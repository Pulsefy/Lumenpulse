#![cfg(test)]
extern crate std;

use crate::storage::TimelockAction;
use crate::{UpgradableContract, UpgradableContractClient};
use soroban_sdk::{
    testutils::{Address as _, Events, Ledger},
    Address, Bytes, BytesN, Env,
};

const CONTRACT_WASM: &[u8] = include_bytes!("./mock/upgradable_contract.wasm");

fn setup(env: &Env) -> (Address, UpgradableContractClient<'_>) {
    let contract_id = env.register(UpgradableContract, ());
    let client = UpgradableContractClient::new(env, &contract_id);
    (contract_id, client)
}

fn upload_wasm(env: &Env) -> BytesN<32> {
    let bytes = Bytes::from_slice(env, CONTRACT_WASM);
    env.deployer().upload_contract_wasm(bytes)
}

// ---------------------------------------------------------------------------
// Existing tests (unchanged)
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

#[test]
fn test_upgrade_succeeds_for_admin() {
    let env = Env::default();
    env.mock_all_auths();
    let admin = Address::generate(&env);
    let contract_id = env.register(CONTRACT_WASM, ());
    let client = UpgradableContractClient::new(&env, &contract_id);
    client.init(&admin);
    let new_wasm_hash = upload_wasm(&env);
    client.upgrade(&admin, &new_wasm_hash);
}

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
    assert!(env.events().all().len() > before);
}

#[test]
#[should_panic]
fn test_only_admin_can_upgrade() {
    let env = Env::default();
    env.mock_all_auths();
    let admin = Address::generate(&env);
    let non_admin = Address::generate(&env);
    let (_, client) = setup(&env);
    client.init(&admin);
    let dummy = BytesN::from_array(&env, &[0u8; 32]);
    client.upgrade(&non_admin, &dummy);
}

#[test]
#[should_panic(expected = "already initialized")]
fn test_already_initialized() {
    let env = Env::default();
    env.mock_all_auths();
    let admin = Address::generate(&env);
    let (_, client) = setup(&env);
    client.init(&admin);
    client.init(&admin);
}

#[test]
fn test_set_admin_transfers_role() {
    let env = Env::default();
    env.mock_all_auths();
    let admin = Address::generate(&env);
    let new_admin = Address::generate(&env);
    let (_, client) = setup(&env);
    client.init(&admin);
    assert_eq!(client.get_admin(), admin);
    client.set_admin(&admin, &new_admin);
    assert_eq!(client.get_admin(), new_admin);
}

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
    assert!(env.events().all().len() > before);
}

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
    client.upgrade(&admin, &dummy);
}

#[test]
fn test_instance_storage_accessible_after_ledger_advance() {
    let env = Env::default();
    env.mock_all_auths();
    let admin = Address::generate(&env);
    let (_, client) = setup(&env);
    client.init(&admin);
    client.increment();
    client.increment();
    env.ledger().set_sequence_number(200_000);
    assert_eq!(client.get_admin(), admin);
    assert_eq!(client.get_count(), 2);
}

#[test]
fn test_ttl_extended_after_read_write() {
    let env = Env::default();
    env.mock_all_auths();
    let admin = Address::generate(&env);
    let (_, client) = setup(&env);
    client.init(&admin);
    assert_eq!(client.increment(), 1);
    env.ledger().set_sequence_number(100_001);
    assert_eq!(client.get_count(), 1);
    env.ledger().set_sequence_number(200_002);
    assert_eq!(client.get_count(), 1);
    assert_eq!(client.increment(), 2);
    env.ledger().set_sequence_number(300_003);
    assert_eq!(client.get_count(), 2);
}

// ---------------------------------------------------------------------------
// New timelock tests
// ---------------------------------------------------------------------------

#[test]
fn test_queue_operation_returns_id() {
    let env = Env::default();
    env.mock_all_auths();
    let admin = Address::generate(&env);
    let new_admin = Address::generate(&env);
    let (_, client) = setup(&env);
    client.init(&admin);

    let action = TimelockAction::SetAdmin(new_admin);
    let id = client.queue_operation(&admin, &action);
    assert_eq!(id, 0);
}

#[test]
fn test_queue_operation_emits_event() {
    let env = Env::default();
    env.mock_all_auths();
    let admin = Address::generate(&env);
    let new_admin = Address::generate(&env);
    let (_, client) = setup(&env);
    client.init(&admin);

    let before = env.events().all().len();
    let action = TimelockAction::SetAdmin(new_admin);
    client.queue_operation(&admin, &action);
    assert!(env.events().all().len() > before);
}

#[test]
fn test_get_operation_returns_queued_op() {
    let env = Env::default();
    env.mock_all_auths();
    let admin = Address::generate(&env);
    let new_admin = Address::generate(&env);
    let (_, client) = setup(&env);
    client.init(&admin);

    let action = TimelockAction::SetAdmin(new_admin.clone());
    let id = client.queue_operation(&admin, &action);
    let op = client.get_operation(&id);

    assert_eq!(op.proposer, admin);
}

#[test]
fn test_cancel_operation_removes_it() {
    let env = Env::default();
    env.mock_all_auths();
    let admin = Address::generate(&env);
    let new_admin = Address::generate(&env);
    let (_, client) = setup(&env);
    client.init(&admin);

    let action = TimelockAction::SetAdmin(new_admin);
    let id = client.queue_operation(&admin, &action);
    client.cancel_operation(&admin, &id);

    let next_id: u32 = 1;
    assert_eq!(id + 1, next_id);
}

#[test]
fn test_cancel_operation_emits_event() {
    let env = Env::default();
    env.mock_all_auths();
    let admin = Address::generate(&env);
    let new_admin = Address::generate(&env);
    let (_, client) = setup(&env);
    client.init(&admin);

    let action = TimelockAction::SetAdmin(new_admin);
    let id = client.queue_operation(&admin, &action);
    client.cancel_operation(&admin, &id);

    assert!(!env.events().all().is_empty());
}

#[test]
#[should_panic(expected = "timelock not expired")]
fn test_execute_before_delay_panics() {
    let env = Env::default();
    env.mock_all_auths();
    let admin = Address::generate(&env);
    let new_admin = Address::generate(&env);
    let (_, client) = setup(&env);
    client.init(&admin);

    let action = TimelockAction::SetAdmin(new_admin);
    let id = client.queue_operation(&admin, &action);

    client.execute_operation(&admin, &id);
}

#[test]
fn test_execute_after_delay_succeeds() {
    let env = Env::default();
    env.mock_all_auths();
    let admin = Address::generate(&env);
    let new_admin = Address::generate(&env);
    let (_, client) = setup(&env);
    client.init(&admin);

    let action = TimelockAction::SetAdmin(new_admin.clone());
    let id = client.queue_operation(&admin, &action);

    env.ledger()
        .set_timestamp(env.ledger().timestamp() + 86_401);

    client.execute_operation(&admin, &id);

    assert_eq!(client.get_admin(), new_admin);
}

#[test]
fn test_execute_emits_event() {
    let env = Env::default();
    env.mock_all_auths();
    let admin = Address::generate(&env);
    let new_admin = Address::generate(&env);
    let (_, client) = setup(&env);
    client.init(&admin);

    let action = TimelockAction::SetAdmin(new_admin);
    let id = client.queue_operation(&admin, &action);

    env.ledger()
        .set_timestamp(env.ledger().timestamp() + 86_401);

    let before = env.events().all().len();
    client.execute_operation(&admin, &id);
    assert!(env.events().all().len() > before);
}

#[test]
#[should_panic]
fn test_non_admin_cannot_queue() {
    let env = Env::default();
    env.mock_all_auths();
    let admin = Address::generate(&env);
    let attacker = Address::generate(&env);
    let (_, client) = setup(&env);
    client.init(&admin);

    let action = TimelockAction::SetAdmin(attacker.clone());
    client.queue_operation(&attacker, &action);
}
