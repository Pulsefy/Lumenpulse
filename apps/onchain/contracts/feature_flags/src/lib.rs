#![no_std]

mod errors;
mod events;
mod storage;

use errors::FlagError;
use soroban_sdk::{contract, contractimpl, Address, Env, Symbol};
use storage::DataKey;

/// # FeatureFlagsContract
///
/// **Testnet-only.** Stores named boolean feature flags that gate experimental
/// protocol behaviour in other contracts. Intended to be deployed on testnet
/// exclusively; mainnet contracts must not depend on it.
///
/// ## Workflow
/// 1. Deploy and call `initialize(admin)`.
/// 2. Admin calls `set_flag(flag_name, true)` to enable a feature.
/// 3. Any caller uses `is_enabled(flag_name)` to check the gate.
/// 4. Every state change emits a `FlagSetEvent` for off-chain observability.
#[contract]
pub struct FeatureFlagsContract;

#[contractimpl]
impl FeatureFlagsContract {
    // ── Internal ──────────────────────────────────────────────────────────────

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

    // ── Initialization ────────────────────────────────────────────────────────

    /// Deploy and configure the contract. Can only be called once.
    pub fn initialize(env: Env, admin: Address) -> Result<(), FlagError> {
        if env.storage().instance().has(&DataKey::Admin) {
            return Err(FlagError::AlreadyInitialized);
        }
        admin.require_auth();
        env.storage().instance().set(&DataKey::Admin, &admin);
        events::InitializedEvent { admin }.publish(&env);
        Ok(())
    }

    // ── Flag management ───────────────────────────────────────────────────────

    /// Enable or disable a named feature flag. Admin only.
    ///
    /// Flags that have never been set default to `false` via `is_enabled`.
    /// Setting a flag always emits `FlagSetEvent` so state transitions are
    /// fully observable on-chain.
    pub fn set_flag(
        env: Env,
        admin: Address,
        flag: Symbol,
        enabled: bool,
    ) -> Result<(), FlagError> {
        Self::require_admin(&env, &admin)?;

        env.storage()
            .instance()
            .set(&DataKey::Flag(flag.clone()), &enabled);

        events::FlagSetEvent {
            flag,
            enabled,
            updated_by: admin,
        }
        .publish(&env);

        Ok(())
    }

    // ── Queries ───────────────────────────────────────────────────────────────

    /// Returns the current state of `flag`. Defaults to `false` if never set,
    /// making the default behaviour deterministic without an explicit seed step.
    pub fn is_enabled(env: Env, flag: Symbol) -> bool {
        env.storage()
            .instance()
            .get::<_, bool>(&DataKey::Flag(flag))
            .unwrap_or(false)
    }

    /// Returns the raw flag value or `FlagNotFound` if it has never been set.
    ///
    /// Prefer `is_enabled` for simple gate checks; use this when you need to
    /// distinguish "flag is explicitly off" from "flag was never configured".
    pub fn get_flag(env: Env, flag: Symbol) -> Result<bool, FlagError> {
        env.storage()
            .instance()
            .get(&DataKey::Flag(flag))
            .ok_or(FlagError::FlagNotFound)
    }

    pub fn get_admin(env: Env) -> Result<Address, FlagError> {
        env.storage()
            .instance()
            .get(&DataKey::Admin)
            .ok_or(FlagError::NotInitialized)
    }

    // ── Admin controls ────────────────────────────────────────────────────────

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
}

#[cfg(test)]
mod test;
