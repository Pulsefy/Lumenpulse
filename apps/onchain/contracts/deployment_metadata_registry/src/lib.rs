#![no_std]

mod errors;
mod events;
mod storage;

use errors::DeploymentRegistryError;
use soroban_sdk::{contract, contractimpl, vec, Address, Env, Map, String, Symbol, Vec};
use storage::{DataKey, DeploymentMetadata};

#[contract]
pub struct DeploymentMetadataRegistryContract;

#[contractimpl]
impl DeploymentMetadataRegistryContract {
    pub fn initialize(env: Env, admin: Address) -> Result<(), DeploymentRegistryError> {
        if env.storage().instance().has(&DataKey::Admin) {
            return Err(DeploymentRegistryError::AlreadyInitialized);
        }

        admin.require_auth();
        env.storage().instance().set(&DataKey::Admin, &admin);
        let keys: Vec<Symbol> = vec![&env];
        env.storage()
            .persistent()
            .set(&DataKey::DeploymentKeys, &keys);

        events::InitializedEvent { admin }.publish(&env);
        Ok(())
    }

    pub fn set_deployment(
        env: Env,
        admin: Address,
        key: Symbol,
        contract_address: Address,
        version: String,
        environment: String,
    ) -> Result<(), DeploymentRegistryError> {
        Self::require_admin(&env, &admin)?;
        Self::require_metadata(&version, &environment)?;

        let entry = DeploymentMetadata {
            key: key.clone(),
            contract_address: contract_address.clone(),
            version: version.clone(),
            environment: environment.clone(),
            updated_at: env.ledger().timestamp(),
            active: true,
        };

        env.storage()
            .persistent()
            .set(&DataKey::Deployment(key.clone()), &entry);
        Self::remember_key(&env, &key);

        events::DeploymentSetEvent {
            key,
            admin,
            contract_address,
            version,
            environment,
        }
        .publish(&env);

        Ok(())
    }

    pub fn deactivate_deployment(
        env: Env,
        admin: Address,
        key: Symbol,
    ) -> Result<(), DeploymentRegistryError> {
        Self::require_admin(&env, &admin)?;

        let mut entry: DeploymentMetadata = env
            .storage()
            .persistent()
            .get(&DataKey::Deployment(key.clone()))
            .ok_or(DeploymentRegistryError::ContractNotFound)?;
        entry.active = false;

        env.storage()
            .persistent()
            .set(&DataKey::Deployment(key.clone()), &entry);

        events::DeploymentDeactivatedEvent { key, admin }.publish(&env);
        Ok(())
    }

    pub fn get_deployment(
        env: Env,
        key: Symbol,
    ) -> Result<DeploymentMetadata, DeploymentRegistryError> {
        env.storage()
            .persistent()
            .get(&DataKey::Deployment(key))
            .ok_or(DeploymentRegistryError::ContractNotFound)
    }

    pub fn get_active_deployments(env: Env) -> Map<Symbol, DeploymentMetadata> {
        let keys: Vec<Symbol> = env
            .storage()
            .persistent()
            .get(&DataKey::DeploymentKeys)
            .unwrap_or(vec![&env]);
        let mut deployments = Map::new(&env);

        for key in keys.iter() {
            if let Some(entry) = env
                .storage()
                .persistent()
                .get::<_, DeploymentMetadata>(&DataKey::Deployment(key.clone()))
            {
                if entry.active {
                    deployments.set(key, entry);
                }
            }
        }

        deployments
    }

    pub fn get_deployment_keys(env: Env) -> Vec<Symbol> {
        env.storage()
            .persistent()
            .get(&DataKey::DeploymentKeys)
            .unwrap_or(vec![&env])
    }

    pub fn get_admin(env: Env) -> Result<Address, DeploymentRegistryError> {
        env.storage()
            .instance()
            .get(&DataKey::Admin)
            .ok_or(DeploymentRegistryError::NotInitialized)
    }

    pub fn set_admin(
        env: Env,
        current_admin: Address,
        new_admin: Address,
    ) -> Result<(), DeploymentRegistryError> {
        Self::require_admin(&env, &current_admin)?;
        env.storage().instance().set(&DataKey::Admin, &new_admin);

        events::AdminTransferredEvent {
            old_admin: current_admin,
            new_admin,
        }
        .publish(&env);

        Ok(())
    }

    fn require_admin(env: &Env, caller: &Address) -> Result<(), DeploymentRegistryError> {
        let admin: Address = env
            .storage()
            .instance()
            .get(&DataKey::Admin)
            .ok_or(DeploymentRegistryError::NotInitialized)?;
        if caller != &admin {
            return Err(DeploymentRegistryError::Unauthorized);
        }
        caller.require_auth();
        Ok(())
    }

    fn require_metadata(
        version: &String,
        environment: &String,
    ) -> Result<(), DeploymentRegistryError> {
        if version.len() == 0 {
            return Err(DeploymentRegistryError::EmptyVersion);
        }
        if environment.len() == 0 {
            return Err(DeploymentRegistryError::EmptyEnvironment);
        }
        Ok(())
    }

    fn remember_key(env: &Env, key: &Symbol) {
        let mut keys: Vec<Symbol> = env
            .storage()
            .persistent()
            .get(&DataKey::DeploymentKeys)
            .unwrap_or(vec![env]);

        if !keys.iter().any(|existing| &existing == key) {
            keys.push_back(key.clone());
            env.storage()
                .persistent()
                .set(&DataKey::DeploymentKeys, &keys);
        }
    }
}

#[cfg(test)]
mod test;
