extern crate std;

use crate::{FeatureFlagsContract, FeatureFlagsContractClient};
use soroban_sdk::{symbol_short, testutils::Address as _, Address, Env};

fn record(env: &Env, entrypoint: &str) {
    let cost = env.cost_estimate().resources();
    std::println!(
        "SOROBAN_COST_BENCHMARK {{\"contract\":\"feature_flags\",\"entrypoint\":\"{entrypoint}\",\"cpu_instructions\":{},\"ledger_reads\":{},\"ledger_writes\":{}}}",
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
    let new_admin = Address::generate(&env);
    let id = env.register(FeatureFlagsContract, ());
    let client = FeatureFlagsContractClient::new(&env, &id);
    let flag = symbol_short!("payments");

    client.initialize(&admin);
    record(&env, "initialize");
    client.set_flag(&admin, &flag, &true);
    record(&env, "set_flag");
    assert!(client.is_enabled(&flag));
    record(&env, "is_enabled");
    let _ = client.get_flag(&flag);
    record(&env, "get_flag");
    let _ = client.list_flags();
    record(&env, "list_flags");
    let _ = client.get_admin();
    record(&env, "get_admin");
    client.set_admin(&admin, &new_admin);
    record(&env, "set_admin");
    client.pause(&new_admin);
    record(&env, "pause");
    client.unpause(&new_admin);
    record(&env, "unpause");
}
