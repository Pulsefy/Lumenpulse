#![cfg(test)]

use super::*;
use soroban_sdk::{vec, Env, String};

#[test]
fn test() {
    let env = Env::default();
    let contract_id = env.register(Contract, ());
    let client = ContractClient::new(&env, &contract_id);

    let words = client.hello(&String::from_str(&env, "Dev"));
    assert_eq!(
        words,
        vec![
            &env,
            String::from_str(&env, "Hello"),
            String::from_str(&env, "Dev"),
        ]
    );
}

#[test]
fn test_hello_empty_string() {
    let env = Env::default();
    let contract_id = env.register(Contract, ());
    let client = ContractClient::new(&env, &contract_id);

    let words = client.hello(&String::from_str(&env, ""));
    assert_eq!(
        words,
        vec![
            &env,
            String::from_str(&env, "Hello"),
            String::from_str(&env, ""),
        ]
    );
}

#[test]
fn test_hello_different_name() {
    let env = Env::default();
    let contract_id = env.register(Contract, ());
    let client = ContractClient::new(&env, &contract_id);

    let words = client.hello(&String::from_str(&env, "World"));
    assert_eq!(
        words,
        vec![
            &env,
            String::from_str(&env, "Hello"),
            String::from_str(&env, "World"),
        ]
    );
}

#[test]
fn test_hello_special_characters() {
    let env = Env::default();
    let contract_id = env.register(Contract, ());
    let client = ContractClient::new(&env, &contract_id);

    let words = client.hello(&String::from_str(&env, "@#$%"));
    assert_eq!(
        words,
        vec![
            &env,
            String::from_str(&env, "Hello"),
            String::from_str(&env, "@#$%"),
        ]
    );
}

#[test]
fn test_hello_unicode() {
    let env = Env::default();
    let contract_id = env.register(Contract, ());
    let client = ContractClient::new(&env, &contract_id);

    let words = client.hello(&String::from_str(&env, "你好"));
    assert_eq!(
        words,
        vec![
            &env,
            String::from_str(&env, "Hello"),
            String::from_str(&env, "你好"),
        ]
    );
}

#[test]
fn test_hello_emoji() {
    let env = Env::default();
    let contract_id = env.register(Contract, ());
    let client = ContractClient::new(&env, &contract_id);

    let words = client.hello(&String::from_str(&env, "🚀"));
    assert_eq!(
        words,
        vec![
            &env,
            String::from_str(&env, "Hello"),
            String::from_str(&env, "🚀"),
        ]
    );
}

#[test]
fn test_hello_long_string() {
    let env = Env::default();
    let contract_id = env.register(Contract, ());
    let client = ContractClient::new(&env, &contract_id);

    let long_string = "A".repeat(100);
    let words = client.hello(&String::from_str(&env, &long_string));
    assert_eq!(words.len(), 2);
    assert_eq!(words.get(0).unwrap(), String::from_str(&env, "Hello"));
    assert_eq!(words.get(1).unwrap(), String::from_str(&env, &long_string));
}

#[test]
fn test_hello_whitespace() {
    let env = Env::default();
    let contract_id = env.register(Contract, ());
    let client = ContractClient::new(&env, &contract_id);

    let words = client.hello(&String::from_str(&env, "  spaces  "));
    assert_eq!(
        words,
        vec![
            &env,
            String::from_str(&env, "Hello"),
            String::from_str(&env, "  spaces  "),
        ]
    );
}

#[test]
fn test_hello_numeric_string() {
    let env = Env::default();
    let contract_id = env.register(Contract, ());
    let client = ContractClient::new(&env, &contract_id);

    let words = client.hello(&String::from_str(&env, "12345"));
    assert_eq!(
        words,
        vec![
            &env,
            String::from_str(&env, "Hello"),
            String::from_str(&env, "12345"),
        ]
    );
}

#[test]
fn test_multiple_contract_instances() {
    let env = Env::default();

    let contract_id1 = env.register(Contract, ());
    let client1 = ContractClient::new(&env, &contract_id1);

    let contract_id2 = env.register(Contract, ());
    let client2 = ContractClient::new(&env, &contract_id2);

    let words1 = client1.hello(&String::from_str(&env, "First"));
    let words2 = client2.hello(&String::from_str(&env, "Second"));

    assert_eq!(
        words1,
        vec![
            &env,
            String::from_str(&env, "Hello"),
            String::from_str(&env, "First")
        ]
    );
    assert_eq!(
        words2,
        vec![
            &env,
            String::from_str(&env, "Hello"),
            String::from_str(&env, "Second")
        ]
    );

    // Verify they are different contract instances
    assert_ne!(contract_id1, contract_id2);
}

#[test]
fn test_hello_response_structure() {
    let env = Env::default();
    let contract_id = env.register(Contract, ());
    let client = ContractClient::new(&env, &contract_id);

    let result = client.hello(&String::from_str(&env, "Test"));

    // Verify response structure
    assert_eq!(result.len(), 2);

    // Verify first element is "Hello"
    assert_eq!(result.get(0).unwrap(), String::from_str(&env, "Hello"));

    // Verify second element is the input
    assert_eq!(result.get(1).unwrap(), String::from_str(&env, "Test"));
}
