//! Test suite for the `yield_vault` contract (issue #1217).
//!
//! Covers:
//! - deposit, withdraw, yield accrual, and full exit
//! - accounting precision (first-depositor case, small-amount rounding)
//! - authorization failures for every admin-only entry point
//! - reverts for withdrawal beyond balance and withdrawal while paused
//! - request-id idempotency
use super::*;
use soroban_sdk::testutils::Address as _;
use soroban_sdk::token::{StellarAssetClient, TokenClient};
use soroban_sdk::{Address, BytesN, Env, Symbol};

#[contract]
struct MockYieldProvider;

#[contractimpl]
impl MockYieldProvider {
    pub fn deposit(env: Env, from: Address, amount: i128) -> i128 {
        let current: i128 = env.storage().persistent().get(&from).unwrap_or(0);
        env.storage().persistent().set(&from, &(current + amount));
        amount
    }

    pub fn withdraw(env: Env, to: Address, amount: i128) -> i128 {
        let current: i128 = env.storage().persistent().get(&to).unwrap_or(0);
        if current < amount {
            panic!("insufficient balance in mock");
        }
        env.storage().persistent().set(&to, &(current - amount));
        amount
    }

    pub fn balance(env: Env, address: Address) -> i128 {
        env.storage().persistent().get(&address).unwrap_or(0)
    }

    /// Simulates yield accruing inside the provider, credited to `to`
    /// (the vault contract address in these tests).
    pub fn accrue(env: Env, to: Address, amount: i128) -> i128 {
        let current: i128 = env.storage().persistent().get(&to).unwrap_or(0);
        env.storage().persistent().set(&to, &(current + amount));
        amount
    }
}

// ── Helpers ──────────────────────────────────────────────────────

fn fresh_request_id(env: &Env, nonce: u8) -> BytesN<32> {
    let mut buf = [0u8; 32];
    buf[31] = nonce;
    BytesN::from_array(env, &buf)
}

struct Fixture<'a> {
    env: Env,
    client: YieldVaultContractClient<'a>,
    token: TokenClient<'a>,
    token_admin: StellarAssetClient<'a>,
    admin: Address,
    user: Address,
    vault: Address,
    provider_id: u32,
}

fn setup() -> Fixture<'static> {
    let env = Env::default();
    env.mock_all_auths();

    let admin = Address::generate(&env);
    let user = Address::generate(&env);
    let token_admin_addr = Address::generate(&env);

    let token_id = env.register_stellar_asset_contract_v2(token_admin_addr.clone());
    let token = TokenClient::new(&env, &token_id.address());
    let token_admin = StellarAssetClient::new(&env, &token_id.address());

    let vault_id = env.register(YieldVaultContract, ());
    let client = YieldVaultContractClient::new(&env, &vault_id);

    let mock_id = env.register(MockYieldProvider, ());

    client.initialize(&admin, &token_id.address());
    let provider_id = client.register_provider(
        &admin,
        &Symbol::new(&env, "mock_provider"),
        &mock_id,
        &10u32,
    );

    // Give the user a healthy starting balance to draw deposits from.
    token_admin.mint(&user, &1_000_000i128);

    Fixture {
        env,
        client,
        token,
        token_admin,
        admin,
        user,
        vault: vault_id,
        provider_id,
    }
}

/// Registers a second mock provider and returns its assigned id.
fn add_provider(f: &Fixture, name: &str, priority: u32) -> u32 {
    let addr = f.env.register(MockYieldProvider, ());
    f.client
        .register_provider(&f.admin, &Symbol::new(&f.env, name), &addr, &priority)
}

// ── Initialization ───────────────────────────────────────────────

#[test]
fn test_initialize_twice_fails() {
    let f = setup();

    let result = f
        .client
        .try_initialize(&f.admin, &Address::generate(&f.env));
    assert_eq!(result, Err(Ok(YieldVaultError::AlreadyInitialized)));
}

#[test]
fn test_deposit_before_initialization_fails() {
    let env = Env::default();
    env.mock_all_auths();

    let vault_id = env.register(YieldVaultContract, ());
    let client = YieldVaultContractClient::new(&env, &vault_id);
    let user = Address::generate(&env);

    let result = client.try_deposit(&100i128, &user, &fresh_request_id(&env, 1));
    assert_eq!(result, Err(Ok(YieldVaultError::NotInitialized)));
}

// ── Deposit ──────────────────────────────────────────────────────

#[test]
fn test_deposit_updates_all_accounting() {
    let f = setup();

    let amount = 1_000i128;
    let user_tokens_before = f.token.balance(&f.user);

    let result = f
        .client
        .deposit(&amount, &f.user, &fresh_request_id(&f.env, 1));

    assert_eq!(result, amount);
    assert_eq!(f.client.balance_of(&f.user), amount);
    assert_eq!(f.client.get_total_aum(), amount);

    // Tokens left the user and sit in the vault.
    assert_eq!(user_tokens_before - f.token.balance(&f.user), amount);
    assert_eq!(f.token.balance(&f.vault), amount);

    // Routed to the highest-priority active provider.
    let provider = f.client.get_provider(&f.provider_id);
    assert_eq!(provider.total_deposited, amount);
}

#[test]
fn test_deposit_routes_to_highest_priority_provider() {
    let f = setup();

    let low_prio = f.provider_id;
    let high_prio = add_provider(&f, "high_priority", 100);

    let amount = 2_500i128;
    f.client
        .deposit(&amount, &f.user, &fresh_request_id(&f.env, 1));

    let low = f.client.get_provider(&low_prio);
    let high = f.client.get_provider(&high_prio);

    assert_eq!(low.total_deposited, 0);
    assert_eq!(high.total_deposited, amount);
    assert_eq!(f.client.get_total_aum(), amount);
}

#[test]
fn test_deposit_invalid_amount_reverts() {
    let f = setup();

    let result = f
        .client
        .try_deposit(&0i128, &f.user, &fresh_request_id(&f.env, 1));
    assert_eq!(result, Err(Ok(YieldVaultError::InvalidAmount)));

    let result = f
        .client
        .try_deposit(&-5i128, &f.user, &fresh_request_id(&f.env, 2));
    assert_eq!(result, Err(Ok(YieldVaultError::InvalidAmount)));

    assert_eq!(f.client.get_total_aum(), 0);
}

#[test]
fn test_deposit_without_providers_reverts() {
    let env = Env::default();
    env.mock_all_auths();

    let admin = Address::generate(&env);
    let user = Address::generate(&env);
    let token_admin_addr = Address::generate(&env);

    let token_id = env.register_stellar_asset_contract_v2(token_admin_addr);
    let token_admin = StellarAssetClient::new(&env, &token_id.address());

    let vault_id = env.register(YieldVaultContract, ());
    let client = YieldVaultContractClient::new(&env, &vault_id);
    client.initialize(&admin, &token_id.address());

    token_admin.mint(&user, &1_000i128);

    let result = client.try_deposit(&100i128, &user, &fresh_request_id(&env, 1));
    assert_eq!(result, Err(Ok(YieldVaultError::NoProvidersAvailable)));
}

// ── Withdraw / full exit ─────────────────────────────────────────

#[test]
fn test_partial_withdraw_then_full_exit() {
    let f = setup();

    let deposit_amount = 1_000i128;
    f.client
        .deposit(&deposit_amount, &f.user, &fresh_request_id(&f.env, 1));

    // Partial withdrawal.
    let partial = 400i128;
    let withdrawn = f
        .client
        .withdraw(&partial, &f.user, &fresh_request_id(&f.env, 2));
    assert_eq!(withdrawn, partial);
    assert_eq!(f.client.balance_of(&f.user), deposit_amount - partial);
    assert_eq!(f.client.get_total_aum(), deposit_amount - partial);
    assert_eq!(
        f.token.balance(&f.user),
        1_000_000 - deposit_amount + partial
    );

    // Full exit.
    let rest = deposit_amount - partial;
    let withdrawn = f
        .client
        .withdraw(&rest, &f.user, &fresh_request_id(&f.env, 3));
    assert_eq!(withdrawn, rest);

    assert_eq!(f.client.balance_of(&f.user), 0);
    assert_eq!(f.client.get_total_aum(), 0);
    assert_eq!(
        f.token.balance(&f.user),
        1_000_000, // every minted stroop is back with the user
    );
}

#[test]
fn test_withdraw_beyond_balance_reverts() {
    let f = setup();

    let amount = 500i128;
    f.client
        .deposit(&amount, &f.user, &fresh_request_id(&f.env, 1));

    let result = f
        .client
        .try_withdraw(&(amount + 1), &f.user, &fresh_request_id(&f.env, 2));
    assert_eq!(result, Err(Ok(YieldVaultError::InsufficientBalance)));

    let result = f
        .client
        .try_withdraw(&(amount * 10), &f.user, &fresh_request_id(&f.env, 3));
    assert_eq!(result, Err(Ok(YieldVaultError::InsufficientBalance)));

    // Failed withdrawals must leave state untouched.
    assert_eq!(f.client.balance_of(&f.user), amount);
    assert_eq!(f.client.get_total_aum(), amount);
    assert_eq!(f.token.balance(&f.user), 1_000_000 - amount);
}

#[test]
fn test_withdraw_from_zero_balance_reverts() {
    let f = setup();

    let result = f
        .client
        .try_withdraw(&1i128, &f.user, &fresh_request_id(&f.env, 1));
    assert_eq!(result, Err(Ok(YieldVaultError::InsufficientBalance)));
}

#[test]
fn test_withdraw_invalid_amount_reverts() {
    let f = setup();

    let result = f
        .client
        .try_withdraw(&0i128, &f.user, &fresh_request_id(&f.env, 1));
    assert_eq!(result, Err(Ok(YieldVaultError::InvalidAmount)));

    let result = f
        .client
        .try_withdraw(&-1i128, &f.user, &fresh_request_id(&f.env, 2));
    assert_eq!(result, Err(Ok(YieldVaultError::InvalidAmount)));
}

#[test]
fn test_withdraw_spans_multiple_providers_in_order() {
    let f = setup();

    let first_id = f.provider_id;
    // First deposit can only be routed to the single registered provider.
    f.client
        .deposit(&500i128, &f.user, &fresh_request_id(&f.env, 1));

    // A higher-priority provider captures all subsequent deposits.
    let second_id = add_provider(&f, "second", 100);
    f.client
        .deposit(&700i128, &f.user, &fresh_request_id(&f.env, 2));

    assert_eq!(f.client.balance_of(&f.user), 1_200i128);

    // Withdraw more than any single allocation: drains providers in
    // registration order until the request is satisfied.
    let withdrawn = f
        .client
        .withdraw(&900i128, &f.user, &fresh_request_id(&f.env, 3));

    assert_eq!(withdrawn, 900);
    assert_eq!(f.client.balance_of(&f.user), 300);
    assert_eq!(f.client.get_total_aum(), 300);

    let first = f.client.get_provider(&first_id);
    let second = f.client.get_provider(&second_id);
    assert_eq!(first.total_withdrawn, 500);
    assert_eq!(second.total_withdrawn, 400);
}

// ── Yield accrual ────────────────────────────────────────────────

#[test]
fn test_harvest_right_after_deposit_yields_zero() {
    let f = setup();

    f.client
        .deposit(&1_000i128, &f.user, &fresh_request_id(&f.env, 1));

    let harvested = f.client.harvest_yield(&f.admin, &f.provider_id);
    assert_eq!(harvested, 0);
    assert_eq!(f.client.get_total_yield_harvested(), 0);
}

#[test]
fn test_harvest_accrued_yield_once() {
    let f = setup();

    let deposit_amount = 1_000i128;
    f.client
        .deposit(&deposit_amount, &f.user, &fresh_request_id(&f.env, 1));

    // Simulate the provider generating 50 stroops of return.
    let mock_client = MockYieldProviderClient::new(&f.env, &get_mock_address(&f));
    mock_client.accrue(&f.vault, &50i128);

    let harvested = f.client.harvest_yield(&f.admin, &f.provider_id);
    assert_eq!(harvested, 50);
    assert_eq!(f.client.get_total_yield_harvested(), 50);

    let provider = f.client.get_provider(&f.provider_id);
    assert_eq!(provider.total_yield_earned, 50);

    // Harvesting again without new accrual must not double-count.
    let again = f.client.harvest_yield(&f.admin, &f.provider_id);
    assert_eq!(again, 0);
    assert_eq!(f.client.get_total_yield_harvested(), 50);
}

#[test]
fn test_harvest_accumulates_across_rounds() {
    let f = setup();

    f.client
        .deposit(&1_000i128, &f.user, &fresh_request_id(&f.env, 1));

    let mock_client = MockYieldProviderClient::new(&f.env, &get_mock_address(&f));

    mock_client.accrue(&f.vault, &30i128);
    assert_eq!(f.client.harvest_yield(&f.admin, &f.provider_id), 30);

    mock_client.accrue(&f.vault, &20i128);
    assert_eq!(f.client.harvest_yield(&f.admin, &f.provider_id), 20);

    assert_eq!(f.client.get_total_yield_harvested(), 50);
    let provider = f.client.get_provider(&f.provider_id);
    assert_eq!(provider.total_yield_earned, 50);
}

#[test]
fn test_reentrancy_guard_deposit_rejects_when_locked() {
    let f = setup();

    // Simulate reentrant lock state
    f.env.as_contract(&f.vault, || {
        f.env
            .storage()
            .instance()
            .set(&Symbol::new(&f.env, "REENTRANT"), &true);
    });

    let result = f
        .client
        .try_deposit(&100i128, &f.user, &fresh_request_id(&f.env, 99));
    assert_eq!(result, Err(Ok(YieldVaultError::Reentrancy)));
}

#[test]
fn test_harvest_after_withdrawal_does_not_overcount() {
    let f = setup();

    f.client
        .deposit(&1_000i128, &f.user, &fresh_request_id(&f.env, 1));
    f.client
        .withdraw(&400i128, &f.user, &fresh_request_id(&f.env, 2));

    // No accrual happened: withdrawing principal must not look like yield.
    assert_eq!(f.client.harvest_yield(&f.admin, &f.provider_id), 0);
}

#[test]
fn test_harvest_unknown_provider_reverts() {
    let f = setup();

    let result = f.client.try_harvest_yield(&f.admin, &999u32);
    assert_eq!(result, Err(Ok(YieldVaultError::ProviderNotFound)));
}

// ── Authorization ────────────────────────────────────────────────

#[test]
fn test_register_provider_requires_admin() {
    let f = setup();

    let outsider = Address::generate(&f.env);
    let impostor = f.env.register(MockYieldProvider, ());

    let result =
        f.client
            .try_register_provider(&outsider, &Symbol::new(&f.env, "evil"), &impostor, &1u32);
    assert_eq!(result, Err(Ok(YieldVaultError::Unauthorized)));

    // State unchanged: still exactly one registered provider.
    assert_eq!(
        f.client.try_get_provider(&1u32),
        Err(Ok(YieldVaultError::ProviderNotFound))
    );
}

#[test]
fn test_harvest_yield_requires_admin() {
    let f = setup();

    f.client
        .deposit(&1_000i128, &f.user, &fresh_request_id(&f.env, 1));

    let outsider = Address::generate(&f.env);
    let result = f.client.try_harvest_yield(&outsider, &f.provider_id);
    assert_eq!(result, Err(Ok(YieldVaultError::Unauthorized)));

    // Nothing was recorded by the unauthorized attempt.
    assert_eq!(f.client.get_total_yield_harvested(), 0);
    let provider = f.client.get_provider(&f.provider_id);
    assert_eq!(provider.total_yield_earned, 0);
}

#[test]
fn test_set_paused_requires_admin() {
    let f = setup();

    let outsider = Address::generate(&f.env);
    let result = f.client.try_set_paused(&outsider, &true);
    assert_eq!(result, Err(Ok(YieldVaultError::Unauthorized)));

    // Vault remains operational.
    assert!(!f.client.is_paused());
    f.client
        .deposit(&100i128, &f.user, &fresh_request_id(&f.env, 1));
}

// ── Pause ────────────────────────────────────────────────────────

#[test]
fn test_pause_blocks_withdraw_and_deposit() {
    let f = setup();

    f.client
        .deposit(&1_000i128, &f.user, &fresh_request_id(&f.env, 1));

    f.client.set_paused(&f.admin, &true);
    assert!(f.client.is_paused());

    let result = f
        .client
        .try_withdraw(&100i128, &f.user, &fresh_request_id(&f.env, 2));
    assert_eq!(result, Err(Ok(YieldVaultError::VaultPaused)));

    let result = f
        .client
        .try_deposit(&100i128, &f.user, &fresh_request_id(&f.env, 3));
    assert_eq!(result, Err(Ok(YieldVaultError::VaultPaused)));

    // Neither failed call changed accounting.
    assert_eq!(f.client.balance_of(&f.user), 1_000i128);
    assert_eq!(f.client.get_total_aum(), 1_000i128);
}

#[test]
fn test_unpause_restores_operations() {
    let f = setup();

    f.client
        .deposit(&1_000i128, &f.user, &fresh_request_id(&f.env, 1));

    f.client.set_paused(&f.admin, &true);
    f.client.set_paused(&f.admin, &false);
    assert!(!f.client.is_paused());

    let withdrawn = f
        .client
        .withdraw(&250i128, &f.user, &fresh_request_id(&f.env, 2));
    assert_eq!(withdrawn, 250);
    assert_eq!(f.client.balance_of(&f.user), 750);
}

// ── Accounting precision ─────────────────────────────────────────

#[test]
fn test_first_depositor_gets_exact_balance() {
    let f = setup();

    // The very first deposit must be reflected exactly, with no
    // rounding or inflation of the recorded balance.
    let amount = 7_777i128;
    f.client
        .deposit(&amount, &f.user, &fresh_request_id(&f.env, 1));

    assert_eq!(f.client.balance_of(&f.user), amount);
    assert_eq!(f.client.get_total_aum(), amount);
    assert_eq!(
        f.client.get_provider(&f.provider_id).total_deposited,
        amount
    );

    // A second, different user is accounted independently.
    let other = Address::generate(&f.env);
    f.token_admin.mint(&other, &5_000i128);
    f.client
        .deposit(&5_000i128, &other, &fresh_request_id(&f.env, 2));

    assert_eq!(f.client.balance_of(&f.user), amount);
    assert_eq!(f.client.balance_of(&other), 5_000i128);
    assert_eq!(f.client.get_total_aum(), amount + 5_000);
}

#[test]
fn test_small_amounts_are_tracked_without_loss() {
    let f = setup();

    // Five one-stroop deposits accumulate exactly.
    for nonce in 1..=5u8 {
        f.client
            .deposit(&1i128, &f.user, &fresh_request_id(&f.env, nonce));
    }
    assert_eq!(f.client.balance_of(&f.user), 5);
    assert_eq!(f.client.get_total_aum(), 5);

    // One-stroop withdrawals decrement exactly.
    f.client
        .withdraw(&1i128, &f.user, &fresh_request_id(&f.env, 6));
    assert_eq!(f.client.balance_of(&f.user), 4);
    assert_eq!(f.client.get_total_aum(), 4);

    // Full exit of the dust returns it all.
    f.client
        .withdraw(&4i128, &f.user, &fresh_request_id(&f.env, 7));
    assert_eq!(f.client.balance_of(&f.user), 0);
    assert_eq!(f.client.get_total_aum(), 0);
    assert_eq!(f.token.balance(&f.user), 1_000_000);
}

#[test]
fn test_many_small_deposits_match_aum_exactly() {
    let f = setup();

    let amounts = [1i128, 2, 3, 5, 8, 13, 21, 34, 55, 89];
    let mut expected = 0i128;
    for (i, amount) in amounts.iter().enumerate() {
        f.client
            .deposit(amount, &f.user, &fresh_request_id(&f.env, i as u8 + 1));
        expected += amount;
        assert_eq!(f.client.balance_of(&f.user), expected);
        assert_eq!(f.client.get_total_aum(), expected);
    }

    // Withdraw half in one shot: odd totals must not lose a stroop.
    let half = expected / 2;
    let withdrawn = f
        .client
        .withdraw(&half, &f.user, &fresh_request_id(&f.env, 99));
    assert_eq!(withdrawn, half);
    assert_eq!(f.client.balance_of(&f.user), expected - half);
    assert_eq!(f.client.get_total_aum(), expected - half);
}

#[test]
fn test_large_amounts_are_tracked_exactly() {
    let f = setup();

    let large = 9_000_000_000_000_000_000i128; // far below i128::MAX
    f.token_admin.mint(&f.user, &large);
    f.client
        .deposit(&large, &f.user, &fresh_request_id(&f.env, 1));

    assert_eq!(f.client.balance_of(&f.user), large);
    assert_eq!(f.client.get_total_aum(), large);

    f.client
        .withdraw(&large, &f.user, &fresh_request_id(&f.env, 2));
    assert_eq!(f.client.balance_of(&f.user), 0);
    assert_eq!(f.token.balance(&f.user), 1_000_000 + large);
}

// ── Idempotency ──────────────────────────────────────────────────

#[test]
fn test_deposit_idempotency() {
    let f = setup();

    let deposit_amount = 1000i128;
    let result = f
        .client
        .deposit(&deposit_amount, &f.user, &fresh_request_id(&f.env, 1));
    assert_eq!(result, deposit_amount);

    let replay = f
        .client
        .try_deposit(&deposit_amount, &f.user, &fresh_request_id(&f.env, 1));
    assert_eq!(replay, Err(Ok(YieldVaultError::AlreadyExecuted)));

    // The replay did not double-credit the user.
    assert_eq!(f.client.balance_of(&f.user), deposit_amount);
    assert_eq!(f.client.get_total_aum(), deposit_amount);
}

#[test]
fn test_withdraw_idempotency() {
    let f = setup();

    let deposit_amount = 1000i128;
    f.client.deposit(
        &deposit_amount,
        &f.user,
        &BytesN::from_array(&f.env, &[1; 32]),
    );

    let withdraw_amount = 500i128;
    let result = f
        .client
        .withdraw(&withdraw_amount, &f.user, &fresh_request_id(&f.env, 2));
    assert_eq!(result, withdraw_amount);

    let replay = f
        .client
        .try_withdraw(&withdraw_amount, &f.user, &fresh_request_id(&f.env, 2));
    assert_eq!(replay, Err(Ok(YieldVaultError::AlreadyExecuted)));

    assert_eq!(
        f.client.balance_of(&f.user),
        deposit_amount - withdraw_amount
    );
}

#[test]
fn test_same_request_id_not_shared_between_operations() {
    let f = setup();

    // A fresh id works for deposit...
    f.client
        .deposit(&100i128, &f.user, &fresh_request_id(&f.env, 1));

    // ...and an independent fresh id works for withdraw.
    let result = f
        .client
        .try_withdraw(&50i128, &f.user, &fresh_request_id(&f.env, 2));
    assert!(result.is_ok());
}

/// Resolves the address of the mock provider registered during setup.
fn get_mock_address(f: &Fixture) -> Address {
    f.client.get_provider(&f.provider_id).address
}
