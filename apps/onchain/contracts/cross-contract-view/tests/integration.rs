#![cfg(test)]

use cross_contract_view::{
    admin_helpers::{get_admin, is_initialized, require_admin},
    safe_view::{has_state, read_state, read_state_with_default},
    token_helpers::{allowance, balance, token_info},
    ViewError,
};
use soroban_sdk::{
    contract, contractimpl, contracttype, testutils::Address as _, Address, Env, String, Symbol,
};

#[contracttype]
pub enum DataKey {
    Admin,
    ValueI128,
    ValueU32,
    ValueString,
}

#[contract]
pub struct TestContract;

#[contractimpl]
impl TestContract {
    pub fn init(env: Env, admin: Address) {
        env.storage().instance().set(&DataKey::Admin, &admin);
        env.storage().instance().set(&DataKey::ValueI128, &42i128);
        env.storage().instance().set(&DataKey::ValueU32, &100u32);
        env.storage().instance().set(&DataKey::ValueString, &String::from_str(&env, "hello"));
    }
}

#[contract]
pub struct MockToken;

#[contractimpl]
impl MockToken {
    pub fn balance(_env: Env, _id: Address) -> i128 {
        1000
    }
    pub fn allowance(_env: Env, _from: Address, _spender: Address) -> i128 {
        500
    }
    pub fn decimals(_env: Env) -> u32 {
        7
    }
    pub fn name(env: Env) -> String {
        String::from_str(&env, "Mock Token")
    }
    pub fn symbol(env: Env) -> String {
        String::from_str(&env, "MOCK")
    }
}

#[test]
fn test_admin_helpers_integration() {
    let env = Env::default();
    env.mock_all_auths();

    let admin = Address::generate(&env);
    let contract_id = env.register(TestContract, ());
    let client = TestContractClient::new(&env, &contract_id);

    env.as_contract(&contract_id, || {
        assert!(!is_initialized(&env, &DataKey::Admin));
        assert_eq!(get_admin(&env, &DataKey::Admin), Err(ViewError::NotInitialized));
    });

    client.init(&admin);

    env.as_contract(&contract_id, || {
        assert!(is_initialized(&env, &DataKey::Admin));
        assert_eq!(get_admin(&env, &DataKey::Admin), Ok(admin.clone()));
        
        let caller = admin.clone();
        assert_eq!(require_admin(&env, &caller, &DataKey::Admin), Ok(()));

        let attacker = Address::generate(&env);
        assert_eq!(require_admin(&env, &attacker, &DataKey::Admin), Err(ViewError::Unauthorized));
    });
}

#[test]
fn test_safe_view_integration() {
    let env = Env::default();
    let admin = Address::generate(&env);
    let contract_id = env.register(TestContract, ());
    let client = TestContractClient::new(&env, &contract_id);

    client.init(&admin);

    env.as_contract(&contract_id, || {
        assert!(has_state(&env, &DataKey::ValueI128));
        
        // Asserting return-type conversions for supported value types
        assert_eq!(read_state::<DataKey, i128>(&env, &DataKey::ValueI128), Ok(42));
        assert_eq!(read_state::<DataKey, u32>(&env, &DataKey::ValueU32), Ok(100));
        assert_eq!(read_state::<DataKey, String>(&env, &DataKey::ValueString), Ok(String::from_str(&env, "hello")));

        assert_eq!(read_state_with_default(&env, &DataKey::ValueI128, 0i128), 42);

        let missing_key = Symbol::new(&env, "Missing");
        assert!(!has_state(&env, &missing_key));
        assert_eq!(read_state::<Symbol, i128>(&env, &missing_key), Err(ViewError::NotFound));
        assert_eq!(read_state_with_default(&env, &missing_key, 99i128), 99);
    });
}

#[test]
fn test_token_helpers_integration_success() {
    let env = Env::default();
    let token_id = env.register(MockToken, ());
    let user1 = Address::generate(&env);
    let user2 = Address::generate(&env);

    assert_eq!(balance(&env, &token_id, &user1), Ok(1000));
    assert_eq!(allowance(&env, &token_id, &user1, &user2), Ok(500));

    let info = token_info(&env, &token_id).unwrap();
    assert_eq!(info.decimals, 7);
    assert_eq!(info.name, String::from_str(&env, "Mock Token"));
    assert_eq!(info.symbol, String::from_str(&env, "MOCK"));
}

#[test]
fn test_token_helpers_integration_failure() {
    let env = Env::default();
    let dummy_id = Address::generate(&env);
    let user = Address::generate(&env);

    // Verify it fails predictably on non-existent contract
    assert_eq!(balance(&env, &dummy_id, &user), Err(ViewError::TokenError));
    assert_eq!(allowance(&env, &dummy_id, &user, &user), Err(ViewError::TokenError));
    assert_eq!(token_info(&env, &dummy_id), Err(ViewError::TokenError));
}
