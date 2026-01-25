#![cfg(test)]
extern crate std;

use crate::{LumenToken, LumenTokenClient};
use soroban_sdk::{testutils::Address as _, Address, Env, String};

#[test]
fn test_token() {
    let env = Env::default();
    env.mock_all_auths();

    let admin = Address::generate(&env);
    let user1 = Address::generate(&env);
    let user2 = Address::generate(&env);

    let contract_id = env.register(LumenToken, ());
    let client = LumenTokenClient::new(&env, &contract_id);

    client.initialize(
        &admin,
        &7,
        &String::from_str(&env, "LumenPulse"),
        &String::from_str(&env, "LMN"),
    );

    assert_eq!(client.decimals(), 7);
    assert_eq!(client.name(), String::from_str(&env, "LumenPulse"));
    assert_eq!(client.symbol(), String::from_str(&env, "LMN"));

    client.mint(&user1, &1000);
    assert_eq!(client.balance(&user1), 1000);

    client.transfer(&user1, &user2, &500);
    assert_eq!(client.balance(&user1), 500);
    assert_eq!(client.balance(&user2), 500);

    client.burn(&user2, &200);
    assert_eq!(client.balance(&user2), 300);
}

#[test]
#[should_panic(expected = "account is frozen")]
fn test_freeze() {
    let env = Env::default();
    env.mock_all_auths();

    let admin = Address::generate(&env);
    let user1 = Address::generate(&env);
    let user2 = Address::generate(&env);

    let contract_id = env.register(LumenToken, ());
    let client = LumenTokenClient::new(&env, &contract_id);

    client.initialize(
        &admin,
        &7,
        &String::from_str(&env, "LumenPulse"),
        &String::from_str(&env, "LMN"),
    );

    client.mint(&user1, &1000);
    client.freeze(&user1);

    client.transfer(&user1, &user2, &100);
}
