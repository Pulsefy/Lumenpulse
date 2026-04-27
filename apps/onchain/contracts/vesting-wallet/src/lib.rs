#![no_std]

mod errors;
mod events;
mod storage;
mod token;
mod vault_interface;

use errors::VestingError;
use events::{AdminChangedEvent, UpgradedEvent};
use soroban_sdk::{contract, contractimpl, Address, BytesN, Env};
use storage::{
    DataKey, MilestoneLink, MilestoneRequirement, VestingData, LEDGER_BUMP, LEDGER_THRESHOLD,
};
use token::transfer;
use vault_interface::CrowdfundVaultClient;

#[contract]
pub struct VestingWalletContract;

#[contractimpl]
impl VestingWalletContract {
    fn milestone_completed(env: &Env, vesting: &VestingData) -> bool {
        match &vesting.milestone_requirement {
            MilestoneRequirement::External(link) => {
                let vault_client = CrowdfundVaultClient::new(env, &link.vault_contract);
                vault_client.is_milestone_approved(&link.project_id, &link.milestone_id)
            }
            MilestoneRequirement::None => true,
        }
    }

    /// Helper function to calculate claimable amount for a vesting schedule
    /// This is used by both get_claimable and claim to ensure consistency
    fn calculate_claimable_amount(env: &Env, current_time: u64, vesting: &VestingData) -> i128 {
        if !Self::milestone_completed(env, vesting) || current_time < vesting.start_time {
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
        env.storage()
            .instance()
            .extend_ttl(LEDGER_THRESHOLD, LEDGER_BUMP);

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
        Self::create_vesting_internal(
            env,
            admin,
            beneficiary,
            amount,
            start_time,
            duration,
            MilestoneRequirement::None,
        )
    }

    /// Create a vesting schedule that is gated by an external crowdfund vault milestone.
    pub fn create_vesting_with_milestone(
        env: Env,
        admin: Address,
        beneficiary: Address,
        amount: i128,
        start_time: u64,
        duration: u64,
        milestone_link: MilestoneLink,
    ) -> Result<(), VestingError> {
        Self::create_vesting_internal(
            env,
            admin,
            beneficiary,
            amount,
            start_time,
            duration,
            MilestoneRequirement::External(milestone_link),
        )
    }

    fn create_vesting_internal(
        env: Env,
        admin: Address,
        beneficiary: Address,
        amount: i128,
        start_time: u64,
        duration: u64,
        milestone_requirement: MilestoneRequirement,
    ) -> Result<(), VestingError> {
        // Check if contract is initialized
        let stored_admin: Address = env
            .storage()
            .instance()
            .get(&DataKey::Admin)
            .ok_or(VestingError::NotInitialized)?;
        env.storage()
            .instance()
            .extend_ttl(LEDGER_THRESHOLD, LEDGER_BUMP);

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
        env.storage()
            .instance()
            .extend_ttl(LEDGER_THRESHOLD, LEDGER_BUMP);

        let contract_address = env.current_contract_address();

        if let MilestoneRequirement::External(link) = &milestone_requirement {
            let vault_client = CrowdfundVaultClient::new(&env, &link.vault_contract);
            let _ = vault_client.is_milestone_approved(&link.project_id, &link.milestone_id);
        }

        // If vesting already exists, return remaining tokens to admin
        // (total_amount - claimed_amount)
        if let Some(existing_vesting) = env
            .storage()
            .persistent()
            .get::<_, VestingData>(&DataKey::Vesting(beneficiary.clone()))
        {
            env.storage().persistent().extend_ttl(
                &DataKey::Vesting(beneficiary.clone()),
                LEDGER_THRESHOLD,
                LEDGER_BUMP,
            );
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
            milestone_requirement,
        };

        // Store vesting data
        env.storage()
            .persistent()
            .set(&DataKey::Vesting(beneficiary.clone()), &vesting);
        env.storage().persistent().extend_ttl(
            &DataKey::Vesting(beneficiary.clone()),
            LEDGER_THRESHOLD,
            LEDGER_BUMP,
        );

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
        env.storage()
            .instance()
            .extend_ttl(LEDGER_THRESHOLD, LEDGER_BUMP);

        // Require beneficiary authorization
        beneficiary.require_auth();

        // Get vesting data
        let vesting_key = DataKey::Vesting(beneficiary.clone());
        let mut vesting: VestingData = env
            .storage()
            .persistent()
            .get(&vesting_key)
            .ok_or(VestingError::VestingNotFound)?;
        env.storage()
            .persistent()
            .extend_ttl(&vesting_key, LEDGER_THRESHOLD, LEDGER_BUMP);

        // Get current time
        let current_time = env.ledger().timestamp();

        // Calculate available amount using the helper function
        let available_amount = Self::calculate_claimable_amount(&env, current_time, &vesting);

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
        env.storage()
            .instance()
            .extend_ttl(LEDGER_THRESHOLD, LEDGER_BUMP);

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

        let remaining = vesting.total_amount - vesting.claimed_amount;

        if remaining == 0 {
            // State compaction: remove the entry once fully claimed to reclaim rent.
            env.storage().persistent().remove(&vesting_key);
        } else {
            env.storage().persistent().set(&vesting_key, &vesting);
            env.storage()
                .persistent()
                .extend_ttl(&vesting_key, LEDGER_THRESHOLD, LEDGER_BUMP);
        }

        // Emit TokensClaimed event
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
        let key = DataKey::Vesting(beneficiary);
        let vesting: VestingData = env
            .storage()
            .persistent()
            .get(&key)
            .ok_or(VestingError::VestingNotFound)?;
        env.storage()
            .persistent()
            .extend_ttl(&key, LEDGER_THRESHOLD, LEDGER_BUMP);

        // Get current time
        let current_time = env.ledger().timestamp();

        // Calculate claimable amount using the helper function
        let claimable_amount = Self::calculate_claimable_amount(&env, current_time, &vesting);

        Ok(claimable_amount)
    }

    /// Get vesting data for a beneficiary
    pub fn get_vesting(env: Env, beneficiary: Address) -> Result<VestingData, VestingError> {
        let key = DataKey::Vesting(beneficiary);
        let data = env
            .storage()
            .persistent()
            .get(&key)
            .ok_or(VestingError::VestingNotFound)?;
        env.storage()
            .persistent()
            .extend_ttl(&key, LEDGER_THRESHOLD, LEDGER_BUMP);
        Ok(data)
    }

    /// Get the available amount that can be claimed by a beneficiary
    pub fn get_available_amount(env: Env, beneficiary: Address) -> Result<i128, VestingError> {
        // Get vesting data
        let key = DataKey::Vesting(beneficiary);
        let vesting: VestingData = env
            .storage()
            .persistent()
            .get(&key)
            .ok_or(VestingError::VestingNotFound)?;
        env.storage()
            .persistent()
            .extend_ttl(&key, LEDGER_THRESHOLD, LEDGER_BUMP);

        // Get current time
        let current_time = env.ledger().timestamp();

        // Calculate available amount using the helper function
        let available_amount = Self::calculate_claimable_amount(&env, current_time, &vesting);

        Ok(available_amount)
    }

    /// Get admin address
    pub fn get_admin(env: Env) -> Result<Address, VestingError> {
        let admin = env
            .storage()
            .instance()
            .get(&DataKey::Admin)
            .ok_or(VestingError::NotInitialized)?;
        env.storage()
            .instance()
            .extend_ttl(LEDGER_THRESHOLD, LEDGER_BUMP);
        Ok(admin)
    }

    /// Get token address
    pub fn get_token(env: Env) -> Result<Address, VestingError> {
        let token = env
            .storage()
            .instance()
            .get(&DataKey::Token)
            .ok_or(VestingError::NotInitialized)?;
        env.storage()
            .instance()
            .extend_ttl(LEDGER_THRESHOLD, LEDGER_BUMP);
        Ok(token)
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
        env.storage()
            .instance()
            .extend_ttl(LEDGER_THRESHOLD, LEDGER_BUMP);
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
        env.storage()
            .instance()
            .extend_ttl(LEDGER_THRESHOLD, LEDGER_BUMP);
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
