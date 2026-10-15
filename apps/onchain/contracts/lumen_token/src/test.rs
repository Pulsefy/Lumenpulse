#![cfg(test)]
extern crate std;

use crate::{LumenToken, LumenTokenClient};
use soroban_sdk::{
    testutils::{Address as _, Events, Ledger},
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

#[test]
fn test_allowance_ttl_extended_to_expiration_ledger() {
    // Regression test (issue #1226): the temporary-storage allowance entry
    // must survive on-chain long enough to reach its own logical
    // `expiration_ledger` — a physical TTL shorter than that would let the
    // entry get archived early and silently read back as a zero allowance.
    let env = Env::default();
    env.mock_all_auths();

    let admin = Address::generate(&env);
    let owner = Address::generate(&env);
    let spender = Address::generate(&env);

    let contract_id = env.register(LumenToken, ());
    let client = LumenTokenClient::new(&env, &contract_id);

    client.initialize(
        &admin,
        &7,
        &String::from_str(&env, "LumenPulse"),
        &String::from_str(&env, "LMN"),
    );
    client.mint(&owner, &1_000);

    let far_future_expiration = 300_000u32;
    client.approve(&owner, &spender, &500, &far_future_expiration);

    // Advance well past what a short/default TTL would have survived, but
    // still short of `far_future_expiration`. The allowance must still be
    // intact — proving `write_allowance` extended the physical TTL out to
    // match the caller-chosen logical expiration.
    env.ledger().set_sequence_number(250_000);
    assert_eq!(client.allowance(&owner, &spender), 500);
    client.transfer_from(&spender, &owner, &spender, &200);
    assert_eq!(client.allowance(&owner, &spender), 300);
}

// ── Event emission coverage (issue #1231) ──────────────────────────────────

#[test]
fn test_mint_emits_event() {
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
    assert_eq!(env.events().all().len(), 1);
}

#[test]
fn test_freeze_and_unfreeze_emit_events() {
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

    // `env.events().all()` reflects only the most recent contract
    // invocation, not accumulated history — so each assertion checks
    // straight after its own call rather than against a running total.
    client.freeze(&user);
    assert_eq!(env.events().all().len(), 1);

    client.unfreeze(&user);
    assert_eq!(env.events().all().len(), 1);
}

#[test]
fn test_approve_emits_event() {
    let env = Env::default();
    env.mock_all_auths();

    let admin = Address::generate(&env);
    let owner = Address::generate(&env);
    let spender = Address::generate(&env);
    let contract_id = env.register(LumenToken, ());
    let client = LumenTokenClient::new(&env, &contract_id);
    client.initialize(
        &admin,
        &7,
        &String::from_str(&env, "LumenPulse"),
        &String::from_str(&env, "LMN"),
    );

    client.approve(&owner, &spender, &500, &1000);
    assert_eq!(env.events().all().len(), 1);
}

#[test]
fn test_transfer_emits_event() {
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
    client.mint(&user1, &1_000);

    client.transfer(&user1, &user2, &300);
    assert_eq!(env.events().all().len(), 1);
    assert_eq!(client.balance(&user2), 300);
}

#[test]
fn test_transfer_from_emits_event() {
    let env = Env::default();
    env.mock_all_auths();

    let admin = Address::generate(&env);
    let owner = Address::generate(&env);
    let spender = Address::generate(&env);
    let recipient = Address::generate(&env);
    let contract_id = env.register(LumenToken, ());
    let client = LumenTokenClient::new(&env, &contract_id);
    client.initialize(
        &admin,
        &7,
        &String::from_str(&env, "LumenPulse"),
        &String::from_str(&env, "LMN"),
    );
    client.mint(&owner, &1_000);
    client.approve(&owner, &spender, &500, &1000);

    client.transfer_from(&spender, &owner, &recipient, &200);
    assert_eq!(env.events().all().len(), 1);
    assert_eq!(client.balance(&recipient), 200);
}

#[test]
fn test_contract_version() {
    use version_interface::ContractVersion;

    let env = Env::default();
    let contract_id = env.register(LumenToken, ());
    let client = LumenTokenClient::new(&env, &contract_id);

    assert_eq!(client.contract_version(), ContractVersion::new(1, 0, 0));
}
