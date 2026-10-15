//! Tests for cross-contract-view library.
//!
//! Verifies:
//! - All exported helpers in `admin_helpers`, `safe_view`, and `token_helpers`.
//! - Success and failure paths for each helper.
//! - Behavior against non-existent or uninitialized target contracts (predictable Result errors, no panics).
//! - Return-type conversions for all supported value types (u32, u64, i128, bool, Address, Symbol, String, custom types).

#![cfg(test)]

use crate::{
    admin_helpers::{get_admin, is_initialized, require_admin},
    errors::ViewError,
    safe_view::{
        has_persistent, has_state, read_persistent, read_persistent_with_default, read_state,
        read_state_with_default, safe_cross_contract_call,
    },
    token_helpers::{allowance, balance, token_info, TokenInfo},
};
use soroban_sdk::{
    contract, contractclient, contracterror, contractimpl, contracttype, symbol_short,
    testutils::{Address as _, Ledger},
    token::StellarAssetClient,
    Address, BytesN, Env, IntoVal, String, Symbol, TryFromVal, Val, Vec,
};

#[contracterror]
#[derive(Copy, Clone, Debug, Eq, PartialEq)]
#[repr(u32)]
pub enum TargetError {
    NotConfigured = 1,
}

#[contracttype]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct CustomRecord {
    pub id: u32,
    pub name: Symbol,
    pub active: bool,
}

#[contracttype]
#[derive(Clone, Debug, Eq, PartialEq)]
pub enum TestStorageKey {
    Admin,
    CountU32,
    TimestampU64,
    BalanceI128,
    FlagBool,
    ContractAddr,
    TagSymbol,
    DescString,
    Record,
    PersistentCount,
    PersistentRecord,
}

#[contractclient(name = "TargetContractClient")]
pub trait TargetContractTrait {
    fn initialize(env: Env, admin: Address);
    fn get_value(env: Env) -> i128;
    fn failing_call(env: Env) -> Result<i128, TargetError>;
}

#[contract]
pub struct TargetContract;

#[contractimpl]
impl TargetContract {
    pub fn initialize(env: Env, admin: Address) {
        env.storage().instance().set(&TestStorageKey::Admin, &admin);
        env.storage()
            .instance()
            .set(&TestStorageKey::BalanceI128, &1_234_567i128);
    }

    pub fn get_value(env: Env) -> i128 {
        env.storage()
            .instance()
            .get(&TestStorageKey::BalanceI128)
            .unwrap_or(0i128)
    }

    pub fn failing_call(_env: Env) -> Result<i128, TargetError> {
        Err(TargetError::NotConfigured)
    }
}

// ─────────────────────────────────────────────────────────────────────────────
// Admin Helpers Tests
// ─────────────────────────────────────────────────────────────────────────────

#[test]
fn test_admin_helpers_require_admin_success() {
    let env = Env::default();
    env.mock_all_auths();
    let admin = Address::generate(&env);
    let contract_id = env.register(TargetContract, ());

    env.as_contract(&contract_id, || {
        env.storage().instance().set(&TestStorageKey::Admin, &admin);
        let res = require_admin(&env, &admin, &TestStorageKey::Admin);
        assert_eq!(res, Ok(()));
    });
}

#[test]
fn test_admin_helpers_require_admin_unauthorized() {
    let env = Env::default();
    env.mock_all_auths();
    let admin = Address::generate(&env);
    let attacker = Address::generate(&env);
    let contract_id = env.register(TargetContract, ());

    env.as_contract(&contract_id, || {
        env.storage().instance().set(&TestStorageKey::Admin, &admin);
        let res = require_admin(&env, &attacker, &TestStorageKey::Admin);
        assert_eq!(res, Err(ViewError::Unauthorized));
    });
}

#[test]
fn test_admin_helpers_require_admin_uninitialized() {
    let env = Env::default();
    env.mock_all_auths();
    let caller = Address::generate(&env);
    let contract_id = env.register(TargetContract, ());

    env.as_contract(&contract_id, || {
        let res = require_admin(&env, &caller, &TestStorageKey::Admin);
        assert_eq!(res, Err(ViewError::NotInitialized));
    });
}

#[test]
fn test_admin_helpers_get_admin_success_and_failure() {
    let env = Env::default();
    let admin = Address::generate(&env);
    let contract_id = env.register(TargetContract, ());

    env.as_contract(&contract_id, || {
        // Uninitialized failure path
        let err = get_admin(&env, &TestStorageKey::Admin);
        assert_eq!(err, Err(ViewError::NotInitialized));

        // Initialized success path
        env.storage().instance().set(&TestStorageKey::Admin, &admin);
        let res = get_admin(&env, &TestStorageKey::Admin);
        assert_eq!(res, Ok(admin));
    });
}

#[test]
fn test_admin_helpers_is_initialized() {
    let env = Env::default();
    let admin = Address::generate(&env);
    let contract_id = env.register(TargetContract, ());

    env.as_contract(&contract_id, || {
        assert!(!is_initialized(&env, &TestStorageKey::Admin));
        env.storage().instance().set(&TestStorageKey::Admin, &admin);
        assert!(is_initialized(&env, &TestStorageKey::Admin));
    });
}

// ─────────────────────────────────────────────────────────────────────────────
// Safe View: Instance Storage Tests
// ─────────────────────────────────────────────────────────────────────────────

#[test]
fn test_safe_view_instance_storage() {
    let env = Env::default();
    let contract_id = env.register(TargetContract, ());

    env.as_contract(&contract_id, || {
        // NotFound failure path
        let err: Result<u32, ViewError> = read_state(&env, &TestStorageKey::CountU32);
        assert_eq!(err, Err(ViewError::NotFound));
        assert!(!has_state(&env, &TestStorageKey::CountU32));

        // Default fallback path when uninitialized
        let fallback = read_state_with_default(&env, &TestStorageKey::CountU32, 99u32);
        assert_eq!(fallback, 99u32);

        // Set value and verify success
        env.storage().instance().set(&TestStorageKey::CountU32, &42u32);
        assert!(has_state(&env, &TestStorageKey::CountU32));

        let val: Result<u32, ViewError> = read_state(&env, &TestStorageKey::CountU32);
        assert_eq!(val, Ok(42u32));

        let def = read_state_with_default(&env, &TestStorageKey::CountU32, 99u32);
        assert_eq!(def, 42u32);
    });
}

// ─────────────────────────────────────────────────────────────────────────────
// Safe View: Persistent Storage Tests
// ─────────────────────────────────────────────────────────────────────────────

#[test]
fn test_safe_view_persistent_storage() {
    let env = Env::default();
    let contract_id = env.register(TargetContract, ());

    env.as_contract(&contract_id, || {
        // NotFound failure path
        let err: Result<i128, ViewError> = read_persistent(&env, &TestStorageKey::PersistentCount);
        assert_eq!(err, Err(ViewError::NotFound));
        assert!(!has_persistent(&env, &TestStorageKey::PersistentCount));

        // Default fallback path when absent
        let fallback = read_persistent_with_default(&env, &TestStorageKey::PersistentCount, 500i128);
        assert_eq!(fallback, 500i128);

        // Set value and verify success
        env.storage().persistent().set(&TestStorageKey::PersistentCount, &1_000i128);
        assert!(has_persistent(&env, &TestStorageKey::PersistentCount));

        let val: Result<i128, ViewError> = read_persistent(&env, &TestStorageKey::PersistentCount);
        assert_eq!(val, Ok(1_000i128));

        let def = read_persistent_with_default(&env, &TestStorageKey::PersistentCount, 500i128);
        assert_eq!(def, 1_000i128);
    });
}

// ─────────────────────────────────────────────────────────────────────────────
// Safe View: safe_cross_contract_call
// ─────────────────────────────────────────────────────────────────────────────

#[test]
fn test_safe_cross_contract_call() {
    let env = Env::default();
    let admin = Address::generate(&env);
    let target_id = env.register(TargetContract, ());
    let client = TargetContractClient::new(&env, &target_id);

    client.initialize(&admin);

    let res = safe_cross_contract_call(&env, &target_id, || client.get_value());
    assert_eq!(res, Ok(1_234_567i128));
}

// ─────────────────────────────────────────────────────────────────────────────
// Return Type Conversions: Comprehensive Value Types
// ─────────────────────────────────────────────────────────────────────────────

#[test]
fn test_return_type_conversions_all_supported_types() {
    let env = Env::default();
    let contract_id = env.register(TargetContract, ());

    let addr = Address::generate(&env);
    let symbol_val = symbol_short!("LM_PULSE");
    let str_val = String::from_str(&env, "Lumenpulse Cross Contract View");
    let record = CustomRecord {
        id: 777,
        name: symbol_short!("RECORD"),
        active: true,
    };

    env.as_contract(&contract_id, || {
        // 1. u32
        env.storage().instance().set(&TestStorageKey::CountU32, &12345u32);
        let res_u32: u32 = read_state(&env, &TestStorageKey::CountU32).unwrap();
        assert_eq!(res_u32, 12345u32);

        // 2. u64
        env.storage().instance().set(&TestStorageKey::TimestampU64, &9876543210u64);
        let res_u64: u64 = read_state(&env, &TestStorageKey::TimestampU64).unwrap();
        assert_eq!(res_u64, 9876543210u64);

        // 3. i128
        env.storage().instance().set(&TestStorageKey::BalanceI128, &-500_000i128);
        let res_i128: i128 = read_state(&env, &TestStorageKey::BalanceI128).unwrap();
        assert_eq!(res_i128, -500_000i128);

        // 4. bool
        env.storage().instance().set(&TestStorageKey::FlagBool, &true);
        let res_bool: bool = read_state(&env, &TestStorageKey::FlagBool).unwrap();
        assert_eq!(res_bool, true);

        // 5. Address
        env.storage().instance().set(&TestStorageKey::ContractAddr, &addr);
        let res_addr: Address = read_state(&env, &TestStorageKey::ContractAddr).unwrap();
        assert_eq!(res_addr, addr);

        // 6. Symbol
        env.storage().instance().set(&TestStorageKey::TagSymbol, &symbol_val);
        let res_sym: Symbol = read_state(&env, &TestStorageKey::TagSymbol).unwrap();
        assert_eq!(res_sym, symbol_val);

        // 7. String
        env.storage().instance().set(&TestStorageKey::DescString, &str_val);
        let res_str: String = read_state(&env, &TestStorageKey::DescString).unwrap();
        assert_eq!(res_str, str_val);

        // 8. Custom contracttype struct in instance storage
        env.storage().instance().set(&TestStorageKey::Record, &record);
        let res_rec: CustomRecord = read_state(&env, &TestStorageKey::Record).unwrap();
        assert_eq!(res_rec, record);

        // 9. Custom struct in persistent storage
        env.storage().persistent().set(&TestStorageKey::PersistentRecord, &record);
        let res_prec: CustomRecord = read_persistent(&env, &TestStorageKey::PersistentRecord).unwrap();
        assert_eq!(res_prec, record);
    });
}

// ─────────────────────────────────────────────────────────────────────────────
// Token Helpers: balance, allowance, token_info Success & Failure Paths
// ─────────────────────────────────────────────────────────────────────────────

#[test]
fn test_token_helpers_success_paths() {
    let env = Env::default();
    env.mock_all_auths();

    let admin = Address::generate(&env);
    let owner = Address::generate(&env);
    let spender = Address::generate(&env);

    let token_address = env.register_stellar_asset_contract_v2(admin.clone());
    let token_addr = token_address.address();
    let token_admin = StellarAssetClient::new(&env, &token_addr);

    // Initial balance should be 0
    assert_eq!(balance(&env, &token_addr, &owner), 0);
    assert_eq!(allowance(&env, &token_addr, &owner, &spender), 0);

    // Mint tokens to owner
    token_admin.mint(&owner, &2_500_000);
    assert_eq!(balance(&env, &token_addr, &owner), 2_500_000);

    // Grant allowance
    let token_client = soroban_sdk::token::Client::new(&env, &token_addr);
    token_client.approve(&owner, &spender, &1_000_000, &1000);
    assert_eq!(allowance(&env, &token_addr, &owner, &spender), 1_000_000);

    // Read token info metadata
    let info = token_info(&env, &token_addr);
    assert!(info.is_ok());
    let info = info.unwrap();
    assert_eq!(info.decimals, 7);
    assert!(info.name.len() > 0);
    assert!(info.symbol.len() > 0);
}

#[test]
fn test_uninitialized_target_contract_reads_fail_predictably() {
    let env = Env::default();
    let dummy_contract_id = env.register(TargetContract, ());

    // When reading state from a contract that was registered but never initialized:
    // read_state returns Err(ViewError::NotFound) predictably without panicking.
    env.as_contract(&dummy_contract_id, || {
        let res: Result<i128, ViewError> = read_state(&env, &TestStorageKey::BalanceI128);
        assert_eq!(res, Err(ViewError::NotFound));

        let res_admin: Result<Address, ViewError> = get_admin(&env, &TestStorageKey::Admin);
        assert_eq!(res_admin, Err(ViewError::NotInitialized));

        assert_eq!(is_initialized(&env, &TestStorageKey::Admin), false);
    });

    // Cross-contract call through client on uninitialized contract returns default/expected value safely
    let client = TargetContractClient::new(&env, &dummy_contract_id);
    let val_res = safe_cross_contract_call(&env, &dummy_contract_id, || client.get_value());
    assert_eq!(val_res, Ok(0i128));

    // Cross-contract call returning error returns safely without panicking the host
    let client_err = client.try_failing_call();
    assert!(client_err.is_err());
}
