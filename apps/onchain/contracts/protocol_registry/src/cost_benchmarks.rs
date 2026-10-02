extern crate std;

use crate::{ProtocolRegistryContract, ProtocolRegistryContractClient};
use soroban_sdk::{symbol_short, testutils::Address as _, Address, Bytes, Env};

fn record(env: &Env, entrypoint: &str) {
    let cost = env.cost_estimate().resources();
    std::println!(
        "SOROBAN_COST_BENCHMARK {{\"contract\":\"protocol_registry\",\"entrypoint\":\"{entrypoint}\",\"cpu_instructions\":{},\"ledger_reads\":{},\"ledger_writes\":{}}}",
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
    let target = Address::generate(&env);
    let updated = Address::generate(&env);
    let id = env.register(ProtocolRegistryContract, ());
    let client = ProtocolRegistryContractClient::new(&env, &id);
    let module = symbol_short!("vault");

    client.initialize(&admin);
    record(&env, "initialize");
    client.register_module(&admin, &module, &target, &1);
    record(&env, "register_module");
    client.update_module(&admin, &module, &updated, &2);
    record(&env, "update_module");
    client.deactivate_module(&admin, &module);
    record(&env, "deactivate_module");
    client.activate_module(&admin, &module);
    record(&env, "activate_module");
    let _ = client.get_module(&module);
    record(&env, "get_module");
    assert_eq!(client.resolve(&module), updated);
    record(&env, "resolve");
    let _ = client.is_active(&module);
    record(&env, "is_active");
    let _ = client.get_admin();
    record(&env, "get_admin");
    client.set_admin(&admin, &new_admin);
    record(&env, "set_admin");
    client.pause(&new_admin);
    record(&env, "pause");
    client.unpause(&new_admin);
    record(&env, "unpause");
    let wasm = Bytes::from_slice(
        &env,
        include_bytes!("../../upgradable-contract/src/mock/upgradable_contract.wasm"),
    );
    let wasm_hash = env.deployer().upload_contract_wasm(wasm);
    client.upgrade(&new_admin, &wasm_hash);
    record(&env, "upgrade");
}
