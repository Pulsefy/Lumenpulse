#![no_std]

mod errors;
mod events;
mod storage;

use errors::RegistryError;
use soroban_sdk::{contract, contractimpl, Address, Env, Symbol, Vec};
use storage::{ContractInfo, DataKey};

#[contract]
pub struct ContractRegistry;

#[contractimpl]
impl ContractRegistry {
    // ── Helpers ──────────────────────────────────────────────────────────────
    fn require_admin(env: &Env, caller: &Address) -> Result<(), RegistryError> {
        let admin: Address = env
            .storage()
            .instance()
            .get(&DataKey::Admin)
            .ok_or(RegistryError::NotInitialized)?;
        if caller != &admin {
            return Err(RegistryError::Unauthorized);
        }
        caller.require_auth();
        Ok(())
    }

    // ── Initialise ────────────────────────────────────────────────────────
    pub fn initialize(env: Env, admin: Address) -> Result<(), RegistryError> {
        if env.storage().instance().has(&DataKey::Admin) {
            return Err(RegistryError::AlreadyInitialized);
        }
        admin.require_auth();
        env.storage().instance().set(&DataKey::Admin, &admin);
        env.storage().instance().set(&DataKey::Paused, &false);
        events::InitializedEvent { admin }.publish(&env);
        Ok(())
    }

    // ── Admin controls ────────────────────────────────────────────────────────
    pub fn pause(env: Env, admin: Address) -> Result<(), RegistryError> {
        Self::require_admin(&env, &admin)?;
        env.storage().instance().set(&DataKey::Paused, &true);
        Ok(())
    }

    pub fn unpause(env: Env, admin: Address) -> Result<(), RegistryError> {
        Self::require_admin(&env, &admin)?;
        env.storage().instance().set(&DataKey::Paused, &false);
        Ok(())
    }

    // ── Registry operations ─────────────────────────────────────────────────────
    pub fn register_contract(
        env: Env,
        admin: Address,
        key: Symbol,
        address: Address,
        version: u32,
        env_meta: Symbol,
    ) -> Result<(), RegistryError> {
        Self::require_admin(&env, &admin)?;

        let contract_key = DataKey::Contract(key.clone());
        if !env.storage().persistent().has(&contract_key) {
            let mut keys: Vec<Symbol> = env
                .storage()
                .instance()
                .get(&DataKey::ContractKeys)
                .unwrap_or_else(|| Vec::new(&env));
            keys.push_back(key.clone());
            env.storage().instance().set(&DataKey::ContractKeys, &keys);
        }

        let info = ContractInfo {
            key: key.clone(),
            address: address.clone(),
            version,
            environment: env_meta.clone(),
        };
        env.storage().persistent().set(&contract_key, &info);

        events::ContractRegisteredEvent {
            key,
            address,
            version,
            env: env_meta,
        }
        .publish(&env);
        Ok(())
    }

    pub fn update_contract(
        env: Env,
        admin: Address,
        key: Symbol,
        address: Address,
        version: u32,
        env_meta: Symbol,
    ) -> Result<(), RegistryError> {
        Self::require_admin(&env, &admin)?;

        let contract_key = DataKey::Contract(key.clone());
        // Ensure contract exists
        if !env.storage().persistent().has(&contract_key) {
            return Err(RegistryError::ContractNotFound);
        }

        let info = ContractInfo {
            key: key.clone(),
            address,
            version,
            environment: env_meta.clone(),
        };
        env.storage().persistent().set(&contract_key, &info);

        events::ContractUpdatedEvent {
            key,
            version,
            env: env_meta,
        }
        .publish(&env);
        Ok(())
    }

    pub fn get_contract(env: Env, key: Symbol) -> Result<ContractInfo, RegistryError> {
        env.storage()
            .persistent()
            .get::<ContractInfo>(&DataKey::Contract(key))
            .ok_or(RegistryError::ContractNotFound)
    }

    pub fn list_contracts(env: Env) -> Result<Vec<ContractInfo>, RegistryError> {
        let keys: Vec<Symbol> = env
            .storage()
            .instance()
            .get(&DataKey::ContractKeys)
            .unwrap_or_else(|| Vec::new(&env));

        let mut contracts = Vec::new(&env);
        for key in keys.iter() {
            if let Some(info) = env.storage().persistent().get(&DataKey::Contract(key)) {
                contracts.push_back(info);
            }
        }
        Ok(contracts)
    }
}

#[cfg(test)]
mod test;
