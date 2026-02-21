#![cfg(test)]
extern crate std;

use crate::{UpgradableContract, UpgradableContractClient};
use soroban_sdk::{
    testutils::{Address as _, Events},
    Address, Bytes, BytesN, Env,
};

// ---------------------------------------------------------------------------
// The compiled contract WASM is embedded for tests that require WASM-level
// behaviour: real upgrade execution and on-chain event emission.
// ---------------------------------------------------------------------------
const CONTRACT_WASM: &[u8] = include_bytes!("./mock/upgradable_contract.wasm");

/// Register the contract *natively* (no WASM VM).
/// Instance storage persists between calls. Fast.
fn setup(env: &Env) -> (Address, UpgradableContractClient<'_>) {
    let contract_id = env.register(UpgradableContract, ());
    let client = UpgradableContractClient::new(env, &contract_id);
    (contract_id, client)
}

/// Upload the compiled WASM into the test ledger and return its hash.
/// Used when a **real** `update_current_contract_wasm` call is needed.
fn upload_wasm(env: &Env) -> BytesN<32> {
    let bytes = Bytes::from_slice(env, CONTRACT_WASM);
    env.deployer().upload_contract_wasm(bytes)
}

// ---------------------------------------------------------------------------
// 1. State (counter) persists across multiple invocations
// ---------------------------------------------------------------------------
#[test]
fn test_counter_persists() {
    let env = Env::default();
    env.mock_all_auths();

    let admin = Address::generate(&env);
    let (_, client) = setup(&env);

    client.init(&admin);
    assert_eq!(client.increment(), 1);
    assert_eq!(client.increment(), 2);
    assert_eq!(client.increment(), 3);
    assert_eq!(client.get_count(), 3);
}

// ---------------------------------------------------------------------------
// 2. upgrade() runs without panicking when called by admin with a valid hash
//    (WASM mode so update_current_contract_wasm has a real target)
// ---------------------------------------------------------------------------
#[test]
fn test_upgrade_succeeds_for_admin() {
    let env = Env::default();
    env.mock_all_auths();

    let admin = Address::generate(&env);
    // Register as WASM so the deployer call has a real ledger entry.
    let contract_id = env.register(CONTRACT_WASM, ());
    let client = UpgradableContractClient::new(&env, &contract_id);

    client.init(&admin);
    // Upload returns the hash of the currently-running WASM.
    let new_wasm_hash = upload_wasm(&env);
    // Should succeed without panicking.
    client.upgrade(&admin, &new_wasm_hash);
}

// ---------------------------------------------------------------------------
// 3. upgrade() emits an UpgradedEvent (WASM mode for event emission)
// ---------------------------------------------------------------------------
#[test]
fn test_upgrade_emits_event() {
    let env = Env::default();
    env.mock_all_auths();

    let admin = Address::generate(&env);
    let contract_id = env.register(CONTRACT_WASM, ());
    let client = UpgradableContractClient::new(&env, &contract_id);

    client.init(&admin);
    let new_wasm_hash = upload_wasm(&env);

    let before = env.events().all().len();
    client.upgrade(&admin, &new_wasm_hash);

    assert!(
        env.events().all().len() > before,
        "upgrade must emit at least one event"
    );
}

// ---------------------------------------------------------------------------
// 4. Only the admin caller is permitted to upgrade
// ---------------------------------------------------------------------------
#[test]
#[should_panic]
fn test_only_admin_can_upgrade() {
    let env = Env::default();
    env.mock_all_auths();

    let admin = Address::generate(&env);
    let non_admin = Address::generate(&env);
    let (_, client) = setup(&env);

    client.init(&admin);

    // Auth check fires before deployer call so a zero hash is fine here.
    let dummy = BytesN::from_array(&env, &[0u8; 32]);
    client.upgrade(&non_admin, &dummy); // must panic
}

// ---------------------------------------------------------------------------
// 5. Double initialisation panics with "already initialized"
// ---------------------------------------------------------------------------
#[test]
#[should_panic(expected = "already initialized")]
fn test_already_initialized() {
    let env = Env::default();
    env.mock_all_auths();

    let admin = Address::generate(&env);
    let (_, client) = setup(&env);

    client.init(&admin);
    client.init(&admin); // must panic
}

// ---------------------------------------------------------------------------
// 6a. set_admin transfers the admin role
// ---------------------------------------------------------------------------
#[test]
fn test_set_admin_transfers_role() {
    let env = Env::default();
    env.mock_all_auths();

    let admin = Address::generate(&env);
    let new_admin = Address::generate(&env);
    let (_, client) = setup(&env);

    client.init(&admin);
    assert_eq!(client.get_admin(), admin, "initial admin must match");

    client.set_admin(&admin, &new_admin);

    assert_eq!(client.get_admin(), new_admin, "admin must be updated");
}

// ---------------------------------------------------------------------------
// 6b. set_admin emits an AdminChangedEvent (WASM mode for events)
// ---------------------------------------------------------------------------
#[test]
fn test_set_admin_emits_event() {
    let env = Env::default();
    env.mock_all_auths();

    let admin = Address::generate(&env);
    let new_admin = Address::generate(&env);
    let contract_id = env.register(CONTRACT_WASM, ());
    let client = UpgradableContractClient::new(&env, &contract_id);

    client.init(&admin);
    let before = env.events().all().len();
    client.set_admin(&admin, &new_admin);

    assert!(
        env.events().all().len() > before,
        "set_admin must emit an AdminChangedEvent"
    );
}

// ---------------------------------------------------------------------------
// 7. After admin rotation the old admin can no longer upgrade
// ---------------------------------------------------------------------------
#[test]
#[should_panic]
fn test_old_admin_cannot_upgrade_after_rotation() {
    let env = Env::default();
    env.mock_all_auths();

    let admin = Address::generate(&env);
    let new_admin = Address::generate(&env);
    let (_, client) = setup(&env);

    client.init(&admin);
    client.set_admin(&admin, &new_admin);

    let dummy = BytesN::from_array(&env, &[0u8; 32]);
    client.upgrade(&admin, &dummy); // must panic – old admin rejected
}
