#![no_std]

mod errors;
mod events;
mod storage;

use errors::RegistryError;
use soroban_sdk::{contract, contractimpl, Address, Env, Symbol};
use storage::{DataKey, ContractInfo};

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
        let info = ContractInfo {
            key: key.clone(),
            address: address.clone(),
            version,
            environment: env_meta.clone(),
        };
        env.storage().persistent().set(&DataKey::Contract(key.clone()), &info);
        events::ContractRegisteredEvent { key, address, version, env: env_meta }.publish(&env);
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
        // Ensure contract exists
        if !env.storage().persistent().has(&DataKey::Contract(key.clone())) {
            return Err(RegistryError::ContractNotFound);
        }
        let info = ContractInfo { key: key.clone(), address, version, environment: env_meta };
        env.storage().persistent().set(&DataKey::Contract(key.clone()), &info);
        events::ContractUpdatedEvent { key, version, env: env_meta }.publish(&env);
        Ok(())
    }

    pub fn get_contract(env: Env, key: Symbol) -> Result<ContractInfo, RegistryError> {
        let contract: ContractInfo = env.storage().persistent()
            .get(&DataKey::Contract(key))
            .ok_or(RegistryError::ContractNotFound)?;
        Ok(contract)
    }

    pub fn list_contracts(_env: Env) -> Result<soroban_sdk::Vec<ContractInfo>, RegistryError> {
        // Placeholder implementation – return empty vector.
        Ok(soroban_sdk::Vec::new(&_env))
    }
}

#[cfg(test)]
mod test;
