#![no_std]

mod errors;
mod events;
mod storage;
mod token;

use errors::VestingError;
use events::{AdminChangedEvent, UpgradedEvent};
use soroban_sdk::{contract, contractimpl, Address, BytesN, Env};
use storage::{DataKey, VestingData};
use token::transfer;

#[contract]
pub struct VestingWalletContract;

#[contractimpl]
impl VestingWalletContract {
    /// Helper function to calculate claimable amount for a vesting schedule
    /// This is used by both get_claimable and claim to ensure consistency
    fn calculate_claimable_amount(current_time: u64, vesting: &VestingData) -> i128 {
        if current_time < vesting.start_time {
            // Vesting hasn't started yet
            0
        } else if current_time >= vesting.start_time + vesting.duration {
            // Vesting period has ended, all tokens are available
            vesting.total_amount - vesting.claimed_amount
        } else {
            // Calculate linearly vested amount
            let time_elapsed = current_time - vesting.start_time;
            let total_vested = (vesting.total_amount as u128)
                .checked_mul(time_elapsed as u128)
                .and_then(|x| x.checked_div(vesting.duration as u128))
                .unwrap_or(0) as i128;
            total_vested - vesting.claimed_amount
        }
    }

    /// Initialize the contract with an admin address and token address
    pub fn initialize(env: Env, admin: Address, token: Address) -> Result<(), VestingError> {
        // Check if already initialized
        if env.storage().instance().has(&DataKey::Admin) {
            return Err(VestingError::AlreadyInitialized);
        }

        // Require admin authorization
        admin.require_auth();

        // Store admin address and token address
        env.storage().instance().set(&DataKey::Admin, &admin);
        env.storage().instance().set(&DataKey::Token, &token);

        Ok(())
    }

    /// Create a vesting schedule for a beneficiary
    pub fn create_vesting(
        env: Env,
        admin: Address,
        beneficiary: Address,
        amount: i128,
        start_time: u64,
        duration: u64,
    ) -> Result<(), VestingError> {
        // Check if contract is initialized
        let stored_admin: Address = env
            .storage()
            .instance()
            .get(&DataKey::Admin)
            .ok_or(VestingError::NotInitialized)?;

        // Verify admin identity
        if admin != stored_admin {
            return Err(VestingError::Unauthorized);
        }

        // Require admin authorization
        admin.require_auth();

        // Validate amount
        if amount <= 0 {
            return Err(VestingError::InvalidAmount);
        }

        // Validate duration
        if duration == 0 {
            return Err(VestingError::InvalidDuration);
        }

        // Validate start time (should be in the future or current time)
        let current_time = env.ledger().timestamp();
        if start_time < current_time {
            return Err(VestingError::InvalidStartTime);
        }

        // Get token address
        let token: Address = env
            .storage()
            .instance()
            .get(&DataKey::Token)
            .ok_or(VestingError::NotInitialized)?;

        let contract_address = env.current_contract_address();

        // If vesting already exists, return remaining tokens to admin
        // (total_amount - claimed_amount)
        if let Some(existing_vesting) = env
            .storage()
            .persistent()
            .get::<_, VestingData>(&DataKey::Vesting(beneficiary.clone()))
        {
            let remaining = existing_vesting.total_amount - existing_vesting.claimed_amount;
            if remaining > 0 {
                transfer(&env, &token, &contract_address, &admin, &remaining);
            }
        }

        // Transfer tokens from admin to contract
        transfer(&env, &token, &admin, &contract_address, &amount);

        // Create vesting data
        let vesting = VestingData {
            beneficiary: beneficiary.clone(),
            total_amount: amount,
            start_time,
            duration,
            claimed_amount: 0,
        };

        // Store vesting data
        env.storage()
            .persistent()
            .set(&DataKey::Vesting(beneficiary), &vesting);

        // Emit VestingCreated event
        events::VestingCreatedEvent {
            beneficiary: vesting.beneficiary.clone(),
            amount: vesting.total_amount,
            start_time: vesting.start_time,
            duration: vesting.duration,
        }
        .publish(&env);

        Ok(())
    }

    /// Claim available tokens based on linear vesting schedule
    pub fn claim(env: Env, beneficiary: Address) -> Result<i128, VestingError> {
        // Check if contract is initialized
        if !env.storage().instance().has(&DataKey::Admin) {
            return Err(VestingError::NotInitialized);
        }

        // Require beneficiary authorization
        beneficiary.require_auth();

        // Get vesting data
        let mut vesting: VestingData = env
            .storage()
            .persistent()
            .get(&DataKey::Vesting(beneficiary.clone()))
            .ok_or(VestingError::VestingNotFound)?;

        // Get current time
        let current_time = env.ledger().timestamp();

        // Calculate available amount using the helper function
        let available_amount = Self::calculate_claimable_amount(current_time, &vesting);

        // Check if there's anything to claim
        if available_amount <= 0 {
            return Err(VestingError::NothingToClaim);
        }

        // Get token address
        let token: Address = env
            .storage()
            .instance()
            .get(&DataKey::Token)
            .ok_or(VestingError::NotInitialized)?;

        // Transfer tokens from contract to beneficiary
        let contract_address = env.current_contract_address();
        transfer(
            &env,
            &token,
            &contract_address,
            &beneficiary,
            &available_amount,
        );

        // Update claimed amount
        vesting.claimed_amount += available_amount;
        env.storage()
            .persistent()
            .set(&DataKey::Vesting(beneficiary), &vesting);

        // Emit TokensClaimed event
        let remaining = vesting.total_amount - vesting.claimed_amount;
        events::TokensClaimedEvent {
            beneficiary: vesting.beneficiary.clone(),
            amount_claimed: available_amount,
            remaining,
        }
        .publish(&env);

        Ok(available_amount)
    }

    /// Get the claimable amount for a beneficiary without modifying state
    /// This is a pure view method that returns how much a beneficiary could claim at the current time
    pub fn get_claimable(env: Env, beneficiary: Address) -> Result<i128, VestingError> {
        // Get vesting data
        let vesting: VestingData = env
            .storage()
            .persistent()
            .get(&DataKey::Vesting(beneficiary))
            .ok_or(VestingError::VestingNotFound)?;

        // Get current time
        let current_time = env.ledger().timestamp();

        // Calculate claimable amount using the helper function
        let claimable_amount = Self::calculate_claimable_amount(current_time, &vesting);

        Ok(claimable_amount)
    }

    /// Get vesting data for a beneficiary
    pub fn get_vesting(env: Env, beneficiary: Address) -> Result<VestingData, VestingError> {
        env.storage()
            .persistent()
            .get(&DataKey::Vesting(beneficiary))
            .ok_or(VestingError::VestingNotFound)
    }

    /// Get the available amount that can be claimed by a beneficiary
    pub fn get_available_amount(env: Env, beneficiary: Address) -> Result<i128, VestingError> {
        // Get vesting data
        let vesting: VestingData = env
            .storage()
            .persistent()
            .get(&DataKey::Vesting(beneficiary))
            .ok_or(VestingError::VestingNotFound)?;

        // Get current time
        let current_time = env.ledger().timestamp();

        // Calculate available amount using the helper function
        let available_amount = Self::calculate_claimable_amount(current_time, &vesting);

        Ok(available_amount)
    }

    /// Get admin address
    pub fn get_admin(env: Env) -> Result<Address, VestingError> {
        env.storage()
            .instance()
            .get(&DataKey::Admin)
            .ok_or(VestingError::NotInitialized)
    }

    /// Get token address
    pub fn get_token(env: Env) -> Result<Address, VestingError> {
        env.storage()
            .instance()
            .get(&DataKey::Token)
            .ok_or(VestingError::NotInitialized)
    }

    /// Upgrade the contract WASM to a new hash.
    ///
    /// Only the stored admin may call this. Emits [`UpgradedEvent`] on success.
    pub fn upgrade(
        env: Env,
        caller: Address,
        new_wasm_hash: BytesN<32>,
    ) -> Result<(), VestingError> {
        let admin: Address = env
            .storage()
            .instance()
            .get(&DataKey::Admin)
            .ok_or(VestingError::NotInitialized)?;
        if caller != admin {
            return Err(VestingError::Unauthorized);
        }
        caller.require_auth();
        env.deployer()
            .update_current_contract_wasm(new_wasm_hash.clone());
        UpgradedEvent {
            admin: caller,
            new_wasm_hash,
        }
        .publish(&env);
        Ok(())
    }

    /// Transfer the admin role to `new_admin`.
    ///
    /// Requires authorization from the current admin. Emits [`AdminChangedEvent`].
    pub fn set_admin(
        env: Env,
        current_admin: Address,
        new_admin: Address,
    ) -> Result<(), VestingError> {
        let stored_admin: Address = env
            .storage()
            .instance()
            .get(&DataKey::Admin)
            .ok_or(VestingError::NotInitialized)?;
        if current_admin != stored_admin {
            return Err(VestingError::Unauthorized);
        }
        current_admin.require_auth();
        env.storage().instance().set(&DataKey::Admin, &new_admin);
        AdminChangedEvent {
            old_admin: current_admin,
            new_admin,
        }
        .publish(&env);
        Ok(())
    }
}

#[cfg(test)]
mod test;
