extern crate std;

use crate::storage::WeightMode;
use crate::{ProjectRegistryContract, ProjectRegistryContractClient};
use soroban_sdk::{symbol_short, testutils::Address as _, Address, Bytes, Env};

fn record(env: &Env, entrypoint: &str) {
    let cost = env.cost_estimate().resources();
    std::println!(
        "SOROBAN_COST_BENCHMARK {{\"contract\":\"project_registry\",\"entrypoint\":\"{entrypoint}\",\"cpu_instructions\":{},\"ledger_reads\":{},\"ledger_writes\":{}}}",
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
    let owner = Address::generate(&env);
    let voter = Address::generate(&env);
    let id = env.register(ProjectRegistryContract, ());
    let client = ProjectRegistryContractClient::new(&env, &id);

    client.initialize(&admin, &100, &WeightMode::Flat, &None, &None, &1);
    record(&env, "initialize");
    client.register_project(&owner, &1, &symbol_short!("one"));
    record(&env, "register_project");
    let _ = client.cast_vote(&voter, &1, &true);
    record(&env, "cast_vote");
    client.archive_project(&admin, &1);
    record(&env, "archive_project");
    client.register_project(&owner, &2, &symbol_short!("two"));
    let _ = client.cast_vote(&Address::generate(&env), &2, &true);
    client.delist_project(&admin, &2);
    record(&env, "delist_project");
    client.register_project(&owner, &3, &symbol_short!("three"));
    client.override_verification(&admin, &3, &true);
    record(&env, "override_verification");
    let _ = client.get_project(&3);
    record(&env, "get_project");
    let _ = client.is_verified(&3);
    record(&env, "is_verified");
    let _ = client.has_voted(&1, &voter);
    record(&env, "has_voted");
    let _ = client.get_voter_weight(&1, &voter);
    record(&env, "get_voter_weight");
    let _ = client.get_config();
    record(&env, "get_config");
    let _ = client.get_admin();
    record(&env, "get_admin");
    client.update_config(&admin, &200, &2);
    record(&env, "update_config");
    client.pause(&admin);
    record(&env, "pause");
    client.unpause(&admin);
    record(&env, "unpause");
    client.set_admin(&admin, &new_admin);
    record(&env, "set_admin");
    let wasm = Bytes::from_slice(
        &env,
        include_bytes!("../../upgradable-contract/src/mock/upgradable_contract.wasm"),
    );
    let wasm_hash = env.deployer().upload_contract_wasm(wasm);
    client.upgrade(&new_admin, &wasm_hash);
    record(&env, "upgrade");
}
