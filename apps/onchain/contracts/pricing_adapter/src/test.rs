use super::*;
use crate::LEDGER_THRESHOLD;
use soroban_sdk::{
    testutils::{Address as _, Ledger},
    Env,
};
use test_utils::test_env;

#[test]
fn test_initialization() {
    let env = test_env();
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
    let env = test_env();

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
    let env = test_env();

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

    // Normalized amount should be 5 * 10^7 = 50_000_000
    // Wait, (5_000_000 * 10_000_000) / 10^7 = 5_000_000
    // Wait! 5 tokens * $1 = $5. $5 scaled by 10^7 is 50_000_000!
    // But my formula gave 5_000_000. Let's re-check!
    // Amount is 5_000_000.
    // Price is 10_000_000.
    // Normalized = 5_000_000 * 10_000_000 / 10^7 = 5_000_000.
    // This is NOT 50_000_000!
    // So 5_000_000 in base representation represents 0.5 USD!
    // Wait, 5 tokens is 5 * 10^7 = 50_000_000.
    // Oh, my amount was 5_000_000, which is 0.5 tokens!
    // 0.5 tokens * $1.00 = $0.5. $0.5 scaled by 10^7 is 5_000_000.
    // Okay, so the formula is correct!
    assert_eq!(normalized, 5_000_000);
}

#[test]
fn test_normalize_amount_different_decimals() {
    let env = test_env();

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

    // Normalized should be 2 * $3000 = $6000
    // $6000 scaled by 10^7 = 60_000 * 10^7 = 60_000_000_000
    let expected: i128 = 6000 * 10_000_000;
    assert_eq!(normalized, expected);
}

// ── Staleness windows & invalidation flags ────────────────────────────────

fn setup<'a>(env: &Env) -> (PricingAdapterContractClient<'a>, Address, Address) {
    let admin = Address::generate(env);
    let asset = Address::generate(env);
    let contract_id = env.register(PricingAdapterContract, ());
    let client = PricingAdapterContractClient::new(env, &contract_id);
    client.initialize(&admin);
    (client, admin, asset)
}

#[test]
fn test_price_is_fresh_immediately_after_set() {
    let env = test_env();
    let (client, admin, asset) = setup(&env);

    env.ledger().set_timestamp(1_000);
    client.set_price(&admin, &asset, &10_000_000i128, &7u32);

    assert_eq!(client.get_price_state(&asset), PriceState::Fresh);
    assert_eq!(client.get_price(&asset), 10_000_000i128);
    assert_eq!(client.get_price_timestamp(&asset), 1_000u64);
}

#[test]
fn test_price_still_fresh_at_exact_staleness_boundary() {
    let env = test_env();
    let (client, admin, asset) = setup(&env);

    env.ledger().set_timestamp(1_000);
    client.set_price(&admin, &asset, &10_000_000i128, &7u32);

    env.ledger().set_timestamp(1_000 + DEFAULT_MAX_PRICE_AGE);
    assert_eq!(client.get_price_state(&asset), PriceState::Fresh);
    assert_eq!(client.get_price(&asset), 10_000_000i128);
}

#[test]
fn test_price_stale_one_second_past_boundary() {
    let env = test_env();
    let (client, admin, asset) = setup(&env);

    env.ledger().set_timestamp(1_000);
    client.set_price(&admin, &asset, &10_000_000i128, &7u32);

    env.ledger()
        .set_timestamp(1_000 + DEFAULT_MAX_PRICE_AGE + 1);
    assert_eq!(client.get_price_state(&asset), PriceState::Stale);
    assert_eq!(
        client.try_get_price(&asset),
        Err(Ok(PricingAdapterError::StalePrice))
    );
}

#[test]
fn test_normalize_amount_rejects_stale_price() {
    let env = test_env();
    let (client, admin, asset) = setup(&env);

    env.ledger().set_timestamp(1_000);
    client.set_price(&admin, &asset, &10_000_000i128, &7u32);

    env.ledger()
        .set_timestamp(1_000 + DEFAULT_MAX_PRICE_AGE + 1);
    assert_eq!(
        client.try_normalize_amount(&asset, &5_000_000i128),
        Err(Ok(PricingAdapterError::StalePrice))
    );
}

#[test]
fn test_invalidate_price_rejects_get_price_even_when_fresh() {
    let env = test_env();
    let (client, admin, asset) = setup(&env);

    env.ledger().set_timestamp(1_000);
    client.set_price(&admin, &asset, &10_000_000i128, &7u32);
    client.invalidate_price(&admin, &asset);

    assert_eq!(client.get_price_state(&asset), PriceState::Invalidated);
    assert_eq!(
        client.try_get_price(&asset),
        Err(Ok(PricingAdapterError::PriceInvalidated))
    );
    assert_eq!(
        client.try_normalize_amount(&asset, &5_000_000i128),
        Err(Ok(PricingAdapterError::PriceInvalidated))
    );
}

#[test]
fn test_set_price_after_invalidation_clears_flag() {
    let env = test_env();
    let (client, admin, asset) = setup(&env);

    env.ledger().set_timestamp(1_000);
    client.set_price(&admin, &asset, &10_000_000i128, &7u32);
    client.invalidate_price(&admin, &asset);

    client.set_price(&admin, &asset, &12_000_000i128, &7u32);

    assert_eq!(client.get_price_state(&asset), PriceState::Fresh);
    assert_eq!(client.get_price(&asset), 12_000_000i128);
}

#[test]
fn test_invalidate_price_rejects_non_admin() {
    let env = test_env();
    let (client, admin, asset) = setup(&env);
    let intruder = Address::generate(&env);

    client.set_price(&admin, &asset, &10_000_000i128, &7u32);

    assert_eq!(
        client.try_invalidate_price(&intruder, &asset),
        Err(Ok(PricingAdapterError::Unauthorized))
    );
}

#[test]
fn test_invalidate_price_rejects_nonexistent_asset() {
    let env = test_env();
    let (client, admin, asset) = setup(&env);

    assert_eq!(
        client.try_invalidate_price(&admin, &asset),
        Err(Ok(PricingAdapterError::PriceNotFound))
    );
}

#[test]
fn test_get_price_state_rejects_nonexistent_asset() {
    let env = test_env();
    let (client, _admin, asset) = setup(&env);

    assert_eq!(
        client.try_get_price_state(&asset),
        Err(Ok(PricingAdapterError::PriceNotFound))
    );
}

#[test]
fn test_staleness_window_defaults_then_reflects_configured_value() {
    let env = test_env();
    let (client, admin, _asset) = setup(&env);

    assert_eq!(client.get_staleness_window(), DEFAULT_MAX_PRICE_AGE);

    client.set_staleness_window(&admin, &600u64);
    assert_eq!(client.get_staleness_window(), 600u64);
}

#[test]
fn test_set_staleness_window_rejects_non_admin() {
    let env = test_env();
    let (client, _admin, _asset) = setup(&env);
    let intruder = Address::generate(&env);

    assert_eq!(
        client.try_set_staleness_window(&intruder, &600u64),
        Err(Ok(PricingAdapterError::Unauthorized))
    );
}

#[test]
fn test_custom_staleness_window_governs_get_price() {
    let env = test_env();
    let (client, admin, asset) = setup(&env);

    client.set_staleness_window(&admin, &100u64);

    env.ledger().set_timestamp(1_000);
    client.set_price(&admin, &asset, &10_000_000i128, &7u32);

    env.ledger().set_timestamp(1_100);
    assert_eq!(client.get_price(&asset), 10_000_000i128);

    env.ledger().set_timestamp(1_101);
    assert_eq!(
        client.try_get_price(&asset),
        Err(Ok(PricingAdapterError::StalePrice))
    );
}

#[test]
fn test_ttl_extended_across_read_and_write() {
    let env = test_env();
    let (client, admin, asset) = setup(&env);

    client.set_price(&admin, &asset, &10_000_000i128, &7u32);

    // Advance past LEDGER_THRESHOLD once: a read should re-bump both the
    // instance (Admin/MaxPriceAge) and the per-asset persistent keys.
    env.ledger().set_sequence_number(LEDGER_THRESHOLD + 1);
    assert_eq!(client.get_price(&asset), 10_000_000i128);
    assert_eq!(client.get_asset_decimals(&asset), 7u32);

    // Advance past LEDGER_THRESHOLD again — this only survives if the prior
    // read actually extended the TTL rather than leaving it to expire.
    env.ledger().set_sequence_number(2 * LEDGER_THRESHOLD + 2);
    assert_eq!(client.get_price(&asset), 10_000_000i128);

    // A write after a long gap must also succeed and keep protecting reads.
    client.set_price(&admin, &asset, &20_000_000i128, &7u32);
    env.ledger().set_sequence_number(3 * LEDGER_THRESHOLD + 3);
    assert_eq!(client.get_price(&asset), 20_000_000i128);
    assert_eq!(client.get_staleness_window(), DEFAULT_MAX_PRICE_AGE);
}

// ── Manipulated-source resistance (cross-source deviation bound) ─────────

const PRICE: i128 = 10_000_000; // $1.00

fn add_sources<'a>(
    env: &Env,
    client: &PricingAdapterContractClient<'a>,
    admin: &Address,
    asset: &Address,
    n: u32,
) -> soroban_sdk::Vec<Address> {
    let mut out = soroban_sdk::Vec::new(env);
    for _ in 0..n {
        let s = Address::generate(env);
        client.add_source(admin, asset, &s);
        out.push_back(s);
    }
    out
}

#[test]
fn test_aggregated_price_agreeing_sources() {
    let env = Env::default();
    env.mock_all_auths();
    let (client, admin, asset) = setup(&env);
    env.ledger().set_timestamp(1_000);
    let s = add_sources(&env, &client, &admin, &asset, 3);

    client.report_price(&s.get(0).unwrap(), &asset, &PRICE);
    client.report_price(&s.get(1).unwrap(), &asset, &(PRICE + 10_000));
    client.report_price(&s.get(2).unwrap(), &asset, &(PRICE - 10_000));

    assert_eq!(client.get_aggregated_price(&asset), PRICE);
}

#[test]
fn test_single_compromised_source_extreme_move_within_freshness_cannot_move_price() {
    let env = Env::default();
    env.mock_all_auths();
    let (client, admin, asset) = setup(&env);
    env.ledger().set_timestamp(1_000);
    let s = add_sources(&env, &client, &admin, &asset, 3);

    client.report_price(&s.get(0).unwrap(), &asset, &PRICE);
    client.report_price(&s.get(1).unwrap(), &asset, &PRICE);
    // Compromised source: 100x, perfectly fresh.
    client.report_price(&s.get(2).unwrap(), &asset, &(PRICE * 100));

    assert_eq!(client.get_aggregated_price(&asset), PRICE);

    // Same for an extreme downward move.
    client.report_price(&s.get(2).unwrap(), &asset, &1i128);
    assert_eq!(client.get_aggregated_price(&asset), PRICE);
}

#[test]
fn test_compromised_source_just_inside_bound_moves_price_at_most_bound() {
    let env = Env::default();
    env.mock_all_auths();
    let (client, admin, asset) = setup(&env);
    env.ledger().set_timestamp(1_000);
    let s = add_sources(&env, &client, &admin, &asset, 3);

    let bound = client.get_max_deviation_bps() as i128;
    assert_eq!(bound, DEFAULT_MAX_DEVIATION_BPS as i128);
    let max_in = PRICE + PRICE * bound / 10_000;

    client.report_price(&s.get(0).unwrap(), &asset, &PRICE);
    client.report_price(&s.get(1).unwrap(), &asset, &PRICE);
    client.report_price(&s.get(2).unwrap(), &asset, &max_in);

    let got = client.get_aggregated_price(&asset);
    assert!(got >= PRICE && got <= max_in);

    // One unit past the bound is excluded entirely.
    client.report_price(&s.get(2).unwrap(), &asset, &(max_in + 1_000));
    assert_eq!(client.get_aggregated_price(&asset), PRICE);
}

#[test]
fn test_all_sources_disagree_fails_closed() {
    let env = Env::default();
    env.mock_all_auths();
    let (client, admin, asset) = setup(&env);
    env.ledger().set_timestamp(1_000);
    let s = add_sources(&env, &client, &admin, &asset, 3);

    client.report_price(&s.get(0).unwrap(), &asset, &PRICE);
    client.report_price(&s.get(1).unwrap(), &asset, &(PRICE * 2));
    client.report_price(&s.get(2).unwrap(), &asset, &(PRICE * 4));

    assert_eq!(
        client.try_get_aggregated_price(&asset),
        Err(Ok(PricingAdapterError::SourcesDisagree))
    );
}

#[test]
fn test_two_diverging_sources_fail_closed() {
    let env = Env::default();
    env.mock_all_auths();
    let (client, admin, asset) = setup(&env);
    env.ledger().set_timestamp(1_000);
    let s = add_sources(&env, &client, &admin, &asset, 2);

    client.report_price(&s.get(0).unwrap(), &asset, &PRICE);
    client.report_price(&s.get(1).unwrap(), &asset, &(PRICE * 10));

    assert_eq!(
        client.try_get_aggregated_price(&asset),
        Err(Ok(PricingAdapterError::SourcesDisagree))
    );
}

#[test]
fn test_single_fresh_source_is_insufficient() {
    let env = Env::default();
    env.mock_all_auths();
    let (client, admin, asset) = setup(&env);
    env.ledger().set_timestamp(1_000);
    let s = add_sources(&env, &client, &admin, &asset, 3);

    client.report_price(&s.get(0).unwrap(), &asset, &(PRICE * 100));

    assert_eq!(
        client.try_get_aggregated_price(&asset),
        Err(Ok(PricingAdapterError::InsufficientSources))
    );
}

#[test]
fn test_stale_sources_are_ignored_in_aggregation() {
    let env = Env::default();
    env.mock_all_auths();
    let (client, admin, asset) = setup(&env);
    env.ledger().set_timestamp(1_000);
    let s = add_sources(&env, &client, &admin, &asset, 3);

    client.report_price(&s.get(0).unwrap(), &asset, &PRICE);
    env.ledger().set_timestamp(1_000 + DEFAULT_MAX_PRICE_AGE + 1);
    client.report_price(&s.get(1).unwrap(), &asset, &PRICE);
    client.report_price(&s.get(2).unwrap(), &asset, &PRICE);
    assert_eq!(client.get_aggregated_price(&asset), PRICE);

    // Only one source remains fresh.
    env.ledger()
        .set_timestamp(1_000 + 2 * DEFAULT_MAX_PRICE_AGE + 2);
    client.report_price(&s.get(0).unwrap(), &asset, &PRICE);
    assert_eq!(
        client.try_get_aggregated_price(&asset),
        Err(Ok(PricingAdapterError::InsufficientSources))
    );
}

#[test]
fn test_custom_deviation_bound_is_enforced() {
    let env = Env::default();
    env.mock_all_auths();
    let (client, admin, asset) = setup(&env);
    env.ledger().set_timestamp(1_000);
    let s = add_sources(&env, &client, &admin, &asset, 3);

    client.set_max_deviation_bps(&admin, &100u32); // 1%
    assert_eq!(client.get_max_deviation_bps(), 100u32);

    client.report_price(&s.get(0).unwrap(), &asset, &PRICE);
    client.report_price(&s.get(1).unwrap(), &asset, &PRICE);
    // +2% is inside the default 5% bound but outside the 1% bound.
    client.report_price(&s.get(2).unwrap(), &asset, &(PRICE + PRICE / 50));
    assert_eq!(client.get_aggregated_price(&asset), PRICE);

    assert_eq!(
        client.try_set_max_deviation_bps(&admin, &0u32),
        Err(Ok(PricingAdapterError::InvalidDeviationBound))
    );
    assert_eq!(
        client.try_set_max_deviation_bps(&admin, &10_001u32),
        Err(Ok(PricingAdapterError::InvalidDeviationBound))
    );
}

#[test]
fn test_source_management_and_authorization() {
    let env = Env::default();
    env.mock_all_auths();
    let (client, admin, asset) = setup(&env);
    let intruder = Address::generate(&env);
    let unregistered = Address::generate(&env);
    let s = add_sources(&env, &client, &admin, &asset, 1);
    let src = s.get(0).unwrap();

    assert_eq!(
        client.try_add_source(&intruder, &asset, &unregistered),
        Err(Ok(PricingAdapterError::Unauthorized))
    );
    assert_eq!(
        client.try_add_source(&admin, &asset, &src),
        Err(Ok(PricingAdapterError::SourceAlreadyRegistered))
    );
    assert_eq!(
        client.try_report_price(&unregistered, &asset, &PRICE),
        Err(Ok(PricingAdapterError::SourceNotRegistered))
    );
    assert_eq!(
        client.try_report_price(&src, &asset, &0i128),
        Err(Ok(PricingAdapterError::InvalidPrice))
    );
    assert_eq!(
        client.try_set_max_deviation_bps(&intruder, &100u32),
        Err(Ok(PricingAdapterError::Unauthorized))
    );

    client.remove_source(&admin, &asset, &src);
    assert_eq!(client.get_sources(&asset).len(), 0);
    assert_eq!(
        client.try_remove_source(&admin, &asset, &src),
        Err(Ok(PricingAdapterError::SourceNotRegistered))
    );
}

#[test]
fn test_source_cap() {
    let env = Env::default();
    env.mock_all_auths();
    let (client, admin, asset) = setup(&env);
    add_sources(&env, &client, &admin, &asset, MAX_SOURCES);
    let extra = Address::generate(&env);
    assert_eq!(
        client.try_add_source(&admin, &asset, &extra),
        Err(Ok(PricingAdapterError::TooManySources))
    );
}
