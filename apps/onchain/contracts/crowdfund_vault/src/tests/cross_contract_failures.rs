// Failure injection at every crowdfund_vault cross-contract call site (#1622).
//
// Each test fails exactly one downstream call and asserts the invocation
// reverts as a unit: no tokens move, no ledger entry changes, and the request
// id is not consumed, so the caller can retry once the fault is cleared.
// The call-site inventory and recovery procedures live in
// docs/CROSS_CONTRACT_FAILURE_HANDLING.md.

extern crate std;

use crate::storage::{DataKey, ProtocolStats};
use crate::yield_provider::YieldProviderTrait;
use crate::{CrowdfundVaultContract, CrowdfundVaultContractClient};
use notification_interface::{Notification, NotificationReceiverTrait};
use soroban_sdk::{
    contract, contractimpl, symbol_short, testutils::Address as _, Address, BytesN, Env, Symbol,
};
use test_utils::{FaultyToken, FaultyTokenClient};
use treasury::{TreasuryContract, TreasuryContractClient};

// ─── Mock downstream contracts ───────────────────────────────────────────────

#[contract]
pub struct PanickingReceiver;

#[contractimpl]
impl NotificationReceiverTrait for PanickingReceiver {
    fn on_notify(_env: Env, _notification: Notification) {
        panic!("subscriber failure");
    }
}

#[contract]
pub struct RecordingReceiver;

#[contractimpl]
impl NotificationReceiverTrait for RecordingReceiver {
    fn on_notify(env: Env, notification: Notification) {
        env.storage()
            .instance()
            .set(&symbol_short!("last"), &notification);
    }
}

#[contract]
pub struct FlakyYieldProvider;

#[contractimpl]
impl FlakyYieldProvider {
    pub fn initialize(env: Env, token: Address) {
        env.storage()
            .instance()
            .set(&symbol_short!("token"), &token);
    }

    pub fn set_faults(env: Env, fail_deposit: bool, fail_withdraw: bool) {
        env.storage()
            .instance()
            .set(&symbol_short!("faults"), &(fail_deposit, fail_withdraw));
    }

    fn faults(env: &Env) -> (bool, bool) {
        env.storage()
            .instance()
            .get(&symbol_short!("faults"))
            .unwrap_or((false, false))
    }
}

#[contractimpl]
impl YieldProviderTrait for FlakyYieldProvider {
    fn deposit(env: Env, from: Address, amount: i128) {
        if Self::faults(&env).0 {
            panic!("yield deposit failure");
        }
        let current: i128 = env.storage().persistent().get(&from).unwrap_or(0);
        env.storage().persistent().set(&from, &(current + amount));
    }

    fn withdraw(env: Env, to: Address, amount: i128) {
        if Self::faults(&env).1 {
            panic!("yield withdraw failure");
        }
        let token: Address = env
            .storage()
            .instance()
            .get(&symbol_short!("token"))
            .unwrap();
        let current: i128 = env.storage().persistent().get(&to).unwrap_or(0);
        FaultyTokenClient::new(&env, &token).transfer(
            &env.current_contract_address(),
            &to,
            &amount,
        );
        env.storage().persistent().set(&to, &(current - amount));
    }

    fn balance(env: Env, address: Address) -> i128 {
        env.storage().persistent().get(&address).unwrap_or(0)
    }
}

// ─── Harness ─────────────────────────────────────────────────────────────────

const DEPOSIT: i128 = 500_000;

struct Fixture<'a> {
    env: Env,
    vault: CrowdfundVaultContractClient<'a>,
    token: FaultyTokenClient<'a>,
    admin: Address,
    owner: Address,
    user: Address,
    project_id: u64,
}

fn rid(env: &Env, byte: u8) -> BytesN<32> {
    BytesN::from_array(env, &[byte; 32])
}

/// Vault with one project funded by a single `DEPOSIT` and milestone 0 approved.
fn setup<'a>() -> Fixture<'a> {
    let env = Env::default();
    env.mock_all_auths();

    let admin = Address::generate(&env);
    let owner = Address::generate(&env);
    let user = Address::generate(&env);

    let token = FaultyTokenClient::new(&env, &env.register(FaultyToken, ()));
    token.mint(&user, &10_000_000);

    let vault = CrowdfundVaultContractClient::new(&env, &env.register(CrowdfundVaultContract, ()));
    vault.initialize(&admin);
    let project_id =
        vault.create_project(&owner, &symbol_short!("XFail"), &1_000_000, &token.address);
    vault.deposit(&user, &project_id, &DEPOSIT, &rid(&env, 1));
    vault.approve_milestone(&admin, &project_id, &0);

    Fixture {
        env,
        vault,
        token,
        admin,
        owner,
        user,
        project_id,
    }
}

/// Every piece of value-bearing state a failed call could leave half-written.
#[derive(Debug, PartialEq)]
struct Snapshot {
    project_balance: i128,
    total_deposited: i128,
    total_withdrawn: i128,
    invested: i128,
    tvl: i128,
    contribution: i128,
    token_balances: std::vec::Vec<i128>,
}

fn snapshot(f: &Fixture, holders: &[Address]) -> Snapshot {
    let project = f.vault.get_project(&f.project_id);
    let (invested, tvl) = f.env.as_contract(&f.vault.address, || {
        let invested: i128 = f
            .env
            .storage()
            .persistent()
            .get(&DataKey::ProjectInvestedBalance(f.project_id))
            .unwrap_or(0);
        let stats: ProtocolStats = f
            .env
            .storage()
            .instance()
            .get(&DataKey::ProtocolStats)
            .unwrap();
        (invested, stats.tvl)
    });
    Snapshot {
        project_balance: f.vault.get_balance(&f.project_id),
        total_deposited: project.total_deposited,
        total_withdrawn: project.total_withdrawn,
        invested,
        tvl,
        contribution: f.vault.get_contribution(&f.project_id, &f.user),
        token_balances: holders.iter().map(|a| f.token.balance(a)).collect(),
    }
}

fn holders(f: &Fixture, extra: &[&Address]) -> std::vec::Vec<Address> {
    let mut v = std::vec![
        f.vault.address.clone(),
        f.admin.clone(),
        f.owner.clone(),
        f.user.clone(),
    ];
    v.extend(extra.iter().map(|a| (*a).clone()));
    v
}

// ─── deposit: token pull (user → vault) ─────────────────────────────────────

#[test]
fn deposit_token_failure_reverts_and_request_id_is_reusable() {
    let f = setup();
    let all = holders(&f, &[]);
    let before = snapshot(&f, &all);

    f.token.fail_transfers_to(&Some(f.vault.address.clone()));
    let req = rid(&f.env, 2);
    assert!(f
        .vault
        .try_deposit(&f.user, &f.project_id, &100, &req)
        .is_err());
    assert_eq!(snapshot(&f, &all), before);

    f.token.fail_transfers_to(&None);
    f.vault.deposit(&f.user, &f.project_id, &100, &req);
    assert_eq!(f.vault.get_balance(&f.project_id), DEPOSIT + 100);
    assert_eq!(f.token.balance(&f.vault.address), DEPOSIT + 100);
}

#[test]
fn deposit_without_funds_is_not_credited() {
    let f = setup();
    let broke = Address::generate(&f.env);
    assert!(f
        .vault
        .try_deposit(&broke, &f.project_id, &100, &rid(&f.env, 2))
        .is_err());
    assert_eq!(f.vault.get_contribution(&f.project_id, &broke), 0);
    assert_eq!(f.vault.get_balance(&f.project_id), DEPOSIT);
    assert_eq!(f.token.balance(&f.vault.address), DEPOSIT);
}

// ─── deposit: subscriber fan-out ────────────────────────────────────────────

#[test]
fn failing_subscriber_never_blocks_deposit() {
    let f = setup();
    let bad = f.env.register(PanickingReceiver, ());
    let good = f.env.register(RecordingReceiver, ());
    // The failing subscriber is notified first so a revert would also
    // starve the healthy one.
    f.vault.add_subscriber(&f.admin, &bad);
    f.vault.add_subscriber(&f.admin, &good);

    f.vault
        .deposit(&f.user, &f.project_id, &100, &rid(&f.env, 2));

    assert_eq!(f.vault.get_balance(&f.project_id), DEPOSIT + 100);
    assert_eq!(f.token.balance(&f.vault.address), DEPOSIT + 100);
    let delivered: Notification = f.env.as_contract(&good, || {
        f.env
            .storage()
            .instance()
            .get(&symbol_short!("last"))
            .unwrap()
    });
    assert_eq!(delivered.event_type, Symbol::new(&f.env, "deposit"));
}

// ─── withdraw: fee leg (vault → fee treasury) and owner leg ─────────────────

#[test]
fn withdraw_fee_leg_failure_reverts_both_legs() {
    let f = setup();
    let fee_sink = Address::generate(&f.env);
    f.vault.set_fee_config(&f.admin, &500, &fee_sink);
    let all = holders(&f, &[&fee_sink]);
    let before = snapshot(&f, &all);

    f.token.fail_transfers_to(&Some(fee_sink.clone()));
    assert!(f.vault.try_withdraw(&f.project_id, &0, &100_000).is_err());
    assert_eq!(snapshot(&f, &all), before);

    f.token.fail_transfers_to(&None);
    f.vault.withdraw(&f.project_id, &0, &100_000);
    assert_eq!(f.token.balance(&fee_sink), 5_000);
    assert_eq!(f.token.balance(&f.owner), 95_000);
    assert_eq!(f.token.balance(&f.vault.address), DEPOSIT - 100_000);
    assert_eq!(f.vault.get_balance(&f.project_id), DEPOSIT - 100_000);
}

#[test]
fn withdraw_owner_leg_failure_reverts_fee_already_sent() {
    let f = setup();
    let fee_sink = Address::generate(&f.env);
    f.vault.set_fee_config(&f.admin, &500, &fee_sink);
    let all = holders(&f, &[&fee_sink]);
    let before = snapshot(&f, &all);

    // The fee transfer succeeds first; the owner transfer then traps.
    f.token.fail_transfers_to(&Some(f.owner.clone()));
    assert!(f.vault.try_withdraw(&f.project_id, &0, &100_000).is_err());
    assert_eq!(snapshot(&f, &all), before);
}

// ─── yield provider: invest (transfer + deposit) and divest (withdraw) ──────

fn with_yield(f: &Fixture) -> FlakyYieldProviderClient<'static> {
    let id = f.env.register(FlakyYieldProvider, ());
    let provider = FlakyYieldProviderClient::new(&f.env, &id);
    provider.initialize(&f.token.address);
    f.vault.set_yield_provider(&f.admin, &f.token.address, &id);
    provider
}

#[test]
fn yield_deposit_failure_reverts_invest() {
    let f = setup();
    let provider = with_yield(&f);
    let all = holders(&f, &[&provider.address]);
    let before = snapshot(&f, &all);

    // Token leg to the provider succeeds; the provider's deposit then traps.
    provider.set_faults(&true, &false);
    assert!(f
        .vault
        .try_invest_idle_funds(&f.owner, &f.project_id, &200_000)
        .is_err());
    assert_eq!(snapshot(&f, &all), before);
}

#[test]
fn yield_token_leg_failure_reverts_invest() {
    let f = setup();
    let provider = with_yield(&f);
    let all = holders(&f, &[&provider.address]);
    let before = snapshot(&f, &all);

    f.token.fail_transfers_to(&Some(provider.address.clone()));
    assert!(f
        .vault
        .try_invest_idle_funds(&f.owner, &f.project_id, &200_000)
        .is_err());
    assert_eq!(snapshot(&f, &all), before);
}

#[test]
fn yield_withdraw_failure_reverts_auto_divesting_withdraw() {
    let f = setup();
    let provider = with_yield(&f);
    f.vault.invest_idle_funds(&f.owner, &f.project_id, &400_000);
    let all = holders(&f, &[&provider.address]);
    let before = snapshot(&f, &all);

    // Local balance is 100_000, so this withdraw must divest 200_000 first.
    provider.set_faults(&false, &true);
    assert!(f.vault.try_withdraw(&f.project_id, &0, &300_000).is_err());
    assert_eq!(snapshot(&f, &all), before);

    provider.set_faults(&false, &false);
    f.vault.withdraw(&f.project_id, &0, &300_000);
    assert_eq!(f.token.balance(&f.owner), 300_000);
    assert_eq!(f.vault.get_balance(&f.project_id), DEPOSIT - 300_000);
}

// ─── allocate_to_streaming_treasury: vault → admin → treasury ───────────────

const ALLOC: i128 = 100_000;
const DURATION: u64 = 2_592_000;

fn treasury<'a>(f: &Fixture) -> TreasuryContractClient<'a> {
    TreasuryContractClient::new(&f.env, &f.env.register(TreasuryContract, ()))
}

fn allocate(f: &Fixture, treasury: &Address, req: &BytesN<32>) -> bool {
    f.vault
        .try_allocate_to_streaming_treasury(
            &f.admin,
            &f.project_id,
            &0,
            treasury,
            &ALLOC,
            &DURATION,
            req,
        )
        .is_ok()
}

#[test]
fn treasury_allocation_moves_amount_exactly_once() {
    let f = setup();
    let t = treasury(&f);
    t.initialize(&f.admin, &f.token.address);

    assert!(allocate(&f, &t.address, &rid(&f.env, 9)));

    assert_eq!(f.token.balance(&t.address), ALLOC);
    assert_eq!(t.get_financials(), (ALLOC, ALLOC));
    assert_eq!(f.token.balance(&f.admin), 0);
    assert_eq!(f.token.balance(&f.vault.address), DEPOSIT - ALLOC);
    assert_eq!(f.vault.get_balance(&f.project_id), DEPOSIT - ALLOC);
    let all = holders(&f, &[]);
    assert_eq!(snapshot(&f, &all).tvl, DEPOSIT - ALLOC);
}

#[test]
fn treasury_rejection_reverts_allocation_and_is_retryable() {
    let f = setup();
    let t = treasury(&f);
    let all = holders(&f, &[&t.address]);
    let before = snapshot(&f, &all);
    let req = rid(&f.env, 9);

    // Uninitialised treasury: allocate_budget returns NotInitialized.
    assert!(!allocate(&f, &t.address, &req));
    assert_eq!(snapshot(&f, &all), before);

    // Treasury administered by someone else: Unauthorized.
    t.initialize(&Address::generate(&f.env), &f.token.address);
    assert!(!allocate(&f, &t.address, &req));
    assert_eq!(snapshot(&f, &all), before);

    // A treasury address that is not a contract at all.
    assert!(!allocate(&f, &Address::generate(&f.env), &req));
    assert_eq!(snapshot(&f, &all), before);

    // Recovery: the same request id still works against a healthy treasury.
    let healthy = treasury(&f);
    healthy.initialize(&f.admin, &f.token.address);
    assert!(allocate(&f, &healthy.address, &req));
    assert_eq!(healthy.get_financials(), (ALLOC, ALLOC));
}

#[test]
fn treasury_allocation_token_leg_failures_revert() {
    let f = setup();
    let t = treasury(&f);
    t.initialize(&f.admin, &f.token.address);
    let all = holders(&f, &[&t.address]);
    let before = snapshot(&f, &all);
    let req = rid(&f.env, 9);

    // Leg 1: vault → admin.
    f.token.fail_transfers_to(&Some(f.admin.clone()));
    assert!(!allocate(&f, &t.address, &req));
    assert_eq!(snapshot(&f, &all), before);

    // Leg 2: admin → treasury, inside allocate_budget.
    f.token.fail_transfers_to(&Some(t.address.clone()));
    assert!(!allocate(&f, &t.address, &req));
    assert_eq!(snapshot(&f, &all), before);
    assert_eq!(t.get_financials(), (0, 0));
}

#[test]
fn treasury_replayed_request_id_reverts_allocation() {
    let f = setup();
    let t = treasury(&f);
    t.initialize(&f.admin, &f.token.address);
    let req = rid(&f.env, 9);

    // The treasury already consumed this request id (e.g. a direct call).
    f.token.mint(&f.admin, &1);
    t.allocate_budget(&f.admin, &f.owner, &1, &0, &DURATION, &req);

    let all = holders(&f, &[&t.address]);
    let before = snapshot(&f, &all);
    assert!(!allocate(&f, &t.address, &req));
    assert_eq!(snapshot(&f, &all), before);

    // Recovery: a fresh request id goes through.
    assert!(allocate(&f, &t.address, &rid(&f.env, 10)));
}
