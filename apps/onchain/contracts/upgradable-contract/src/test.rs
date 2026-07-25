#![cfg(test)]
extern crate std;

use crate::storage::{TimelockAction, GRACE_PERIOD_SECONDS, MIN_DELAY_SECONDS};
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
// Basic functionality
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
// Bypass rejection - direct upgrade / set_admin must be disabled
// ---------------------------------------------------------------------------

#[test]
#[should_panic(expected = "direct upgrade disabled: use timelock flow")]
fn test_direct_upgrade_is_disabled() {
    let env = Env::default();
    env.mock_all_auths();
    let admin = Address::generate(&env);
    let (_, client) = setup(&env);
    client.init(&admin);
    let dummy = BytesN::from_array(&env, &[0u8; 32]);
    client.upgrade(&admin, &dummy);
}

#[test]
#[should_panic(expected = "direct admin transfer disabled: use timelock flow")]
fn test_direct_set_admin_is_disabled() {
    let env = Env::default();
    env.mock_all_auths();
    let admin = Address::generate(&env);
    let new_admin = Address::generate(&env);
    let (_, client) = setup(&env);
    client.init(&admin);
    client.set_admin(&admin, &new_admin);
}

#[test]
#[should_panic]
fn test_only_admin_can_upgrade_via_direct_path_still_unauthorized() {
    let env = Env::default();
    env.mock_all_auths();
    let admin = Address::generate(&env);
    let non_admin = Address::generate(&env);
    let (_, client) = setup(&env);
    client.init(&admin);
    let dummy = BytesN::from_array(&env, &[0u8; 32]);
    // Even non-admin attempting direct upgrade should panic (bypass rejected)
    client.upgrade(&non_admin, &dummy);
}

#[test]
#[should_panic(expected = "direct upgrade disabled")]
fn test_old_admin_cannot_bypass_after_rotation_via_timelock() {
    let env = Env::default();
    env.mock_all_auths();
    let admin = Address::generate(&env);
    let new_admin = Address::generate(&env);
    let (_, client) = setup(&env);
    client.init(&admin);

    // Rotate admin via timelock flow
    let action = TimelockAction::SetAdmin(new_admin.clone());
    let id = client.queue_operation(&admin, &action);
    env.ledger()
        .set_timestamp(env.ledger().timestamp() + MIN_DELAY_SECONDS + 1);
    client.execute_operation(&admin, &id);

    // Old admin now tries direct upgrade - should be rejected as bypass
    let dummy = BytesN::from_array(&env, &[0u8; 32]);
    client.upgrade(&admin, &dummy);
}

// ---------------------------------------------------------------------------
// Timelock queue / query / cancel / execute
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
    assert_eq!(client.get_next_operation_id(), 1);
}

#[test]
fn test_queue_increments_id() {
    let env = Env::default();
    env.mock_all_auths();
    let admin = Address::generate(&env);
    let new_admin = Address::generate(&env);
    let (_, client) = setup(&env);
    client.init(&admin);

    let a1 = TimelockAction::SetAdmin(new_admin.clone());
    let a2 = TimelockAction::SetAdmin(new_admin);
    let id0 = client.queue_operation(&admin, &a1);
    let id1 = client.queue_operation(&admin, &a2);
    assert_eq!(id0, 0);
    assert_eq!(id1, 1);
    assert_eq!(client.get_next_operation_id(), 2);
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
fn test_get_operation_returns_queued_op_and_metadata() {
    let env = Env::default();
    env.mock_all_auths();
    let admin = Address::generate(&env);
    let new_admin = Address::generate(&env);
    let (_, client) = setup(&env);
    client.init(&admin);

    let start_ts = env.ledger().timestamp();
    let action = TimelockAction::SetAdmin(new_admin.clone());
    let id = client.queue_operation(&admin, &action);
    let op = client.get_operation(&id);

    assert_eq!(op.proposer, admin);
    assert_eq!(op.created_at, start_ts);
    assert_eq!(op.execute_after, start_ts + MIN_DELAY_SECONDS);
    assert_eq!(op.expires_at, start_ts + MIN_DELAY_SECONDS + GRACE_PERIOD_SECONDS);
    // action should be SetAdmin
    match op.action {
        TimelockAction::SetAdmin(addr) => assert_eq!(addr, new_admin),
        _ => panic!("unexpected action"),
    }
}

#[test]
fn test_get_operation_queryable_upgrade_metadata() {
    let env = Env::default();
    env.mock_all_auths();
    let admin = Address::generate(&env);
    let (_, client) = setup(&env);
    client.init(&admin);

    let wasm_hash = upload_wasm(&env);
    let action = TimelockAction::Upgrade(wasm_hash.clone());
    let id = client.queue_operation(&admin, &action);
    let op = client.get_operation(&id);

    match op.action {
        TimelockAction::Upgrade(hash) => assert_eq!(hash, wasm_hash),
        _ => panic!("expected Upgrade action"),
    }
    // Queryable fields
    assert!(op.execute_after > op.created_at);
    assert!(op.expires_at > op.execute_after);
}

#[test]
fn test_get_next_operation_id_queryable() {
    let env = Env::default();
    env.mock_all_auths();
    let admin = Address::generate(&env);
    let (_, client) = setup(&env);
    client.init(&admin);
    assert_eq!(client.get_next_operation_id(), 0);
    let action = TimelockAction::SetAdmin(Address::generate(&env));
    client.queue_operation(&admin, &action);
    assert_eq!(client.get_next_operation_id(), 1);
}

#[test]
fn test_is_operation_ready_false_before_delay() {
    let env = Env::default();
    env.mock_all_auths();
    let admin = Address::generate(&env);
    let (_, client) = setup(&env);
    client.init(&admin);
    let action = TimelockAction::SetAdmin(Address::generate(&env));
    let id = client.queue_operation(&admin, &action);
    assert!(!client.is_operation_ready(&id));
}

#[test]
fn test_is_operation_ready_true_after_delay() {
    let env = Env::default();
    env.mock_all_auths();
    let admin = Address::generate(&env);
    let (_, client) = setup(&env);
    client.init(&admin);
    let action = TimelockAction::SetAdmin(Address::generate(&env));
    let id = client.queue_operation(&admin, &action);
    env.ledger()
        .set_timestamp(env.ledger().timestamp() + MIN_DELAY_SECONDS + 1);
    assert!(client.is_operation_ready(&id));
}

#[test]
fn test_is_operation_ready_false_after_expiry() {
    let env = Env::default();
    env.mock_all_auths();
    let admin = Address::generate(&env);
    let (_, client) = setup(&env);
    client.init(&admin);
    let action = TimelockAction::SetAdmin(Address::generate(&env));
    let id = client.queue_operation(&admin, &action);
    env.ledger().set_timestamp(
        env.ledger().timestamp() + MIN_DELAY_SECONDS + GRACE_PERIOD_SECONDS + 1,
    );
    assert!(!client.is_operation_ready(&id));
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

    // After cancel, get_operation should panic
    let res = client.try_get_operation(&id);
    assert!(res.is_err());
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
    // Cancel should emit an event
    assert!(!env.events().all().is_empty());
}

#[test]
#[should_panic(expected = "operation not found")]
fn test_cancel_blocks_execution() {
    let env = Env::default();
    env.mock_all_auths();
    let admin = Address::generate(&env);
    let new_admin = Address::generate(&env);
    let (_, client) = setup(&env);
    client.init(&admin);

    let action = TimelockAction::SetAdmin(new_admin);
    let id = client.queue_operation(&admin, &action);
    client.cancel_operation(&admin, &id);

    // Advance time past delay, then try execute - should fail because cancelled
    env.ledger()
        .set_timestamp(env.ledger().timestamp() + MIN_DELAY_SECONDS + 1);
    client.execute_operation(&admin, &id);
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
fn test_execute_after_delay_succeeds_set_admin() {
    let env = Env::default();
    env.mock_all_auths();
    let admin = Address::generate(&env);
    let new_admin = Address::generate(&env);
    let (_, client) = setup(&env);
    client.init(&admin);

    let action = TimelockAction::SetAdmin(new_admin.clone());
    let id = client.queue_operation(&admin, &action);

    env.ledger()
        .set_timestamp(env.ledger().timestamp() + MIN_DELAY_SECONDS + 1);

    client.execute_operation(&admin, &id);

    assert_eq!(client.get_admin(), new_admin);
}

#[test]
fn test_execute_after_delay_succeeds_upgrade() {
    let env = Env::default();
    env.mock_all_auths();
    let admin = Address::generate(&env);
    let (_, client) = setup(&env);
    client.init(&admin);

    let new_wasm_hash = upload_wasm(&env);
    let action = TimelockAction::Upgrade(new_wasm_hash.clone());
    let id = client.queue_operation(&admin, &action);

    env.ledger()
        .set_timestamp(env.ledger().timestamp() + MIN_DELAY_SECONDS + 1);

    client.execute_operation(&admin, &id);

    // Operation should be cleaned up after successful execution
    let res = client.try_get_operation(&id);
    assert!(res.is_err());
    // Admin should still be queryable (state preserved across upgrade intent)
    assert_eq!(client.get_admin(), admin);
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
        .set_timestamp(env.ledger().timestamp() + MIN_DELAY_SECONDS + 1);

    client.execute_operation(&admin, &id);
    // Execute should emit events (AdminChanged + Executed)
    assert!(!env.events().all().is_empty());
}

#[test]
fn test_execute_removes_operation() {
    let env = Env::default();
    env.mock_all_auths();
    let admin = Address::generate(&env);
    let new_admin = Address::generate(&env);
    let (_, client) = setup(&env);
    client.init(&admin);

    let action = TimelockAction::SetAdmin(new_admin);
    let id = client.queue_operation(&admin, &action);
    env.ledger()
        .set_timestamp(env.ledger().timestamp() + MIN_DELAY_SECONDS + 1);
    client.execute_operation(&admin, &id);

    assert!(client.try_get_operation(&id).is_err());
}

// ---------------------------------------------------------------------------
// Expiry behavior
// ---------------------------------------------------------------------------

#[test]
#[should_panic(expected = "operation expired")]
fn test_operation_expires_after_grace_period() {
    let env = Env::default();
    env.mock_all_auths();
    let admin = Address::generate(&env);
    let new_admin = Address::generate(&env);
    let (_, client) = setup(&env);
    client.init(&admin);

    let action = TimelockAction::SetAdmin(new_admin);
    let id = client.queue_operation(&admin, &action);

    // Move past execute_after + grace
    env.ledger().set_timestamp(
        env.ledger().timestamp() + MIN_DELAY_SECONDS + GRACE_PERIOD_SECONDS + 1,
    );

    client.execute_operation(&admin, &id);
}

#[test]
fn test_expired_operation_remains_until_cancelled() {
    let env = Env::default();
    env.mock_all_auths();
    let admin = Address::generate(&env);
    let new_admin = Address::generate(&env);
    let (_, client) = setup(&env);
    client.init(&admin);

    let action = TimelockAction::SetAdmin(new_admin);
    let id = client.queue_operation(&admin, &action);

    env.ledger().set_timestamp(
        env.ledger().timestamp() + MIN_DELAY_SECONDS + GRACE_PERIOD_SECONDS + 10,
    );

    // Expired execution should fail (panic) but operation remains until explicitly cancelled
    let res = client.try_execute_operation(&admin, &id);
    assert!(res.is_err());

    // Operation should still be queryable after failed expired execution
    // because panic rolls back removal in our design (intentional for safety)
    let op = client.get_operation(&id);
    assert_eq!(op.proposer, admin);

    // Admin can cancel expired operation
    client.cancel_operation(&admin, &id);
    assert!(client.try_get_operation(&id).is_err());
}

#[test]
fn test_execute_at_exact_expiry_boundary_succeeds() {
    let env = Env::default();
    env.mock_all_auths();
    let admin = Address::generate(&env);
    let new_admin = Address::generate(&env);
    let (_, client) = setup(&env);
    client.init(&admin);

    let action = TimelockAction::SetAdmin(new_admin.clone());
    let id = client.queue_operation(&admin, &action);

    // Exactly at execute_after + grace should still be valid (<=)
    env.ledger().set_timestamp(
        env.ledger().timestamp() + MIN_DELAY_SECONDS + GRACE_PERIOD_SECONDS,
    );

    client.execute_operation(&admin, &id);
    assert_eq!(client.get_admin(), new_admin);
}

#[test]
fn test_execute_one_second_after_expiry_fails() {
    let env = Env::default();
    env.mock_all_auths();
    let admin = Address::generate(&env);
    let new_admin = Address::generate(&env);
    let (_, client) = setup(&env);
    client.init(&admin);

    let action = TimelockAction::SetAdmin(new_admin);
    let id = client.queue_operation(&admin, &action);

    env.ledger().set_timestamp(
        env.ledger().timestamp() + MIN_DELAY_SECONDS + GRACE_PERIOD_SECONDS + 1,
    );

    let res = client.try_execute_operation(&admin, &id);
    assert!(res.is_err());
}

// ---------------------------------------------------------------------------
// Unauthorized access
// ---------------------------------------------------------------------------

#[test]
#[should_panic(expected = "unauthorized")]
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

#[test]
#[should_panic(expected = "unauthorized")]
fn test_non_admin_cannot_cancel() {
    let env = Env::default();
    env.mock_all_auths();
    let admin = Address::generate(&env);
    let attacker = Address::generate(&env);
    let (_, client) = setup(&env);
    client.init(&admin);

    let action = TimelockAction::SetAdmin(Address::generate(&env));
    let id = client.queue_operation(&admin, &action);

    client.cancel_operation(&attacker, &id);
}

#[test]
#[should_panic(expected = "unauthorized")]
fn test_non_admin_cannot_execute() {
    let env = Env::default();
    env.mock_all_auths();
    let admin = Address::generate(&env);
    let attacker = Address::generate(&env);
    let (_, client) = setup(&env);
    client.init(&admin);

    let action = TimelockAction::SetAdmin(Address::generate(&env));
    let id = client.queue_operation(&admin, &action);

    env.ledger()
        .set_timestamp(env.ledger().timestamp() + MIN_DELAY_SECONDS + 1);

    client.execute_operation(&attacker, &id);
}

#[test]
#[should_panic(expected = "operation not found")]
fn test_get_nonexistent_operation_panics() {
    let env = Env::default();
    env.mock_all_auths();
    let admin = Address::generate(&env);
    let (_, client) = setup(&env);
    client.init(&admin);

    client.get_operation(&999);
}

#[test]
#[should_panic(expected = "operation not found")]
fn test_cancel_nonexistent_operation_panics() {
    let env = Env::default();
    env.mock_all_auths();
    let admin = Address::generate(&env);
    let (_, client) = setup(&env);
    client.init(&admin);

    client.cancel_operation(&admin, &42);
}

#[test]
#[should_panic(expected = "operation not found")]
fn test_execute_nonexistent_operation_panics() {
    let env = Env::default();
    env.mock_all_auths();
    let admin = Address::generate(&env);
    let (_, client) = setup(&env);
    client.init(&admin);

    client.execute_operation(&admin, &777);
}

// ---------------------------------------------------------------------------
// Admin rotation via timelock
// ---------------------------------------------------------------------------

#[test]
fn test_admin_rotation_via_timelock_and_old_admin_loses_privileges() {
    let env = Env::default();
    env.mock_all_auths();
    let admin = Address::generate(&env);
    let new_admin = Address::generate(&env);
    let (_, client) = setup(&env);
    client.init(&admin);

    // Queue SetAdmin
    let action = TimelockAction::SetAdmin(new_admin.clone());
    let id = client.queue_operation(&admin, &action);
    env.ledger()
        .set_timestamp(env.ledger().timestamp() + MIN_DELAY_SECONDS + 1);
    client.execute_operation(&admin, &id);

    assert_eq!(client.get_admin(), new_admin);

    // Old admin should now be unauthorized to queue
    let action2 = TimelockAction::SetAdmin(admin.clone());
    let res = client.try_queue_operation(&admin, &action2);
    assert!(res.is_err());

    // New admin can queue
    let action3 = TimelockAction::SetAdmin(admin.clone());
    let id2 = client.queue_operation(&new_admin, &action3);
    assert_eq!(id2, 1);
}

#[test]
fn test_upgrade_via_timelock_flow() {
    let env = Env::default();
    env.mock_all_auths();
    let admin = Address::generate(&env);
    let (_, client) = setup(&env);
    client.init(&admin);

    let wasm_hash = upload_wasm(&env);
    let action = TimelockAction::Upgrade(wasm_hash);
    let id = client.queue_operation(&admin, &action);

    // Before delay, should not be ready and execute should fail
    assert!(!client.is_operation_ready(&id));
    assert!(client.try_execute_operation(&admin, &id).is_err());

    // After delay, ready
    env.ledger()
        .set_timestamp(env.ledger().timestamp() + MIN_DELAY_SECONDS + 1);
    assert!(client.is_operation_ready(&id));

    client.execute_operation(&admin, &id);

    // Operation cleaned up
    assert!(client.try_get_operation(&id).is_err());
}
