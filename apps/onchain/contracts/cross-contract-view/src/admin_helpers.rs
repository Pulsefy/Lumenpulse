//! Admin validation helpers for cross-contract operations.

use crate::errors::ViewError;
use soroban_sdk::{Address, Env, IntoVal, Val};

/// Verify that the caller is the contract admin.
///
/// This is a common pattern across contracts - verifying that a caller
/// has admin privileges. This helper standardizes the pattern with
/// proper error handling.
///
/// # Arguments
///
/// * `env` - The Soroban environment
/// * `caller` - The address attempting the admin operation
/// * `admin_key` - The storage key for the admin address
///
/// # Returns
///
/// `Ok(())` if the caller is the admin, `ViewError::Unauthorized` otherwise.
pub fn require_admin<K: IntoVal<Env, Val>>(
    env: &Env,
    caller: &Address,
    admin_key: &K,
) -> Result<(), ViewError> {
    let admin: Address = env
        .storage()
        .instance()
        .get(admin_key)
        .ok_or(ViewError::NotInitialized)?;

    if caller != &admin {
        return Err(ViewError::Unauthorized);
    }

    caller.require_auth();

    env.storage().instance().extend_ttl(
        super::safe_view::DEFAULT_LEDGER_THRESHOLD,
        super::safe_view::DEFAULT_LEDGER_BUMP,
    );

    Ok(())
}

/// Get the admin address from storage.
///
/// # Arguments
///
/// * `env` - The Soroban environment
/// * `admin_key` - The storage key for the admin address
///
/// # Returns
///
/// The admin address, or `ViewError::NotInitialized` if not set.
pub fn get_admin<K: IntoVal<Env, Val>>(env: &Env, admin_key: &K) -> Result<Address, ViewError> {
    let admin: Address = env
        .storage()
        .instance()
        .get(admin_key)
        .ok_or(ViewError::NotInitialized)?;

    env.storage().instance().extend_ttl(
        super::safe_view::DEFAULT_LEDGER_THRESHOLD,
        super::safe_view::DEFAULT_LEDGER_BUMP,
    );

    Ok(admin)
}

/// Check if the contract is initialized.
///
/// # Arguments
///
/// * `env` - The Soroban environment
/// * `admin_key` - The storage key for the admin address (used as init marker)
///
/// # Returns
///
/// `true` if initialized, `false` otherwise.
pub fn is_initialized<K: IntoVal<Env, Val>>(env: &Env, admin_key: &K) -> bool {
    env.storage().instance().has(admin_key)
}

#[cfg(test)]
mod tests {
    use super::*;
    use soroban_sdk::{contract, contractimpl, contracttype, testutils::Address as _};

    #[contracttype]
    enum DataKey {
        Admin,
    }

    #[contract]
    struct TestContract;

    #[contractimpl]
    impl TestContract {
        pub fn setup(env: Env, admin: Address) {
            env.storage().instance().set(&DataKey::Admin, &admin);
        }
    }

    #[test]
    fn test_require_admin_success() {
        let env = Env::default();
        env.mock_all_auths();
        let admin = Address::generate(&env);
        let contract_id = env.register(TestContract, ());

        env.as_contract(&contract_id, || {
            env.storage()
                .instance()
                .set(&DataKey::Admin, &admin.clone());
            let result = require_admin(&env, &admin, &DataKey::Admin);
            assert!(result.is_ok());
        });
    }

    #[test]
    fn test_require_admin_unauthorized() {
        let env = Env::default();
        env.mock_all_auths();
        let admin = Address::generate(&env);
        let attacker = Address::generate(&env);
        let contract_id = env.register(TestContract, ());

        env.as_contract(&contract_id, || {
            env.storage().instance().set(&DataKey::Admin, &admin);
            let result = require_admin(&env, &attacker, &DataKey::Admin);
            assert_eq!(result, Err(ViewError::Unauthorized));
        });
    }

    #[test]
    fn test_require_admin_not_initialized() {
        let env = Env::default();
        env.mock_all_auths();
        let caller = Address::generate(&env);
        let contract_id = env.register(TestContract, ());

        env.as_contract(&contract_id, || {
            let result = require_admin(&env, &caller, &DataKey::Admin);
            assert_eq!(result, Err(ViewError::NotInitialized));
        });
    }

    #[test]
    fn test_get_admin() {
        let env = Env::default();
        let admin = Address::generate(&env);
        let contract_id = env.register(TestContract, ());

        env.as_contract(&contract_id, || {
            env.storage()
                .instance()
                .set(&DataKey::Admin, &admin.clone());
            let result = get_admin(&env, &DataKey::Admin);
            assert_eq!(result, Ok(admin));
        });
    }

    #[test]
    fn test_is_initialized() {
        let env = Env::default();
        let admin = Address::generate(&env);
        let contract_id = env.register(TestContract, ());

        env.as_contract(&contract_id, || {
            assert!(!is_initialized(&env, &DataKey::Admin));
            env.storage().instance().set(&DataKey::Admin, &admin);
            assert!(is_initialized(&env, &DataKey::Admin));
        });
    }
}
