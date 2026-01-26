#![no_std]

mod errors;
mod storage;

use errors::ContributorError;
use soroban_sdk::{contract, contractimpl, Address, Env, String};
use storage::{ContributorData, DataKey};

#[contract]
pub struct ContributorRegistryContract;

#[contractimpl]
impl ContributorRegistryContract {
    /// Initialize the contract with an admin address
    pub fn initialize(env: Env, admin: Address) -> Result<(), ContributorError> {
        // Check if already initialized
        if env.storage().instance().has(&DataKey::Admin) {
            return Err(ContributorError::AlreadyInitialized);
        }

        // Require admin authorization
        admin.require_auth();

        // Store admin address
        env.storage().instance().set(&DataKey::Admin, &admin);

        Ok(())
    }

    /// Register a new contributor with their GitHub handle
    pub fn register_contributor(
        env: Env,
        address: Address,
        github_handle: String,
    ) -> Result<(), ContributorError> {
        // Check if contract is initialized
        if !env.storage().instance().has(&DataKey::Admin) {
            return Err(ContributorError::NotInitialized);
        }

        // Require contributor authorization
        address.require_auth();

        // Validate GitHub handle (must not be empty)
        if github_handle.is_empty() {
            return Err(ContributorError::InvalidGitHubHandle);
        }

        // Check if contributor already exists
        if env
            .storage()
            .persistent()
            .has(&DataKey::Contributor(address.clone()))
        {
            return Err(ContributorError::ContributorAlreadyExists);
        }

        // Get current timestamp
        let timestamp = env.ledger().timestamp();

        // Create contributor data
        let contributor = ContributorData {
            address: address.clone(),
            github_handle,
            reputation_score: 0, // Start with 0 reputation
            registered_timestamp: timestamp,
        };

        // Store contributor
        env.storage()
            .persistent()
            .set(&DataKey::Contributor(address), &contributor);

        Ok(())
    }

    /// Update the reputation score of a contributor (admin only)
    pub fn update_reputation(
        env: Env,
        admin: Address,
        contributor_address: Address,
        new_score: u64,
    ) -> Result<(), ContributorError> {
        // Check if contract is initialized
        let stored_admin: Address = env
            .storage()
            .instance()
            .get(&DataKey::Admin)
            .ok_or(ContributorError::NotInitialized)?;

        // Verify admin identity
        if admin != stored_admin {
            return Err(ContributorError::Unauthorized);
        }

        // Require admin authorization
        admin.require_auth();

        // Get contributor data
        let mut contributor: ContributorData = env
            .storage()
            .persistent()
            .get(&DataKey::Contributor(contributor_address.clone()))
            .ok_or(ContributorError::ContributorNotFound)?;

        // Update reputation score
        contributor.reputation_score = new_score;

        // Save updated contributor
        env.storage()
            .persistent()
            .set(&DataKey::Contributor(contributor_address), &contributor);

        Ok(())
    }

    /// Get contributor profile data
    pub fn get_contributor(
        env: Env,
        address: Address,
    ) -> Result<ContributorData, ContributorError> {
        env.storage()
            .persistent()
            .get(&DataKey::Contributor(address))
            .ok_or(ContributorError::ContributorNotFound)
    }

    /// Get admin address
    pub fn get_admin(env: Env) -> Result<Address, ContributorError> {
        env.storage()
            .instance()
            .get(&DataKey::Admin)
            .ok_or(ContributorError::NotInitialized)
    }
}

#[cfg(test)]
mod test;
