extern crate std;

use super::*;
use crate::storage::{MigrationPlanStatus, MilestoneDecision};
use crate::treasury_interface::TreasuryTrait;
use soroban_sdk::{contract, contractimpl, symbol_short, vec, Bytes};

#[contract]
struct BenchmarkTreasury;

#[contractimpl]
impl TreasuryTrait for BenchmarkTreasury {
    fn allocate_budget(
        _env: Env,
        _admin: Address,
        _beneficiary: Address,
        _amount: i128,
        _start_time: u64,
        _duration: u64,
        _request_id: BytesN<32>,
    ) -> Result<(), soroban_sdk::Val> {
        Ok(())
    }
}

fn record(env: &Env, entrypoint: &str) {
    let resources = env.cost_estimate().resources();
    std::println!(
        "SOROBAN_COST_BENCHMARK {{\"contract\":\"crowdfund_vault\",\"entrypoint\":\"{entrypoint}\",\"cpu_instructions\":{},\"ledger_reads\":{},\"ledger_writes\":{}}}",
        resources.instructions,
        resources.memory_read_entries + resources.disk_read_entries,
        resources.write_entries,
    );
}

fn new_project(client: &CrowdfundVaultContractClient, owner: &Address, token: &TokenClient) -> u64 {
    client.create_project(
        owner,
        &symbol_short!("Benchmark"),
        &1_000_000,
        &token.address,
    )
}

fn deposit(
    client: &CrowdfundVaultContractClient,
    env: &Env,
    user: &Address,
    project_id: u64,
    amount: i128,
    request_byte: u8,
) {
    client.deposit(
        user,
        &project_id,
        &amount,
        &BytesN::from_array(env, &[request_byte; 32]),
    );
}

#[test]
fn successful_entrypoint_costs() {
    let env = Env::default();
    env.mock_all_auths();
    let (client, admin, owner, user, token, token_admin, contract_id) = setup_test_with_admin(&env);
    token_admin.mint(&admin, &10_000_000);

    client.initialize(&admin);
    record(&env, "initialize");
    client.migrate(&admin);
    record(&env, "migrate");
    client.get_storage_version();
    record(&env, "get_storage_version");
    let _ = client.contract_version();
    record(&env, "contract_version");

    let project = new_project(&client, &owner, &token);
    record(&env, "create_project");
    client.deposit_with_sig(
        &user,
        &project,
        &100_000,
        &Bytes::from_slice(&env, &[1, 2, 3]),
    );
    record(&env, "deposit_with_sig");
    deposit(&client, &env, &user, project, 200_000, 2);
    record(&env, "deposit");

    let subscriber = Address::generate(&env);
    client.add_subscriber(&admin, &subscriber);
    record(&env, "add_subscriber");
    client.remove_subscriber(&admin, &subscriber);
    record(&env, "remove_subscriber");

    client.approve_milestone(&admin, &project, &1);
    record(&env, "approve_milestone");
    client.process_milestone_decisions(
        &admin,
        &vec![
            &env,
            MilestoneDecision {
                project_id: project,
                milestone_id: 2,
                approve: true,
            },
        ],
    );
    record(&env, "process_milestone_decisions");
    client.start_milestone_vote(&project, &3, &3_600);
    record(&env, "start_milestone_vote");
    client.vote_milestone(&user, &project, &3, &true);
    record(&env, "vote_milestone");
    client.withdraw(&project, &1, &50_000);
    record(&env, "withdraw");

    client.dispute_milestone(&user, &project, &1, &symbol_short!("review"));
    record(&env, "dispute_milestone");
    client.get_milestone_dispute(&project, &1);
    record(&env, "get_milestone_dispute");
    client.is_milestone_disputed(&project, &1);
    record(&env, "is_milestone_disputed");
    client.resolve_milestone_dispute(&admin, &project, &1, &true);
    record(&env, "resolve_milestone_dispute");

    let contributor = Address::generate(&env);
    client.register_contributor(&contributor);
    record(&env, "register_contributor");
    let signed_contributor = Address::generate(&env);
    client.register_contributor_with_sig(&signed_contributor, &Bytes::from_slice(&env, &[4, 5]));
    record(&env, "register_contributor_with_sig");
    client.update_reputation(&admin, &contributor, &25);
    record(&env, "update_reputation");
    client.get_reputation(&contributor);
    record(&env, "get_reputation");

    client.fund_matching_pool(&admin, &token.address, &500_000);
    record(&env, "fund_matching_pool");
    client.calculate_match(&project);
    record(&env, "calculate_match");
    client.distribute_match(&project);
    record(&env, "distribute_match");
    client.get_matching_pool_balance(&token.address);
    record(&env, "get_matching_pool_balance");

    client.fund_reward_pool(&admin, &token.address, &500_000);
    record(&env, "fund_reward_pool");
    client.get_reward_pool_balance(&token.address);
    record(&env, "get_reward_pool_balance");
    client.batch_payout(
        &admin,
        &token.address,
        &vec![&env, (Address::generate(&env), 10_000i128)],
        &BytesN::from_array(&env, &[9; 32]),
    );
    record(&env, "batch_payout");

    let treasury_id = env.register(BenchmarkTreasury, ());
    client.allocate_to_streaming_treasury(
        &admin,
        &project,
        &1,
        &treasury_id,
        &10_000,
        &3_600,
        &BytesN::from_array(&env, &[13; 32]),
    );
    record(&env, "allocate_to_streaming_treasury");

    client.get_contribution(&project, &user);
    record(&env, "get_contribution");
    client.get_contributor_count(&project);
    record(&env, "get_contributor_count");
    client.get_project_storage_summary(&project);
    record(&env, "get_project_storage_summary");
    client.get_project(&project);
    record(&env, "get_project");
    client.get_balance(&project);
    record(&env, "get_balance");
    client.is_milestone_approved(&project, &1);
    record(&env, "is_milestone_approved");
    client.get_total_contributions(&project);
    record(&env, "get_total_contributions");
    client.get_contributor_contribution(&project, &user);
    record(&env, "get_contributor_contribution");
    client.get_project_status(&project);
    record(&env, "get_project_status");
    client.get_admin();
    record(&env, "get_admin");
    client.get_refund_receipt_count(&project);
    record(&env, "get_refund_receipt_count");
    client.has_refund_claimed(&project, &user);
    record(&env, "has_refund_claimed");

    client.set_fee_config(&admin, &100u32, &Address::generate(&env));
    record(&env, "set_fee_config");
    client.set_yield_provider(&admin, &token.address, &Address::generate(&env));
    record(&env, "set_yield_provider");

    // Exercise investment and divestment against the same in-memory provider
    // used by the contract's yield integration tests.
    let yield_project = new_project(&client, &owner, &token);
    deposit(&client, &env, &user, yield_project, 50_000, 14);
    let yield_id = env.register(crate::test_yield::MockYieldProvider, ());
    let yield_mock = crate::test_yield::MockYieldProviderClient::new(&env, &yield_id);
    yield_mock.initialize(&token.address);
    token_admin.mint(&yield_id, &100_000);
    client.set_yield_provider(&admin, &token.address, &yield_id);
    client.invest_idle_funds(&owner, &yield_project, &20_000);
    record(&env, "invest_idle_funds");
    client.divest_funds(&owner, &yield_project, &10_000);
    record(&env, "divest_funds");

    client.pause(&admin);
    record(&env, "pause");
    assert!(client.require_not_paused());
    record(&env, "require_not_paused");
    client.unpause(&admin);
    record(&env, "unpause");

    let migration_project = new_project(&client, &owner, &token);
    deposit(&client, &env, &user, migration_project, 50_000, 10);
    client.pause(&admin);
    client.propose_emergency_migration(
        &admin,
        &migration_project,
        &Address::generate(&env),
        &10_000,
        &symbol_short!("recover"),
    );
    record(&env, "propose_emergency_migration");
    client.get_emergency_migration_plan(&migration_project);
    record(&env, "get_emergency_migration_plan");
    client.veto_emergency_migration(&admin, &migration_project);
    record(&env, "veto_emergency_migration");

    client.unpause(&admin);
    let execute_project = new_project(&client, &owner, &token);
    deposit(&client, &env, &user, execute_project, 50_000, 15);
    client.pause(&admin);
    client.propose_emergency_migration(
        &admin,
        &execute_project,
        &Address::generate(&env),
        &10_000,
        &symbol_short!("execute"),
    );
    client.execute_emergency_migration(&admin, &execute_project);
    record(&env, "execute_emergency_migration");

    client.unpause(&admin);
    let cancel_project = new_project(&client, &owner, &token);
    deposit(&client, &env, &user, cancel_project, 50_000, 11);
    client.cancel_project(&owner, &cancel_project);
    record(&env, "cancel_project");
    client.refund_contributors(&cancel_project, &admin);
    record(&env, "refund_contributors");
    client.get_refund_receipt(&cancel_project, &0);
    record(&env, "get_refund_receipt");

    let clawback_project = new_project(&client, &owner, &token);
    deposit(&client, &env, &user, clawback_project, 50_000, 12);
    env.ledger()
        .set_timestamp(env.ledger().timestamp() + 30 * 24 * 60 * 60 + 1);
    client.clawback_contribution(&clawback_project, &user);
    record(&env, "clawback_contribution");
    let new_admin = Address::generate(&env);
    client.set_admin(&admin, &new_admin);
    record(&env, "set_admin");
    let wasm = env.deployer().upload_contract_wasm(Bytes::from_slice(
        &env,
        include_bytes!("../../upgradable-contract/src/mock/upgradable_contract.wasm"),
    ));
    client.upgrade(&new_admin, &wasm);
    record(&env, "upgrade");
    let _ = (contract_id, MigrationPlanStatus::Pending);
}
