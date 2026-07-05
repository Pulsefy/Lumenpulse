use super::*;
use soroban_sdk::{
    testutils::{Address as _, Ledger},
    Env,
};
use storage::PriceData;

const PRICE: i128 = 10_000_000; // $1.00 scaled by 10^7
const DECIMALS: u32 = 7;

/// Creates a contract client, admin, and asset address; initializes the contract.
/// Caller must create `Env::default()` and call `env.mock_all_auths()` first.
fn setup<'a>(env: &'a Env) -> (PricingAdapterContractClient<'a>, Address, Address) {
    let admin = Address::generate(env);
    let asset = Address::generate(env);
    let contract_id = env.register(PricingAdapterContract, ());
    let client = PricingAdapterContractClient::new(env, &contract_id);
    client.initialize(&admin);
    (client, admin, asset)
}

// ── Existing tests (unchanged) ───────────────────────────────────────────────

#[test]
fn test_initialization() {
    let env = Env::default();
    env.mock_all_auths();
    let admin = Address::generate(&env);

    let contract_id = env.register(PricingAdapterContract, ());
    let client = PricingAdapterContractClient::new(&env, &contract_id);

    client.initialize(&admin);

    // Cannot initialize twice
    let res = client.try_initialize(&admin);
    assert!(res.is_err() || res.unwrap().is_err());
}

#[test]
fn test_set_and_get_price() {
    let env = Env::default();
    env.mock_all_auths();

    let admin = Address::generate(&env);
    let asset = Address::generate(&env);

    let contract_id = env.register(PricingAdapterContract, ());
    let client = PricingAdapterContractClient::new(&env, &contract_id);

    client.initialize(&admin);

    let price: i128 = 10_000_000; // $1.00 scaled by 10^7
    let asset_decimals: u32 = 7;

    client.set_price(&admin, &asset, &price, &asset_decimals);

    let retrieved_price = client.get_price(&asset);
    assert_eq!(retrieved_price, price);

    let retrieved_decimals = client.get_asset_decimals(&asset);
    assert_eq!(retrieved_decimals, asset_decimals);
}

#[test]
fn test_normalize_amount_same_decimals() {
    let env = Env::default();
    env.mock_all_auths();

    let admin = Address::generate(&env);
    let asset = Address::generate(&env);

    let contract_id = env.register(PricingAdapterContract, ());
    let client = PricingAdapterContractClient::new(&env, &contract_id);

    client.initialize(&admin);

    let price: i128 = 10_000_000; // $1.00 scaled by 10^7
    let asset_decimals: u32 = 7;
    client.set_price(&admin, &asset, &price, &asset_decimals);

    let amount: i128 = 5_000_000; // 5 tokens
    let normalized = client.normalize_amount(&asset, &amount);

    assert_eq!(normalized, 5_000_000);
}

#[test]
fn test_normalize_amount_different_decimals() {
    let env = Env::default();
    env.mock_all_auths();

    let admin = Address::generate(&env);
    let eth_asset = Address::generate(&env);

    let contract_id = env.register(PricingAdapterContract, ());
    let client = PricingAdapterContractClient::new(&env, &contract_id);

    client.initialize(&admin);

    let eth_price: i128 = 3000 * 10_000_000; // $3000 scaled by 10^7
    let eth_decimals: u32 = 18;
    client.set_price(&admin, &eth_asset, &eth_price, &eth_decimals);

    let amount: i128 = 2 * 1_000_000_000_000_000_000; // 2 ETH
    let normalized = client.normalize_amount(&eth_asset, &amount);

    let expected: i128 = 6000 * 10_000_000;
    assert_eq!(normalized, expected);
}

// ── Freshness metadata ───────────────────────────────────────────────────────

#[test]
fn test_price_timestamp_stored_on_set_price() {
    let env = Env::default();
    env.mock_all_auths();
    let (client, admin, asset) = setup(&env);
    env.ledger().set_timestamp(5_000);
    client.set_price(&admin, &asset, &PRICE, &DECIMALS);

    let data = client.get_price_data(&asset);
    assert_eq!(data.timestamp, 5_000);
}

#[test]
fn test_price_timestamp_updated_on_subsequent_set_price() {
    let env = Env::default();
    env.mock_all_auths();
    let (client, admin, asset) = setup(&env);
    env.ledger().set_timestamp(1_000);
    client.set_price(&admin, &asset, &PRICE, &DECIMALS);
    env.ledger().set_timestamp(2_500);
    client.set_price(&admin, &asset, &PRICE, &DECIMALS);

    let data = client.get_price_data(&asset);
    assert_eq!(data.timestamp, 2_500);
}

// ── Staleness window — boundary values ──────────────────────────────────────

#[test]
fn test_get_safe_price_fresh() {
    // Price age = 50s, window = 60s — fresh.
    let env = Env::default();
    env.mock_all_auths();
    let (client, admin, asset) = setup(&env);
    env.ledger().set_timestamp(1_000);
    client.set_price(&admin, &asset, &PRICE, &DECIMALS);
    client.set_staleness_window(&admin, &asset, &60u64);

    env.ledger().set_timestamp(1_050);
    assert_eq!(client.get_safe_price(&asset), PRICE);
}

#[test]
fn test_get_safe_price_at_exact_boundary_is_fresh() {
    // age == window → still fresh (> not >=).
    let env = Env::default();
    env.mock_all_auths();
    let (client, admin, asset) = setup(&env);
    env.ledger().set_timestamp(1_000);
    client.set_price(&admin, &asset, &PRICE, &DECIMALS);
    client.set_staleness_window(&admin, &asset, &60u64);

    env.ledger().set_timestamp(1_060); // age = 60 == window
    assert_eq!(client.get_safe_price(&asset), PRICE);
}

#[test]
fn test_get_safe_price_one_second_past_boundary_is_stale() {
    // age = window + 1 → stale.
    let env = Env::default();
    env.mock_all_auths();
    let (client, admin, asset) = setup(&env);
    env.ledger().set_timestamp(1_000);
    client.set_price(&admin, &asset, &PRICE, &DECIMALS);
    client.set_staleness_window(&admin, &asset, &60u64);

    env.ledger().set_timestamp(1_061); // age = 61 > 60
    assert_eq!(
        client.try_get_safe_price(&asset),
        Err(Ok(PricingAdapterError::PriceStale))
    );
}

#[test]
fn test_get_safe_price_stale_rejected() {
    let env = Env::default();
    env.mock_all_auths();
    let (client, admin, asset) = setup(&env);
    env.ledger().set_timestamp(0);
    client.set_price(&admin, &asset, &PRICE, &DECIMALS);
    client.set_staleness_window(&admin, &asset, &60u64);

    env.ledger().set_timestamp(200); // age = 200 >> 60
    assert_eq!(
        client.try_get_safe_price(&asset),
        Err(Ok(PricingAdapterError::PriceStale))
    );
}

#[test]
fn test_zero_staleness_window_never_stale() {
    // window = 0 disables the check — any age is accepted.
    let env = Env::default();
    env.mock_all_auths();
    let (client, admin, asset) = setup(&env);
    env.ledger().set_timestamp(0);
    client.set_price(&admin, &asset, &PRICE, &DECIMALS);
    // Default window is 0; explicit set to confirm.
    client.set_staleness_window(&admin, &asset, &0u64);

    env.ledger().set_timestamp(u64::MAX / 2);
    assert_eq!(client.get_safe_price(&asset), PRICE);
}

#[test]
fn test_get_price_ignores_staleness() {
    // get_price is backward-compatible — never errors on stale prices.
    let env = Env::default();
    env.mock_all_auths();
    let (client, admin, asset) = setup(&env);
    env.ledger().set_timestamp(0);
    client.set_price(&admin, &asset, &PRICE, &DECIMALS);
    client.set_staleness_window(&admin, &asset, &60u64);

    env.ledger().set_timestamp(9_999);
    assert_eq!(client.get_price(&asset), PRICE);
}

// ── Invalidation flag ────────────────────────────────────────────────────────

#[test]
fn test_invalidate_price_blocks_safe_price() {
    let env = Env::default();
    env.mock_all_auths();
    let (client, admin, asset) = setup(&env);
    env.ledger().set_timestamp(1_000);
    client.set_price(&admin, &asset, &PRICE, &DECIMALS);
    client.invalidate_price(&admin, &asset);

    assert_eq!(
        client.try_get_safe_price(&asset),
        Err(Ok(PricingAdapterError::PriceInvalidated))
    );
}

#[test]
fn test_invalidation_cleared_by_new_set_price() {
    let env = Env::default();
    env.mock_all_auths();
    let (client, admin, asset) = setup(&env);
    env.ledger().set_timestamp(1_000);
    client.set_price(&admin, &asset, &PRICE, &DECIMALS);
    client.invalidate_price(&admin, &asset);

    // Re-publishing the price clears the invalidation flag.
    env.ledger().set_timestamp(1_100);
    client.set_price(&admin, &asset, &PRICE, &DECIMALS);
    assert_eq!(client.get_safe_price(&asset), PRICE);
}

#[test]
fn test_invalidate_non_admin_fails() {
    let env = Env::default();
    env.mock_all_auths();
    let (client, admin, asset) = setup(&env);
    env.ledger().set_timestamp(1_000);
    client.set_price(&admin, &asset, &PRICE, &DECIMALS);

    let non_admin = Address::generate(&env);
    assert_eq!(
        client.try_invalidate_price(&non_admin, &asset),
        Err(Ok(PricingAdapterError::Unauthorized))
    );
}

#[test]
fn test_invalidate_nonexistent_price_fails() {
    let env = Env::default();
    env.mock_all_auths();
    let (client, admin, _) = setup(&env);
    let unknown_asset = Address::generate(&env);
    assert_eq!(
        client.try_invalidate_price(&admin, &unknown_asset),
        Err(Ok(PricingAdapterError::PriceNotFound))
    );
}

#[test]
fn test_invalidation_does_not_affect_get_price() {
    // get_price is backward-compatible — never errors on invalidated prices.
    let env = Env::default();
    env.mock_all_auths();
    let (client, admin, asset) = setup(&env);
    env.ledger().set_timestamp(1_000);
    client.set_price(&admin, &asset, &PRICE, &DECIMALS);
    client.invalidate_price(&admin, &asset);

    assert_eq!(client.get_price(&asset), PRICE);
}

// ── get_price_data ───────────────────────────────────────────────────────────

#[test]
fn test_get_price_data_fresh_and_valid() {
    let env = Env::default();
    env.mock_all_auths();
    let (client, admin, asset) = setup(&env);
    env.ledger().set_timestamp(1_000);
    client.set_price(&admin, &asset, &PRICE, &DECIMALS);
    client.set_staleness_window(&admin, &asset, &120u64);

    env.ledger().set_timestamp(1_050);
    let data = client.get_price_data(&asset);

    assert_eq!(
        data,
        PriceData {
            price: PRICE,
            timestamp: 1_000,
            staleness_window: 120,
            is_invalidated: false,
            is_stale: false,
        }
    );
}

#[test]
fn test_get_price_data_shows_stale_flag() {
    let env = Env::default();
    env.mock_all_auths();
    let (client, admin, asset) = setup(&env);
    env.ledger().set_timestamp(1_000);
    client.set_price(&admin, &asset, &PRICE, &DECIMALS);
    client.set_staleness_window(&admin, &asset, &60u64);

    env.ledger().set_timestamp(1_100); // age = 100 > window = 60
    let data = client.get_price_data(&asset);

    assert!(data.is_stale);
    assert!(!data.is_invalidated);
}

#[test]
fn test_get_price_data_shows_invalidated_flag() {
    let env = Env::default();
    env.mock_all_auths();
    let (client, admin, asset) = setup(&env);
    env.ledger().set_timestamp(1_000);
    client.set_price(&admin, &asset, &PRICE, &DECIMALS);
    client.invalidate_price(&admin, &asset);

    let data = client.get_price_data(&asset);
    assert!(data.is_invalidated);
    assert!(!data.is_stale);
}

#[test]
fn test_get_price_data_no_staleness_window_is_never_stale() {
    let env = Env::default();
    env.mock_all_auths();
    let (client, admin, asset) = setup(&env);
    env.ledger().set_timestamp(0);
    client.set_price(&admin, &asset, &PRICE, &DECIMALS);

    env.ledger().set_timestamp(u64::MAX / 2);
    let data = client.get_price_data(&asset);

    assert_eq!(data.staleness_window, 0);
    assert!(!data.is_stale);
}

// ── set_staleness_window guards ──────────────────────────────────────────────

#[test]
fn test_set_staleness_window_non_admin_fails() {
    let env = Env::default();
    env.mock_all_auths();
    let (client, _, asset) = setup(&env);
    let non_admin = Address::generate(&env);
    assert_eq!(
        client.try_set_staleness_window(&non_admin, &asset, &60u64),
        Err(Ok(PricingAdapterError::Unauthorized))
    );
}

#[test]
fn test_staleness_window_can_be_updated() {
    let env = Env::default();
    env.mock_all_auths();
    let (client, admin, asset) = setup(&env);
    env.ledger().set_timestamp(1_000);
    client.set_price(&admin, &asset, &PRICE, &DECIMALS);
    client.set_staleness_window(&admin, &asset, &30u64);

    // Age = 40s → stale under window=30.
    env.ledger().set_timestamp(1_040);
    assert_eq!(
        client.try_get_safe_price(&asset),
        Err(Ok(PricingAdapterError::PriceStale))
    );

    // Widen window to 60 — same age now fresh.
    client.set_staleness_window(&admin, &asset, &60u64);
    assert_eq!(client.get_safe_price(&asset), PRICE);
}
