#![no_std]

mod errors;
mod events;
mod storage;

use errors::RegistryError;
use soroban_sdk::{contract, contractimpl, Address, BytesN, Env, Symbol};
use storage::{DataKey, ModuleEntry};

#[contract]
pub struct ProtocolRegistryContract;

#[contractimpl]
impl ProtocolRegistryContract {
    // ── Internal guards ───────────────────────────────────────────────────────

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

    fn require_not_paused(env: &Env) -> Result<(), RegistryError> {
        if env
            .storage()
            .instance()
            .get::<_, bool>(&DataKey::Paused)
            .unwrap_or(false)
        {
            return Err(RegistryError::ContractPaused);
        }
        Ok(())
    }

    // ── Initialization ────────────────────────────────────────────────────────

    /// Deploy and configure the registry. Can only be called once.
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

    // ── Module registration ───────────────────────────────────────────────────

    /// Register a new protocol module. Admin only. Module name must be unique.
    ///
    /// `name`    — canonical module identifier (use `symbol_short!`)
    /// `address` — deployed contract address for this module
    /// `version` — starting version number (must be ≥ 1)
    pub fn register_module(
        env: Env,
        admin: Address,
        name: Symbol,
        address: Address,
        version: u32,
    ) -> Result<(), RegistryError> {
        Self::require_not_paused(&env)?;
        Self::require_admin(&env, &admin)?;

        if env
            .storage()
            .persistent()
            .has(&DataKey::Module(name.clone()))
        {
            return Err(RegistryError::ModuleAlreadyRegistered);
        }

        let entry = ModuleEntry {
            name: name.clone(),
            address: address.clone(),
            version,
            registered_at: env.ledger().timestamp(),
            is_active: true,
        };

        env.storage()
            .persistent()
            .set(&DataKey::Module(name.clone()), &entry);

        events::ModuleRegisteredEvent {
            name,
            address,
            version,
        }
        .publish(&env);

        Ok(())
    }

    /// Update an existing module to a new address and/or version.
    ///
    /// The new `version` must be strictly greater than the current one so
    /// clients can detect upgrades by comparing version numbers.
    pub fn update_module(
        env: Env,
        admin: Address,
        name: Symbol,
        new_address: Address,
        new_version: u32,
    ) -> Result<(), RegistryError> {
        Self::require_not_paused(&env)?;
        Self::require_admin(&env, &admin)?;

        let mut entry: ModuleEntry = env
            .storage()
            .persistent()
            .get(&DataKey::Module(name.clone()))
            .ok_or(RegistryError::ModuleNotFound)?;

        if new_version <= entry.version {
            return Err(RegistryError::VersionNotIncremented);
        }

        let old_address = entry.address.clone();
        let old_version = entry.version;

        entry.address = new_address.clone();
        entry.version = new_version;
        entry.registered_at = env.ledger().timestamp();
        entry.is_active = true; // updating reactivates a previously deactivated module

        env.storage()
            .persistent()
            .set(&DataKey::Module(name.clone()), &entry);

        events::ModuleUpdatedEvent {
            name,
            old_address,
            new_address,
            old_version,
            new_version,
        }
        .publish(&env);

        Ok(())
    }

    /// Mark a module inactive. Inactive modules are rejected by `resolve`.
    /// The entry is retained for historical querying via `get_module`.
    pub fn deactivate_module(env: Env, admin: Address, name: Symbol) -> Result<(), RegistryError> {
        Self::require_admin(&env, &admin)?;

        let mut entry: ModuleEntry = env
            .storage()
            .persistent()
            .get(&DataKey::Module(name.clone()))
            .ok_or(RegistryError::ModuleNotFound)?;

        entry.is_active = false;

        env.storage()
            .persistent()
            .set(&DataKey::Module(name.clone()), &entry);

        events::ModuleDeactivatedEvent { name, admin }.publish(&env);

        Ok(())
    }

    /// Re-enable a previously deactivated module.
    pub fn activate_module(env: Env, admin: Address, name: Symbol) -> Result<(), RegistryError> {
        Self::require_not_paused(&env)?;
        Self::require_admin(&env, &admin)?;

        let mut entry: ModuleEntry = env
            .storage()
            .persistent()
            .get(&DataKey::Module(name.clone()))
            .ok_or(RegistryError::ModuleNotFound)?;

        entry.is_active = true;

        env.storage()
            .persistent()
            .set(&DataKey::Module(name.clone()), &entry);

        events::ModuleActivatedEvent { name, admin }.publish(&env);

        Ok(())
    }

    // ── Queries ───────────────────────────────────────────────────────────────

    /// Return the full `ModuleEntry` for a module, including inactive ones.
    pub fn get_module(env: Env, name: Symbol) -> Result<ModuleEntry, RegistryError> {
        env.storage()
            .persistent()
            .get(&DataKey::Module(name))
            .ok_or(RegistryError::ModuleNotFound)
    }

    /// Resolve the active address for a module.
    ///
    /// Returns `ModuleInactive` if the module exists but has been deactivated,
    /// and `ModuleNotFound` if it was never registered. Clients should prefer
    /// this over `get_module` when they just need an address to call.
    pub fn resolve(env: Env, name: Symbol) -> Result<Address, RegistryError> {
        let entry: ModuleEntry = env
            .storage()
            .persistent()
            .get(&DataKey::Module(name))
            .ok_or(RegistryError::ModuleNotFound)?;

        if !entry.is_active {
            return Err(RegistryError::ModuleInactive);
        }

        Ok(entry.address)
    }

    /// Returns true only if the module is registered and currently active.
    pub fn is_active(env: Env, name: Symbol) -> bool {
        env.storage()
            .persistent()
            .get::<_, ModuleEntry>(&DataKey::Module(name))
            .map(|e| e.is_active)
            .unwrap_or(false)
    }

    pub fn get_admin(env: Env) -> Result<Address, RegistryError> {
        env.storage()
            .instance()
            .get(&DataKey::Admin)
            .ok_or(RegistryError::NotInitialized)
    }

    // ── Admin controls ────────────────────────────────────────────────────────

    pub fn set_admin(
        env: Env,
        current_admin: Address,
        new_admin: Address,
    ) -> Result<(), RegistryError> {
        Self::require_admin(&env, &current_admin)?;

        env.storage().instance().set(&DataKey::Admin, &new_admin);

        events::AdminTransferredEvent {
            old_admin: current_admin,
            new_admin,
        }
        .publish(&env);

        Ok(())
    }

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

    /// Upgrade the contract WASM. Admin only.
    pub fn upgrade(
        env: Env,
        caller: Address,
        new_wasm_hash: BytesN<32>,
    ) -> Result<(), RegistryError> {
        Self::require_admin(&env, &caller)?;
        env.deployer().update_current_contract_wasm(new_wasm_hash);
        Ok(())
    }
}

#[cfg(test)]
mod test;
