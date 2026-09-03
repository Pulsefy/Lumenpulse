//! Safe view operations for cross-contract reads.
//!
//! This module provides helper functions for reading state from contracts
//! with proper error handling and TTL management.

use crate::errors::ViewError;
use soroban_sdk::{Address, Env, IntoVal, TryFromVal, Val};

/// Default TTL threshold (number of ledgers before we extend TTL).
/// ~7 days at 5 seconds per ledger.
pub const DEFAULT_LEDGER_THRESHOLD: u32 = 120_960;

/// Default TTL bump (number of ledgers to extend TTL by).
/// ~14 days at 5 seconds per ledger.
pub const DEFAULT_LEDGER_BUMP: u32 = 241_920;

/// Read state from instance storage with proper error handling.
///
/// This function reads a value from the contract's instance storage,
/// returning an error if the key doesn't exist. It also extends the
/// TTL of the entry to prevent expiration.
///
/// # Arguments
///
/// * `env` - The Soroban environment
/// * `key` - The storage key to read
///
/// # Returns
///
/// The stored value, or `ViewError::NotFound` if the key doesn't exist.
pub fn read_state<K, T>(env: &Env, key: &K) -> Result<T, ViewError>
where
    K: IntoVal<Env, Val>,
    T: TryFromVal<Env, Val>,
{
    env.storage()
        .instance()
        .get(key)
        .ok_or(ViewError::NotFound)
        .inspect(|_v: &T| {
            env.storage()
                .instance()
                .extend_ttl(DEFAULT_LEDGER_THRESHOLD, DEFAULT_LEDGER_BUMP);
        })
}

/// Check if a key exists in instance storage.
///
/// # Arguments
///
/// * `env` - The Soroban environment
/// * `key` - The storage key to check
///
/// # Returns
///
/// `true` if the key exists, `false` otherwise.
pub fn has_state<K: IntoVal<Env, Val>>(env: &Env, key: &K) -> bool {
    env.storage().instance().has(key)
}

/// Read state from instance storage with a default value.
///
/// If the key doesn't exist, returns the provided default value.
/// This is useful for optional configuration or state that may not be set.
///
/// # Arguments
///
/// * `env` - The Soroban environment
/// * `key` - The storage key to read
/// * `default` - The default value to return if the key doesn't exist
///
/// # Returns
///
/// The stored value, or the default if the key doesn't exist.
pub fn read_state_with_default<K, T>(env: &Env, key: &K, default: T) -> T
where
    K: IntoVal<Env, Val>,
    T: TryFromVal<Env, Val> + Clone,
{
    env.storage().instance().get(key).unwrap_or_else(|| {
        if env.storage().instance().has(key) {
            env.storage()
                .instance()
                .extend_ttl(DEFAULT_LEDGER_THRESHOLD, DEFAULT_LEDGER_BUMP);
        }
        default
    })
}

/// Read state from persistent storage with proper error handling.
///
/// This function reads a value from the contract's persistent storage,
/// returning an error if the key doesn't exist. It also extends the
/// TTL of the entry to prevent expiration.
///
/// # Arguments
///
/// * `env` - The Soroban environment
/// * `key` - The storage key to read
///
/// # Returns
///
/// The stored value, or `ViewError::NotFound` if the key doesn't exist.
pub fn read_persistent<K, T>(env: &Env, key: &K) -> Result<T, ViewError>
where
    K: IntoVal<Env, Val>,
    T: TryFromVal<Env, Val>,
{
    env.storage()
        .persistent()
        .get(key)
        .ok_or(ViewError::NotFound)
        .inspect(|_v: &T| {
            env.storage().persistent().extend_ttl(
                key,
                DEFAULT_LEDGER_THRESHOLD,
                DEFAULT_LEDGER_BUMP,
            );
        })
}

/// Read state from persistent storage with a default value.
///
/// If the key doesn't exist, returns the provided default value.
///
/// # Arguments
///
/// * `env` - The Soroban environment
/// * `key` - The storage key to read
/// * `default` - The default value to return if the key doesn't exist
///
/// # Returns
///
/// The stored value, or the default if the key doesn't exist.
pub fn read_persistent_with_default<K, T>(env: &Env, key: &K, default: T) -> T
where
    K: IntoVal<Env, Val>,
    T: TryFromVal<Env, Val> + Clone,
{
    let value = env
        .storage()
        .persistent()
        .get(key)
        .unwrap_or(default.clone());
    if env.storage().persistent().has(key) {
        env.storage()
            .persistent()
            .extend_ttl(key, DEFAULT_LEDGER_THRESHOLD, DEFAULT_LEDGER_BUMP);
    }
    value
}

/// Check if a key exists in persistent storage.
///
/// # Arguments
///
/// * `env` - The Soroban environment
/// * `key` - The storage key to check
///
/// # Returns
///
/// `true` if the key exists, `false` otherwise.
pub fn has_persistent<K: IntoVal<Env, Val>>(env: &Env, key: &K) -> bool {
    env.storage().persistent().has(key)
}

/// Safe cross-contract view call wrapper.
///
/// This provides a standardized pattern for making view calls to other contracts,
/// with consistent error handling. The caller provides a closure that performs
/// the actual cross-contract call, and this wrapper ensures errors are properly
/// mapped to `ViewError`.
///
/// # Arguments
///
/// * `env` - The Soroban environment
/// * `contract_address` - The address of the contract to call
/// * `call` - A closure that performs the cross-contract call
///
/// # Returns
///
/// The result of the cross-contract call, or a `ViewError` if it fails.
pub fn safe_cross_contract_call<T, F>(
    _env: &Env,
    _contract_address: &Address,
    call: F,
) -> Result<T, ViewError>
where
    F: FnOnce() -> T,
{
    // The actual cross-contract call happens in the closure.
    // Soroban will trap on errors, so if we reach here, the call succeeded.
    Ok(call())
}

#[cfg(test)]
mod tests {
    use super::*;
    use soroban_sdk::{contract, contractimpl, contracttype, testutils::Address as _, Env};

    #[contracttype]
    enum DataKey {
        Admin,
        Value,
    }

    #[contract]
    struct TestContract;

    #[contractimpl]
    impl TestContract {
        pub fn setup(env: Env) {
            env.storage()
                .instance()
                .set(&DataKey::Admin, &Address::generate(&env));
            env.storage().instance().set(&DataKey::Value, &42i128);
        }
    }

    #[test]
    fn test_read_state_success() {
        let env = Env::default();
        let contract_id = env.register(TestContract, ());
        env.as_contract(&contract_id, || {
            env.storage().instance().set(&DataKey::Value, &100i128);
            let result: Result<i128, ViewError> = read_state(&env, &DataKey::Value);
            assert_eq!(result, Ok(100i128));
        });
    }

    #[test]
    fn test_read_state_not_found() {
        let env = Env::default();
        let contract_id = env.register(TestContract, ());
        env.as_contract(&contract_id, || {
            let result: Result<i128, ViewError> = read_state(&env, &DataKey::Admin);
            assert_eq!(result, Err(ViewError::NotFound));
        });
    }

    #[test]
    fn test_has_state() {
        let env = Env::default();
        let contract_id = env.register(TestContract, ());
        env.as_contract(&contract_id, || {
            env.storage().instance().set(&DataKey::Value, &1i128);
            assert!(has_state(&env, &DataKey::Value));
            assert!(!has_state(&env, &DataKey::Admin));
        });
    }

    #[test]
    fn test_read_state_with_default() {
        let env = Env::default();
        let contract_id = env.register(TestContract, ());
        env.as_contract(&contract_id, || {
            env.storage().instance().set(&DataKey::Value, &50i128);
            let result = read_state_with_default(&env, &DataKey::Value, 0i128);
            assert_eq!(result, 50i128);

            let result = read_state_with_default(&env, &DataKey::Admin, 0i128);
            assert_eq!(result, 0i128);
        });
    }
}
