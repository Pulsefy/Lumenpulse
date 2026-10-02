extern crate std;

use crate::{ContractRegistry, ContractRegistryClient};
use soroban_sdk::{testutils::Address as _, Address, Env, Symbol};

fn record(env: &Env, entrypoint: &str) {
    let cost = env.cost_estimate().resources();
    std::println!(
        "SOROBAN_COST_BENCHMARK {{\"contract\":\"contract_registry\",\"entrypoint\":\"{entrypoint}\",\"cpu_instructions\":{},\"ledger_reads\":{},\"ledger_writes\":{}}}",
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
    let target = Address::generate(&env);
    let replacement = Address::generate(&env);
    let id = env.register(ContractRegistry, ());
    let client = ContractRegistryClient::new(&env, &id);
    let key = Symbol::new(&env, "vault");
    let network = Symbol::new(&env, "testnet");

    client.initialize(&admin);
    record(&env, "initialize");
    client.pause(&admin);
    record(&env, "pause");
    client.unpause(&admin);
    record(&env, "unpause");
    client.register_contract(&admin, &key, &target, &1, &network);
    record(&env, "register_contract");
    client.update_contract(&admin, &key, &replacement, &2, &network);
    record(&env, "update_contract");
    let _ = client.get_contract(&key);
    record(&env, "get_contract");
    let contracts = client.list_contracts();
    assert_eq!(contracts.len(), 1);
    record(&env, "list_contracts");
}
