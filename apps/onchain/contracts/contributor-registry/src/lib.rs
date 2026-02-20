#![no_std]

mod errors;
mod events;
mod storage;

use errors::ContributorError;
use events::{AdminChangedEvent, UpgradedEvent};
use soroban_sdk::{contract, contractimpl, Address, BytesN, Env, String};
use storage::{ContributorData, DataKey};

#[contract]
pub struct ContributorRegistryContract;

#[contractimpl]
impl ContributorRegistryContract {
    /// Initialize the contract with an admin address
    pub fn initialize(env: Env, admin: Address) -> Result<(), ContributorError> {
        if env.storage().instance().has(&DataKey::Admin) {
            return Err(ContributorError::AlreadyInitialized);
        }
        admin.require_auth();
        env.storage().instance().set(&DataKey::Admin, &admin);
        Ok(())
    }

    /// Register a new contributor with their GitHub handle
    pub fn register_contributor(
        env: Env,
        address: Address,
        github_handle: String,
    ) -> Result<(), ContributorError> {
        if !env.storage().instance().has(&DataKey::Admin) {
            return Err(ContributorError::NotInitialized);
        }
        address.require_auth();
        if github_handle.is_empty() {
            return Err(ContributorError::InvalidGitHubHandle);
        }
        if env
            .storage()
            .persistent()
            .has(&DataKey::Contributor(address.clone()))
        {
            return Err(ContributorError::ContributorAlreadyExists);
        }
        let timestamp = env.ledger().timestamp();
        let contributor = ContributorData {
            address: address.clone(),
            github_handle,
            reputation_score: 0,
            registered_timestamp: timestamp,
        };
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
        let stored_admin: Address = env
            .storage()
            .instance()
            .get(&DataKey::Admin)
            .ok_or(ContributorError::NotInitialized)?;
        if admin != stored_admin {
            return Err(ContributorError::Unauthorized);
        }
        admin.require_auth();
        let mut contributor: ContributorData = env
            .storage()
            .persistent()
            .get(&DataKey::Contributor(contributor_address.clone()))
            .ok_or(ContributorError::ContributorNotFound)?;
        contributor.reputation_score = new_score;
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

    /// Upgrade the contract WASM to a new hash.
    ///
    /// Only the stored admin may call this. Emits [`UpgradedEvent`] on success.
    pub fn upgrade(
        env: Env,
        caller: Address,
        new_wasm_hash: BytesN<32>,
    ) -> Result<(), ContributorError> {
        let admin: Address = env
            .storage()
            .instance()
            .get(&DataKey::Admin)
            .ok_or(ContributorError::NotInitialized)?;
        if caller != admin {
            return Err(ContributorError::Unauthorized);
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
    ) -> Result<(), ContributorError> {
        let stored_admin: Address = env
            .storage()
            .instance()
            .get(&DataKey::Admin)
            .ok_or(ContributorError::NotInitialized)?;
        if current_admin != stored_admin {
            return Err(ContributorError::Unauthorized);
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
