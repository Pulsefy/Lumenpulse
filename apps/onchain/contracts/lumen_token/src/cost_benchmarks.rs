extern crate std;

use crate::{LumenToken, LumenTokenClient};
use soroban_sdk::{testutils::Address as _, Address, Bytes, Env, String};

fn record(env: &Env, entrypoint: &str) {
    let resources = env.cost_estimate().resources();
    std::println!(
        "SOROBAN_COST_BENCHMARK {{\"contract\":\"lumen_token\",\"entrypoint\":\"{entrypoint}\",\"cpu_instructions\":{},\"ledger_reads\":{},\"ledger_writes\":{}}}",
        resources.instructions,
        resources.memory_read_entries + resources.disk_read_entries,
        resources.write_entries,
    );
}

#[test]
fn successful_entrypoint_costs() {
    let env = Env::default();
    env.mock_all_auths();
    let admin = Address::generate(&env);
    let alice = Address::generate(&env);
    let bob = Address::generate(&env);
    let spender = Address::generate(&env);
    let contract_id = env.register(LumenToken, ());
    let client = LumenTokenClient::new(&env, &contract_id);

    let name = String::from_str(&env, "LumenPulse");
    let symbol = String::from_str(&env, "LMN");
    client.initialize(&admin, &7, &name, &symbol);
    record(&env, "initialize");
    let _ = client.contract_version();
    record(&env, "contract_version");
    let _ = client.decimals();
    record(&env, "decimals");
    let _ = client.name();
    record(&env, "name");
    let _ = client.symbol();
    record(&env, "symbol");
    client.mint(&alice, &1_000);
    record(&env, "mint");
    let _ = client.balance(&alice);
    record(&env, "balance");
    client.approve(&alice, &spender, &500, &(env.ledger().sequence() + 100));
    record(&env, "approve");
    let _ = client.allowance(&alice, &spender);
    record(&env, "allowance");
    client.transfer_from(&spender, &alice, &bob, &100);
    record(&env, "transfer_from");
    client.burn_from(&spender, &alice, &50);
    record(&env, "burn_from");
    client.transfer(&alice, &bob, &400);
    record(&env, "transfer");
    client.burn(&bob, &100);
    record(&env, "burn");
    client.freeze(&bob);
    record(&env, "freeze");
    client.unfreeze(&bob);
    record(&env, "unfreeze");
    client.set_admin(&bob);
    record(&env, "set_admin");
    assert_eq!(client.balance(&alice), 450);
    assert_eq!(client.balance(&bob), 400);
    let wasm_hash = env.deployer().upload_contract_wasm(Bytes::from_slice(
        &env,
        include_bytes!("../../upgradable-contract/src/mock/upgradable_contract.wasm"),
    ));
    client.upgrade(&bob, &wasm_hash);
    record(&env, "upgrade");
}
