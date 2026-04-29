#![no_std]

mod errors;
mod events;
mod storage;

use errors::TreasuryError;
use reentrancy_guard::{acquire as acquire_reentrancy, release as release_reentrancy};
use soroban_sdk::{contract, contractimpl, token, Address, Env};
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
    pub fn initialize(env: Env, admin: Address, token: Address) -> Result<(), TreasuryError> {
        if env.storage().instance().has(&DataKey::Admin) {
            return Err(TreasuryError::AlreadyInitialized);
        }
        admin.require_auth();
        env.storage().instance().set(&DataKey::Admin, &admin);
        env.storage().instance().set(&DataKey::Token, &token);
        Ok(())
    }

    /// Allocate a budget and start a stream
    pub fn allocate_budget(
        env: Env,
        admin: Address,
        beneficiary: Address,
        amount: i128,
        start_time: u64,
        duration: u64,
    ) -> Result<(), TreasuryError> {
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
}

#[cfg(test)]
mod test;
