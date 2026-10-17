//! Execution Cost Benchmark for Soroban Contracts
//!
//! Measures CPU instructions, ledger read count, and ledger write count per public entry point.

use std::collections::BTreeMap;
use std::env;
use std::fs;
use std::path::PathBuf;

use serde::{Deserialize, Serialize};
use soroban_sdk::{symbol_short, BytesN, Env};

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct BenchmarkRecord {
    pub contract: String,
    pub entry_point: String,
    pub cpu_instructions: u64,
    pub ledger_reads: u32,
    pub ledger_writes: u32,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub description: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct BenchmarkSuiteOutput {
    pub version: u32,
    pub description: String,
    pub metrics: MetricDefinitions,
    pub benchmarks: BTreeMap<String, BenchmarkRecord>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct MetricDefinitions {
    pub cpu_instructions: String,
    pub ledger_reads: String,
    pub ledger_writes: String,
}

struct BenchmarkRunner {
    records: BTreeMap<String, BenchmarkRecord>,
}

impl BenchmarkRunner {
    fn new() -> Self {
        Self {
            records: BTreeMap::new(),
        }
    }

    fn record(&mut self, contract: &str, entry_point: &str, env: &Env, description: Option<&str>) {
        let res = env.cost_estimate().resources();
        let cpu_instructions = res.instructions.max(0) as u64;
        let ledger_reads = res.memory_read_entries + res.disk_read_entries;
        let ledger_writes = res.write_entries;

        let key = format!("{}::{}", contract, entry_point);
        self.records.insert(
            key,
            BenchmarkRecord {
                contract: contract.to_string(),
                entry_point: entry_point.to_string(),
                cpu_instructions,
                ledger_reads,
                ledger_writes,
                description: description.map(|s| s.to_string()),
            },
        );
    }
}

// ─────────────────────────────────────────────────────────────────────────────
// Benchmark implementations per contract
// ─────────────────────────────────────────────────────────────────────────────

fn benchmark_feature_flags(runner: &mut BenchmarkRunner) {
    let contract = "feature_flags";
    let env = test_utils::test_env();
    let admin = test_utils::account(&env);
    let id = test_utils::register_contract(&env, feature_flags::FeatureFlagsContract);
    let client = feature_flags::FeatureFlagsContractClient::new(&env, &id);

    client.initialize(&admin);
    runner.record(
        contract,
        "initialize",
        &env,
        Some("Initialize contract with admin"),
    );

    client.set_flag(&admin, &symbol_short!("vault_v2"), &true);
    runner.record(contract, "set_flag", &env, Some("Store feature flag"));

    client.get_flag(&symbol_short!("vault_v2"));
    runner.record(contract, "get_flag", &env, Some("Retrieve feature flag"));

    client.is_enabled(&symbol_short!("vault_v2"));
    runner.record(
        contract,
        "is_enabled",
        &env,
        Some("Check if feature flag is active"),
    );

    client.list_flags();
    runner.record(
        contract,
        "list_flags",
        &env,
        Some("List all configured flags"),
    );

    let new_admin = test_utils::account(&env);
    client.set_admin(&admin, &new_admin);
    runner.record(contract, "set_admin", &env, Some("Rotate contract admin"));

    client.pause(&new_admin);
    runner.record(contract, "pause", &env, Some("Pause contract operations"));

    client.unpause(&new_admin);
    runner.record(
        contract,
        "unpause",
        &env,
        Some("Unpause contract operations"),
    );
}

fn benchmark_pricing_adapter(runner: &mut BenchmarkRunner) {
    let contract = "pricing_adapter";
    let env = test_utils::test_env();
    let admin = test_utils::account(&env);
    let id = test_utils::register_contract(&env, pricing_adapter::PricingAdapterContract);
    let client = pricing_adapter::PricingAdapterContractClient::new(&env, &id);

    client.initialize(&admin);
    runner.record(
        contract,
        "initialize",
        &env,
        Some("Initialize pricing adapter"),
    );

    let asset1 = test_utils::account(&env);

    client.set_price(&admin, &asset1, &100_000_000i128, &7u32);
    runner.record(
        contract,
        "set_price",
        &env,
        Some("Publish asset price update"),
    );

    client.get_price(&asset1);
    runner.record(contract, "get_price", &env, Some("Read fresh asset price"));

    client.get_price_timestamp(&asset1);
    runner.record(
        contract,
        "get_price_timestamp",
        &env,
        Some("Read price update timestamp"),
    );

    client.get_asset_decimals(&asset1);
    runner.record(
        contract,
        "get_asset_decimals",
        &env,
        Some("Query asset decimals"),
    );

    client.normalize_amount(&asset1, &1_000_000i128);
    runner.record(
        contract,
        "normalize_amount",
        &env,
        Some("Cross-currency amount normalization"),
    );

    client.set_staleness_window(&admin, &3600u64);
    runner.record(
        contract,
        "set_staleness_window",
        &env,
        Some("Configure max acceptable price age"),
    );

    client.get_staleness_window();
    runner.record(
        contract,
        "get_staleness_window",
        &env,
        Some("Read current staleness window"),
    );

    client.invalidate_price(&admin, &asset1);
    runner.record(
        contract,
        "invalidate_price",
        &env,
        Some("Mark price feed invalid"),
    );
}

fn benchmark_protocol_registry(runner: &mut BenchmarkRunner) {
    let contract = "protocol_registry";
    let env = test_utils::test_env();
    let admin = test_utils::account(&env);
    let id = test_utils::register_contract(&env, protocol_registry::ProtocolRegistryContract);
    let client = protocol_registry::ProtocolRegistryContractClient::new(&env, &id);

    client.initialize(&admin);
    runner.record(
        contract,
        "initialize",
        &env,
        Some("Initialize protocol registry"),
    );

    let module_addr = test_utils::account(&env);
    client.register_module(&admin, &symbol_short!("vault"), &module_addr, &1u32);
    runner.record(
        contract,
        "register_module",
        &env,
        Some("Register protocol module"),
    );

    let new_addr = test_utils::account(&env);
    client.update_module(&admin, &symbol_short!("vault"), &new_addr, &2u32);
    runner.record(
        contract,
        "update_module",
        &env,
        Some("Update registered module"),
    );

    client.get_module(&symbol_short!("vault"));
    runner.record(contract, "get_module", &env, Some("Fetch module record"));

    client.resolve(&symbol_short!("vault"));
    runner.record(contract, "resolve", &env, Some("Resolve module address"));

    client.is_active(&symbol_short!("vault"));
    runner.record(
        contract,
        "is_active",
        &env,
        Some("Check module active state"),
    );

    client.deactivate_module(&admin, &symbol_short!("vault"));
    runner.record(
        contract,
        "deactivate_module",
        &env,
        Some("Deactivate module"),
    );

    client.activate_module(&admin, &symbol_short!("vault"));
    runner.record(contract, "activate_module", &env, Some("Reactivate module"));

    client.pause(&admin);
    runner.record(contract, "pause", &env, Some("Pause protocol registry"));

    client.unpause(&admin);
    runner.record(contract, "unpause", &env, Some("Unpause protocol registry"));
}

fn benchmark_lumen_token(runner: &mut BenchmarkRunner) {
    let contract = "lumen_token";
    let env = test_utils::test_env();
    let admin = test_utils::account(&env);
    let id = test_utils::register_contract(&env, lumen_token::LumenToken);
    let client = lumen_token::LumenTokenClient::new(&env, &id);

    let name = soroban_sdk::String::from_str(&env, "Lumenpulse Token");
    let symbol = soroban_sdk::String::from_str(&env, "LUM");
    client.initialize(&admin, &7u32, &name, &symbol);
    runner.record(
        contract,
        "initialize",
        &env,
        Some("Initialize token with metadata"),
    );

    let alice = test_utils::account(&env);
    let bob = test_utils::account(&env);
    let charlie = test_utils::account(&env);

    client.mint(&alice, &1_000_000_000i128);
    runner.record(contract, "mint", &env, Some("Mint tokens to account"));

    client.transfer(&alice, &bob, &50_000i128);
    runner.record(contract, "transfer", &env, Some("Direct token transfer"));

    client.approve(&alice, &bob, &200_000i128, &1000u32);
    runner.record(contract, "approve", &env, Some("Set allowance for spender"));

    client.transfer_from(&bob, &alice, &charlie, &25_000i128);
    runner.record(
        contract,
        "transfer_from",
        &env,
        Some("Transfer from allowance"),
    );

    client.balance(&alice);
    runner.record(contract, "balance", &env, Some("Query token balance"));

    client.allowance(&alice, &bob);
    runner.record(contract, "allowance", &env, Some("Query allowance balance"));

    client.burn(&alice, &10_000i128);
    runner.record(contract, "burn", &env, Some("Burn tokens"));

    client.freeze(&bob);
    runner.record(contract, "freeze", &env, Some("Freeze account transfers"));

    client.unfreeze(&bob);
    runner.record(
        contract,
        "unfreeze",
        &env,
        Some("Unfreeze account transfers"),
    );
}

fn benchmark_contributor_registry(runner: &mut BenchmarkRunner) {
    let contract = "contributor_registry";
    let env = test_utils::test_env();
    let admin = test_utils::account(&env);
    let id = test_utils::register_contract(&env, contributor_registry::ContributorRegistryContract);
    let client = contributor_registry::ContributorRegistryContractClient::new(&env, &id);

    let mut signers = soroban_sdk::Vec::new(&env);
    signers.push_back(contributor_registry::Signer {
        address: admin.clone(),
        weight: 1,
    });
    client.initialize(&signers, &1u32);
    runner.record(
        contract,
        "initialize",
        &env,
        Some("Initialize contributor registry with multisig"),
    );

    let contrib = test_utils::account(&env);
    let handle = soroban_sdk::String::from_str(&env, "alice_dev");
    client.register_contributor(&contrib, &handle);
    runner.record(
        contract,
        "register_contributor",
        &env,
        Some("Register new contributor"),
    );

    client.get_contributor(&contrib);
    runner.record(
        contract,
        "get_contributor",
        &env,
        Some("Read contributor profile"),
    );

    client.get_reputation(&contrib);
    runner.record(
        contract,
        "get_reputation",
        &env,
        Some("Query reputation score"),
    );

    client.get_multisig_config();
    runner.record(
        contract,
        "get_multisig_config",
        &env,
        Some("Query multisig configuration"),
    );

    client.is_paused(&contributor_registry::ContribPauseScope::Contribution);
    runner.record(contract, "is_paused", &env, Some("Check pause state"));
}

fn benchmark_project_registry(runner: &mut BenchmarkRunner) {
    let contract = "project_registry";
    let env = test_utils::test_env();
    let admin = test_utils::account(&env);
    let id = test_utils::register_contract(&env, project_registry::ProjectRegistryContract);
    let client = project_registry::ProjectRegistryContractClient::new(&env, &id);

    client.initialize(
        &admin,
        &100i128,
        &project_registry::WeightMode::Flat,
        &None,
        &None,
        &1i128,
    );
    runner.record(
        contract,
        "initialize",
        &env,
        Some("Initialize project registry"),
    );

    let owner = test_utils::account(&env);
    client.register_project(&owner, &1u64, &symbol_short!("proj1"));
    runner.record(
        contract,
        "register_project",
        &env,
        Some("Register new crowdfunding project"),
    );

    let voter = test_utils::account(&env);
    client.cast_vote(&voter, &1u64, &true);
    runner.record(
        contract,
        "cast_vote",
        &env,
        Some("Cast community verification vote"),
    );

    client.get_project(&1u64);
    runner.record(contract, "get_project", &env, Some("Read project data"));

    client.is_verified(&1u64);
    runner.record(
        contract,
        "is_verified",
        &env,
        Some("Check verification status"),
    );

    client.has_voted(&1u64, &voter);
    runner.record(
        contract,
        "has_voted",
        &env,
        Some("Check if voter has participated"),
    );

    client.archive_project(&admin, &1u64);
    runner.record(
        contract,
        "archive_project",
        &env,
        Some("Archive inactive project"),
    );

    client.pause(&admin);
    runner.record(contract, "pause", &env, Some("Pause project registry"));

    client.unpause(&admin);
    runner.record(contract, "unpause", &env, Some("Unpause project registry"));
}

fn benchmark_treasury(runner: &mut BenchmarkRunner) {
    let contract = "treasury";
    let env = test_utils::test_env();
    let admin = test_utils::account(&env);
    let (token_client, token_admin) = test_utils::create_token(&env, &admin);
    test_utils::mint(&token_admin, &admin, 100_000_000);
    let token = token_client.address;
    let id = test_utils::register_contract(&env, treasury::TreasuryContract);
    let client = treasury::TreasuryContractClient::new(&env, &id);

    client.initialize(&admin, &token);
    runner.record(
        contract,
        "initialize",
        &env,
        Some("Initialize protocol treasury"),
    );

    let beneficiary = test_utils::account(&env);
    let req_id = BytesN::from_array(&env, &[1u8; 32]);
    client.allocate_budget(
        &admin,
        &beneficiary,
        &1_000_000i128,
        &0u64,
        &5000u64,
        &req_id,
    );
    runner.record(
        contract,
        "allocate_budget",
        &env,
        Some("Allocate linear vesting stream"),
    );

    client.get_unlocked(&beneficiary);
    runner.record(
        contract,
        "get_unlocked",
        &env,
        Some("Compute unlocked streaming balance"),
    );

    client.get_financials();
    runner.record(
        contract,
        "get_financials",
        &env,
        Some("Get aggregate treasury financials"),
    );

    client.get_admin();
    runner.record(
        contract,
        "get_admin",
        &env,
        Some("Query treasury administrator"),
    );

    client.cancel_stream(&admin, &beneficiary);
    runner.record(
        contract,
        "cancel_stream",
        &env,
        Some("Cancel active budget stream"),
    );
}

fn benchmark_matching_pool(runner: &mut BenchmarkRunner) {
    let contract = "matching_pool";
    let env = test_utils::test_env();
    let admin = test_utils::account(&env);
    let id = test_utils::register_contract(&env, matching_pool::MatchingPoolContract);
    let client = matching_pool::MatchingPoolContractClient::new(&env, &id);

    client.initialize(&admin);
    runner.record(
        contract,
        "initialize",
        &env,
        Some("Initialize quadratic funding matching pool"),
    );

    let (token_client, token_admin) = test_utils::create_token(&env, &admin);
    test_utils::mint(&token_admin, &admin, 100_000_000);
    let token = token_client.address;
    let round_id =
        client.create_round(&admin, &symbol_short!("round1"), &token, &0u64, &100_000u64);
    runner.record(
        contract,
        "create_round",
        &env,
        Some("Create quadratic funding round"),
    );

    client.approve_project(&admin, &round_id, &1u64);
    runner.record(
        contract,
        "approve_project",
        &env,
        Some("Approve project for matching round"),
    );

    let contributor = test_utils::account(&env);
    client.record_contribution(&round_id, &1u64, &contributor, &10_000i128);
    runner.record(
        contract,
        "record_contribution",
        &env,
        Some("Record round contribution and update QF sum"),
    );

    client.get_round(&round_id);
    runner.record(
        contract,
        "get_round",
        &env,
        Some("Read matching round details"),
    );

    client.get_pool_balance(&round_id);
    runner.record(
        contract,
        "get_pool_balance",
        &env,
        Some("Read matching pool remaining balance"),
    );

    client.preview_distribution(&round_id);
    runner.record(
        contract,
        "preview_distribution",
        &env,
        Some("Preview QF allocation amounts"),
    );
}

fn benchmark_vesting_wallet(runner: &mut BenchmarkRunner) {
    let contract = "vesting_wallet";
    let env = test_utils::test_env();
    let admin = test_utils::account(&env);
    let (token_client, token_admin) = test_utils::create_token(&env, &admin);
    test_utils::mint(&token_admin, &admin, 100_000_000);
    let token = token_client.address;
    let id = test_utils::register_contract(&env, vesting_wallet::VestingWalletContract);
    let client = vesting_wallet::VestingWalletContractClient::new(&env, &id);

    client.initialize(&admin, &token);
    runner.record(
        contract,
        "initialize",
        &env,
        Some("Initialize vesting wallet"),
    );

    let beneficiary = test_utils::account(&env);
    client.create_vesting(&admin, &beneficiary, &1_000_000i128, &1000u64, &5000u64);
    runner.record(
        contract,
        "create_vesting",
        &env,
        Some("Create schedule with cliff and duration"),
    );

    client.get_vesting(&beneficiary);
    runner.record(contract, "get_vesting", &env, Some("Read vesting schedule"));

    client.get_claimable(&beneficiary);
    runner.record(
        contract,
        "get_claimable",
        &env,
        Some("Calculate unlocked claimable tokens"),
    );

    client.get_admin();
    runner.record(
        contract,
        "get_admin",
        &env,
        Some("Query vesting contract admin"),
    );
}

fn benchmark_upgradable_contract(runner: &mut BenchmarkRunner) {
    let contract = "upgradable_contract";
    let env = test_utils::test_env();
    let admin = test_utils::account(&env);
    let id = test_utils::register_contract(&env, upgradable_contract::UpgradableContract);
    let client = upgradable_contract::UpgradableContractClient::new(&env, &id);

    client.init(&admin);
    runner.record(
        contract,
        "init",
        &env,
        Some("Initialize upgradable timelocked contract"),
    );

    client.increment();
    runner.record(
        contract,
        "increment",
        &env,
        Some("State increment operation"),
    );

    client.get_count();
    runner.record(contract, "get_count", &env, Some("Read state counter"));

    let action = upgradable_contract::TimelockAction::SetAdmin(test_utils::account(&env));
    let op_id = client.queue_operation(&admin, &action);
    runner.record(
        contract,
        "queue_operation",
        &env,
        Some("Queue timelocked governance action"),
    );

    client.get_operation(&op_id);
    runner.record(
        contract,
        "get_operation",
        &env,
        Some("Read queued operation details"),
    );

    client.get_operation_status(&op_id);
    runner.record(
        contract,
        "get_operation_status",
        &env,
        Some("Check timelock operation status"),
    );
}

fn benchmark_crowdfund_vault(runner: &mut BenchmarkRunner) {
    let contract = "crowdfund_vault";
    let env = test_utils::test_env();
    let admin = test_utils::account(&env);
    let id = test_utils::register_contract(&env, crowdfund_vault::CrowdfundVaultContract);
    let client = crowdfund_vault::CrowdfundVaultContractClient::new(&env, &id);

    client.initialize(&admin);
    runner.record(
        contract,
        "initialize",
        &env,
        Some("Initialize crowdfunding vault"),
    );

    client.get_storage_version();
    runner.record(
        contract,
        "get_storage_version",
        &env,
        Some("Query contract schema version"),
    );

    client.get_admin();
    runner.record(
        contract,
        "get_admin",
        &env,
        Some("Query crowdfunding vault admin"),
    );

    let contrib = test_utils::account(&env);
    client.register_contributor(&contrib);
    runner.record(
        contract,
        "register_contributor",
        &env,
        Some("Register project contributor"),
    );

    client.get_reputation(&contrib);
    runner.record(
        contract,
        "get_reputation",
        &env,
        Some("Query contributor reputation"),
    );

    client.pause(&admin);
    runner.record(contract, "pause", &env, Some("Pause vault operations"));

    client.unpause(&admin);
    runner.record(contract, "unpause", &env, Some("Unpause vault operations"));
}

fn benchmark_curation(runner: &mut BenchmarkRunner) {
    let contract = "lumenpulse_curation";
    let env = test_utils::test_env();
    let admin = test_utils::account(&env);
    let (token_client, token_admin) = test_utils::create_token(&env, &admin);
    test_utils::mint(&token_admin, &admin, 100_000_000);
    let token = token_client.address;
    let contrib_reg = test_utils::account(&env);
    let id = test_utils::register_contract(
        &env,
        lumenpulse_community_curation::CommunityCurationContract,
    );
    let client = lumenpulse_community_curation::CommunityCurationContractClient::new(&env, &id);

    client.initialize(&admin, &token, &contrib_reg);
    runner.record(
        contract,
        "initialize",
        &env,
        Some("Initialize curation governance contract"),
    );

    client.get_deposit_amount();
    runner.record(
        contract,
        "get_deposit_amount",
        &env,
        Some("Query required curation proposal stake"),
    );

    client.get_voting_window_ledgers();
    runner.record(
        contract,
        "get_voting_window_ledgers",
        &env,
        Some("Query voting duration"),
    );

    client.get_verify_threshold_bps();
    runner.record(
        contract,
        "get_verify_threshold_bps",
        &env,
        Some("Query verification consensus threshold"),
    );

    client.is_verified(&100u64);
    runner.record(
        contract,
        "is_verified",
        &env,
        Some("Check project curation status"),
    );
}

fn benchmark_yield_vault(runner: &mut BenchmarkRunner) {
    let contract = "yield_vault";
    let env = test_utils::test_env();
    let admin = test_utils::account(&env);
    let (token_client, token_admin) = test_utils::create_token(&env, &admin);
    test_utils::mint(&token_admin, &admin, 100_000_000);
    let asset = token_client.address;
    let id = test_utils::register_contract(&env, yield_vault::YieldVaultContract);
    let client = yield_vault::YieldVaultContractClient::new(&env, &id);

    client.initialize(&admin, &asset);
    runner.record(
        contract,
        "initialize",
        &env,
        Some("Initialize multi-provider yield vault"),
    );

    client.is_paused();
    runner.record(contract, "is_paused", &env, Some("Check pause flag"));

    client.get_total_aum();
    runner.record(
        contract,
        "get_total_aum",
        &env,
        Some("Read total assets under management"),
    );

    let user = test_utils::account(&env);
    client.balance_of(&user);
    runner.record(
        contract,
        "balance_of",
        &env,
        Some("Read user share balance"),
    );

    client.get_total_yield_harvested();
    runner.record(
        contract,
        "get_total_yield_harvested",
        &env,
        Some("Read total harvested yield"),
    );
}

// ─────────────────────────────────────────────────────────────────────────────
// CLI Runner
// ─────────────────────────────────────────────────────────────────────────────

fn main() {
    let args: Vec<String> = env::args().collect();
    let mut output_path: Option<PathBuf> = None;
    let mut print_stdout = false;
    let mut print_markdown = false;

    let mut i = 1;
    while i < args.len() {
        match args[i].as_str() {
            "--output" | "-o" => {
                if i + 1 < args.len() {
                    output_path = Some(PathBuf::from(&args[i + 1]));
                    i += 1;
                }
            }
            "--stdout" => print_stdout = true,
            "--markdown" => print_markdown = true,
            _ => {}
        }
        i += 1;
    }

    println!("Running Soroban execution cost benchmarks across suite contracts...");
    let mut runner = BenchmarkRunner::new();

    benchmark_feature_flags(&mut runner);
    benchmark_pricing_adapter(&mut runner);
    benchmark_protocol_registry(&mut runner);
    benchmark_lumen_token(&mut runner);
    benchmark_contributor_registry(&mut runner);
    benchmark_project_registry(&mut runner);
    benchmark_treasury(&mut runner);
    benchmark_matching_pool(&mut runner);
    benchmark_vesting_wallet(&mut runner);
    benchmark_upgradable_contract(&mut runner);
    benchmark_crowdfund_vault(&mut runner);
    benchmark_curation(&mut runner);
    benchmark_yield_vault(&mut runner);

    println!(
        "Completed benchmarks for {} entry points.\n",
        runner.records.len()
    );

    let output = BenchmarkSuiteOutput {
        version: 1,
        description: "Baseline execution costs (CPU instructions, ledger reads, ledger writes) for Soroban contract public entry points".to_string(),
        metrics: MetricDefinitions {
            cpu_instructions: "Modelled CPU instructions consumed during entry point execution".to_string(),
            ledger_reads: "Number of ledger entry reads (memory + disk)".to_string(),
            ledger_writes: "Number of ledger entry writes".to_string(),
        },
        benchmarks: runner.records.clone(),
    };

    let json_bytes =
        serde_json::to_string_pretty(&output).expect("Failed to serialize benchmark output");

    if let Some(ref path) = output_path {
        if let Some(parent) = path.parent() {
            fs::create_dir_all(parent).ok();
        }
        fs::write(path, &json_bytes).unwrap_or_else(|err| {
            panic!("Failed to write output to {}: {}", path.display(), err);
        });
        println!("Wrote benchmark results to {}", path.display());
    }

    if print_stdout || output_path.is_none() {
        println!("{}", json_bytes);
    }

    if print_markdown {
        println!("\n### Most Expensive 5 Entry Points by CPU Instructions\n");
        println!(
            "| Rank | Contract | Entry Point | CPU Instructions | Ledger Reads | Ledger Writes |"
        );
        println!("| ---: | --- | --- | ---: | ---: | ---: |");

        let mut sorted: Vec<&BenchmarkRecord> = runner.records.values().collect();
        sorted.sort_by_key(|a| std::cmp::Reverse(a.cpu_instructions));

        for (rank, r) in sorted.iter().take(5).enumerate() {
            println!(
                "| {} | `{}` | `{}` | {} | {} | {} |",
                rank + 1,
                r.contract,
                r.entry_point,
                r.cpu_instructions,
                r.ledger_reads,
                r.ledger_writes
            );
        }
    }
}
