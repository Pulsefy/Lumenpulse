#![no_std]

mod errors;
mod storage;
mod token;

use errors::VestingError;
use soroban_sdk::{contract, contractimpl, Address, Env};
use storage::{DataKey, VestingData};
use token::transfer;

#[contract]
pub struct VestingWalletContract;

#[contractimpl]
impl VestingWalletContract {
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

        // Calculate available amount based on linear vesting
        // claimed = total * (now - start) / duration
        let available_amount = if current_time < vesting.start_time {
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
        };

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

        Ok(available_amount)
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

        // Calculate available amount based on linear vesting
        let available_amount = if current_time < vesting.start_time {
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
        };

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
}

#[cfg(test)]
mod test;
