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

// ── Fallback Price Source Tests ───────────────────────────────────────────────

fn make_source_id(env: &Env, b: u8) -> soroban_sdk::BytesN<32> {
    soroban_sdk::BytesN::from_array(env, &[b; 32])
}

/// AC-1: Primary source healthy returns primary price
#[test]
fn test_fallback_primary_healthy() {
    let env = test_env();
    let (client, admin, asset) = setup(&env);

    let source_primary = make_source_id(&env, 0x01);
    let source_secondary = make_source_id(&env, 0x02);

    // Configure fallback chain: primary → secondary
    let mut sources = soroban_sdk::Vec::new(&env);
    sources.push_back(source_primary.clone());
    sources.push_back(source_secondary.clone());
    client.set_price_sources(&admin, &asset, &sources);

    // Set prices for both sources
    env.ledger().set_timestamp(1_000);
    client.set_source_price(&admin, &asset, &source_primary, &10_000_000i128, &7u32);
    client.set_source_price(&admin, &asset, &source_secondary, &12_000_000i128, &7u32);

    // Get price with fallback should return primary
    let result = client.get_price_with_fallback(&asset);
    assert_eq!(result.price, 10_000_000i128);
    assert_eq!(result.source_id, source_primary);
    assert_eq!(result.age_seconds, 0u64);
}

/// AC-2: Primary stale with healthy fallback returns fallback price
#[test]
fn test_fallback_primary_stale_secondary_healthy() {
    let env = test_env();
    let (client, admin, asset) = setup(&env);

    let source_primary = make_source_id(&env, 0x01);
    let source_secondary = make_source_id(&env, 0x02);

    let mut sources = soroban_sdk::Vec::new(&env);
    sources.push_back(source_primary.clone());
    sources.push_back(source_secondary.clone());
    client.set_price_sources(&admin, &asset, &sources);

    // Set primary price at t=1000, secondary at t=2000
    env.ledger().set_timestamp(1_000);
    client.set_source_price(&admin, &asset, &source_primary, &10_000_000i128, &7u32);

    env.ledger().set_timestamp(2_000);
    client.set_source_price(&admin, &asset, &source_secondary, &12_000_000i128, &7u32);

    // Advance time so primary is stale but secondary is fresh
    env.ledger().set_timestamp(2_000 + DEFAULT_MAX_PRICE_AGE + 1);

    // Primary is stale
    assert_eq!(
        client.get_source_price_state(&asset, &source_primary),
        PriceState::Stale
    );
    // Secondary is fresh
    assert_eq!(
        client.get_source_price_state(&asset, &source_secondary),
        PriceState::Fresh
    );

    // Get price with fallback should return secondary
    let result = client.get_price_with_fallback(&asset);
    assert_eq!(result.price, 12_000_000i128);
    assert_eq!(result.source_id, source_secondary);
    assert_eq!(result.age_seconds, DEFAULT_MAX_PRICE_AGE + 1);
}

/// AC-3: Primary invalidated with healthy fallback returns fallback price
#[test]
fn test_fallback_primary_invalidated_secondary_healthy() {
    let env = test_env();
    let (client, admin, asset) = setup(&env);

    let source_primary = make_source_id(&env, 0x01);
    let source_secondary = make_source_id(&env, 0x02);

    let mut sources = soroban_sdk::Vec::new(&env);
    sources.push_back(source_primary.clone());
    sources.push_back(source_secondary.clone());
    client.set_price_sources(&admin, &asset, &sources);

    env.ledger().set_timestamp(1_000);
    client.set_source_price(&admin, &asset, &source_primary, &10_000_000i128, &7u32);
    client.set_source_price(&admin, &asset, &source_secondary, &12_000_000i128, &7u32);

    // Invalidate primary source
    client.invalidate_source_price(&admin, &asset, &source_primary);

    assert_eq!(
        client.get_source_price_state(&asset, &source_primary),
        PriceState::Invalidated
    );
    assert_eq!(
        client.get_source_price_state(&asset, &source_secondary),
        PriceState::Fresh
    );

    // Should fall back to secondary
    let result = client.get_price_with_fallback(&asset);
    assert_eq!(result.price, 12_000_000i128);
    assert_eq!(result.source_id, source_secondary);
}

/// AC-4: All sources stale reverts with AllSourcesExhausted
#[test]
fn test_fallback_all_sources_stale() {
    let env = test_env();
    let (client, admin, asset) = setup(&env);

    let source_primary = make_source_id(&env, 0x01);
    let source_secondary = make_source_id(&env, 0x02);

    let mut sources = soroban_sdk::Vec::new(&env);
    sources.push_back(source_primary.clone());
    sources.push_back(source_secondary.clone());
    client.set_price_sources(&admin, &asset, &sources);

    // Set both prices at t=1000
    env.ledger().set_timestamp(1_000);
    client.set_source_price(&admin, &asset, &source_primary, &10_000_000i128, &7u32);
    client.set_source_price(&admin, &asset, &source_secondary, &12_000_000i128, &7u32);

    // Advance time so both are stale
    env.ledger()
        .set_timestamp(1_000 + DEFAULT_MAX_PRICE_AGE + 1);

    assert_eq!(
        client.get_source_price_state(&asset, &source_primary),
        PriceState::Stale
    );
    assert_eq!(
        client.get_source_price_state(&asset, &source_secondary),
        PriceState::Stale
    );

    // Must revert with AllSourcesExhausted (not return a default)
    assert_eq!(
        client.try_get_price_with_fallback(&asset),
        Err(Ok(PricingAdapterError::AllSourcesExhausted))
    );
}

/// AC-5: All sources invalidated reverts with AllSourcesExhausted
#[test]
fn test_fallback_all_sources_invalidated() {
    let env = test_env();
    let (client, admin, asset) = setup(&env);

    let source_primary = make_source_id(&env, 0x01);
    let source_secondary = make_source_id(&env, 0x02);

    let mut sources = soroban_sdk::Vec::new(&env);
    sources.push_back(source_primary.clone());
    sources.push_back(source_secondary.clone());
    client.set_price_sources(&admin, &asset, &sources);

    env.ledger().set_timestamp(1_000);
    client.set_source_price(&admin, &asset, &source_primary, &10_000_000i128, &7u32);
    client.set_source_price(&admin, &asset, &source_secondary, &12_000_000i128, &7u32);

    // Invalidate both sources
    client.invalidate_source_price(&admin, &asset, &source_primary);
    client.invalidate_source_price(&admin, &asset, &source_secondary);

    assert_eq!(
        client.get_source_price_state(&asset, &source_primary),
        PriceState::Invalidated
    );
    assert_eq!(
        client.get_source_price_state(&asset, &source_secondary),
        PriceState::Invalidated
    );

    // Must revert with AllSourcesExhausted
    assert_eq!(
        client.try_get_price_with_fallback(&asset),
        Err(Ok(PricingAdapterError::AllSourcesExhausted))
    );
}

/// AC-6: Multiple fallbacks - skip stale primary and stale secondary, use tertiary
#[test]
fn test_fallback_chain_multiple_sources() {
    let env = test_env();
    let (client, admin, asset) = setup(&env);

    let source_1 = make_source_id(&env, 0x01);
    let source_2 = make_source_id(&env, 0x02);
    let source_3 = make_source_id(&env, 0x03);

    let mut sources = soroban_sdk::Vec::new(&env);
    sources.push_back(source_1.clone());
    sources.push_back(source_2.clone());
    sources.push_back(source_3.clone());
    client.set_price_sources(&admin, &asset, &sources);

    // Set all prices at different times
    env.ledger().set_timestamp(1_000);
    client.set_source_price(&admin, &asset, &source_1, &10_000_000i128, &7u32);

    env.ledger().set_timestamp(2_000);
    client.set_source_price(&admin, &asset, &source_2, &11_000_000i128, &7u32);

    env.ledger().set_timestamp(3_000);
    client.set_source_price(&admin, &asset, &source_3, &12_000_000i128, &7u32);

    // Advance time so source_1 and source_2 are stale, but source_3 is fresh
    env.ledger().set_timestamp(3_000 + DEFAULT_MAX_PRICE_AGE + 1);

    assert_eq!(
        client.get_source_price_state(&asset, &source_1),
        PriceState::Stale
    );
    assert_eq!(
        client.get_source_price_state(&asset, &source_2),
        PriceState::Stale
    );
    assert_eq!(
        client.get_source_price_state(&asset, &source_3),
        PriceState::Fresh
    );

    // Should return source_3
    let result = client.get_price_with_fallback(&asset);
    assert_eq!(result.price, 12_000_000i128);
    assert_eq!(result.source_id, source_3);
}

/// AC-7: No sources configured falls back to legacy single-source behavior
#[test]
fn test_fallback_no_sources_uses_legacy() {
    let env = test_env();
    let (client, admin, asset) = setup(&env);

    // Set price using legacy set_price (no sources configured)
    env.ledger().set_timestamp(1_000);
    client.set_price(&admin, &asset, &10_000_000i128, &7u32);

    // get_price_with_fallback should fall back to legacy behavior
    let result = client.get_price_with_fallback(&asset);
    assert_eq!(result.price, 10_000_000i128);
    // Default source ID (all zeros)
    assert_eq!(result.source_id, make_source_id(&env, 0x00));
    assert_eq!(result.age_seconds, 0u64);
}

/// AC-8: Returned price identifies source and age correctly
#[test]
fn test_fallback_result_includes_source_and_age() {
    let env = test_env();
    let (client, admin, asset) = setup(&env);

    let source_primary = make_source_id(&env, 0xAA);

    let mut sources = soroban_sdk::Vec::new(&env);
    sources.push_back(source_primary.clone());
    client.set_price_sources(&admin, &asset, &sources);

    env.ledger().set_timestamp(5_000);
    client.set_source_price(&admin, &asset, &source_primary, &15_000_000i128, &7u32);

    // Advance time by 100 seconds
    env.ledger().set_timestamp(5_100);

    let result = client.get_price_with_fallback(&asset);
    assert_eq!(result.price, 15_000_000i128);
    assert_eq!(result.source_id, source_primary);
    assert_eq!(result.age_seconds, 100u64);
}

/// AC-9: Setting price on invalidated source clears invalidation flag
#[test]
fn test_fallback_set_source_price_clears_invalidation() {
    let env = test_env();
    let (client, admin, asset) = setup(&env);

    let source_id = make_source_id(&env, 0x01);

    let mut sources = soroban_sdk::Vec::new(&env);
    sources.push_back(source_id.clone());
    client.set_price_sources(&admin, &asset, &sources);

    env.ledger().set_timestamp(1_000);
    client.set_source_price(&admin, &asset, &source_id, &10_000_000i128, &7u32);

    // Invalidate
    client.invalidate_source_price(&admin, &asset, &source_id);
    assert_eq!(
        client.get_source_price_state(&asset, &source_id),
        PriceState::Invalidated
    );

    // Set new price (should clear invalidation)
    client.set_source_price(&admin, &asset, &source_id, &11_000_000i128, &7u32);
    assert_eq!(
        client.get_source_price_state(&asset, &source_id),
        PriceState::Fresh
    );

    let result = client.get_price_with_fallback(&asset);
    assert_eq!(result.price, 11_000_000i128);
}

/// AC-10: Empty source list after configuration falls back to legacy
#[test]
fn test_fallback_empty_sources_list() {
    let env = test_env();
    let (client, admin, asset) = setup(&env);

    // Configure with empty sources
    let sources = soroban_sdk::Vec::new(&env);
    client.set_price_sources(&admin, &asset, &sources);

    // Set legacy price
    env.ledger().set_timestamp(1_000);
    client.set_price(&admin, &asset, &8_000_000i128, &7u32);

    // Should use legacy behavior
    let result = client.get_price_with_fallback(&asset);
    assert_eq!(result.price, 8_000_000i128);
}

/// AC-11: Distinct error when all sources exhausted vs price not found
#[test]
fn test_fallback_distinct_error_all_sources_exhausted() {
    let env = test_env();
    let (client, admin, asset) = setup(&env);

    let source_id = make_source_id(&env, 0x01);
    let mut sources = soroban_sdk::Vec::new(&env);
    sources.push_back(source_id.clone());
    client.set_price_sources(&admin, &asset, &sources);

    env.ledger().set_timestamp(1_000);
    client.set_source_price(&admin, &asset, &source_id, &10_000_000i128, &7u32);

    // Make it stale
    env.ledger()
        .set_timestamp(1_000 + DEFAULT_MAX_PRICE_AGE + 1);

    // AllSourcesExhausted is distinct from PriceNotFound
    let result = client.try_get_price_with_fallback(&asset);
    assert_eq!(result, Err(Ok(PricingAdapterError::AllSourcesExhausted)));

    // For comparison, asset with no data at all gives PriceNotFound
    let unknown_asset = Address::generate(&env);
    assert_eq!(
        client.try_get_price_with_fallback(&unknown_asset),
        Err(Ok(PricingAdapterError::PriceNotFound))
    );
}

/// AC-12: Test authorization - only admin can set sources and source prices
#[test]
fn test_fallback_authorization_admin_only() {
    let env = test_env();
    let (client, admin, asset) = setup(&env);
    let intruder = Address::generate(&env);

    let source_id = make_source_id(&env, 0x01);
    let mut sources = soroban_sdk::Vec::new(&env);
    sources.push_back(source_id.clone());

    // Non-admin cannot set sources
    assert_eq!(
        client.try_set_price_sources(&intruder, &asset, &sources),
        Err(Ok(PricingAdapterError::Unauthorized))
    );

    // Non-admin cannot set source price
    assert_eq!(
        client.try_set_source_price(&intruder, &asset, &source_id, &10_000_000i128, &7u32),
        Err(Ok(PricingAdapterError::Unauthorized))
    );

    // Non-admin cannot invalidate source
    client.set_price_sources(&admin, &asset, &sources);
    client.set_source_price(&admin, &asset, &source_id, &10_000_000i128, &7u32);

    assert_eq!(
        client.try_invalidate_source_price(&intruder, &asset, &source_id),
        Err(Ok(PricingAdapterError::Unauthorized))
    );
}
