extern crate std;

use crate::{
    CommunityCurationContract, CommunityCurationContractClient, ProjectMetadata, ProjectStatus,
};
use soroban_sdk::{
    contract, contractimpl, contracttype,
    testutils::{Address as _, Ledger},
    token::StellarAssetClient,
    Address, Env, Map, String,
};

#[contracttype]
#[derive(Clone)]
enum RegistryKey {
    Scores,
}

#[contract]
struct BenchmarkRegistry;

#[contractimpl]
impl BenchmarkRegistry {
    pub fn __constructor(env: Env) {
        env.storage()
            .instance()
            .set(&RegistryKey::Scores, &Map::<Address, u64>::new(&env));
    }

    pub fn set_reputation(env: Env, contributor: Address, score: u64) {
        let mut scores: Map<Address, u64> = env
            .storage()
            .instance()
            .get(&RegistryKey::Scores)
            .unwrap_or(Map::new(&env));
        scores.set(contributor, score);
        env.storage().instance().set(&RegistryKey::Scores, &scores);
    }

    pub fn get_reputation(env: Env, contributor: Address) -> u64 {
        scores(&env).get(contributor).unwrap_or(0)
    }

    pub fn total_reputation(env: Env) -> u64 {
        scores(&env)
            .iter()
            .fold(0u64, |total, (_, score)| total.saturating_add(score))
    }
}

fn scores(env: &Env) -> Map<Address, u64> {
    env.storage()
        .instance()
        .get(&RegistryKey::Scores)
        .unwrap_or(Map::new(env))
}

fn metadata(env: &Env) -> ProjectMetadata {
    ProjectMetadata {
        name: String::from_str(env, "Cost benchmark project"),
        description: String::from_str(env, "Valid scenario for curation entrypoint costs."),
        url: String::from_str(env, "https://example.org/project"),
        funding_address: Address::generate(env),
    }
}

fn record(env: &Env, entrypoint: &str) {
    let resources = env.cost_estimate().resources();
    std::println!(
        "SOROBAN_COST_BENCHMARK {{\"contract\":\"lumenpulse-curation\",\"entrypoint\":\"{entrypoint}\",\"cpu_instructions\":{},\"ledger_reads\":{},\"ledger_writes\":{}}}",
        resources.instructions,
        resources.memory_read_entries + resources.disk_read_entries,
        resources.write_entries,
    );
}

#[test]
fn successful_entrypoint_costs() {
    let env = Env::default();
    env.mock_all_auths();
    env.ledger().set_sequence_number(1_000);

    let admin = Address::generate(&env);
    let token_admin = Address::generate(&env);
    let token = env.register_stellar_asset_contract_v2(token_admin);
    let proposer = Address::generate(&env);
    StellarAssetClient::new(&env, &token.address()).mint(&proposer, &1_000_000_000);
    let registry = env.register(BenchmarkRegistry, ());
    let registry_client = BenchmarkRegistryClient::new(&env, &registry);
    let contract = env.register(CommunityCurationContract, ());
    let client = CommunityCurationContractClient::new(&env, &contract);

    client.initialize(&admin, &token.address(), &registry);
    record(&env, "initialize");

    let project_id = client.propose_project(&proposer, &metadata(&env));
    record(&env, "propose_project");
    let voter = Address::generate(&env);
    registry_client.set_reputation(&voter, &100);
    client.vote_to_verify(&voter, &project_id, &true);
    record(&env, "vote_to_verify");

    assert!(client.is_verified(&project_id));
    record(&env, "is_verified");
    assert!(client.get_proposal_state(&project_id).is_some());
    record(&env, "get_proposal_state");
    assert!(client.get_vote(&project_id, &voter).is_some());
    record(&env, "get_vote");

    let rejected_id = client.propose_project(&proposer, &metadata(&env));
    client.admin_reject(&rejected_id);
    record(&env, "admin_reject");

    let expired_id = client.propose_project(&proposer, &metadata(&env));
    env.ledger()
        .set_sequence_number(env.ledger().sequence() + 120_961);
    assert_eq!(
        client.finalize_proposal(&expired_id),
        ProjectStatus::Rejected
    );
    record(&env, "finalize_proposal");

    assert_eq!(client.get_deposit_amount(), 10_000_000);
    record(&env, "get_deposit_amount");
    assert_eq!(client.get_voting_window_ledgers(), 120_960);
    record(&env, "get_voting_window_ledgers");
    assert_eq!(client.get_verify_threshold_bps(), 3_000);
    record(&env, "get_verify_threshold_bps");
}
