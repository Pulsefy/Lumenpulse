#![no_std]

mod errors;
mod events;
mod storage;

use errors::TreasuryError;
use reentrancy_guard::{acquire as acquire_reentrancy, release as release_reentrancy};
use soroban_sdk::{contract, contractimpl, token, Address, Bytes, BytesN, Env, Symbol};
use storage::{DataKey, StreamData, LEDGER_BUMP, LEDGER_THRESHOLD};

#[contract]
pub struct TreasuryContract;

#[contractimpl]
impl TreasuryContract {
    fn with_reentrancy_guard<T, F>(env: &Env, f: F) -> Result<T, TreasuryError>
    where
        F: FnOnce() -> Result<T, TreasuryError>,
    {
        acquire_reentrancy(env).map_err(|_| TreasuryError::Reentrancy)?;
        let result = f();
        release_reentrancy(env);
        result
    }

    /// Check if timelock is enabled
    fn is_timelock_enabled(env: &Env) -> bool {
        env.storage().instance().has(&DataKey::TimelockContract)
    }

    /// Get timelock contract address
    fn get_timelock_contract(env: &Env) -> Option<Address> {
        env.storage().instance().get(&DataKey::TimelockContract)
    }

    /// Queue a timelocked admin action
    fn queue_timelocked_action(
        env: &Env,
        admin: &Address,
        action_type: Symbol,
        payload: Bytes,
        delay: u64,
    ) -> Result<BytesN<32>, TreasuryError> {
        let timelock = Self::get_timelock_contract(env)
            .ok_or(TreasuryError::TimelockNotConfigured)?;

        // Call timelock contract to queue the action
        let proposal_id: BytesN<32> = env.invoke_contract(
            &timelock,
            &Symbol::new(env, "queue_action"),
            soroban_sdk::vec![
                env,
                admin.into_val(env),
                action_type.into_val(env),
                env.current_contract_address().into_val(env),
                payload.into_val(env),
                delay.into_val(env),
            ],
        );

        Ok(proposal_id)
    }

    /// Calculate how much is currently unlocked for a stream
    fn calculate_unlocked(current_time: u64, stream: &StreamData) -> i128 {
        if current_time < stream.start_time {
            0
        } else if current_time >= stream.start_time + stream.duration {
            stream.total_amount - stream.claimed_amount
        } else {
            let time_elapsed = current_time - stream.start_time;
            let total_unlocked = (stream.total_amount as u128)
                .checked_mul(time_elapsed as u128)
                .and_then(|x| x.checked_div(stream.duration as u128))
                .unwrap_or(0) as i128;
            total_unlocked - stream.claimed_amount
        }
    }

    /// Initialize the treasury with admin and token
    /// `timelock_contract` - optional timelock contract for admin actions
    pub fn initialize(
        env: Env,
        admin: Address,
        token: Address,
        timelock_contract: Option<Address>,
    ) -> Result<(), TreasuryError> {
        if env.storage().instance().has(&DataKey::Admin) {
            return Err(TreasuryError::AlreadyInitialized);
        }
        admin.require_auth();
        env.storage().instance().set(&DataKey::Admin, &admin);
        env.storage().instance().set(&DataKey::Token, &token);
        
        if let Some(ref timelock) = timelock_contract {
            env.storage().instance().set(&DataKey::TimelockContract, timelock);
        }
        
        Ok(())
    }

    /// Allocate a budget and start a stream
    /// If timelock is enabled, this action will be queued for delayed execution
    pub fn allocate_budget(
        env: Env,
        admin: Address,
        beneficiary: Address,
        amount: i128,
        start_time: u64,
        duration: u64,
    ) -> Result<(), TreasuryError> {
        // If timelock is enabled, queue the action
        if Self::is_timelock_enabled(&env) {
            let payload = env.serialize((&beneficiary, amount, start_time, duration));
            let proposal_id = Self::queue_timelocked_action(
                &env,
                &admin,
                Symbol::new(&env, "allocate_budget"),
                payload,
                86400, // 24 hour delay
            )?;
            
            events::AdminActionQueuedEvent {
                admin,
                action: Symbol::new(&env, "allocate_budget"),
                proposal_id,
            }.publish(&env);
            
            return Ok(());
        }
        
        Self::with_reentrancy_guard(&env, || {
            let stored_admin: Address = env
                .storage()
                .instance()
                .get(&DataKey::Admin)
                .ok_or(TreasuryError::NotInitialized)?;

            if admin != stored_admin {
                return Err(TreasuryError::Unauthorized);
            }
            admin.require_auth();

            if amount <= 0 {
                return Err(TreasuryError::InvalidAmount);
            }
            if duration == 0 {
                return Err(TreasuryError::InvalidDuration);
            }

            let token_addr: Address = env
                .storage()
                .instance()
                .get(&DataKey::Token)
                .ok_or(TreasuryError::NotInitialized)?;

            let stream = StreamData {
                beneficiary: beneficiary.clone(),
                total_amount: amount,
                claimed_amount: 0,
                start_time,
                duration,
            };

            env.storage()
                .persistent()
                .set(&DataKey::Stream(beneficiary.clone()), &stream);
            env.storage().persistent().extend_ttl(
                &DataKey::Stream(beneficiary.clone()),
                LEDGER_THRESHOLD,
                LEDGER_BUMP,
            );

            // Transfer tokens from admin to treasury
            let token_client = token::TokenClient::new(&env, &token_addr);
            token_client.transfer(&admin, env.current_contract_address(), &amount);

            events::publish_stream_created(&env, beneficiary, amount, start_time, duration);

            Ok(())
        })
    }

    /// Claim unlocked funds
    pub fn claim(env: Env, beneficiary: Address) -> Result<i128, TreasuryError> {
        Self::with_reentrancy_guard(&env, || {
            beneficiary.require_auth();

            let key = DataKey::Stream(beneficiary.clone());
            let mut stream: StreamData = env
                .storage()
                .persistent()
                .get(&key)
                .ok_or(TreasuryError::StreamNotFound)?;

            let current_time = env.ledger().timestamp();
            let unlocked = Self::calculate_unlocked(current_time, &stream);

            if unlocked <= 0 {
                return Err(TreasuryError::NothingToClaim);
            }

            let token_addr: Address = env
                .storage()
                .instance()
                .get(&DataKey::Token)
                .ok_or(TreasuryError::NotInitialized)?;

            stream.claimed_amount += unlocked;
            let remaining = stream.total_amount - stream.claimed_amount;

            if remaining == 0 {
                env.storage().persistent().remove(&key);
            } else {
                env.storage().persistent().set(&key, &stream);
                env.storage()
                    .persistent()
                    .extend_ttl(&key, LEDGER_THRESHOLD, LEDGER_BUMP);
            }

            let token_client = token::TokenClient::new(&env, &token_addr);
            token_client.transfer(&env.current_contract_address(), &beneficiary, &unlocked);

            events::publish_tokens_claimed(&env, beneficiary, unlocked, remaining);

            Ok(unlocked)
        })
    }

    /// View currently unlocked amount
    pub fn get_unlocked(env: Env, beneficiary: Address) -> Result<i128, TreasuryError> {
        let key = DataKey::Stream(beneficiary);
        let stream: StreamData = env
            .storage()
            .persistent()
            .get(&key)
            .ok_or(TreasuryError::StreamNotFound)?;

        Ok(Self::calculate_unlocked(env.ledger().timestamp(), &stream))
    }

    pub fn get_admin(env: Env) -> Result<Address, TreasuryError> {
        env.storage()
            .instance()
            .get(&DataKey::Admin)
            .ok_or(TreasuryError::NotInitialized)
    }

    pub fn get_token(env: Env) -> Result<Address, TreasuryError> {
        env.storage()
            .instance()
            .get(&DataKey::Token)
            .ok_or(TreasuryError::NotInitialized)
    }

    // ── Admin controls with timelock support ──────────────────────────────────

    /// Change the treasury token destination (requires timelock if enabled)
    pub fn set_token(
        env: Env,
        admin: Address,
        new_token: Address,
    ) -> Result<(), TreasuryError> {
        let stored_admin: Address = env
            .storage()
            .instance()
            .get(&DataKey::Admin)
            .ok_or(TreasuryError::NotInitialized)?;

        if admin != stored_admin {
            return Err(TreasuryError::Unauthorized);
        }
        admin.require_auth();

        // If timelock is enabled, queue the action
        if Self::is_timelock_enabled(&env) {
            let payload = env.serialize(&new_token);
            let proposal_id = Self::queue_timelocked_action(
                &env,
                &admin,
                Symbol::new(&env, "set_token"),
                payload,
                86400, // 24 hour delay
            )?;
            
            events::AdminActionQueuedEvent {
                admin,
                action: Symbol::new(&env, "set_token"),
                proposal_id,
            }.publish(&env);
            
            return Ok(());
        }

        // Immediate execution if no timelock
        let old_token: Address = env
            .storage()
            .instance()
            .get(&DataKey::Token)
            .ok_or(TreasuryError::NotInitialized)?;

        env.storage().instance().set(&DataKey::Token, &new_token);

        events::TreasuryDestinationChangedEvent {
            admin,
            old_token,
            new_token,
        }.publish(&env);

        Ok(())
    }

    /// Transfer admin role (requires timelock if enabled)
    pub fn set_admin(
        env: Env,
        current_admin: Address,
        new_admin: Address,
    ) -> Result<(), TreasuryError> {
        let stored_admin: Address = env
            .storage()
            .instance()
            .get(&DataKey::Admin)
            .ok_or(TreasuryError::NotInitialized)?;

        if current_admin != stored_admin {
            return Err(TreasuryError::Unauthorized);
        }
        current_admin.require_auth();

        // If timelock is enabled, queue the action
        if Self::is_timelock_enabled(&env) {
            let payload = env.serialize(&new_admin);
            let proposal_id = Self::queue_timelocked_action(
                &env,
                &current_admin,
                Symbol::new(&env, "set_admin"),
                payload,
                86400, // 24 hour delay
            )?;
            
            events::AdminActionQueuedEvent {
                admin: current_admin,
                action: Symbol::new(&env, "set_admin"),
                proposal_id,
            }.publish(&env);
            
            return Ok(());
        }

        // Immediate execution if no timelock
        env.storage().instance().set(&DataKey::Admin, &new_admin);

        Ok(())
    }
}

#[cfg(test)]
mod test;
