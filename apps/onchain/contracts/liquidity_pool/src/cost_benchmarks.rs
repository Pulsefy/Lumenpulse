extern crate std;

use crate::{LiquidityPoolContract, LiquidityPoolContractClient};
use soroban_sdk::{testutils::Address as _, token::StellarAssetClient, Address, Env};

fn record(env: &Env, name: &str) {
    let r = env.cost_estimate().resources();
    std::println!("SOROBAN_COST_BENCHMARK {{\"contract\":\"liquidity_pool\",\"entrypoint\":\"{name}\",\"cpu_instructions\":{},\"ledger_reads\":{},\"ledger_writes\":{}}}", r.instructions, r.memory_read_entries + r.disk_read_entries, r.write_entries);
}

#[test]
fn successful_entrypoint_costs() {
    let env = Env::default();
    env.mock_all_auths();
    let admin = Address::generate(&env);
    let user = Address::generate(&env);
    let t0 = env.register_stellar_asset_contract_v2(admin.clone());
    let t1 = env.register_stellar_asset_contract_v2(admin.clone());
    let c_id = env.register(LiquidityPoolContract, ());
    let c = LiquidityPoolContractClient::new(&env, &c_id);
    c.initialize(&admin, &t0.address(), &t1.address());
    record(&env, "initialize");
    StellarAssetClient::new(&env, &t0.address()).mint(&user, &1_000_000);
    StellarAssetClient::new(&env, &t1.address()).mint(&user, &1_000_000);
    c.add_liquidity(&user, &100_000, &100_000, &0);
    record(&env, "add_liquidity");
    c.lp_balance(&user);
    record(&env, "lp_balance");
    c.get_reserves();
    record(&env, "get_reserves");
    c.swap_exact_in(&user, &1_000, &0);
    record(&env, "swap_exact_in");
    c.get_accrued_fees();
    record(&env, "get_accrued_fees");
    let lp = c.lp_balance(&user);
    c.remove_liquidity(&user, &(lp / 2), &0, &0);
    record(&env, "remove_liquidity");
}
