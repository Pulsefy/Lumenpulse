#![cfg(test)]

use crate::errors::RegistryError;
use crate::{ContractRegistry, ContractRegistryClient};
use soroban_sdk::{testutils::Address as _, Address, Env, Symbol};

fn setup_test<'a>(env: &Env) -> (ContractRegistryClient<'a>, Address) {
    let admin = Address::generate(env);
    let contract_id = env.register(ContractRegistry, ());
    let client = ContractRegistryClient::new(env, &contract_id);
    (client, admin)
}

#[test]
fn test_initialize() {
    let env = Env::default();
    env.mock_all_auths();

    let (client, admin) = setup_test(&env);
    client.initialize(&admin);
}

#[test]
fn test_double_initialization_fails() {
    let env = Env::default();
    env.mock_all_auths();

    let (client, admin) = setup_test(&env);
    client.initialize(&admin);

    let result = client.try_initialize(&admin);
    assert_eq!(result, Err(Ok(RegistryError::AlreadyInitialized)));
}

#[test]
fn test_register_and_get_contract() {
    let env = Env::default();
    env.mock_all_auths();

    let (client, admin) = setup_test(&env);
    client.initialize(&admin);

    let key = Symbol::new(&env, "vault");
    let target_addr = Address::generate(&env);
    let version = 1u32;
    let env_meta = Symbol::new(&env, "mainnet");

    client.register_contract(&admin, &key, &target_addr, &version, &env_meta);

    let info = client.get_contract(&key);
    assert_eq!(info.key, key);
    assert_eq!(info.address, target_addr);
    assert_eq!(info.version, version);
    assert_eq!(info.environment, env_meta);
}

#[test]
fn test_get_contract_not_found() {
    let env = Env::default();
    env.mock_all_auths();

    let (client, admin) = setup_test(&env);
    client.initialize(&admin);

    let key = Symbol::new(&env, "nonexistent");
    let result = client.try_get_contract(&key);
    assert_eq!(result, Err(Ok(RegistryError::ContractNotFound)));
}

#[test]
fn test_update_contract() {
    let env = Env::default();
    env.mock_all_auths();

    let (client, admin) = setup_test(&env);
    client.initialize(&admin);

    let key = Symbol::new(&env, "vault");
    let addr1 = Address::generate(&env);
    let addr2 = Address::generate(&env);
    let env_meta = Symbol::new(&env, "mainnet");

    client.register_contract(&admin, &key, &addr1, &1u32, &env_meta);
    client.update_contract(&admin, &key, &addr2, &2u32, &env_meta);

    let info = client.get_contract(&key);
    assert_eq!(info.address, addr2);
    assert_eq!(info.version, 2u32);
}

#[test]
fn test_update_contract_not_found() {
    let env = Env::default();
    env.mock_all_auths();

    let (client, admin) = setup_test(&env);
    client.initialize(&admin);

    let key = Symbol::new(&env, "nonexistent");
    let addr = Address::generate(&env);
    let env_meta = Symbol::new(&env, "mainnet");

    let result = client.try_update_contract(&admin, &key, &addr, &1u32, &env_meta);
    assert_eq!(result, Err(Ok(RegistryError::ContractNotFound)));
}

#[test]
fn test_list_contracts() {
    let env = Env::default();
    env.mock_all_auths();

    let (client, admin) = setup_test(&env);
    client.initialize(&admin);

    let key1 = Symbol::new(&env, "vault");
    let key2 = Symbol::new(&env, "pool");
    let addr1 = Address::generate(&env);
    let addr2 = Address::generate(&env);
    let env_meta = Symbol::new(&env, "testnet");

    client.register_contract(&admin, &key1, &addr1, &1u32, &env_meta);
    client.register_contract(&admin, &key2, &addr2, &1u32, &env_meta);

    let list = client.list_contracts();
    assert_eq!(list.len(), 2);
}
