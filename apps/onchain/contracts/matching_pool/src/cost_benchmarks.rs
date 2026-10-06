extern crate std;

use crate::{storage::PauseScope, MatchingPoolContract, MatchingPoolContractClient};
use soroban_sdk::{
    testutils::{Address as _, Ledger},
    token::StellarAssetClient,
    vec, Address, Bytes, Env, Symbol,
};

fn record(env: &Env, name: &str) {
    let r = env.cost_estimate().resources();
    std::println!("SOROBAN_COST_BENCHMARK {{\"contract\":\"matching_pool\",\"entrypoint\":\"{name}\",\"cpu_instructions\":{},\"ledger_reads\":{},\"ledger_writes\":{}}}",r.instructions,r.memory_read_entries+r.disk_read_entries,r.write_entries);
}
macro_rules! bench {
    ($env:expr,$name:literal,$call:expr) => {{
        let value = $call;
        record($env, $name);
        value
    }};
}

#[test]
fn successful_entrypoint_costs() {
    let env = Env::default();
    env.mock_all_auths();
    let admin = Address::generate(&env);
    let funder = Address::generate(&env);
    let contributor = Address::generate(&env);
    let owner = Address::generate(&env);
    let token = env.register_stellar_asset_contract_v2(admin.clone());
    let token_admin = StellarAssetClient::new(&env, &token.address());
    let id = env.register(MatchingPoolContract, ());
    let c = MatchingPoolContractClient::new(&env, &id);
    bench!(&env, "initialize", c.initialize(&admin));
    env.ledger().set_timestamp(500);
    let round = bench!(
        &env,
        "create_round",
        c.create_round(
            &admin,
            &Symbol::new(&env, "Bench"),
            &token.address(),
            &1_000,
            &2_000
        )
    );
    token_admin.mint(&funder, &1_000);
    bench!(&env, "fund_pool", c.fund_pool(&funder, &round, &500));
    bench!(
        &env,
        "approve_project",
        c.approve_project(&admin, &round, &7)
    );
    c.approve_project(&admin, &round, &8);
    bench!(&env, "remove_project", c.remove_project(&admin, &round, &8));
    bench!(&env, "set_round_cap", c.set_round_cap(&admin, &round, &100));
    env.ledger().set_timestamp(1_500);
    bench!(
        &env,
        "record_contribution",
        c.record_contribution(&round, &7, &contributor, &80)
    );
    bench!(&env, "get_round", c.get_round(&round));
    bench!(&env, "get_pool_balance", c.get_pool_balance(&round));
    bench!(
        &env,
        "get_project_qf_score",
        c.get_project_qf_score(&round, &7)
    );
    bench!(&env, "preview_distribution", c.preview_distribution(&round));
    bench!(
        &env,
        "get_project_contributions",
        c.get_project_contributions(&round, &7)
    );
    bench!(
        &env,
        "get_contributor_count",
        c.get_contributor_count(&round, &7)
    );
    bench!(&env, "get_round_cap", c.get_round_cap(&round));
    bench!(
        &env,
        "get_contributor_round_total",
        c.get_contributor_round_total(&round, &contributor)
    );
    bench!(&env, "get_round_status", c.get_round_status(&round));
    bench!(&env, "get_admin", c.get_admin());
    bench!(
        &env,
        "pause_scope",
        c.pause_scope(&admin, &PauseScope::Contribution)
    );
    bench!(
        &env,
        "unpause_scope",
        c.unpause_scope(&admin, &PauseScope::Contribution)
    );
    bench!(&env, "pause", c.pause(&admin));
    bench!(&env, "unpause", c.unpause(&admin));
    bench!(&env, "is_paused", c.is_paused(&PauseScope::Contribution));
    env.ledger().set_timestamp(2_001);
    bench!(&env, "finalize_round", c.finalize_round(&admin, &round));
    bench!(&env, "get_finalized_at", c.get_finalized_at(&round));
    bench!(
        &env,
        "distribute_matching_funds",
        c.distribute_matching_funds(&admin, &round, &vec![&env, owner.clone()])
    );
    let next_admin = Address::generate(&env);
    bench!(&env, "set_admin", c.set_admin(&admin, &next_admin));
    let wasm = env.deployer().upload_contract_wasm(Bytes::from_slice(
        &env,
        include_bytes!("../../upgradable-contract/src/mock/upgradable_contract.wasm"),
    ));
    bench!(&env, "upgrade", c.upgrade(&next_admin, &wasm));
}
