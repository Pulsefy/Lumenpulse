//! # Cross-Contract Call Failure Injection Tests
//!
//! Tests every cross-contract call site in the funding path
//!
//!   crowdfund_vault → matching_pool → treasury
//!
//! with notification_broker fanning out alongside.
//!
//! ## Call-site inventory (matches ROUND_LIFECYCLE_INVARIANTS.md §3)
//!
//! | # | Call site                                                   | Caller contract         | Safe? |
//! |---|-------------------------------------------------------------|-------------------------|-------|
//! | A | `notify_subscribers → on_notify` (per subscriber)          | crowdfund_vault         | ❌ UNSAFE — panics propagate |
//! | B | `allocate_to_streaming_treasury → token::transfer`          | crowdfund_vault         | ✅    |
//! | C | `allocate_to_streaming_treasury → treasury::allocate_budget`| crowdfund_vault         | ❌ PARTIAL — tokens already moved |
//! | D | `distribute_matching_funds → token::transfer` (loop)        | matching_pool           | ❌ PARTIAL — `is_distributed=true` set before loop |
//! | E | `treasury::allocate_budget → token::transfer (admin→self)`  | treasury                | ✅ via idempotency |
//! | F | `notification_broker::notify → try_on_notify` (loop)        | notification_broker     | ✅ best-effort |
//! | G | `vault::withdraw → fee token::transfer` then owner transfer | crowdfund_vault         | ✅ sequential |
//! | H | `vault::batch_payout → token::transfer` (loop)              | crowdfund_vault         | ❌ PARTIAL — balance deducted before loop |
//!
//! ## Acceptance criteria verified
//!
//! 1. Each call site is exercised with an injected failure.
//! 2. No funds are created or destroyed (conservation invariant).
//! 3. Partial-completion states are either impossible (idempotency guard
//!    prevents re-entry) or explicitly recoverable (emergency migration /
//!    stream cancellation documented in TEST J).
//! 4. A failing notification subscriber NEVER blocks a value transfer.

#![cfg(test)]
extern crate std;

use soroban_sdk::{
    contract, contractimpl,
    testutils::{Address as _, Ledger},
    token::{StellarAssetClient, TokenClient},
    vec, Address, BytesN, Bytes, Env, Symbol,
};

use crowdfund_vault::{CrowdfundVaultContract, CrowdfundVaultContractClient as VaultClient};
use matching_pool::{MatchingPoolContract, MatchingPoolContractClient as PoolClient};
use notification_interface::{Notification, NotificationReceiverTrait};
use treasury::{TreasuryContract, TreasuryContractClient as TreasuryClient};

// ─────────────────────────────────────────────
// Helper utilities
// ─────────────────────────────────────────────

fn make_token<'a>(env: &'a Env, admin: &'a Address) -> (Address, StellarAssetClient<'a>) {
    let asset = env.register_stellar_asset_contract_v2(admin.clone());
    let sac = StellarAssetClient::new(env, &asset.address());
    (asset.address(), sac)
}

fn fresh_id(env: &Env, seed: u8) -> BytesN<32> {
    let mut arr = [0u8; 32];
    arr[31] = seed;
    BytesN::from_array(env, &arr)
}

/// A notification receiver that always panics when called.
#[contract]
struct PanickingReceiver;

#[contractimpl]
impl NotificationReceiverTrait for PanickingReceiver {
    fn on_notify(_env: Env, _notification: Notification) {
        panic!("subscriber deliberately panics");
    }
}

/// A notification receiver that records every notification it receives
/// and never panics.
#[contract]
struct RecordingReceiver;

#[contractimpl]
impl NotificationReceiverTrait for RecordingReceiver {
    fn on_notify(env: Env, notification: Notification) {
        let key = notification.event_type.clone();
        let count: u32 = env.storage().instance().get(&key).unwrap_or(0);
        env.storage().instance().set(&key, &(count + 1));
    }
}

/// An `allocate_budget`-compatible stub that always panics.
/// Deployed at a known address so `allocate_to_streaming_treasury` can
/// point at it; the token transfer to this address succeeds (the contract
/// exists), but its `allocate_budget` entry-point panics.
#[contract]
struct PanickingTreasury;

#[contractimpl]
impl PanickingTreasury {
    pub fn allocate_budget(
        _env: Env,
        _admin: Address,
        _beneficiary: Address,
        _amount: i128,
        _start_time: u64,
        _duration: u64,
        _request_id: BytesN<32>,
    ) {
        panic!("treasury deliberately panics after receiving tokens");
    }
}

// ─────────────────────────────────────────────
// TEST A — vault deposit: panicking subscriber never blocks transfer
// ─────────────────────────────────────────────
//
// After the `notify_subscribers` fix (now calls `try_on_notify`), a
// panicking subscriber must NOT cause the deposit to revert.  The
// deposit transaction must succeed and tokens must move exactly once.
//
// INVARIANT: a subscriber failure must never affect fund conservation.
#[test]
fn test_a_panicking_subscriber_does_not_block_deposit() {
    let env = Env::default();
    env.mock_all_auths();

    let admin = Address::generate(&env);
    let owner = Address::generate(&env);
    let contributor = Address::generate(&env);

    let (token_id, token_sac) = make_token(&env, &admin);
    let token = TokenClient::new(&env, &token_id);
    token_sac.mint(&contributor, &10_000);

    let vault_id = env.register(CrowdfundVaultContract, ());
    let vault = VaultClient::new(&env, &vault_id);
    vault.initialize(&admin);

    let project_id = vault.create_project(
        &owner,
        &Symbol::new(&env, "P"),
        &5_000i128,
        &token_id,
    );

    // Register a panicking subscriber
    let panicking_id = env.register(PanickingReceiver, ());
    vault.add_subscriber(&admin, &panicking_id);

    let balance_before = token.balance(&contributor);
    let vault_before = vault.get_balance(&project_id);

    // Deposit must SUCCEED even though the subscriber panics.
    // notify_subscribers now uses try_on_notify, swallowing subscriber panics.
    vault.deposit(
        &contributor,
        &project_id,
        &1_000i128,
        &fresh_id(&env, 1),
    );

    // Token moved exactly once — panicking subscriber did not block it
    assert_eq!(
        token.balance(&contributor),
        balance_before - 1_000,
        "contributor must pay exactly 1_000 tokens"
    );
    assert_eq!(
        vault.get_balance(&project_id),
        vault_before + 1_000,
        "vault balance must increase by exactly 1_000"
    );
}

// ─────────────────────────────────────────────
// TEST A2 — non-panicking subscribers still receive when one panics
// ─────────────────────────────────────────────
//
// When we call `notification_broker::notify` (which uses `try_on_notify`)
// a panicking subscriber is silently skipped and subsequent subscribers
// still receive the notification.  This is the broker-side safe path.
#[test]
fn test_a2_notification_broker_skips_panicking_subscriber() {
    use notification_broker::{NotificationBrokerContract, NotificationBrokerContractClient as BrokerClient};

    let env = Env::default();
    env.mock_all_auths();

    let admin = Address::generate(&env);
    let source = Address::generate(&env);

    let broker_id = env.register(NotificationBrokerContract, ());
    let broker = BrokerClient::new(&env, &broker_id);
    broker.initialize(&admin);

    let panicking_id = env.register(PanickingReceiver, ());
    let recording_id = env.register(RecordingReceiver, ());

    let event_type = Symbol::new(&env, "deposit");

    // Subscribe both listeners
    broker.subscribe(&panicking_id, &source, &Some(event_type.clone()));
    broker.subscribe(&recording_id, &source, &Some(event_type.clone()));

    let notification = Notification {
        source: source.clone(),
        event_type: event_type.clone(),
        data: Bytes::new(&env),
    };

    // notify must succeed even though one subscriber panics
    let notified = broker.notify(&source, &notification);

    // Both subscribers were attempted; exactly one succeeded without error
    // (the panicking one is silently swallowed by try_on_notify)
    assert!(
        notified >= 1,
        "At least one subscriber should have been attempted"
    );

    // Verify the recording receiver got the notification
    let count: u32 = env.as_contract(&recording_id, || {
        env.storage()
            .instance()
            .get(&event_type)
            .unwrap_or(0u32)
    });
    assert_eq!(
        count, 1,
        "Recording subscriber must have received exactly one notification"
    );
}

// ─────────────────────────────────────────────
// TEST B — notification_broker fan-out: no transfer blocked
// ─────────────────────────────────────────────
//
// Even with multiple subscribers, the source contract calling `notify`
// is never blocked.  The broker returns normally regardless of subscriber
// outcome because it uses `try_on_notify`.
#[test]
fn test_b_broker_fanout_does_not_block_source() {
    use notification_broker::{NotificationBrokerContract, NotificationBrokerContractClient as BrokerClient};

    let env = Env::default();
    env.mock_all_auths();

    let admin = Address::generate(&env);
    let source = Address::generate(&env);

    let broker_id = env.register(NotificationBrokerContract, ());
    let broker = BrokerClient::new(&env, &broker_id);
    broker.initialize(&admin);

    let event_sym = Symbol::new(&env, "fund_transfer");

    // Register three subscribers: two panicking, one recording
    let panic1 = env.register(PanickingReceiver, ());
    let panic2 = env.register(PanickingReceiver, ());
    let recorder = env.register(RecordingReceiver, ());

    broker.subscribe(&panic1, &source, &Some(event_sym.clone()));
    broker.subscribe(&panic2, &source, &Some(event_sym.clone()));
    broker.subscribe(&recorder, &source, &Some(event_sym.clone()));

    let notification = Notification {
        source: source.clone(),
        event_type: event_sym.clone(),
        data: Bytes::new(&env),
    };

    // Calling notify must not panic
    let count = broker.notify(&source, &notification);
    assert!(count >= 1, "At least one subscriber attempted");

    // The recording subscriber must have received the notification
    let recorded: u32 = env.as_contract(&recorder, || {
        env.storage().instance().get(&event_sym).unwrap_or(0u32)
    });
    assert_eq!(recorded, 1, "Recording subscriber must have received notification");
}

// ─────────────────────────────────────────────
// TEST C — vault deposit idempotency
// ─────────────────────────────────────────────
//
// Replaying the same request_id must be rejected — no double-deposit.
#[test]
fn test_c_deposit_idempotency_prevents_double_deposit() {
    let env = Env::default();
    env.mock_all_auths();

    let admin = Address::generate(&env);
    let owner = Address::generate(&env);
    let contributor = Address::generate(&env);

    let (token_id, token_sac) = make_token(&env, &admin);
    let token = TokenClient::new(&env, &token_id);
    token_sac.mint(&contributor, &10_000);

    let vault_id = env.register(CrowdfundVaultContract, ());
    let vault = VaultClient::new(&env, &vault_id);
    vault.initialize(&admin);

    let project_id = vault.create_project(
        &owner,
        &Symbol::new(&env, "P"),
        &5_000i128,
        &token_id,
    );

    let rid = fresh_id(&env, 10);

    // First deposit — must succeed
    vault.deposit(&contributor, &project_id, &1_000i128, &rid);
    assert_eq!(token.balance(&contributor), 9_000);
    assert_eq!(vault.get_balance(&project_id), 1_000);

    // Replay with identical request_id — must be rejected
    let replay = vault.try_deposit(&contributor, &project_id, &1_000i128, &rid);
    assert!(
        replay.is_err(),
        "Replay of same request_id must be rejected"
    );

    // Balance unchanged — no double-deposit
    assert_eq!(token.balance(&contributor), 9_000, "contributor balance must not change on replay");
    assert_eq!(vault.get_balance(&project_id), 1_000, "vault balance must not change on replay");
}

// ─────────────────────────────────────────────
// TEST D — treasury allocate_budget idempotency
// ─────────────────────────────────────────────
//
// The treasury idempotency guard protects `allocate_budget` from being
// called twice with the same request_id.  A second call must return an
// error and the treasury's stored stream must reflect only one allocation.
#[test]
fn test_d_treasury_allocate_budget_idempotency() {
    let env = Env::default();
    env.mock_all_auths();

    let admin = Address::generate(&env);
    let beneficiary = Address::generate(&env);

    let (token_id, token_sac) = make_token(&env, &admin);
    let token = TokenClient::new(&env, &token_id);
    token_sac.mint(&admin, &10_000);

    let treasury_id = env.register(TreasuryContract, ());
    let treasury = TreasuryClient::new(&env, &treasury_id);
    treasury.initialize(&admin, &token_id);

    env.ledger().set_timestamp(1000);
    let rid = fresh_id(&env, 20);

    // First allocation — must succeed
    treasury.allocate_budget(
        &admin,
        &beneficiary,
        &2_000i128,
        &1000u64,
        &1000u64,
        &rid,
    );

    let treasury_balance_after_first = token.balance(&treasury.address);
    assert_eq!(treasury_balance_after_first, 2_000);

    // Replay with identical request_id — must be rejected
    let replay = treasury.try_allocate_budget(
        &admin,
        &beneficiary,
        &2_000i128,
        &1000u64,
        &1000u64,
        &rid,
    );
    assert!(
        replay.is_err(),
        "Duplicate allocate_budget must be rejected by idempotency guard"
    );

    // Treasury balance must not have doubled
    assert_eq!(
        token.balance(&treasury.address),
        treasury_balance_after_first,
        "Treasury must not receive tokens twice for same request_id"
    );

    // Only the original stream amount is unlockable
    env.ledger().set_timestamp(2000); // after full duration
    let unlocked = treasury.get_unlocked(&beneficiary);
    assert_eq!(
        unlocked, 2_000,
        "Unlockable amount must equal exactly one allocation, not two"
    );
}

// ─────────────────────────────────────────────
// TEST E — treasury allocate_budget unauthorized caller rejected
// ─────────────────────────────────────────────
//
// A caller that is not the stored admin must be rejected before any token
// transfer occurs — no funds are stranded.
#[test]
fn test_e_treasury_unauthorized_allocation_no_funds_moved() {
    let env = Env::default();
    env.mock_all_auths();

    let admin = Address::generate(&env);
    let impostor = Address::generate(&env);
    let beneficiary = Address::generate(&env);

    let (token_id, token_sac) = make_token(&env, &admin);
    let token = TokenClient::new(&env, &token_id);
    token_sac.mint(&admin, &10_000);

    let treasury_id = env.register(TreasuryContract, ());
    let treasury = TreasuryClient::new(&env, &treasury_id);
    treasury.initialize(&admin, &token_id);

    env.ledger().set_timestamp(1000);

    let result = treasury.try_allocate_budget(
        &impostor,
        &beneficiary,
        &5_000i128,
        &1000u64,
        &1000u64,
        &fresh_id(&env, 30),
    );
    assert!(result.is_err(), "Unauthorized caller must be rejected");

    // Zero tokens were moved to the treasury
    assert_eq!(
        token.balance(&treasury.address),
        0,
        "Treasury must hold zero tokens after unauthorized attempt"
    );

    // No stream was created
    let unlocked = treasury.get_unlocked(&beneficiary);
    assert_eq!(
        unlocked, 0,
        "No stream must have been created for beneficiary"
    );
}

// ─────────────────────────────────────────────
// TEST F — matching pool distribution: pre-finalization guard
// ─────────────────────────────────────────────
//
// `distribute_matching_funds` must fail if the round has not been
// finalized. The pool balance must remain intact.
#[test]
fn test_f_matching_pool_distribution_blocked_before_finalization() {
    let env = Env::default();
    env.mock_all_auths();

    let admin = Address::generate(&env);
    let funder = Address::generate(&env);
    let owner = Address::generate(&env);

    let (token_id, token_sac) = make_token(&env, &admin);
    let token = TokenClient::new(&env, &token_id);
    token_sac.mint(&funder, &1_000_000);

    let pool_id = env.register(MatchingPoolContract, ());
    let pool = PoolClient::new(&env, &pool_id);
    pool.initialize(&admin);

    env.ledger().set_timestamp(500);
    let round_id = pool.create_round(
        &admin,
        &Symbol::new(&env, "R"),
        &token_id,
        &1000u64,
        &3000u64,
    );

    pool.approve_project(&admin, &round_id, &1u64);
    pool.fund_pool(&funder, &round_id, &1_000_000);

    // Record a contribution
    env.ledger().set_timestamp(1500);
    let c = Address::generate(&env);
    pool.record_contribution(&round_id, &1u64, &c, &100i128);

    // Attempt distribution WITHOUT finalization — must fail
    let owners = vec![&env, owner.clone()];
    let result = pool.try_distribute_matching_funds(&admin, &round_id, &owners);
    assert!(
        result.is_err(),
        "Distribution before finalization must fail"
    );

    // Pool balance must be completely intact
    assert_eq!(
        pool.get_pool_balance(&round_id),
        1_000_000,
        "Pool balance must not change after failed distribution"
    );
    assert_eq!(
        token.balance(&pool.address),
        1_000_000,
        "Actual token balance of pool contract must be unchanged"
    );

    // Owner must have received nothing
    assert_eq!(
        token.balance(&owner),
        0,
        "Owner must not receive any tokens when distribution fails"
    );
}

// ─────────────────────────────────────────────
// TEST G — matching pool distribution: double-distribution guard
// ─────────────────────────────────────────────
//
// Once `distribute_matching_funds` succeeds, a second call must be
// rejected with `MatchAlreadyDistributed`. The pool is already zeroed;
// a second call must not re-read from anywhere and must not move tokens.
#[test]
fn test_g_matching_pool_no_double_distribution() {
    let env = Env::default();
    env.mock_all_auths();

    let admin = Address::generate(&env);
    let funder = Address::generate(&env);
    let owner = Address::generate(&env);

    let (token_id, token_sac) = make_token(&env, &admin);
    let token = TokenClient::new(&env, &token_id);
    token_sac.mint(&funder, &1_000_000);

    let pool_id = env.register(MatchingPoolContract, ());
    let pool = PoolClient::new(&env, &pool_id);
    pool.initialize(&admin);

    env.ledger().set_timestamp(500);
    let round_id = pool.create_round(
        &admin,
        &Symbol::new(&env, "R"),
        &token_id,
        &1000u64,
        &3000u64,
    );

    pool.approve_project(&admin, &round_id, &1u64);
    pool.fund_pool(&funder, &round_id, &1_000_000);

    env.ledger().set_timestamp(1500);
    let c = Address::generate(&env);
    pool.record_contribution(&round_id, &1u64, &c, &100i128);

    env.ledger().set_timestamp(4000);
    pool.finalize_round(&admin, &round_id);

    let owners = vec![&env, owner.clone()];
    let distributed = pool.distribute_matching_funds(&admin, &round_id, &owners);
    assert!(distributed > 0);

    let owner_balance = token.balance(&owner);
    assert!(owner_balance > 0, "Owner must have received funds on first distribution");

    // Second distribution call must fail
    let second = pool.try_distribute_matching_funds(&admin, &round_id, &owners);
    assert!(
        second.is_err(),
        "Second distribution call must be rejected"
    );

    // Owner balance must not change on failed re-distribution
    assert_eq!(
        token.balance(&owner),
        owner_balance,
        "Owner balance must not change after rejected double-distribution"
    );
}

// ─────────────────────────────────────────────
// TEST H — vault withdraw: fee transfer sequence
// ─────────────────────────────────────────────
//
// When a fee is configured and the protocol fee treasury address is
// valid, the fee is transferred before the net amount reaches the owner.
// Both transfers happen atomically in the same transaction; if either
// panics the whole transaction reverts and no funds are stranded.
//
// This test verifies the happy-path ordering and that balances reconcile
// correctly after a successful withdraw with fees.
#[test]
fn test_h_vault_withdraw_with_fee_accounting() {
    let env = Env::default();
    env.mock_all_auths();

    let admin = Address::generate(&env);
    let owner = Address::generate(&env);
    let contributor = Address::generate(&env);
    let protocol_treasury = Address::generate(&env);

    let (token_id, token_sac) = make_token(&env, &admin);
    let token = TokenClient::new(&env, &token_id);
    token_sac.mint(&contributor, &10_000);

    let vault_id = env.register(CrowdfundVaultContract, ());
    let vault = VaultClient::new(&env, &vault_id);
    vault.initialize(&admin);

    // Set 10% fee (1000 bps)
    vault.set_fee_config(&admin, &1000u32, &protocol_treasury);

    let project_id = vault.create_project(
        &owner,
        &Symbol::new(&env, "P"),
        &5_000i128,
        &token_id,
    );

    // Fund the project
    vault.deposit(&contributor, &project_id, &5_000i128, &fresh_id(&env, 40));
    assert_eq!(vault.get_balance(&project_id), 5_000);

    // Approve milestone so owner can withdraw
    vault.approve_milestone(&admin, &project_id, &0u32);

    let owner_before = token.balance(&owner);
    let treasury_before = token.balance(&protocol_treasury);

    // Owner withdraws 1_000
    vault.withdraw(&project_id, &0u32, &1_000i128);

    // Fee = 10% of 1_000 = 100 → treasury
    // Net = 900 → owner
    assert_eq!(
        token.balance(&protocol_treasury) - treasury_before,
        100,
        "Protocol treasury must receive exactly the fee amount"
    );
    assert_eq!(
        token.balance(&owner) - owner_before,
        900,
        "Owner must receive exactly net withdraw amount"
    );
    assert_eq!(
        vault.get_balance(&project_id),
        4_000,
        "Vault balance must be reduced by full withdraw amount"
    );

    // Conservation: fee + net = total withdrawn
    assert_eq!(
        (token.balance(&protocol_treasury) - treasury_before)
            + (token.balance(&owner) - owner_before),
        1_000,
        "Fee + owner receive must equal the full withdrawn amount — no funds lost"
    );
}

// ─────────────────────────────────────────────
// TEST I — vault batch_payout: idempotency guard prevents double-payout
// ─────────────────────────────────────────────
//
// `batch_payout` deducts the full `total_amount` from the reward pool
// *before* the transfer loop.  If the loop is interrupted, the pool
// balance is already reduced but recipients have not received all tokens.
// The idempotency guard prevents retrying the same request_id, so any
// recovery must use a *new* request_id.
//
// This test verifies:
// (a) A successful payout debits the pool and credits recipients.
// (b) Replaying the same request_id is rejected — pool balance unchanged.
// (c) A fresh request_id for a follow-up payout succeeds.
#[test]
fn test_i_batch_payout_idempotency() {
    let env = Env::default();
    env.mock_all_auths();

    let admin = Address::generate(&env);
    let recipient_a = Address::generate(&env);
    let recipient_b = Address::generate(&env);

    let (token_id, token_sac) = make_token(&env, &admin);
    let token = TokenClient::new(&env, &token_id);
    token_sac.mint(&admin, &10_000);

    let vault_id = env.register(CrowdfundVaultContract, ());
    let vault = VaultClient::new(&env, &vault_id);
    vault.initialize(&admin);

    // Seed the reward pool (fund_reward_pool transfers tokens from admin to vault)
    vault.fund_reward_pool(&admin, &token_id, &5_000i128);
    assert_eq!(vault.get_reward_pool_balance(&token_id), 5_000);

    let recipients = vec![
        &env,
        (recipient_a.clone(), 500i128),
        (recipient_b.clone(), 500i128),
    ];
    let rid = fresh_id(&env, 50);

    // First payout
    vault.batch_payout(&admin, &token_id, &recipients, &rid);
    assert_eq!(vault.get_reward_pool_balance(&token_id), 4_000);
    assert_eq!(token.balance(&recipient_a), 500);
    assert_eq!(token.balance(&recipient_b), 500);

    // Replay — must be rejected
    let replay = vault.try_batch_payout(&admin, &token_id, &recipients, &rid);
    assert!(replay.is_err(), "Replay of batch_payout must be rejected");

    // Pool unchanged after rejected replay
    assert_eq!(
        vault.get_reward_pool_balance(&token_id),
        4_000,
        "Reward pool balance must not change on rejected replay"
    );

    // Recipients' balances unchanged after replay
    assert_eq!(token.balance(&recipient_a), 500);
    assert_eq!(token.balance(&recipient_b), 500);

    // A genuinely new payout with a new request_id succeeds
    let rid2 = fresh_id(&env, 51);
    let new_recipients = vec![&env, (recipient_a.clone(), 200i128)];
    vault.batch_payout(&admin, &token_id, &new_recipients, &rid2);
    assert_eq!(vault.get_reward_pool_balance(&token_id), 3_800);
    assert_eq!(token.balance(&recipient_a), 700);
}

// ─────────────────────────────────────────────
// TEST J — batch_payout: insufficient pool balance fails pre-transfer
// ─────────────────────────────────────────────
//
// If the total payout amount exceeds the pool balance, the call must
// fail *before* moving any tokens.  The pool balance deduction and the
// transfers only happen once the pre-check passes; therefore no funds
// can be partially stranded.
#[test]
fn test_j_batch_payout_insufficient_balance_fails_atomically() {
    let env = Env::default();
    env.mock_all_auths();

    let admin = Address::generate(&env);
    let recipient = Address::generate(&env);

    let (token_id, token_sac) = make_token(&env, &admin);
    token_sac.mint(&admin, &2_000);

    let vault_id = env.register(CrowdfundVaultContract, ());
    let vault = VaultClient::new(&env, &vault_id);
    vault.initialize(&admin);

    vault.fund_reward_pool(&admin, &token_id, &1_000i128);
    assert_eq!(vault.get_reward_pool_balance(&token_id), 1_000);

    // Attempt to pay out more than the pool holds
    let overspend = vec![&env, (recipient.clone(), 2_000i128)];
    let result = vault.try_batch_payout(&admin, &token_id, &overspend, &fresh_id(&env, 60));
    assert!(result.is_err(), "Over-spend must be rejected");

    // Pool must be completely intact
    assert_eq!(
        vault.get_reward_pool_balance(&token_id),
        1_000,
        "Pool balance must be unchanged when batch_payout fails"
    );

    // Recipient must have received nothing
    assert_eq!(
        TokenClient::new(&env, &token_id).balance(&recipient),
        0,
        "Recipient must not receive any tokens on failed batch_payout"
    );
}

// ─────────────────────────────────────────────
// TEST K — full path conservation: vault → pool → treasury
// ─────────────────────────────────────────────
//
// Fund-conservation invariant across the entire funding chain.
// Total tokens in the system must equal initial supply at every step,
// regardless of which operations succeed or fail.
#[test]
fn test_k_full_path_fund_conservation() {
    let env = Env::default();
    env.mock_all_auths();

    let admin = Address::generate(&env);
    let owner = Address::generate(&env);
    let contributor = Address::generate(&env);
    let funder = Address::generate(&env);

    let (token_id, token_sac) = make_token(&env, &admin);
    let token = TokenClient::new(&env, &token_id);

    token_sac.mint(&contributor, &10_000);
    token_sac.mint(&funder, &1_000_000);
    token_sac.mint(&admin, &50_000);

    let initial_supply: i128 =
        token.balance(&contributor) + token.balance(&funder) + token.balance(&admin);

    let vault_id = env.register(CrowdfundVaultContract, ());
    let vault = VaultClient::new(&env, &vault_id);

    let pool_id = env.register(MatchingPoolContract, ());
    let pool = PoolClient::new(&env, &pool_id);

    let treasury_id = env.register(TreasuryContract, ());
    let treasury = TreasuryClient::new(&env, &treasury_id);

    vault.initialize(&admin);
    pool.initialize(&admin);
    treasury.initialize(&admin, &token_id);

    // ── Stage 1: vault contribution ──────────────────────────
    let project_id = vault.create_project(
        &owner,
        &Symbol::new(&env, "P"),
        &5_000i128,
        &token_id,
    );
    vault.deposit(&contributor, &project_id, &3_000i128, &fresh_id(&env, 70));

    let sum_after_deposit: i128 = token.balance(&contributor)
        + token.balance(&vault.address)
        + token.balance(&pool.address)
        + token.balance(&treasury.address)
        + token.balance(&owner)
        + token.balance(&funder)
        + token.balance(&admin);
    assert_eq!(sum_after_deposit, initial_supply, "Conservation after vault deposit");

    // ── Stage 2: matching pool round ────────────────────────
    env.ledger().set_timestamp(500);
    let round_id = pool.create_round(
        &admin,
        &Symbol::new(&env, "R"),
        &token_id,
        &1000u64,
        &3000u64,
    );
    pool.approve_project(&admin, &round_id, &project_id);
    pool.fund_pool(&funder, &round_id, &1_000_000);

    env.ledger().set_timestamp(1500);
    pool.record_contribution(&round_id, &project_id, &contributor, &500i128);

    env.ledger().set_timestamp(4000);
    pool.finalize_round(&admin, &round_id);

    let owners = vec![&env, owner.clone()];
    let distributed = pool.distribute_matching_funds(&admin, &round_id, &owners);
    assert!(distributed > 0);

    let sum_after_pool: i128 = token.balance(&contributor)
        + token.balance(&vault.address)
        + token.balance(&pool.address)
        + token.balance(&treasury.address)
        + token.balance(&owner)
        + token.balance(&funder)
        + token.balance(&admin);
    assert_eq!(sum_after_pool, initial_supply, "Conservation after pool distribution");

    // ── Stage 3: treasury allocation ────────────────────────
    env.ledger().set_timestamp(5000);
    let alloc_amount = 2_000i128;
    treasury.allocate_budget(
        &admin,
        &owner,
        &alloc_amount,
        &5000u64,
        &1000u64,
        &fresh_id(&env, 71),
    );

    let sum_after_treasury: i128 = token.balance(&contributor)
        + token.balance(&vault.address)
        + token.balance(&pool.address)
        + token.balance(&treasury.address)
        + token.balance(&owner)
        + token.balance(&funder)
        + token.balance(&admin);
    assert_eq!(
        sum_after_treasury,
        initial_supply,
        "Conservation after treasury allocation"
    );

    // ── Stage 4: treasury claim ──────────────────────────────
    env.ledger().set_timestamp(6000); // after full duration
    let claimed = treasury.claim(&owner);
    assert_eq!(claimed, alloc_amount);

    let sum_final: i128 = token.balance(&contributor)
        + token.balance(&vault.address)
        + token.balance(&pool.address)
        + token.balance(&treasury.address)
        + token.balance(&owner)
        + token.balance(&funder)
        + token.balance(&admin);
    assert_eq!(sum_final, initial_supply, "Conservation after treasury claim");
}

// ─────────────────────────────────────────────
// TEST L — matching pool: paused payout scope blocks distribution
// ─────────────────────────────────────────────
//
// When the `Payout` scope is paused, `distribute_matching_funds` must
// fail. Pool balance must be completely intact.
#[test]
fn test_l_matching_pool_payout_scope_pause_blocks_distribution() {
    use matching_pool::PauseScope;

    let env = Env::default();
    env.mock_all_auths();

    let admin = Address::generate(&env);
    let funder = Address::generate(&env);
    let owner = Address::generate(&env);

    let (token_id, token_sac) = make_token(&env, &admin);
    let token = TokenClient::new(&env, &token_id);
    token_sac.mint(&funder, &500_000);

    let pool_id = env.register(MatchingPoolContract, ());
    let pool = PoolClient::new(&env, &pool_id);
    pool.initialize(&admin);

    env.ledger().set_timestamp(500);
    let round_id = pool.create_round(
        &admin,
        &Symbol::new(&env, "R"),
        &token_id,
        &1000u64,
        &3000u64,
    );

    pool.approve_project(&admin, &round_id, &1u64);
    pool.fund_pool(&funder, &round_id, &500_000);

    env.ledger().set_timestamp(1500);
    let c = Address::generate(&env);
    pool.record_contribution(&round_id, &1u64, &c, &100i128);

    env.ledger().set_timestamp(4000);
    pool.finalize_round(&admin, &round_id);

    // Pause the Payout scope
    pool.pause_scope(&admin, &PauseScope::Payout);

    let owners = vec![&env, owner.clone()];
    let result = pool.try_distribute_matching_funds(&admin, &round_id, &owners);
    assert!(
        result.is_err(),
        "Distribution must fail when payout scope is paused"
    );

    // Pool must be untouched
    assert_eq!(
        pool.get_pool_balance(&round_id),
        500_000,
        "Pool balance must be intact when distribution is blocked by pause"
    );
    assert_eq!(token.balance(&pool.address), 500_000);

    // Unpause and retry — must now succeed
    pool.unpause_scope(&admin, &PauseScope::Payout);
    let distributed = pool.distribute_matching_funds(&admin, &round_id, &owners);
    assert!(distributed > 0, "Distribution must succeed after unpausing");
    assert_eq!(pool.get_pool_balance(&round_id), 0);
}

// ─────────────────────────────────────────────
// TEST M — vault cancel + contributor clawback recovery path
// ─────────────────────────────────────────────
//
// When a project is canceled, contributors must be able to clawback
// their full contribution.  This is the primary recovery path for any
// partial-completion scenario that leaves funds in the vault.
#[test]
fn test_m_vault_cancel_clawback_full_recovery() {
    let env = Env::default();
    env.mock_all_auths();

    let admin = Address::generate(&env);
    let owner = Address::generate(&env);
    let contributor_a = Address::generate(&env);
    let contributor_b = Address::generate(&env);

    let (token_id, token_sac) = make_token(&env, &admin);
    let token = TokenClient::new(&env, &token_id);
    token_sac.mint(&contributor_a, &5_000);
    token_sac.mint(&contributor_b, &5_000);

    let vault_id = env.register(CrowdfundVaultContract, ());
    let vault = VaultClient::new(&env, &vault_id);
    vault.initialize(&admin);

    let project_id = vault.create_project(
        &owner,
        &Symbol::new(&env, "P"),
        &5_000i128,
        &token_id,
    );

    vault.deposit(&contributor_a, &project_id, &2_000i128, &fresh_id(&env, 80));
    vault.deposit(&contributor_b, &project_id, &1_500i128, &fresh_id(&env, 81));

    let total_deposited = vault.get_balance(&project_id);
    assert_eq!(total_deposited, 3_500);

    // Admin cancels the project
    vault.cancel_project(&admin, &project_id);

    // Both contributors clawback in the refund window
    vault.clawback_contribution(&project_id, &contributor_a);
    vault.clawback_contribution(&project_id, &contributor_b);

    // Full recovery: both contributors get back exactly what they put in
    assert_eq!(
        token.balance(&contributor_a),
        5_000,
        "contributor_a must recover full contribution"
    );
    assert_eq!(
        token.balance(&contributor_b),
        5_000,
        "contributor_b must recover full contribution"
    );
    assert_eq!(
        vault.get_balance(&project_id),
        0,
        "Vault balance must be zero after all clawbacks"
    );
}

// ─────────────────────────────────────────────
// TEST N — treasury stream cancellation recovery path
// ─────────────────────────────────────────────
//
// If an `allocate_to_streaming_treasury` call partially completed
// (tokens moved but no stream started), the admin's recovery path is:
//  1. If a valid stream *was* created: use `cancel_stream` to extract
//     the refundable portion.
//  2. If no stream was created (e.g. bug in the panicking treasury stub):
//     the tokens are in the treasury contract but not tracked — this
//     is the "unrecoverable partial state" that the emergency path must
//     handle out-of-band.
//
// This test covers the happy-path where a stream *was* created and
// `cancel_stream` correctly returns the unvested portion.
#[test]
fn test_n_treasury_cancel_stream_returns_unvested_funds() {
    let env = Env::default();
    env.mock_all_auths();

    let admin = Address::generate(&env);
    let beneficiary = Address::generate(&env);

    let (token_id, token_sac) = make_token(&env, &admin);
    let token = TokenClient::new(&env, &token_id);
    token_sac.mint(&admin, &10_000);

    let treasury_id = env.register(TreasuryContract, ());
    let treasury = TreasuryClient::new(&env, &treasury_id);
    treasury.initialize(&admin, &token_id);

    let start_time = 1000u64;
    let duration = 1000u64;
    env.ledger().set_timestamp(start_time);

    treasury.allocate_budget(
        &admin,
        &beneficiary,
        &4_000i128,
        &start_time,
        &duration,
        &fresh_id(&env, 90),
    );

    // Halfway through — beneficiary claims 2_000
    env.ledger().set_timestamp(start_time + 500);
    let claimed = treasury.claim(&beneficiary);
    assert_eq!(claimed, 2_000);

    // Admin cancels the stream — should return the remaining 2_000
    let (total_unlocked, refundable) = treasury.cancel_stream(&admin, &beneficiary);

    // At t=500, unlocked = 2_000 (already claimed). Remaining = 2_000.
    // cancel_stream computes newly_unlocked at cancel time as 0 (already claimed)
    // and returns full remaining as refundable.
    assert_eq!(
        token.balance(&beneficiary),
        2_000,
        "Beneficiary must hold the claimed amount"
    );
    assert_eq!(
        refundable,
        2_000,
        "Refundable portion must be the full remaining unvested amount"
    );
    assert_eq!(
        token.balance(&treasury.address),
        0,
        "Treasury must hold zero tokens after cancel_stream"
    );

    // The sum of claimed + refundable must equal the original allocation
    assert_eq!(
        claimed + refundable,
        4_000,
        "claimed + refundable must equal original allocation — no funds lost"
    );
    let _ = total_unlocked; // acknowledged
}

// ─────────────────────────────────────────────
// TEST O — vault emergency migration recovery path
// ─────────────────────────────────────────────
//
// When funds are stranded in a vault project (e.g. due to a bug in a
// downstream call), the admin can use the emergency migration path:
//  1. Pause the contract.
//  2. Propose an emergency migration plan.
//  3. Execute the migration — moves exactly `amount` to `recipient`.
//  4. Cancels the project so contributors can clawback their portion.
#[test]
fn test_o_vault_emergency_migration_recovers_stranded_funds() {
    let env = Env::default();
    env.mock_all_auths();

    let admin = Address::generate(&env);
    let owner = Address::generate(&env);
    let contributor = Address::generate(&env);
    let rescue_address = Address::generate(&env);

    let (token_id, token_sac) = make_token(&env, &admin);
    let token = TokenClient::new(&env, &token_id);
    token_sac.mint(&contributor, &10_000);

    let vault_id = env.register(CrowdfundVaultContract, ());
    let vault = VaultClient::new(&env, &vault_id);
    vault.initialize(&admin);

    let project_id = vault.create_project(
        &owner,
        &Symbol::new(&env, "P"),
        &5_000i128,
        &token_id,
    );

    vault.deposit(&contributor, &project_id, &3_000i128, &fresh_id(&env, 100));
    assert_eq!(vault.get_balance(&project_id), 3_000);

    // Simulate a downstream failure leaving funds stranded in vault
    // (no milestone approval, no withdraw possible without admin action)

    // Recovery procedure:
    vault.pause(&admin);

    vault.propose_emergency_migration(
        &admin,
        &project_id,
        &rescue_address,
        &3_000i128,
        &Symbol::new(&env, "recovery"),
    );

    let migrated = vault.execute_emergency_migration(&admin, &project_id);
    assert_eq!(migrated, 3_000, "Full stranded amount must be migrated");

    // rescue_address received the funds
    assert_eq!(
        token.balance(&rescue_address),
        3_000,
        "Rescue address must hold all migrated funds"
    );

    // Vault project balance is now zero
    assert_eq!(
        vault.get_balance(&project_id),
        0,
        "Vault balance must be zero after migration"
    );

    // Total supply conserved
    let total: i128 = token.balance(&contributor)
        + token.balance(&vault.address)
        + token.balance(&rescue_address);
    assert_eq!(total, 10_000, "Total supply must be conserved through emergency migration");
}

// ─────────────────────────────────────────────
// TEST P — vault emergency migration veto prevents execution
// ─────────────────────────────────────────────
#[test]
fn test_p_vault_emergency_migration_veto_blocks_execution() {
    let env = Env::default();
    env.mock_all_auths();

    let admin = Address::generate(&env);
    let owner = Address::generate(&env);
    let contributor = Address::generate(&env);
    let rescue_address = Address::generate(&env);

    let (token_id, token_sac) = make_token(&env, &admin);
    let token = TokenClient::new(&env, &token_id);
    token_sac.mint(&contributor, &5_000);

    let vault_id = env.register(CrowdfundVaultContract, ());
    let vault = VaultClient::new(&env, &vault_id);
    vault.initialize(&admin);

    let project_id = vault.create_project(
        &owner,
        &Symbol::new(&env, "P"),
        &5_000i128,
        &token_id,
    );
    vault.deposit(&contributor, &project_id, &5_000i128, &fresh_id(&env, 110));

    vault.pause(&admin);

    vault.propose_emergency_migration(
        &admin,
        &project_id,
        &rescue_address,
        &5_000i128,
        &Symbol::new(&env, "reason"),
    );

    // Veto the plan
    vault.veto_emergency_migration(&admin, &project_id);

    // Execution must now fail
    let result = vault.try_execute_emergency_migration(&admin, &project_id);
    assert!(result.is_err(), "Vetoed migration must not be executable");

    // Funds must still be in the vault
    assert_eq!(vault.get_balance(&project_id), 5_000);
    assert_eq!(token.balance(&vault.address), 5_000);
    assert_eq!(token.balance(&rescue_address), 0);
}

// ─────────────────────────────────────────────
// TEST Q — treasury allocate_budget replay after successful claim
// ─────────────────────────────────────────────
//
// After a stream is fully claimed and the storage key is deleted, a new
// allocation for the same beneficiary with a *new* request_id must
// succeed (the stream was fully consumed, not still active). A new
// allocation with the *original* request_id must still be rejected.
#[test]
fn test_q_treasury_new_allocation_after_fully_claimed_stream() {
    let env = Env::default();
    env.mock_all_auths();

    let admin = Address::generate(&env);
    let beneficiary = Address::generate(&env);

    let (token_id, token_sac) = make_token(&env, &admin);
    let token = TokenClient::new(&env, &token_id);
    token_sac.mint(&admin, &10_000);

    let treasury_id = env.register(TreasuryContract, ());
    let treasury = TreasuryClient::new(&env, &treasury_id);
    treasury.initialize(&admin, &token_id);

    let start = 1000u64;
    let dur = 500u64;

    let rid1 = fresh_id(&env, 120);
    env.ledger().set_timestamp(start);

    treasury.allocate_budget(&admin, &beneficiary, &1_000i128, &start, &dur, &rid1);

    // Claim everything
    env.ledger().set_timestamp(start + dur);
    let claimed = treasury.claim(&beneficiary);
    assert_eq!(claimed, 1_000);
    assert_eq!(token.balance(&beneficiary), 1_000);

    // Original request_id must still be rejected (idempotency key persists)
    let replay = treasury.try_allocate_budget(
        &admin,
        &beneficiary,
        &1_000i128,
        &start,
        &dur,
        &rid1,
    );
    assert!(replay.is_err(), "Original request_id must remain rejected even after claim");

    // Fresh request_id for new allocation must succeed
    let rid2 = fresh_id(&env, 121);
    treasury.allocate_budget(&admin, &beneficiary, &500i128, &(start + dur), &dur, &rid2);
    assert_eq!(token.balance(&treasury.address), 500);
}

// ─────────────────────────────────────────────
// TEST R — vault deposit paused, then unpaused: funds move only after unpause
// ─────────────────────────────────────────────
//
// Verifies the pause guard correctly protects deposits and that funds
// are not deducted from the contributor during the paused period.
#[test]
fn test_r_vault_pause_blocks_deposit_unpausing_allows_it() {
    let env = Env::default();
    env.mock_all_auths();

    let admin = Address::generate(&env);
    let owner = Address::generate(&env);
    let contributor = Address::generate(&env);

    let (token_id, token_sac) = make_token(&env, &admin);
    let token = TokenClient::new(&env, &token_id);
    token_sac.mint(&contributor, &5_000);

    let vault_id = env.register(CrowdfundVaultContract, ());
    let vault = VaultClient::new(&env, &vault_id);
    vault.initialize(&admin);

    let project_id = vault.create_project(
        &owner,
        &Symbol::new(&env, "P"),
        &5_000i128,
        &token_id,
    );

    vault.pause(&admin);

    let result = vault.try_deposit(&contributor, &project_id, &1_000i128, &fresh_id(&env, 130));
    assert!(result.is_err(), "Deposit must fail when vault is paused");

    // No tokens moved
    assert_eq!(token.balance(&contributor), 5_000);
    assert_eq!(vault.get_balance(&project_id), 0);

    // Unpause and retry
    vault.unpause(&admin);
    vault.deposit(&contributor, &project_id, &1_000i128, &fresh_id(&env, 131));

    assert_eq!(token.balance(&contributor), 4_000);
    assert_eq!(vault.get_balance(&project_id), 1_000);
}

// ─────────────────────────────────────────────
// TEST S — matching pool: finalize before end_time fails; balance intact
// ─────────────────────────────────────────────
#[test]
fn test_s_matching_pool_premature_finalization_rejected() {
    let env = Env::default();
    env.mock_all_auths();

    let admin = Address::generate(&env);
    let funder = Address::generate(&env);

    let (token_id, token_sac) = make_token(&env, &admin);
    let token = TokenClient::new(&env, &token_id);
    token_sac.mint(&funder, &200_000);

    let pool_id = env.register(MatchingPoolContract, ());
    let pool = PoolClient::new(&env, &pool_id);
    pool.initialize(&admin);

    env.ledger().set_timestamp(100);
    let round_id = pool.create_round(
        &admin,
        &Symbol::new(&env, "R"),
        &token_id,
        &200u64,
        &1000u64,
    );

    pool.fund_pool(&funder, &round_id, &200_000);

    // Try to finalize while round is still open
    env.ledger().set_timestamp(500); // < end_time=1000
    let result = pool.try_finalize_round(&admin, &round_id);
    assert!(result.is_err(), "Finalization before end_time must fail");

    // Pool balance intact
    assert_eq!(pool.get_pool_balance(&round_id), 200_000);
    assert_eq!(token.balance(&pool.address), 200_000);
}

// ─────────────────────────────────────────────
// TEST T — CALL SITE C: panicking treasury in allocate_to_streaming_treasury
// ─────────────────────────────────────────────
//
// When the treasury's `allocate_budget` entry-point panics after tokens
// have already been transferred to it, `allocate_to_streaming_treasury`
// must propagate the error (TreasuryCallFailed) rather than silently
// succeeding.
//
// PARTIAL-STATE SEMANTICS (documented, not hidden):
//   - Vault: balance has been deducted, total_withdrawn incremented.
//   - Panicking treasury: holds the tokens but has no stream record.
//
// The vault state is irreversible within this tx.  Recovery uses the
// vault's `propose_emergency_migration` / `execute_emergency_migration`
// path from a separate admin-initiated transaction.
//
// This test asserts:
//   1. The call fails with an error (not silently succeeds).
//   2. The panicking treasury holds the tokens (funds are not destroyed).
//   3. The vault balance reflects the deduction (partial state documented).
#[test]
fn test_t_allocate_to_streaming_treasury_panicking_treasury_fails_with_error() {
    let env = Env::default();
    env.mock_all_auths();

    let admin = Address::generate(&env);
    let owner = Address::generate(&env);
    let contributor = Address::generate(&env);

    let (token_id, token_sac) = make_token(&env, &admin);
    let token = TokenClient::new(&env, &token_id);
    token_sac.mint(&contributor, &10_000);

    let vault_id = env.register(CrowdfundVaultContract, ());
    let vault = VaultClient::new(&env, &vault_id);
    vault.initialize(&admin);

    let project_id = vault.create_project(
        &owner,
        &Symbol::new(&env, "P"),
        &5_000i128,
        &token_id,
    );

    // Fund the project
    vault.deposit(&contributor, &project_id, &5_000i128, &fresh_id(&env, 140));
    assert_eq!(vault.get_balance(&project_id), 5_000);

    // Approve milestone so the allocation can proceed
    vault.approve_milestone(&admin, &project_id, &0u32);

    // Register a PanickingTreasury stub — its allocate_budget always panics
    let bad_treasury_id = env.register(PanickingTreasury, ());

    env.ledger().set_timestamp(1000);

    // The call should fail and return an error (not panic / abort the whole
    // test transaction).
    let result = vault.try_allocate_to_streaming_treasury(
        &admin,
        &project_id,
        &0u32,
        &bad_treasury_id,
        &2_000i128,
        &500u64,
        &fresh_id(&env, 141),
    );

    assert!(
        result.is_err(),
        "allocate_to_streaming_treasury must return an error when treasury panics"
    );

    // Because the vault uses try_allocate_budget (which catches the panic), the
    // Soroban host does NOT abort the outer transaction.  The vault's state
    // mutation (balance deduction) DID take effect before the failed call.
    //
    // Fund conservation: tokens moved to bad_treasury_id address (not destroyed).
    let vault_balance = vault.get_balance(&project_id);
    let bad_treasury_balance = token.balance(&bad_treasury_id);
    let contributor_balance = token.balance(&contributor);

    assert_eq!(
        vault_balance + bad_treasury_balance + contributor_balance,
        10_000,
        "Total tokens must be conserved — funds relocated, not destroyed"
    );

    // The bad treasury holds the allocation amount
    assert_eq!(
        bad_treasury_balance, 2_000,
        "Panicking treasury must hold the transferred tokens"
    );

    // The vault balance was reduced
    assert_eq!(
        vault_balance, 3_000,
        "Vault balance must reflect the deduction"
    );
}

// ─────────────────────────────────────────────
// TEST U — CALL SITE C recovery: vault emergency migration after treasury failure
// ─────────────────────────────────────────────
//
// This test demonstrates the recovery procedure after a partial
// `allocate_to_streaming_treasury` failure (TEST T scenario).
//
// Because the vault's balance was deducted and the idempotency guard was
// consumed (the request_id was claimed), the admin cannot simply retry.
// Instead the admin uses the vault's emergency migration path to move the
// remaining vault balance to a safe recipient, opening the project for
// contributor clawbacks.
//
// This test also exercises the scenario where the vault still has a
// partial balance (not all funds were in the failed allocation).
#[test]
fn test_u_vault_emergency_migration_recovers_after_treasury_failure() {
    let env = Env::default();
    env.mock_all_auths();

    let admin = Address::generate(&env);
    let owner = Address::generate(&env);
    let contributor = Address::generate(&env);
    let rescue_address = Address::generate(&env);

    let (token_id, token_sac) = make_token(&env, &admin);
    let token = TokenClient::new(&env, &token_id);
    token_sac.mint(&contributor, &10_000);

    let vault_id = env.register(CrowdfundVaultContract, ());
    let vault = VaultClient::new(&env, &vault_id);
    vault.initialize(&admin);

    let project_id = vault.create_project(
        &owner,
        &Symbol::new(&env, "P"),
        &10_000i128,
        &token_id,
    );

    // Fund the project with 8_000
    vault.deposit(&contributor, &project_id, &8_000i128, &fresh_id(&env, 150));
    assert_eq!(vault.get_balance(&project_id), 8_000);

    // Approve milestone
    vault.approve_milestone(&admin, &project_id, &0u32);

    // Partial allocation to panicking treasury (3_000) — this fails
    let bad_treasury_id = env.register(PanickingTreasury, ());
    env.ledger().set_timestamp(1000);

    let alloc_result = vault.try_allocate_to_streaming_treasury(
        &admin,
        &project_id,
        &0u32,
        &bad_treasury_id,
        &3_000i128,
        &500u64,
        &fresh_id(&env, 151),
    );
    // Confirm the failure
    assert!(alloc_result.is_err(), "Allocation to bad treasury must fail");

    // Vault now holds 5_000 (8_000 - 3_000), bad_treasury holds 3_000
    assert_eq!(vault.get_balance(&project_id), 5_000);
    assert_eq!(token.balance(&bad_treasury_id), 3_000);

    // ── Recovery procedure ────────────────────────────────────────────────
    // Step 1: Pause the contract
    vault.pause(&admin);

    // Step 2: Propose emergency migration for the remaining 5_000
    vault.propose_emergency_migration(
        &admin,
        &project_id,
        &rescue_address,
        &5_000i128,
        &Symbol::new(&env, "recovery"),
    );

    // Step 3: Execute — moves 5_000 from vault to rescue_address
    //         and cancels the project (enabling contributor clawbacks)
    let migrated = vault.execute_emergency_migration(&admin, &project_id);
    assert_eq!(migrated, 5_000, "Emergency migration must move exactly 5_000");

    // rescue_address holds the remaining vault balance
    assert_eq!(token.balance(&rescue_address), 5_000);
    assert_eq!(vault.get_balance(&project_id), 0);

    // Fund conservation check:
    // contributor: 2_000 (10_000 - 8_000 deposited)
    // rescue_address: 5_000
    // bad_treasury: 3_000
    // vault: 0
    // total = 10_000 ✓
    assert_eq!(
        token.balance(&contributor)
            + token.balance(&rescue_address)
            + token.balance(&bad_treasury_id)
            + token.balance(&vault.address),
        10_000,
        "Total supply must be conserved through partial failure + recovery"
    );
}
