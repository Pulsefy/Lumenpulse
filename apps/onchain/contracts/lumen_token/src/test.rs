#![cfg(test)]
extern crate std;

use crate::{LumenToken, LumenTokenClient};
use soroban_sdk::{
    testutils::{Address as _, Events, Ledger},
    Address, BytesN, Env, String,
};
use std::vec::Vec;

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

// ---------------------------------------------------------------------------
// Upgradeability tests
// ---------------------------------------------------------------------------

#[test]
fn test_set_admin_transfers_role() {
    let env = Env::default();
    env.mock_all_auths();

    let admin = Address::generate(&env);
    let new_admin = Address::generate(&env);

    let contract_id = env.register(LumenToken, ());
    let client = LumenTokenClient::new(&env, &contract_id);

    client.initialize(
        &admin,
        &7,
        &String::from_str(&env, "LumenPulse"),
        &String::from_str(&env, "LMN"),
    );

    // Rotate admin
    client.set_admin(&new_admin);

    // Verify the new admin can mint (only admin can mint)
    client.mint(&new_admin, &1000);
    assert_eq!(client.balance(&new_admin), 1000);
}

#[test]
#[should_panic]
fn test_only_admin_can_upgrade() {
    let env = Env::default();
    env.mock_all_auths();

    let admin = Address::generate(&env);
    let non_admin = Address::generate(&env);

    let contract_id = env.register(LumenToken, ());
    let client = LumenTokenClient::new(&env, &contract_id);

    client.initialize(
        &admin,
        &7,
        &String::from_str(&env, "LumenPulse"),
        &String::from_str(&env, "LMN"),
    );

    let dummy: BytesN<32> = BytesN::from_array(&env, &[0u8; 32]);
    client.upgrade(&non_admin, &dummy); // must panic
}

// ---------------------------------------------------------------------------
// TTL / storage-rent tests
// ---------------------------------------------------------------------------

/// Verify that a balance entry remains accessible after a simulated ledger
/// advance — the TTL bump on write keeps the entry alive.
#[test]
fn test_balance_entry_accessible_after_ledger_advance() {
    let env = Env::default();
    env.mock_all_auths();

    let admin = Address::generate(&env);
    let user = Address::generate(&env);

    let contract_id = env.register(LumenToken, ());
    let client = LumenTokenClient::new(&env, &contract_id);

    client.initialize(
        &admin,
        &7,
        &String::from_str(&env, "LumenPulse"),
        &String::from_str(&env, "LMN"),
    );

    client.mint(&user, &1_000);

    // Advance the ledger sequence significantly.
    env.ledger().set_sequence_number(200_000);

    // Balance must still be readable — TTL bump on write keeps it alive.
    assert_eq!(client.balance(&user), 1_000);
}

/// Verify that TTL is extended after a read (balance query) by confirming the
/// entry survives a second large ledger jump.
#[test]
fn test_ttl_extended_after_read_write() {
    let env = Env::default();
    env.mock_all_auths();

    let admin = Address::generate(&env);
    let user = Address::generate(&env);

    let contract_id = env.register(LumenToken, ());
    let client = LumenTokenClient::new(&env, &contract_id);

    client.initialize(
        &admin,
        &7,
        &String::from_str(&env, "LumenPulse"),
        &String::from_str(&env, "LMN"),
    );

    client.mint(&user, &500);

    // First ledger advance.
    env.ledger().set_sequence_number(100_001);

    // Read triggers another TTL bump.
    assert_eq!(client.balance(&user), 500);

    // Second ledger advance — read-triggered bump should keep it alive.
    env.ledger().set_sequence_number(200_002);
    assert_eq!(client.balance(&user), 500);
}

// ---------------------------------------------------------------------------
// Event emission tests
// ---------------------------------------------------------------------------

#[test]
fn test_mint_emits_event() {
    let env = Env::default();
    let contract_address = env.register(LumenToken, ());
    let admin = Address::generate(&env);
    let to = Address::generate(&env);
    let client = LumenTokenClient::new(&env, &contract_address);

    env.mock_all_auths();
    client.initialize(&admin, &7, &String::from_str(&env, "Lumen"), &String::from_str(&env, "LUMEN"));

    client.mint(&to, &1000);

    let events = env.events().all();
    let mint_events: Vec<_> = events
        .iter()
        .filter(|e| {
            let topics = &e.1;
            topics.len() > 0
        })
        .collect();
    assert!(!mint_events.is_empty());
}

#[test]
fn test_transfer_emits_event() {
    let env = Env::default();
    let contract_address = env.register(LumenToken, ());
    let admin = Address::generate(&env);
    let from = Address::generate(&env);
    let to = Address::generate(&env);
    let client = LumenTokenClient::new(&env, &contract_address);

    env.mock_all_auths();
    client.initialize(&admin, &7, &String::from_str(&env, "Lumen"), &String::from_str(&env, "LUMEN"));
    client.mint(&from, &1000);

    env.events().all();
    client.transfer(&from, &to, &100);

    let events = env.events().all();
    assert!(events.len() >= 1);
}

#[test]
fn test_freeze_emits_event() {
    let env = Env::default();
    let contract_address = env.register(LumenToken, ());
    let admin = Address::generate(&env);
    let user = Address::generate(&env);
    let client = LumenTokenClient::new(&env, &contract_address);

    env.mock_all_auths();
    client.initialize(&admin, &7, &String::from_str(&env, "Lumen"), &String::from_str(&env, "LUMEN"));
    client.freeze(&user);

    let events = env.events().all();
    assert!(!events.is_empty());
}

#[test]
fn test_unfreeze_emits_event() {
    let env = Env::default();
    let contract_address = env.register(LumenToken, ());
    let admin = Address::generate(&env);
    let user = Address::generate(&env);
    let client = LumenTokenClient::new(&env, &contract_address);

    env.mock_all_auths();
    client.initialize(&admin, &7, &String::from_str(&env, "Lumen"), &String::from_str(&env, "LUMEN"));
    client.freeze(&user);

    env.events().all();
    client.unfreeze(&user);

    let events = env.events().all();
    assert!(events.len() >= 1);
}

#[test]
fn test_approve_emits_event() {
    let env = Env::default();
    let contract_address = env.register(LumenToken, ());
    let admin = Address::generate(&env);
    let from = Address::generate(&env);
    let spender = Address::generate(&env);
    let client = LumenTokenClient::new(&env, &contract_address);

    env.mock_all_auths();
    client.initialize(&admin, &7, &String::from_str(&env, "Lumen"), &String::from_str(&env, "LUMEN"));
    client.mint(&from, &1000);

    env.events().all();
    client.approve(&from, &spender, &500, &100_000);

    let events = env.events().all();
    assert!(events.len() >= 1);
}
