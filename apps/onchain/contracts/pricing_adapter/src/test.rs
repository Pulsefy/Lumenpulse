use super::*;
use crate::LEDGER_THRESHOLD;
use soroban_sdk::{
    testutils::{Address as _, Ledger},
    Env, Vec,
};

#[test]
fn test_initialization() {
    let env = Env::default();
    env.mock_all_auths();
    let admin = Address::generate(&env);

    let contract_id = env.register(PricingAdapterContract, ());
    let client = PricingAdapterContractClient::new(&env, &contract_id);

    client.initialize(&admin);

    let res = client.try_initialize(&admin);
    assert!(res.is_err() || res.unwrap().is_err());
}

fn setup<'a>(env: &Env) -> (PricingAdapterContractClient<'a>, Address, Address) {
    let admin = Address::generate(env);
    let asset = Address::generate(env);
    let contract_id = env.register(PricingAdapterContract, ());
    let client = PricingAdapterContractClient::new(env, &contract_id);
    client.initialize(&admin);
    (client, admin, asset)
}

#[test]
fn test_set_and_get_price() {
    let env = Env::default();
    env.mock_all_auths();
    let (client, admin, asset) = setup(&env);

    let sources = soroban_sdk::vec![&env, 0u32];
    client.set_sources(&admin, &asset, &sources);

    let price: i128 = 10_000_000;
    let asset_decimals: u32 = 7;
    client.set_price(&admin, &asset, &0, &price, &asset_decimals);

    let retrieved = client.get_price(&asset);
    assert_eq!(retrieved.price, price);
    assert_eq!(retrieved.source, 0);
}

#[test]
fn test_multiple_sources_fallback() {
    let env = Env::default();
    env.mock_all_auths();
    let (client, admin, asset) = setup(&env);

    let sources = soroban_sdk::vec![&env, 1u32, 2, 3];
    client.set_sources(&admin, &asset, &sources);

    env.ledger().set_timestamp(1_000);
    // Source 1 is fresh but invalidated
    client.set_price(&admin, &asset, &1, &10_000_000i128, &7u32);
    client.invalidate_price(&admin, &asset, &1);

    // Source 2 is stale (timestamp 100, age 900 > default max)
    // Actually we need to set timestamp in ledger
    // We can just set its timestamp to 0 by changing ledger before setting
    env.ledger().set_timestamp(100);
    client.set_price(&admin, &asset, &2, &11_000_000i128, &7u32);

    env.ledger().set_timestamp(1_000 + DEFAULT_MAX_PRICE_AGE + 1);
    
    // Source 3 is fresh and valid
    env.ledger().set_timestamp(2_000 + DEFAULT_MAX_PRICE_AGE);
    client.set_price(&admin, &asset, &3, &12_000_000i128, &7u32);
    
    env.ledger().set_timestamp(2_000 + DEFAULT_MAX_PRICE_AGE + 10);
    
    // Now get price, it should fallback to source 3
    let retrieved = client.get_price(&asset);
    assert_eq!(retrieved.price, 12_000_000i128);
    assert_eq!(retrieved.source, 3);
}

#[test]
fn test_all_sources_exhausted() {
    let env = Env::default();
    env.mock_all_auths();
    let (client, admin, asset) = setup(&env);

    let sources = soroban_sdk::vec![&env, 1u32, 2];
    client.set_sources(&admin, &asset, &sources);

    env.ledger().set_timestamp(1_000);
    client.set_price(&admin, &asset, &1, &10_000_000i128, &7u32);
    client.invalidate_price(&admin, &asset, &1);

    env.ledger().set_timestamp(1_000);
    client.set_price(&admin, &asset, &2, &11_000_000i128, &7u32);

    // Move time so source 2 is stale
    env.ledger().set_timestamp(1_000 + DEFAULT_MAX_PRICE_AGE + 1);

    assert_eq!(
        client.try_get_price(&asset),
        Err(Ok(PricingAdapterError::NoValidSource))
    );
}

#[test]
fn test_normalize_amount() {
    let env = Env::default();
    env.mock_all_auths();
    let (client, admin, asset) = setup(&env);

    let sources = soroban_sdk::vec![&env, 0u32];
    client.set_sources(&admin, &asset, &sources);

    let eth_price: i128 = 3000 * 10_000_000;
    let eth_decimals: u32 = 18;
    client.set_price(&admin, &asset, &0, &eth_price, &eth_decimals);

    let amount: i128 = 2 * 1_000_000_000_000_000_000;
    let normalized = client.normalize_amount(&asset, &amount);

    let expected: i128 = 6000 * 10_000_000;
    assert_eq!(normalized, expected);
}

#[test]
fn test_invalidate_price_clears_on_new_set() {
    let env = Env::default();
    env.mock_all_auths();
    let (client, admin, asset) = setup(&env);
    
    let sources = soroban_sdk::vec![&env, 1u32];
    client.set_sources(&admin, &asset, &sources);

    env.ledger().set_timestamp(1_000);
    client.set_price(&admin, &asset, &1, &10_000_000i128, &7u32);
    client.invalidate_price(&admin, &asset, &1);

    assert_eq!(client.get_price_state(&asset, &1), PriceState::Invalidated);

    client.set_price(&admin, &asset, &1, &12_000_000i128, &7u32);

    assert_eq!(client.get_price_state(&asset, &1), PriceState::Fresh);
    assert_eq!(client.get_price(&asset).price, 12_000_000i128);
}
