#![cfg(test)]
extern crate std;

use crate::errors::ContractError;
use crate::storage::{
    OperationStatus, TimelockAction, GRACE_PERIOD_SECONDS, LEDGER_THRESHOLD, MIN_DELAY_SECONDS,
};
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

fn advance_to_ready(env: &Env) {
    env.ledger()
        .set_timestamp(env.ledger().timestamp() + MIN_DELAY_SECONDS);
}

// ---------------------------------------------------------------------------
// Basic lifecycle (unaffected by the timelock refactor)
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
fn test_already_initialized() {
    let env = Env::default();
    env.mock_all_auths();
    let admin = Address::generate(&env);
    let (_, client) = setup(&env);
    client.init(&admin);
    assert_eq!(
        client.try_init(&admin),
        Err(Ok(ContractError::AlreadyInitialized))
    );
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

#[test]
fn test_queued_operation_ttl_extended_on_read() {
    let env = Env::default();
    env.mock_all_auths();
    let admin = Address::generate(&env);
    let new_admin = Address::generate(&env);
    let (_, client) = setup(&env);
    client.init(&admin);

    let action = TimelockAction::SetAdmin(new_admin.clone());
    let id = client.queue_operation(&admin, &action);

    // First threshold crossing: a read (`get_operation`) should re-bump the
    // QueuedOperation's own persistent TTL, not just the instance TTL.
    env.ledger().set_sequence_number(LEDGER_THRESHOLD + 1);
    let op = client.get_operation(&id);
    assert_eq!(op.proposer, admin);
    assert_eq!(op.action, action);

    // Second threshold crossing: this only survives if the prior read
    // actually extended the TTL rather than leaving it to expire.
    env.ledger().set_sequence_number(2 * LEDGER_THRESHOLD + 2);
    let op = client.get_operation(&id);
    assert_eq!(op.proposer, admin);
    assert_eq!(op.action, action);

    // `get_operation_status` is the other read path touching this key —
    // confirm it also keeps the entry alive across a further advance.
    // (Ledger *timestamp* stays at 0 throughout — only *sequence number*
    // advances here — so the timelock itself is still Pending; this is
    // purely exercising storage-TTL survival, not timelock state.)
    env.ledger().set_sequence_number(3 * LEDGER_THRESHOLD + 3);
    assert_eq!(client.get_operation_status(&id), OperationStatus::Pending);
    env.ledger().set_sequence_number(4 * LEDGER_THRESHOLD + 4);
    let op = client.get_operation(&id);
    assert_eq!(op.proposer, admin);
}

// ---------------------------------------------------------------------------
// Queue
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

    let action = TimelockAction::SetAdmin(new_admin);
    client.queue_operation(&admin, &action);
    // `env.events().all()` reflects only the invocation tree of the most
    // recent top-level client call, not an accumulated history.
    assert!(!env.events().all().is_empty());
}

#[test]
fn test_non_admin_cannot_queue() {
    let env = Env::default();
    env.mock_all_auths();
    let admin = Address::generate(&env);
    let attacker = Address::generate(&env);
    let (_, client) = setup(&env);
    client.init(&admin);

    let action = TimelockAction::SetAdmin(attacker.clone());
    assert_eq!(
        client.try_queue_operation(&attacker, &action),
        Err(Ok(ContractError::Unauthorized))
    );
}

// ---------------------------------------------------------------------------
// Get / status
// ---------------------------------------------------------------------------

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
    assert_eq!(op.action, action);
    assert_eq!(op.execute_after, op.created_at + MIN_DELAY_SECONDS);
    assert_eq!(op.expires_at, op.execute_after + GRACE_PERIOD_SECONDS);
}

#[test]
fn test_get_operation_nonexistent_returns_not_found() {
    let env = Env::default();
    env.mock_all_auths();
    let admin = Address::generate(&env);
    let (_, client) = setup(&env);
    client.init(&admin);

    assert_eq!(
        client.try_get_operation(&9_999u32),
        Err(Ok(ContractError::OperationNotFound))
    );
}

#[test]
fn test_operation_status_transitions_pending_ready_expired() {
    let env = Env::default();
    env.mock_all_auths();
    let admin = Address::generate(&env);
    let new_admin = Address::generate(&env);
    let (_, client) = setup(&env);
    client.init(&admin);

    let action = TimelockAction::SetAdmin(new_admin);
    let id = client.queue_operation(&admin, &action);

    assert_eq!(client.get_operation_status(&id), OperationStatus::Pending);

    advance_to_ready(&env);
    assert_eq!(client.get_operation_status(&id), OperationStatus::Ready);

    env.ledger()
        .set_timestamp(env.ledger().timestamp() + GRACE_PERIOD_SECONDS + 1);
    assert_eq!(client.get_operation_status(&id), OperationStatus::Expired);
}

#[test]
fn test_get_operation_status_nonexistent_returns_not_found() {
    let env = Env::default();
    env.mock_all_auths();
    let admin = Address::generate(&env);
    let (_, client) = setup(&env);
    client.init(&admin);

    assert_eq!(
        client.try_get_operation_status(&9_999u32),
        Err(Ok(ContractError::OperationNotFound))
    );
}

// ---------------------------------------------------------------------------
// Cancel
// ---------------------------------------------------------------------------

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

    assert_eq!(
        client.try_get_operation(&id),
        Err(Ok(ContractError::OperationNotFound))
    );
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

    // `env.events().all()` reflects only the invocation tree of the most
    // recent top-level client call, not an accumulated history.
    assert!(!env.events().all().is_empty());
}

#[test]
fn test_cancel_operation_rejects_non_admin() {
    let env = Env::default();
    env.mock_all_auths();
    let admin = Address::generate(&env);
    let new_admin = Address::generate(&env);
    let attacker = Address::generate(&env);
    let (_, client) = setup(&env);
    client.init(&admin);

    let action = TimelockAction::SetAdmin(new_admin);
    let id = client.queue_operation(&admin, &action);

    assert_eq!(
        client.try_cancel_operation(&attacker, &id),
        Err(Ok(ContractError::Unauthorized))
    );
}

#[test]
fn test_cancel_operation_nonexistent_returns_not_found() {
    let env = Env::default();
    env.mock_all_auths();
    let admin = Address::generate(&env);
    let (_, client) = setup(&env);
    client.init(&admin);

    assert_eq!(
        client.try_cancel_operation(&admin, &9_999u32),
        Err(Ok(ContractError::OperationNotFound))
    );
}

#[test]
fn test_cancel_operation_works_after_expiry() {
    let env = Env::default();
    env.mock_all_auths();
    let admin = Address::generate(&env);
    let new_admin = Address::generate(&env);
    let (_, client) = setup(&env);
    client.init(&admin);

    let action = TimelockAction::SetAdmin(new_admin);
    let id = client.queue_operation(&admin, &action);

    env.ledger()
        .set_timestamp(env.ledger().timestamp() + MIN_DELAY_SECONDS + GRACE_PERIOD_SECONDS + 1);

    // Cancelling a stale, expired operation must still work — it's the only
    // way to clean it up.
    client.cancel_operation(&admin, &id);
    assert_eq!(
        client.try_get_operation(&id),
        Err(Ok(ContractError::OperationNotFound))
    );
}

// ---------------------------------------------------------------------------
// Execute — timing boundaries
// ---------------------------------------------------------------------------

#[test]
fn test_execute_before_delay_rejected() {
    let env = Env::default();
    env.mock_all_auths();
    let admin = Address::generate(&env);
    let new_admin = Address::generate(&env);
    let (_, client) = setup(&env);
    client.init(&admin);

    let action = TimelockAction::SetAdmin(new_admin);
    let id = client.queue_operation(&admin, &action);

    // One second before the boundary.
    env.ledger()
        .set_timestamp(env.ledger().timestamp() + MIN_DELAY_SECONDS - 1);

    assert_eq!(
        client.try_execute_operation(&admin, &id),
        Err(Ok(ContractError::OperationNotReady))
    );
}

#[test]
fn test_execute_at_exact_delay_boundary_succeeds() {
    let env = Env::default();
    env.mock_all_auths();
    let admin = Address::generate(&env);
    let new_admin = Address::generate(&env);
    let (_, client) = setup(&env);
    client.init(&admin);

    let action = TimelockAction::SetAdmin(new_admin.clone());
    let id = client.queue_operation(&admin, &action);

    advance_to_ready(&env);
    client.execute_operation(&admin, &id);

    assert_eq!(client.get_admin(), new_admin);
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
        .set_timestamp(env.ledger().timestamp() + MIN_DELAY_SECONDS + 1);

    client.execute_operation(&admin, &id);

    assert_eq!(client.get_admin(), new_admin);
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

    env.ledger()
        .set_timestamp(env.ledger().timestamp() + MIN_DELAY_SECONDS + GRACE_PERIOD_SECONDS);

    client.execute_operation(&admin, &id);
    assert_eq!(client.get_admin(), new_admin);
}

#[test]
fn test_execute_one_second_past_expiry_rejected() {
    let env = Env::default();
    env.mock_all_auths();
    let admin = Address::generate(&env);
    let new_admin = Address::generate(&env);
    let (_, client) = setup(&env);
    client.init(&admin);

    let action = TimelockAction::SetAdmin(new_admin);
    let id = client.queue_operation(&admin, &action);

    env.ledger()
        .set_timestamp(env.ledger().timestamp() + MIN_DELAY_SECONDS + GRACE_PERIOD_SECONDS + 1);

    assert_eq!(
        client.try_execute_operation(&admin, &id),
        Err(Ok(ContractError::OperationExpired))
    );
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

    advance_to_ready(&env);

    client.execute_operation(&admin, &id);
    // `env.events().all()` reflects only the invocation tree of the most
    // recent top-level client call, not an accumulated history.
    assert!(!env.events().all().is_empty());
}

#[test]
fn test_execute_rejects_non_admin() {
    let env = Env::default();
    env.mock_all_auths();
    let admin = Address::generate(&env);
    let new_admin = Address::generate(&env);
    let attacker = Address::generate(&env);
    let (_, client) = setup(&env);
    client.init(&admin);

    let action = TimelockAction::SetAdmin(new_admin);
    let id = client.queue_operation(&admin, &action);
    advance_to_ready(&env);

    assert_eq!(
        client.try_execute_operation(&attacker, &id),
        Err(Ok(ContractError::Unauthorized))
    );
}

#[test]
fn test_execute_nonexistent_returns_not_found() {
    let env = Env::default();
    env.mock_all_auths();
    let admin = Address::generate(&env);
    let (_, client) = setup(&env);
    client.init(&admin);

    assert_eq!(
        client.try_execute_operation(&admin, &9_999u32),
        Err(Ok(ContractError::OperationNotFound))
    );
}

#[test]
fn test_double_execute_rejected() {
    let env = Env::default();
    env.mock_all_auths();
    let admin = Address::generate(&env);
    let contract_id = env.register(CONTRACT_WASM, ());
    let client = UpgradableContractClient::new(&env, &contract_id);
    client.init(&admin);

    // Use an Upgrade (not SetAdmin) so the caller's own authority is
    // unaffected by the first execution, isolating "already consumed"
    // from "caller is no longer admin".
    let new_wasm_hash = upload_wasm(&env);
    let action = TimelockAction::Upgrade(new_wasm_hash);
    let id = client.queue_operation(&admin, &action);
    advance_to_ready(&env);

    client.execute_operation(&admin, &id);

    // The operation was consumed on first execution — a second attempt has
    // nothing to execute.
    assert_eq!(
        client.try_execute_operation(&admin, &id),
        Err(Ok(ContractError::OperationNotFound))
    );
}

// ---------------------------------------------------------------------------
// Upgrade through the queue (the only way an upgrade can happen)
// ---------------------------------------------------------------------------

#[test]
fn test_upgrade_via_queue_succeeds_after_delay() {
    let env = Env::default();
    env.mock_all_auths();
    let admin = Address::generate(&env);
    let contract_id = env.register(CONTRACT_WASM, ());
    let client = UpgradableContractClient::new(&env, &contract_id);
    client.init(&admin);

    let new_wasm_hash = upload_wasm(&env);
    let action = TimelockAction::Upgrade(new_wasm_hash);
    let id = client.queue_operation(&admin, &action);

    advance_to_ready(&env);

    client.execute_operation(&admin, &id);
    // `env.events().all()` reflects only the invocation tree of the most
    // recent top-level client call, not an accumulated history.
    assert!(!env.events().all().is_empty());

    // The operation is consumed, matching the SetAdmin path.
    assert_eq!(
        client.try_get_operation(&id),
        Err(Ok(ContractError::OperationNotFound))
    );
}

#[test]
fn test_upgrade_via_queue_rejected_before_delay() {
    let env = Env::default();
    env.mock_all_auths();
    let admin = Address::generate(&env);
    let contract_id = env.register(CONTRACT_WASM, ());
    let client = UpgradableContractClient::new(&env, &contract_id);
    client.init(&admin);

    let new_wasm_hash = upload_wasm(&env);
    let action = TimelockAction::Upgrade(new_wasm_hash);
    let id = client.queue_operation(&admin, &action);

    assert_eq!(
        client.try_execute_operation(&admin, &id),
        Err(Ok(ContractError::OperationNotReady))
    );
}

#[test]
fn test_upgrade_via_queue_rejected_for_non_admin_proposer() {
    let env = Env::default();
    env.mock_all_auths();
    let admin = Address::generate(&env);
    let attacker = Address::generate(&env);
    let contract_id = env.register(CONTRACT_WASM, ());
    let client = UpgradableContractClient::new(&env, &contract_id);
    client.init(&admin);

    let new_wasm_hash = upload_wasm(&env);
    let action = TimelockAction::Upgrade(new_wasm_hash);

    assert_eq!(
        client.try_queue_operation(&attacker, &action),
        Err(Ok(ContractError::Unauthorized))
    );
}

#[test]
fn test_old_admin_cannot_execute_after_rotation() {
    let env = Env::default();
    env.mock_all_auths();
    let admin = Address::generate(&env);
    let new_admin = Address::generate(&env);
    let contract_id = env.register(CONTRACT_WASM, ());
    let client = UpgradableContractClient::new(&env, &contract_id);
    client.init(&admin);

    // Rotate admin through the queue.
    let rotate_id = client.queue_operation(&admin, &TimelockAction::SetAdmin(new_admin.clone()));
    advance_to_ready(&env);
    client.execute_operation(&admin, &rotate_id);
    assert_eq!(client.get_admin(), new_admin);

    // The old admin can no longer queue anything, including an upgrade.
    let new_wasm_hash = upload_wasm(&env);
    assert_eq!(
        client.try_queue_operation(&admin, &TimelockAction::Upgrade(new_wasm_hash)),
        Err(Ok(ContractError::Unauthorized))
    );
}

#[test]
fn test_two_step_admin_rotation_flow() {
    let env = Env::default();
    env.mock_all_auths();
    let admin = Address::generate(&env);
    let new_admin = Address::generate(&env);
    let attacker = Address::generate(&env);
    let (_, client) = setup(&env);
    client.init(&admin);

    // Unauthorized proposer fails
    assert_eq!(
        client.try_propose_admin_rotation(&attacker, &new_admin),
        Err(Ok(ContractError::Unauthorized))
    );

    // Propose
    client.propose_admin_rotation(&admin, &new_admin);

    // Accept
    client.accept_admin_rotation(&new_admin);
    assert_eq!(client.get_admin(), new_admin);
}

#[test]
fn test_admin_rotation_cancel() {
    let env = Env::default();
    env.mock_all_auths();
    let admin = Address::generate(&env);
    let new_admin = Address::generate(&env);
    let (_, client) = setup(&env);
    client.init(&admin);

    client.propose_admin_rotation(&admin, &new_admin);
    client.cancel_admin_rotation(&admin);

    assert_eq!(
        client.try_accept_admin_rotation(&new_admin),
        Err(Ok(ContractError::OperationNotFound))
    );
}

// ── Event emission coverage (issue #1231) ──────────────────────────────────

#[test]
fn test_propose_admin_rotation_emits_event() {
    let env = Env::default();
    env.mock_all_auths();
    let admin = Address::generate(&env);
    let new_admin = Address::generate(&env);
    let (_, client) = setup(&env);
    client.init(&admin);

    client.propose_admin_rotation(&admin, &new_admin);
    // `env.events().all()` reflects only the invocation tree of the most
    // recent top-level client call, not an accumulated history.
    assert!(!env.events().all().is_empty());
}

#[test]
fn test_cancel_admin_rotation_emits_event() {
    let env = Env::default();
    env.mock_all_auths();
    let admin = Address::generate(&env);
    let new_admin = Address::generate(&env);
    let (_, client) = setup(&env);
    client.init(&admin);

    client.propose_admin_rotation(&admin, &new_admin);
    client.cancel_admin_rotation(&admin);
    // `env.events().all()` reflects only the invocation tree of the most
    // recent top-level client call, not an accumulated history.
    assert!(!env.events().all().is_empty());
}

#[test]
fn test_cancel_admin_rotation_without_proposal_fails() {
    let env = Env::default();
    env.mock_all_auths();
    let admin = Address::generate(&env);
    let (_, client) = setup(&env);
    client.init(&admin);

    assert_eq!(
        client.try_cancel_admin_rotation(&admin),
        Err(Ok(ContractError::OperationNotFound))
    );
}

#[test]
fn test_contract_version() {
    use version_interface::ContractVersion;

    let env = Env::default();
    let (_, client) = setup(&env);
    assert_eq!(client.contract_version(), ContractVersion::new(1, 0, 0));
}
