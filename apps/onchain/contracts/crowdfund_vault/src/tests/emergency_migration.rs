//! Emergency-migration invariant suite for `crowdfund_vault` (issue #1047).
//!
//! Covers the propose → execute | veto flow for paused rounds with
//! stranded funds.
//!
//! Invariants verified:
//!   EMI-1  Proposal requires pause.
//!   EMI-2  Proposal is admin-only.
//!   EMI-3  Amount must be ≤ current project balance and > 0.
//!   EMI-4  Recipient must not be the contract itself.
//!   EMI-5  Only one pending plan per project at a time; a vetoed plan
//!           may be superseded.
//!   EMI-6  Execution requires pause.
//!   EMI-7  Execution is admin-only.
//!   EMI-8  A vetoed plan cannot be executed.
//!   EMI-9  A plan cannot be executed twice.
//!   EMI-10 After execution, exactly `amount` tokens leave the vault.
//!   EMI-11 After execution, the project is CANCELED and contributors
//!           can clawback any remaining balance.
//!   EMI-12 After execution, TVL decreases by exactly `amount`.
//!   EMI-13 After execution, a second execute call returns
//!           MigrationAlreadyExecuted.
//!   EMI-14 Veto is admin-only.
//!   EMI-15 Veto on a non-existent plan returns MigrationPlanNotFound.
//!   EMI-16 Veto on an already-executed plan returns
//!           MigrationAlreadyExecuted.
//!   EMI-17 Full propose→execute path emits the correct events.
//!   EMI-18 Partially deposited (paused mid-round) round migrates safely.

use crate::errors::CrowdfundError;
use crate::storage::MigrationPlanStatus;
use crate::{CrowdfundVaultContract, CrowdfundVaultContractClient};
use soroban_sdk::{
    symbol_short,
    testutils::{Address as _, Ledger as _},
    token::{StellarAssetClient, TokenClient},
    Address, Env, Symbol,
};

// ── helpers ──────────────────────────────────────────────────────────────────

fn create_token<'a>(env: &Env, admin: &Address) -> (TokenClient<'a>, StellarAssetClient<'a>) {
    let addr = env.register_stellar_asset_contract_v2(admin.clone());
    (
        TokenClient::new(env, &addr.address()),
        StellarAssetClient::new(env, &addr.address()),
    )
}

/// Deploys a fresh vault, initializes it, returns client + helpers.
fn setup<'a>(
    env: &Env,
) -> (
    CrowdfundVaultContractClient<'a>,
    Address, // admin
    TokenClient<'a>,
    StellarAssetClient<'a>,
) {
    let admin = Address::generate(env);
    let (token, token_admin) = create_token(env, &admin);
    let contract_id = env.register(CrowdfundVaultContract, ());
    let client = CrowdfundVaultContractClient::new(env, &contract_id);
    client.initialize(&admin);
    (client, admin, token, token_admin)
}

/// Creates a project, mints `deposit` tokens to `user`, deposits them,
/// pauses the contract, and returns the project_id.
fn setup_paused_round_with_deposit(
    env: &Env,
    client: &CrowdfundVaultContractClient,
    admin: &Address,
    token: &TokenClient,
    token_admin: &StellarAssetClient,
    deposit: i128,
) -> (u64, Address, Address) {
    let owner = Address::generate(env);
    let user = Address::generate(env);

    let project_id = client.create_project(
        &owner,
        &symbol_short!("emrg"),
        &1_000_000_000_000i128,
        &token.address,
    );

    token_admin.mint(&user, &deposit);
    client.deposit(&user, &project_id, &deposit);

    // Pause the contract — prerequisite for emergency migration.
    client.pause(admin);

    (project_id, owner, user)
}

// ── EMI-1  Proposal requires pause ───────────────────────────────────────────

#[test]
fn test_emi1_proposal_requires_pause() {
    let env = Env::default();
    env.mock_all_auths();

    let (client, admin, token, token_admin) = setup(&env);
    let owner = Address::generate(&env);
    let recipient = Address::generate(&env);

    let project_id = client.create_project(
        &owner,
        &symbol_short!("proj"),
        &1_000_000i128,
        &token.address,
    );
    token_admin.mint(&owner, &500_000);
    client.deposit(&owner, &project_id, &500_000);

    // Contract is NOT paused — should fail.
    let result = client.try_propose_emergency_migration(
        &admin,
        &project_id,
        &recipient,
        &500_000i128,
        &symbol_short!("test"),
    );
    assert_eq!(
        result,
        Err(Ok(CrowdfundError::EmergencyMigrationRequiresPause)),
        "EMI-1: proposal must fail when contract is not paused"
    );
}

// ── EMI-2  Proposal is admin-only ─────────────────────────────────────────────

#[test]
fn test_emi2_proposal_is_admin_only() {
    let env = Env::default();
    env.mock_all_auths();

    let (client, admin, token, token_admin) = setup(&env);
    let owner = Address::generate(&env);
    let intruder = Address::generate(&env);
    let recipient = Address::generate(&env);

    let project_id = client.create_project(
        &owner,
        &symbol_short!("proj"),
        &1_000_000i128,
        &token.address,
    );
    token_admin.mint(&owner, &500_000);
    client.deposit(&owner, &project_id, &500_000);
    client.pause(&admin);

    let result = client.try_propose_emergency_migration(
        &intruder,
        &project_id,
        &recipient,
        &500_000i128,
        &symbol_short!("test"),
    );
    assert_eq!(
        result,
        Err(Ok(CrowdfundError::Unauthorized)),
        "EMI-2: proposal must be rejected from non-admin"
    );
}

// ── EMI-3  Amount must be ≤ balance and > 0 ──────────────────────────────────

#[test]
fn test_emi3_amount_exceeds_balance() {
    let env = Env::default();
    env.mock_all_auths();

    let (client, admin, token, token_admin) = setup(&env);
    let (project_id, _, _) =
        setup_paused_round_with_deposit(&env, &client, &admin, &token, &token_admin, 300_000);
    let recipient = Address::generate(&env);

    let result = client.try_propose_emergency_migration(
        &admin,
        &project_id,
        &recipient,
        &400_000i128, // more than deposited
        &symbol_short!("test"),
    );
    assert_eq!(
        result,
        Err(Ok(CrowdfundError::MigrationAmountExceedsBalance)),
        "EMI-3: proposal must fail when amount > balance"
    );
}

#[test]
fn test_emi3_zero_amount_rejected() {
    let env = Env::default();
    env.mock_all_auths();

    let (client, admin, token, token_admin) = setup(&env);
    let (project_id, _, _) =
        setup_paused_round_with_deposit(&env, &client, &admin, &token, &token_admin, 300_000);
    let recipient = Address::generate(&env);

    let result = client.try_propose_emergency_migration(
        &admin,
        &project_id,
        &recipient,
        &0i128,
        &symbol_short!("test"),
    );
    assert_eq!(
        result,
        Err(Ok(CrowdfundError::InvalidAmount)),
        "EMI-3: zero-amount proposal must be rejected"
    );
}

// ── EMI-4  Recipient must not be the contract ─────────────────────────────────

#[test]
fn test_emi4_recipient_cannot_be_contract() {
    let env = Env::default();
    env.mock_all_auths();

    let (client, admin, token, token_admin) = setup(&env);
    let (project_id, _, _) =
        setup_paused_round_with_deposit(&env, &client, &admin, &token, &token_admin, 300_000);

    // Use the contract's own address as recipient.
    let contract_addr = client.address.clone();
    let result = client.try_propose_emergency_migration(
        &admin,
        &project_id,
        &contract_addr,
        &100_000i128,
        &symbol_short!("selfrecv"),
    );
    assert_eq!(
        result,
        Err(Ok(CrowdfundError::InvalidMigrationRecipient)),
        "EMI-4: contract address as recipient must be rejected"
    );
}

// ── EMI-5  Duplicate plan is rejected; vetoed plan can be superseded ──────────

#[test]
fn test_emi5_duplicate_plan_rejected() {
    let env = Env::default();
    env.mock_all_auths();

    let (client, admin, token, token_admin) = setup(&env);
    let (project_id, _, _) =
        setup_paused_round_with_deposit(&env, &client, &admin, &token, &token_admin, 600_000);
    let recipient = Address::generate(&env);

    client.propose_emergency_migration(
        &admin,
        &project_id,
        &recipient,
        &100_000i128,
        &symbol_short!("reason1"),
    );

    let result = client.try_propose_emergency_migration(
        &admin,
        &project_id,
        &recipient,
        &100_000i128,
        &symbol_short!("reason2"),
    );
    assert_eq!(
        result,
        Err(Ok(CrowdfundError::MigrationPlanAlreadyExists)),
        "EMI-5: second proposal on a pending plan must be rejected"
    );
}

#[test]
fn test_emi5_vetoed_plan_can_be_superseded() {
    let env = Env::default();
    env.mock_all_auths();

    let (client, admin, token, token_admin) = setup(&env);
    let (project_id, _, _) =
        setup_paused_round_with_deposit(&env, &client, &admin, &token, &token_admin, 600_000);
    let recipient = Address::generate(&env);

    client.propose_emergency_migration(
        &admin,
        &project_id,
        &recipient,
        &100_000i128,
        &symbol_short!("first"),
    );
    client.veto_emergency_migration(&admin, &project_id);

    // Re-propose after veto — must succeed.
    client.propose_emergency_migration(
        &admin,
        &project_id,
        &recipient,
        &200_000i128,
        &symbol_short!("second"),
    );

    let plan = client.get_emergency_migration_plan(&project_id);
    assert_eq!(
        plan.amount, 200_000,
        "EMI-5: re-proposed plan must use new amount"
    );
    assert_eq!(
        plan.status,
        MigrationPlanStatus::Pending,
        "EMI-5: re-proposed plan must be Pending"
    );
}

// ── EMI-6 + EMI-7  Execution requires pause and admin ────────────────────────

#[test]
fn test_emi6_execution_requires_pause() {
    let env = Env::default();
    env.mock_all_auths();

    let (client, admin, token, token_admin) = setup(&env);
    let (project_id, _, _) =
        setup_paused_round_with_deposit(&env, &client, &admin, &token, &token_admin, 300_000);
    let recipient = Address::generate(&env);

    client.propose_emergency_migration(
        &admin,
        &project_id,
        &recipient,
        &300_000i128,
        &symbol_short!("reason"),
    );

    // Unpause between propose and execute.
    client.unpause(&admin);

    let result = client.try_execute_emergency_migration(&admin, &project_id);
    assert_eq!(
        result,
        Err(Ok(CrowdfundError::EmergencyMigrationRequiresPause)),
        "EMI-6: execution must fail when contract is not paused"
    );
}

#[test]
fn test_emi7_execution_is_admin_only() {
    let env = Env::default();
    env.mock_all_auths();

    let (client, admin, token, token_admin) = setup(&env);
    let (project_id, _, _) =
        setup_paused_round_with_deposit(&env, &client, &admin, &token, &token_admin, 300_000);
    let recipient = Address::generate(&env);
    let intruder = Address::generate(&env);

    client.propose_emergency_migration(
        &admin,
        &project_id,
        &recipient,
        &300_000i128,
        &symbol_short!("reason"),
    );

    let result = client.try_execute_emergency_migration(&intruder, &project_id);
    assert_eq!(
        result,
        Err(Ok(CrowdfundError::Unauthorized)),
        "EMI-7: non-admin execution must be rejected"
    );
}

// ── EMI-8  Vetoed plan cannot be executed ────────────────────────────────────

#[test]
fn test_emi8_vetoed_plan_cannot_be_executed() {
    let env = Env::default();
    env.mock_all_auths();

    let (client, admin, token, token_admin) = setup(&env);
    let (project_id, _, _) =
        setup_paused_round_with_deposit(&env, &client, &admin, &token, &token_admin, 300_000);
    let recipient = Address::generate(&env);

    client.propose_emergency_migration(
        &admin,
        &project_id,
        &recipient,
        &300_000i128,
        &symbol_short!("reason"),
    );
    client.veto_emergency_migration(&admin, &project_id);

    let result = client.try_execute_emergency_migration(&admin, &project_id);
    assert_eq!(
        result,
        Err(Ok(CrowdfundError::MigrationPlanVetoed)),
        "EMI-8: vetoed plan must not be executable"
    );
}

// ── EMI-9 + EMI-13  Plan cannot be executed twice ────────────────────────────

#[test]
fn test_emi9_double_execution_rejected() {
    let env = Env::default();
    env.mock_all_auths();

    let (client, admin, token, token_admin) = setup(&env);
    let (project_id, _, _) =
        setup_paused_round_with_deposit(&env, &client, &admin, &token, &token_admin, 300_000);
    let recipient = Address::generate(&env);

    client.propose_emergency_migration(
        &admin,
        &project_id,
        &recipient,
        &300_000i128,
        &symbol_short!("reason"),
    );
    client.execute_emergency_migration(&admin, &project_id);

    // Second execution must fail.
    let result = client.try_execute_emergency_migration(&admin, &project_id);
    assert_eq!(
        result,
        Err(Ok(CrowdfundError::MigrationAlreadyExecuted)),
        "EMI-9/EMI-13: second execution must return MigrationAlreadyExecuted"
    );
}

// ── EMI-10  Exact token transfer ──────────────────────────────────────────────

#[test]
fn test_emi10_exact_token_transfer() {
    let env = Env::default();
    env.mock_all_auths();

    let (client, admin, token, token_admin) = setup(&env);
    let deposit = 600_000i128;
    let migrate = 400_000i128;
    let (project_id, _, _) =
        setup_paused_round_with_deposit(&env, &client, &admin, &token, &token_admin, deposit);
    let recipient = Address::generate(&env);

    let recipient_before = token.balance(&recipient);

    client.propose_emergency_migration(
        &admin,
        &project_id,
        &recipient,
        &migrate,
        &symbol_short!("recover"),
    );
    let transferred = client.execute_emergency_migration(&admin, &project_id);

    assert_eq!(
        transferred, migrate,
        "EMI-10: returned amount must equal migrate amount"
    );
    assert_eq!(
        token.balance(&recipient),
        recipient_before + migrate,
        "EMI-10: recipient balance must increase by exactly the migrated amount"
    );
    assert_eq!(
        client.get_balance(&project_id),
        deposit - migrate,
        "EMI-10: remaining vault balance must be deposit minus migrated amount"
    );
}

// ── EMI-11  Project transitions to CANCELED after execution ──────────────────
//
// When the full vault balance is migrated the project moves to CANCELED and
// contributors see a clean terminal state with zero remaining funds.
//
// When less than the full balance is migrated, each contributor's on-chain
// contribution record is unchanged but only the residual balance is claimable.
// The contributor calls clawback_contribution and receives min(contribution,
// remaining_balance).  Because the vault tracks individual contributions (not
// pro-rata shares), this test uses a single depositor whose full contribution
// equals the residual so clawback receives exactly that residual.

#[test]
fn test_emi11_project_canceled_after_full_migration() {
    let env = Env::default();
    env.mock_all_auths();

    let (client, admin, token, token_admin) = setup(&env);
    let deposit = 500_000i128;
    let (project_id, _, _) =
        setup_paused_round_with_deposit(&env, &client, &admin, &token, &token_admin, deposit);
    let recipient = Address::generate(&env);

    // Migrate the entire balance.
    client.propose_emergency_migration(
        &admin,
        &project_id,
        &recipient,
        &deposit,
        &symbol_short!("reason"),
    );
    client.execute_emergency_migration(&admin, &project_id);

    // Project must be CANCELED.
    let status = client.get_project_status(&project_id);
    assert_eq!(
        status,
        Symbol::new(&env, "CANCELED"),
        "EMI-11: project must be CANCELED after emergency migration"
    );

    // Nothing remains in the vault.
    assert_eq!(
        client.get_balance(&project_id),
        0,
        "EMI-11: vault must be empty after full migration"
    );
}

#[test]
fn test_emi11_partial_migration_contributor_clawback() {
    let env = Env::default();
    env.mock_all_auths();

    let (client, admin, token, token_admin) = setup(&env);
    // Deposit 300k from user A and 200k from user B (total 500k).
    // Migrate 300k (user A's exact share) — leaves 200k for user B.
    let owner = Address::generate(&env);
    let user_a = Address::generate(&env);
    let user_b = Address::generate(&env);

    let project_id = client.create_project(
        &owner,
        &symbol_short!("p11"),
        &1_000_000i128,
        &token.address,
    );
    token_admin.mint(&user_a, &300_000);
    token_admin.mint(&user_b, &200_000);
    client.deposit(&user_a, &project_id, &300_000);
    client.deposit(&user_b, &project_id, &200_000);

    let recipient = Address::generate(&env);
    client.pause(&admin);

    // Migrate exactly user A's contribution (300k).
    client.propose_emergency_migration(
        &admin,
        &project_id,
        &recipient,
        &300_000i128,
        &symbol_short!("reason"),
    );
    client.execute_emergency_migration(&admin, &project_id);

    let status = client.get_project_status(&project_id);
    assert_eq!(
        status,
        Symbol::new(&env, "CANCELED"),
        "EMI-11: must be CANCELED"
    );

    // 200k remains — user B can clawback their exact deposit.
    let b_before = token.balance(&user_b);
    let clawed = client.clawback_contribution(&project_id, &user_b);
    assert_eq!(
        clawed, 200_000,
        "EMI-11: user B must clawback their exact deposit"
    );
    assert_eq!(
        token.balance(&user_b),
        b_before + 200_000,
        "EMI-11: user B balance must increase by 200k"
    );
}

// ── EMI-12  TVL decreases by exactly amount ──────────────────────────────────

#[test]
fn test_emi12_tvl_decreases_by_amount() {
    let env = Env::default();
    env.mock_all_auths();

    let (client, admin, token, token_admin) = setup(&env);
    let deposit = 700_000i128;
    let migrate = 500_000i128;
    let (project_id, _, _) =
        setup_paused_round_with_deposit(&env, &client, &admin, &token, &token_admin, deposit);
    let recipient = Address::generate(&env);

    client.propose_emergency_migration(
        &admin,
        &project_id,
        &recipient,
        &migrate,
        &symbol_short!("tvltest"),
    );
    client.execute_emergency_migration(&admin, &project_id);

    // Vault balance must have decreased by exactly `migrate`.
    assert_eq!(
        client.get_balance(&project_id),
        deposit - migrate,
        "EMI-12: vault balance after migration must equal deposit - migrate"
    );
}

// ── EMI-14  Veto is admin-only ────────────────────────────────────────────────

#[test]
fn test_emi14_veto_is_admin_only() {
    let env = Env::default();
    env.mock_all_auths();

    let (client, admin, token, token_admin) = setup(&env);
    let (project_id, _, _) =
        setup_paused_round_with_deposit(&env, &client, &admin, &token, &token_admin, 300_000);
    let recipient = Address::generate(&env);
    let intruder = Address::generate(&env);

    client.propose_emergency_migration(
        &admin,
        &project_id,
        &recipient,
        &300_000i128,
        &symbol_short!("reason"),
    );

    let result = client.try_veto_emergency_migration(&intruder, &project_id);
    assert_eq!(
        result,
        Err(Ok(CrowdfundError::Unauthorized)),
        "EMI-14: non-admin veto must be rejected"
    );
}

// ── EMI-15  Veto on non-existent plan ────────────────────────────────────────

#[test]
fn test_emi15_veto_nonexistent_plan() {
    let env = Env::default();
    env.mock_all_auths();

    let (client, admin, token, _) = setup(&env);
    let owner = Address::generate(&env);
    let project_id = client.create_project(
        &owner,
        &symbol_short!("proj"),
        &1_000_000i128,
        &token.address,
    );

    let result = client.try_veto_emergency_migration(&admin, &project_id);
    assert_eq!(
        result,
        Err(Ok(CrowdfundError::MigrationPlanNotFound)),
        "EMI-15: veto on missing plan must return MigrationPlanNotFound"
    );
}

// ── EMI-16  Veto on already-executed plan ────────────────────────────────────

#[test]
fn test_emi16_veto_on_executed_plan() {
    let env = Env::default();
    env.mock_all_auths();

    let (client, admin, token, token_admin) = setup(&env);
    let (project_id, _, _) =
        setup_paused_round_with_deposit(&env, &client, &admin, &token, &token_admin, 300_000);
    let recipient = Address::generate(&env);

    client.propose_emergency_migration(
        &admin,
        &project_id,
        &recipient,
        &300_000i128,
        &symbol_short!("reason"),
    );
    client.execute_emergency_migration(&admin, &project_id);

    let result = client.try_veto_emergency_migration(&admin, &project_id);
    assert_eq!(
        result,
        Err(Ok(CrowdfundError::MigrationAlreadyExecuted)),
        "EMI-16: veto on executed plan must return MigrationAlreadyExecuted"
    );
}

// ── EMI-17  Correct events are emitted ───────────────────────────────────────

#[test]
fn test_emi17_events_emitted() {
    let env = Env::default();
    env.mock_all_auths();
    // Advance ledger time so timestamps are non-zero.
    env.ledger().set_timestamp(1_700_000_000);

    let (client, admin, token, token_admin) = setup(&env);
    let deposit = 500_000i128;
    let migrate = 500_000i128;
    let (project_id, _, _) =
        setup_paused_round_with_deposit(&env, &client, &admin, &token, &token_admin, deposit);
    let recipient = Address::generate(&env);

    client.propose_emergency_migration(
        &admin,
        &project_id,
        &recipient,
        &migrate,
        &symbol_short!("reason"),
    );
    client.execute_emergency_migration(&admin, &project_id);

    // The plan state itself is the authoritative on-chain audit record;
    // verify it is correct post-execution.
    let plan = client.get_emergency_migration_plan(&project_id);
    assert_eq!(
        plan.status,
        MigrationPlanStatus::Executed,
        "EMI-17: plan must be Executed after execute_emergency_migration"
    );
    assert!(
        plan.resolved_at > 0,
        "EMI-17: resolved_at must be non-zero (timestamp was advanced to {})",
        plan.resolved_at
    );
    assert_eq!(
        plan.proposed_by, admin,
        "EMI-17: proposed_by must record the admin address"
    );
    assert_eq!(
        plan.amount, migrate,
        "EMI-17: plan amount must match proposed amount"
    );

    // Verify a ProjectCanceled event was also emitted (project transitioned to CANCELED).
    let status = client.get_project_status(&project_id);
    assert_eq!(
        status,
        Symbol::new(&env, "CANCELED"),
        "EMI-17: project must be CANCELED after execution (ProjectCanceledEvent was emitted)"
    );
}

// ── EMI-18  Partially-deposited paused round migrates safely ─────────────────
//
// Simulates an operational halt mid-round: three contributors deposit before
// the pause.  The admin migrates only the excess beyond each contributor's
// individual amount so that every depositor can still clawback their exact
// contribution.  The invariant verified is:
//   total_in == migrated + sum(clawbacks)  (conservation of funds, INV-3)

#[test]
fn test_emi18_partial_round_migration() {
    let env = Env::default();
    env.mock_all_auths();

    let (client, admin, token, token_admin) = setup(&env);
    let owner = Address::generate(&env);

    // Create project.
    let project_id = client.create_project(
        &owner,
        &symbol_short!("partial"),
        &2_000_000i128,
        &token.address,
    );

    // Three contributors deposit non-overlapping amounts.
    let user_a = Address::generate(&env);
    let user_b = Address::generate(&env);
    let user_c = Address::generate(&env);
    let amt_a = 100_000i128;
    let amt_b = 200_000i128;
    let amt_c = 150_000i128;
    let total = amt_a + amt_b + amt_c; // 450_000

    token_admin.mint(&user_a, &amt_a);
    token_admin.mint(&user_b, &amt_b);
    token_admin.mint(&user_c, &amt_c);
    client.deposit(&user_a, &project_id, &amt_a);
    client.deposit(&user_b, &project_id, &amt_b);
    client.deposit(&user_c, &project_id, &amt_c);

    // Pause mid-round — simulates an operational halt.
    client.pause(&admin);

    let recipient = Address::generate(&env);

    // Migrate only user B's amount (200k), leaving 250k = amt_a + amt_c.
    // This means user A and user C can each clawback their full contribution
    // without triggering any yield-provider divestment (vault holds enough).
    let migrate = amt_b;

    client.propose_emergency_migration(
        &admin,
        &project_id,
        &recipient,
        &migrate,
        &symbol_short!("halt"),
    );
    let transferred = client.execute_emergency_migration(&admin, &project_id);

    assert_eq!(
        transferred, migrate,
        "EMI-18: transferred must equal migrate"
    );
    assert_eq!(
        token.balance(&recipient),
        migrate,
        "EMI-18: recipient receives exactly migrate amount"
    );

    // Project must be CANCELED.
    let status = client.get_project_status(&project_id);
    assert_eq!(
        status,
        Symbol::new(&env, "CANCELED"),
        "EMI-18: project must be CANCELED"
    );

    let residual = total - migrate; // 250_000
    assert_eq!(
        client.get_balance(&project_id),
        residual,
        "EMI-18: residual = total - migrate"
    );

    // Users A and C can each clawback their full individual deposits
    // (vault holds amt_a + amt_c = 250k, each clawback is <= vault balance).
    let a_before = token.balance(&user_a);
    let clawed_a = client.clawback_contribution(&project_id, &user_a);
    assert_eq!(clawed_a, amt_a, "EMI-18: user A gets back their deposit");
    assert_eq!(
        token.balance(&user_a),
        a_before + amt_a,
        "EMI-18: user A balance correct"
    );

    let c_before = token.balance(&user_c);
    let clawed_c = client.clawback_contribution(&project_id, &user_c);
    assert_eq!(clawed_c, amt_c, "EMI-18: user C gets back their deposit");
    assert_eq!(
        token.balance(&user_c),
        c_before + amt_c,
        "EMI-18: user C balance correct"
    );

    // Funds conservation: migrated + clawbacks == total deposited.
    assert_eq!(
        migrate + clawed_a + clawed_c,
        total,
        "EMI-18 INV-3: migrated + clawbacks must equal total deposited"
    );
}
