#![cfg(test)]

use super::*;
use soroban_sdk::{testutils::Address as _, Address, Env, String};

#[test]
fn test_registry_flow() {
    let env = Env::default();
    env.mock_all_auths();

    let contract_id = env.register(MetadataRegistryContract, ());
    let client = MetadataRegistryContractClient::new(&env, &contract_id);

    let admin = Address::generate(&env);
    client.initialize(&admin);

    let key = String::from_str(&env, "yield_vault");
    let contract_address = Address::generate(&env);
    let version = String::from_str(&env, "1.0.0");
    let environment = String::from_str(&env, "testnet");

    client.set_metadata(&admin, &key, &contract_address, &version, &environment);

    let metadata = client.get_metadata(&key);
    assert_eq!(metadata.address, contract_address);
    assert_eq!(metadata.version, version);
    assert_eq!(metadata.environment, environment);

    let all = client.get_all_contracts();
    assert_eq!(all.len(), 1);
    assert_eq!(all.get(0).unwrap(), key);
}

#[test]
#[should_panic(expected = "Error(Contract, #3)")]
fn test_unauthorized() {
    let env = Env::default();
    env.mock_all_auths();

    let contract_id = env.register(MetadataRegistryContract, ());
    let client = MetadataRegistryContractClient::new(&env, &contract_id);

    let admin = Address::generate(&env);
    client.initialize(&admin);

    let fake_admin = Address::generate(&env);
    let key = String::from_str(&env, "yield_vault");
    let contract_address = Address::generate(&env);
    let version = String::from_str(&env, "1.0.0");
    let environment = String::from_str(&env, "testnet");

    client.set_metadata(&fake_admin, &key, &contract_address, &version, &environment);
}
