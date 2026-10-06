extern crate std;

use crate::{PricingAdapterContract, PricingAdapterContractClient};
use soroban_sdk::{testutils::Address as _, Address, Env};

fn record(env: &Env, entrypoint: &str) {
    let cost = env.cost_estimate().resources();
    std::println!(
        "SOROBAN_COST_BENCHMARK {{\"contract\":\"pricing_adapter\",\"entrypoint\":\"{entrypoint}\",\"cpu_instructions\":{},\"ledger_reads\":{},\"ledger_writes\":{}}}",
        cost.instructions,
        cost.memory_read_entries + cost.disk_read_entries,
        cost.write_entries,
    );
}

#[test]
fn successful_entrypoint_costs() {
    let env = Env::default();
    env.mock_all_auths();
    let admin = Address::generate(&env);
    let asset = Address::generate(&env);
    let id = env.register(PricingAdapterContract, ());
    let client = PricingAdapterContractClient::new(&env, &id);

    client.initialize(&admin);
    record(&env, "initialize");
    client.set_price(&admin, &asset, &20_000_000, &7);
    record(&env, "set_price");
    let _ = client.get_price(&asset);
    record(&env, "get_price");
    client.invalidate_price(&admin, &asset);
    record(&env, "invalidate_price");
    client.set_price(&admin, &asset, &20_000_000, &7);
    client.set_staleness_window(&admin, &7200);
    record(&env, "set_staleness_window");
    let _ = client.get_staleness_window();
    record(&env, "get_staleness_window");
    let _ = client.get_price_state(&asset);
    record(&env, "get_price_state");
    let _ = client.get_price_timestamp(&asset);
    record(&env, "get_price_timestamp");
    let _ = client.get_asset_decimals(&asset);
    record(&env, "get_asset_decimals");
    let _ = client.normalize_amount(&asset, &5_000_000);
    record(&env, "normalize_amount");
}
