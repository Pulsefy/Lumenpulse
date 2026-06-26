#![cfg(test)]
extern crate std;

use crate::{LumenToken, LumenTokenClient};
use soroban_sdk::{
    testutils::{Address as _, Ledger},
    Address, BytesN, Env, String,
};

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
