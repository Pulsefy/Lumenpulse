#![no_std]

mod errors;
mod events;
mod storage;

use errors::ContributorError;
use events::{AdminChangedEvent, UpgradedEvent};
use notification_interface::{Notification, NotificationReceiverTrait};
use soroban_sdk::xdr::FromXdr;
use soroban_sdk::{contract, contractimpl, Address, BytesN, Env, String, Symbol};
use storage::{ContributorData, DataKey};

#[contract]
pub struct ContributorRegistryContract;

#[contractimpl]
impl ContributorRegistryContract {
    fn ensure_github_handle_available(
        env: &Env,
        github_handle: &String,
        address: &Address,
    ) -> Result<(), ContributorError> {
        if let Some(existing_address) = env
            .storage()
            .persistent()
            .get::<_, Address>(&DataKey::GitHubIndex(github_handle.clone()))
        {
            if existing_address != *address {
                return Err(ContributorError::GitHubHandleTaken);
            }
        }
        Ok(())
    }

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
        Self::ensure_github_handle_available(&env, &github_handle, &address)?;
        let timestamp = env.ledger().timestamp();
        let contributor = ContributorData {
            address: address.clone(),
            github_handle: github_handle.clone(),
            reputation_score: 0,
            registered_timestamp: timestamp,
        };
        env.storage()
            .persistent()
            .set(&DataKey::Contributor(address.clone()), &contributor);
        env.storage()
            .persistent()
            .set(&DataKey::GitHubIndex(github_handle), &address);

        Ok(())
    }

    /// Update an existing contributor's profile data.
    pub fn update_contributor(
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
        let mut contributor: ContributorData = env
            .storage()
            .persistent()
            .get(&DataKey::Contributor(address.clone()))
            .ok_or(ContributorError::ContributorNotFound)?;

        Self::ensure_github_handle_available(&env, &github_handle, &address)?;
        if contributor.github_handle != github_handle {
            env.storage()
                .persistent()
                .remove(&DataKey::GitHubIndex(contributor.github_handle.clone()));
        }

        contributor.github_handle = github_handle.clone();
        env.storage()
            .persistent()
            .set(&DataKey::Contributor(address.clone()), &contributor);
        env.storage()
            .persistent()
            .set(&DataKey::GitHubIndex(github_handle), &address);

        Ok(())
    }

    /// Update the reputation score of a contributor (admin only)
    pub fn update_reputation(
        env: Env,
        admin: Address,
        contributor_address: Address,
        delta: i64,
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

        let new_score = if delta > 0 {
            contributor
                .reputation_score
                .checked_add(delta as u64)
                .ok_or(ContributorError::ReputationOverflow)?
        } else {
            let new_delta = match delta.checked_abs() {
                Some(new_delta) => new_delta as u64,
                None => 0,
            };
            contributor.reputation_score.saturating_sub(new_delta)
        };
        contributor.reputation_score = new_score;
        env.storage()
            .persistent()
            .set(&DataKey::Contributor(contributor_address), &contributor);

        Ok(())
    }

    /// Get contributor reputation
    pub fn get_reputation(env: Env, contributor: Address) -> Result<u64, ContributorError> {
        let contributor_data: ContributorData = Self::get_contributor(env, contributor)?;
        Ok(contributor_data.reputation_score)
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

    /// Get contributor profile data by GitHub handle.
    pub fn get_contributor_by_github(
        env: Env,
        github_handle: String,
    ) -> Result<ContributorData, ContributorError> {
        let contributor_address: Address = env
            .storage()
            .persistent()
            .get(&DataKey::GitHubIndex(github_handle))
            .ok_or(ContributorError::ContributorNotFound)?;
        Self::get_contributor(env, contributor_address)
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

#[contractimpl]
impl NotificationReceiverTrait for ContributorRegistryContract {
    fn on_notify(env: Env, notification: Notification) {
        // Only react to "deposit" events
        if notification.event_type == Symbol::new(&env, "deposit") {
            // Unpack data: (user: Address, project_id: u64, amount: i128)
            let (user, _project_id, _amount): (Address, u64, i128) =
                <(Address, u64, i128)>::from_xdr(&env, &notification.data).unwrap();

            // Attempt to update reputation (1 point per deposit for now)
            // If the contributor is not registered, this will fail silently or we could register them
            if let Some(mut contributor) = env
                .storage()
                .persistent()
                .get::<_, ContributorData>(&DataKey::Contributor(user.clone()))
            {
                contributor.reputation_score = contributor.reputation_score.saturating_add(1);
                env.storage()
                    .persistent()
                    .set(&DataKey::Contributor(user), &contributor);
            }
        }
    }
}

#[cfg(test)]
mod test;
