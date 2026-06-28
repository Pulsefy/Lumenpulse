#![no_std]

mod errors;
mod events;
mod storage;

use errors::RegistryError;
use soroban_sdk::{contract, contractimpl, Address, Env, String, Vec};
use storage::{ContractMetadata, DataKey};

#[contract]
pub struct MetadataRegistryContract;

#[contractimpl]
impl MetadataRegistryContract {
    pub fn initialize(env: Env, admin: Address) -> Result<(), RegistryError> {
        if env.storage().instance().has(&DataKey::Admin) {
            return Err(RegistryError::AlreadyInitialized);
        }
        admin.require_auth();

        env.storage().instance().set(&DataKey::Admin, &admin);
        
        // Initialize an empty vector for contracts
        let empty_vec: Vec<String> = Vec::new(&env);
        env.storage().instance().set(&DataKey::AllContracts, &empty_vec);

        events::InitializedEvent { admin }.publish(&env);
        Ok(())
    }

    pub fn set_metadata(
        env: Env,
        admin: Address,
        key: String,
        address: Address,
        version: String,
        environment: String,
    ) -> Result<(), RegistryError> {
        let stored_admin: Address = env
            .storage()
            .instance()
            .get(&DataKey::Admin)
            .ok_or(RegistryError::NotInitialized)?;
            
        if admin != stored_admin {
            return Err(RegistryError::Unauthorized);
        }
        admin.require_auth();

        let metadata = ContractMetadata {
            address: address.clone(),
            version: version.clone(),
            environment: environment.clone(),
            updated_at: env.ledger().timestamp(),
        };

        // If it's a new key, add to AllContracts
        let metadata_key = DataKey::Metadata(key.clone());
        if !env.storage().persistent().has(&metadata_key) {
            let mut all_contracts: Vec<String> = env
                .storage()
                .instance()
                .get(&DataKey::AllContracts)
                .unwrap_or_else(|| Vec::new(&env));
            all_contracts.push_back(key.clone());
            env.storage().instance().set(&DataKey::AllContracts, &all_contracts);
        }

        env.storage().persistent().set(&metadata_key, &metadata);

        events::MetadataUpdatedEvent {
            key,
            address,
            version,
            environment,
        }
        .publish(&env);

        Ok(())
    }

    pub fn get_metadata(env: Env, key: String) -> Result<ContractMetadata, RegistryError> {
        env.storage()
            .persistent()
            .get(&DataKey::Metadata(key))
            .ok_or(RegistryError::ContractNotFound)
    }

    pub fn get_all_contracts(env: Env) -> Result<Vec<String>, RegistryError> {
        env.storage()
            .instance()
            .get(&DataKey::AllContracts)
            .ok_or(RegistryError::NotInitialized)
    }
}

#[cfg(test)]
mod test;
