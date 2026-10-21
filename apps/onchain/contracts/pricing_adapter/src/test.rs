use super::*;
use crate::LEDGER_THRESHOLD;
use soroban_sdk::{
    testutils::{Address as _, Events, Ledger},
    vec, Env, IntoVal, Symbol, Vec,
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

// Ordered price sources and fallback (issue #1235).

const BACKUP_SOURCE: u32 = 1;

/// `setup`, with a backup source listed after the primary one.
fn setup_with_backup<'a>(env: &Env) -> (PricingAdapterContractClient<'a>, Address, Address) {
    let (client, admin, asset) = setup(env);
    client.set_price_sources(&admin, &vec![env, PRIMARY_SOURCE, BACKUP_SOURCE]);
    (client, admin, asset)
}

/// Whether the most recent invocation published a fallback event.
/// `env.events().all()` only reflects that invocation, so this has to run
/// straight after the read under test.
fn fallback_event_emitted(env: &Env, contract_id: &Address) -> bool {
    let events = env.events().all();
    events.iter().any(|(emitter, topics, _)| {
        emitter == *contract_id
            && topics.get(0).is_some_and(|topic| {
                let name: Symbol = topic.into_val(env);
                name == Symbol::new(env, "price_source_fallback_event")
            })
    })
}

#[test]
fn test_existing_deployment_reads_primary_source_by_default() {
    let env = test_env();
    let (client, admin, asset) = setup(&env);

    assert_eq!(client.get_price_sources(), vec![&env, PRIMARY_SOURCE]);

    env.ledger().set_timestamp(1_000);
    client.set_price(&admin, &asset, &10_000_000i128, &7u32);
    env.ledger().set_timestamp(1_045);

    assert_eq!(
        client.get_price_quote(&asset),
        PriceQuote {
            price: 10_000_000,
            source: PRIMARY_SOURCE,
            age_seconds: 45,
        }
    );
    assert!(!fallback_event_emitted(&env, &client.address));
}

#[test]
fn test_healthy_primary_answers_before_backup() {
    let env = test_env();
    let (client, admin, asset) = setup_with_backup(&env);

    env.ledger().set_timestamp(1_000);
    client.set_price(&admin, &asset, &10_000_000i128, &7u32);
    client.set_source_price(&admin, &BACKUP_SOURCE, &asset, &10_400_000i128, &7u32);
    env.ledger().set_timestamp(1_060);

    assert_eq!(
        client.get_price_quote(&asset),
        PriceQuote {
            price: 10_000_000,
            source: PRIMARY_SOURCE,
            age_seconds: 60,
        }
    );
    assert!(!fallback_event_emitted(&env, &client.address));
    assert_eq!(client.get_price(&asset), 10_000_000i128);
}

#[test]
fn test_stale_primary_falls_back_to_fresh_backup() {
    let env = test_env();
    let (client, admin, asset) = setup_with_backup(&env);

    env.ledger().set_timestamp(1_000);
    client.set_price(&admin, &asset, &10_000_000i128, &7u32);
    env.ledger().set_timestamp(4_000);
    client.set_source_price(&admin, &BACKUP_SOURCE, &asset, &10_500_000i128, &7u32);

    // 1_000 + DEFAULT_MAX_PRICE_AGE + 1: the primary is one second past its
    // window, the backup price is 601 seconds old.
    env.ledger().set_timestamp(4_601);

    assert_eq!(client.get_price_state(&asset), PriceState::Stale);
    assert_eq!(
        client.get_price_quote(&asset),
        PriceQuote {
            price: 10_500_000,
            source: BACKUP_SOURCE,
            age_seconds: 601,
        }
    );
    assert!(fallback_event_emitted(&env, &client.address));

    // `get_price` and `normalize_amount` follow the same rule.
    assert_eq!(client.get_price(&asset), 10_500_000i128);
    assert_eq!(
        client.normalize_amount(&asset, &10_000_000i128),
        10_500_000i128
    );
}

#[test]
fn test_all_sources_stale_reverts_with_sources_exhausted() {
    let env = test_env();
    let (client, admin, asset) = setup_with_backup(&env);

    env.ledger().set_timestamp(1_000);
    client.set_price(&admin, &asset, &10_000_000i128, &7u32);
    client.set_source_price(&admin, &BACKUP_SOURCE, &asset, &10_500_000i128, &7u32);
    env.ledger().set_timestamp(4_601);

    assert_eq!(
        client.try_get_price_quote(&asset),
        Err(Ok(PricingAdapterError::PriceSourcesExhausted))
    );
    assert_eq!(
        client.try_get_price(&asset),
        Err(Ok(PricingAdapterError::PriceSourcesExhausted))
    );
    assert_eq!(
        client.try_normalize_amount(&asset, &5_000_000i128),
        Err(Ok(PricingAdapterError::PriceSourcesExhausted))
    );
}

#[test]
fn test_invalidated_primary_falls_back_to_backup() {
    let env = test_env();
    let (client, admin, asset) = setup_with_backup(&env);

    env.ledger().set_timestamp(1_000);
    client.set_price(&admin, &asset, &10_000_000i128, &7u32);
    client.set_source_price(&admin, &BACKUP_SOURCE, &asset, &9_900_000i128, &7u32);
    client.invalidate_price(&admin, &asset);

    assert_eq!(client.get_price_state(&asset), PriceState::Invalidated);
    assert_eq!(
        client.get_price_quote(&asset),
        PriceQuote {
            price: 9_900_000,
            source: BACKUP_SOURCE,
            age_seconds: 0,
        }
    );
    assert!(fallback_event_emitted(&env, &client.address));

    // With the backup invalidated too, no source is left.
    client.invalidate_source_price(&admin, &BACKUP_SOURCE, &asset);
    assert_eq!(
        client.try_get_price(&asset),
        Err(Ok(PricingAdapterError::PriceSourcesExhausted))
    );

    // A new primary price clears its flag, and the primary answers again.
    client.set_price(&admin, &asset, &10_100_000i128, &7u32);
    assert_eq!(client.get_price_quote(&asset).source, PRIMARY_SOURCE);
}

#[test]
fn test_admin_reorders_price_sources() {
    let env = test_env();
    let (client, admin, asset) = setup_with_backup(&env);

    client.set_price(&admin, &asset, &10_000_000i128, &7u32);
    client.set_source_price(&admin, &BACKUP_SOURCE, &asset, &10_200_000i128, &7u32);
    assert_eq!(client.get_price(&asset), 10_000_000i128);

    client.set_price_sources(&admin, &vec![&env, BACKUP_SOURCE, PRIMARY_SOURCE]);
    assert_eq!(
        client.get_price_sources(),
        vec![&env, BACKUP_SOURCE, PRIMARY_SOURCE]
    );

    // Both sources are fresh: the one now listed first answers, and that is
    // not a fallback.
    let quote = client.get_price_quote(&asset);
    assert!(!fallback_event_emitted(&env, &client.address));
    assert_eq!(quote.source, BACKUP_SOURCE);
    assert_eq!(quote.price, 10_200_000i128);
}

#[test]
fn test_price_source_admin_calls_reject_non_admin() {
    let env = test_env();
    let (client, _admin, asset) = setup(&env);
    let intruder = Address::generate(&env);
    let price: i128 = 10_000_000;

    assert_eq!(
        client.try_set_price_sources(&intruder, &vec![&env, BACKUP_SOURCE]),
        Err(Ok(PricingAdapterError::Unauthorized))
    );
    assert_eq!(
        client.try_set_source_price(&intruder, &BACKUP_SOURCE, &asset, &price, &7u32),
        Err(Ok(PricingAdapterError::Unauthorized))
    );
    assert_eq!(
        client.try_invalidate_source_price(&intruder, &BACKUP_SOURCE, &asset),
        Err(Ok(PricingAdapterError::Unauthorized))
    );
    assert_eq!(client.get_price_sources(), vec![&env, PRIMARY_SOURCE]);
}

#[test]
fn test_set_price_sources_rejects_invalid_lists() {
    let env = test_env();
    let (client, admin, _asset) = setup(&env);

    assert_eq!(
        client.try_set_price_sources(&admin, &Vec::new(&env)),
        Err(Ok(PricingAdapterError::InvalidPriceSources))
    );
    assert_eq!(
        client.try_set_price_sources(&admin, &vec![&env, BACKUP_SOURCE, BACKUP_SOURCE]),
        Err(Ok(PricingAdapterError::InvalidPriceSources))
    );
    assert_eq!(
        client.try_set_price_sources(&admin, &vec![&env, 0, 1, 2, 3, 4, 5]),
        Err(Ok(PricingAdapterError::InvalidPriceSources))
    );

    // `MAX_PRICE_SOURCES` distinct ids are accepted, in any order.
    client.set_price_sources(&admin, &vec![&env, 4, 3, 2, 1, 0]);
    assert_eq!(client.get_price_sources().len(), MAX_PRICE_SOURCES);
}

#[test]
fn test_unpriced_asset_reports_price_not_found_with_several_sources() {
    let env = test_env();
    let (client, _admin, asset) = setup_with_backup(&env);

    assert_eq!(
        client.try_get_price_quote(&asset),
        Err(Ok(PricingAdapterError::PriceNotFound))
    );
}

#[test]
fn test_ttl_extended_across_reads_answered_by_backup() {
    let env = test_env();
    let (client, admin, asset) = setup_with_backup(&env);

    // No primary price for this asset, so every read falls back.
    client.set_source_price(&admin, &BACKUP_SOURCE, &asset, &10_000_000i128, &7u32);

    env.ledger().set_sequence_number(LEDGER_THRESHOLD + 1);
    assert_eq!(client.get_price(&asset), 10_000_000i128);
    assert_eq!(client.get_asset_decimals(&asset), 7u32);

    env.ledger().set_sequence_number(2 * LEDGER_THRESHOLD + 2);
    let quote = client.get_price_quote(&asset);
    assert!(fallback_event_emitted(&env, &client.address));
    assert_eq!(quote.source, BACKUP_SOURCE);
    assert_eq!(
        client.get_price_sources(),
        vec![&env, PRIMARY_SOURCE, BACKUP_SOURCE]
    );
}
