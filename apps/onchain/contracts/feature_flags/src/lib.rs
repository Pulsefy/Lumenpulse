#![no_std]

mod errors;
mod events;
mod storage;

use errors::FlagError;
use soroban_sdk::{contract, contractimpl, Address, Env, Symbol, Vec};
use storage::{DataKey, FlagEntry};

#[contract]
pub struct FeatureFlagsContract;

#[contractimpl]
impl FeatureFlagsContract {
    fn require_admin(env: &Env, caller: &Address) -> Result<(), FlagError> {
        let admin: Address = env
            .storage()
            .instance()
            .get(&DataKey::Admin)
            .ok_or(FlagError::NotInitialized)?;
        if caller != &admin {
            return Err(FlagError::Unauthorized);
        }
        caller.require_auth();
        Ok(())
    }

    fn require_not_paused(env: &Env) -> Result<(), FlagError> {
        if env
            .storage()
            .instance()
            .get::<_, bool>(&DataKey::Paused)
            .unwrap_or(false)
        {
            return Err(FlagError::ContractPaused);
        }
        Ok(())
    }

    pub fn initialize(env: Env, admin: Address) -> Result<(), FlagError> {
        if env.storage().instance().has(&DataKey::Admin) {
            return Err(FlagError::AlreadyInitialized);
        }
        admin.require_auth();

        env.storage().instance().set(&DataKey::Admin, &admin);
        env.storage().instance().set(&DataKey::Paused, &false);

        events::InitializedEvent { admin }.publish(&env);
        Ok(())
    }

    pub fn set_flag(
        env: Env,
        caller: Address,
        key: Symbol,
        enabled: bool,
    ) -> Result<(), FlagError> {
        Self::require_not_paused(&env)?;
        Self::require_admin(&env, &caller)?;

        let entry = FlagEntry {
            key: key.clone(),
            enabled,
            toggled_by: caller.clone(),
            updated_at: env.ledger().timestamp(),
        };

        env.storage()
            .persistent()
            .set(&DataKey::Flag(key.clone()), &entry);

        let mut list: Vec<Symbol> = env
            .storage()
            .instance()
            .get(&DataKey::FlagList)
            .unwrap_or(Vec::new(&env));

        let exists = list.iter().any(|k| k == key);
        if !exists {
            list.push_back(key.clone());
            env.storage().instance().set(&DataKey::FlagList, &list);
        }

        events::FlagSetEvent {
            key,
            enabled,
            toggled_by: caller,
        }
        .publish(&env);

        Ok(())
    }

    pub fn is_enabled(env: Env, key: Symbol) -> bool {
        env.storage()
            .persistent()
            .get::<_, FlagEntry>(&DataKey::Flag(key))
            .map(|e| e.enabled)
            .unwrap_or(false)
    }

    pub fn get_flag(env: Env, key: Symbol) -> Option<FlagEntry> {
        env.storage().persistent().get(&DataKey::Flag(key))
    }

    pub fn list_flags(env: Env) -> Vec<FlagEntry> {
        let keys: Vec<Symbol> = env
            .storage()
            .instance()
            .get(&DataKey::FlagList)
            .unwrap_or(Vec::new(&env));

        let mut result: Vec<FlagEntry> = Vec::new(&env);
        for k in keys.iter() {
            if let Some(entry) = env
                .storage()
                .persistent()
                .get::<_, FlagEntry>(&DataKey::Flag(k))
            {
                result.push_back(entry);
            }
        }
        result
    }

    pub fn get_admin(env: Env) -> Result<Address, FlagError> {
        env.storage()
            .instance()
            .get(&DataKey::Admin)
            .ok_or(FlagError::NotInitialized)
    }

    pub fn set_admin(
        env: Env,
        current_admin: Address,
        new_admin: Address,
    ) -> Result<(), FlagError> {
        Self::require_admin(&env, &current_admin)?;

        env.storage().instance().set(&DataKey::Admin, &new_admin);

        events::AdminTransferredEvent {
            old_admin: current_admin,
            new_admin,
        }
        .publish(&env);

        Ok(())
    }

    pub fn pause(env: Env, admin: Address) -> Result<(), FlagError> {
        Self::require_admin(&env, &admin)?;
        env.storage().instance().set(&DataKey::Paused, &true);
        Ok(())
    }

    pub fn unpause(env: Env, admin: Address) -> Result<(), FlagError> {
        Self::require_admin(&env, &admin)?;
        env.storage().instance().set(&DataKey::Paused, &false);
        Ok(())
    }
}

#[cfg(test)]
mod test;
