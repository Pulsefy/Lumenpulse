#![cfg(test)]

use super::*;
use soroban_sdk::{testutils::Address as _, Env};

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

    // Normalized should be 2 * $3000 = $6000
    // $6000 scaled by 10^7 = 60_000 * 10^7 = 60_000_000_000
    let expected: i128 = 6000 * 10_000_000;
    assert_eq!(normalized, expected);
}
