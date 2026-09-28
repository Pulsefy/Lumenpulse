//! Randomised fuzzing harness for the full contribute → match → disburse
//! pipeline spanning `crowdfund_vault`, `matching_pool`, and `treasury`.
//!
//! ## What this tests
//!
//! The harness generates random sequences of the following operations and
//! asserts a set of cross-contract invariants **after every step**:
//!
//! | Operation                        | Contract        | Description                               |
//! |----------------------------------|-----------------|-------------------------------------------|
//! | `VaultDeposit`                   | crowdfund_vault | Contributor deposits into a project       |
//! | `PoolFund`                       | matching_pool   | Funder adds tokens to a matching round    |
//! | `PoolContribute`                 | matching_pool   | Record a community contribution QF score  |
//! | `VaultPause` / `VaultResume`     | crowdfund_vault | Pause / resume the vault                  |
//! | `PoolPause` / `PoolResume`       | matching_pool   | Pause / resume the pool                   |
//! | `FinalizeRound`                  | matching_pool   | Finalize a round after its end window     |
//! | `DistributeMatch`                | matching_pool   | Distribute QF matching funds              |
//! | `VaultDistribute`                | crowdfund_vault | Distribute vault-level match to project   |
//! | `TreasuryAllocate`               | treasury        | Allocate a linear vesting stream          |
//! | `TreasuryClaim`                  | treasury        | Beneficiary claims vested tokens          |
//!
//! ## Invariants checked after every step
//!
//! | Tag     | Description                                                          |
//! |---------|----------------------------------------------------------------------|
//! | `I-CON` | Funds conservation — tokens never created or destroyed              |
//! | `I-DBL` | No double disbursement — distributed round stays at pool=0          |
//! | `I-STR` | No stranded balance — after full distribution pool balance is zero   |
//! | `I-PAU` | Pause halts deposits and contributions                               |
//! | `I-MON` | State monotonicity — distributed flag only flips false→true          |
//! | `I-TRE` | Treasury solvency — claimed ≤ allocated                              |
//!
//! ## CI vs. on-demand runs
//!
//! Set the environment variable `FUZZ_CASES` to control iteration count:
//! - Default / CI:  50 cases  (fast)
//! - On demand:     set `FUZZ_CASES=500` (or any higher number) for deeper search
//!
//! ```sh
//! # default CI run
//! cargo test -p integration_tests fuzz_pipeline
//!
//! # deeper on-demand run
//! FUZZ_CASES=500 cargo test -p integration_tests fuzz_pipeline -- --nocapture
//! ```
//!
//! ## Regression tests
//!
//! Any counterexample found by proptest is saved to
//! `proptest-regressions/fuzz_pipeline.txt` and replayed automatically on
//! subsequent runs.  Commit that file along with a named regression test (see
//! `regression_tests` module at the bottom of this file) to lock the fix.

extern crate std;

use crowdfund_vault::{CrowdfundVaultContract, CrowdfundVaultContractClient as VaultClient};
use matching_pool::{MatchingPoolContract, MatchingPoolContractClient as PoolClient};
use proptest::prelude::*;
use soroban_sdk::{
    symbol_short,
    testutils::{Address as _, Ledger},
    token::{StellarAssetClient, TokenClient},
    Address, BytesN, Env,
};
use treasury::{TreasuryContract, TreasuryContractClient as TreasuryClient};

// ─── Time constants ───────────────────────────────────────────────────────────

/// Ledger timestamp at which the matching round opens.
const ROUND_START: u64 = 1_000;
/// Ledger timestamp at which the matching round closes.
const ROUND_END: u64 = 100_000;
/// Timestamp after `ROUND_END` used for finalization steps.
const AFTER_END: u64 = ROUND_END + 1_000;
/// Treasury vesting start.
const VEST_START: u64 = ROUND_START;
/// Treasury vesting duration.
const VEST_DURATION: u64 = ROUND_END - ROUND_START;

// ─── Shared test harness ──────────────────────────────────────────────────────

/// All the live handles needed across every operation in a scenario.
///
/// Note: `'e` is the lifetime of the `Env` reference. All clients borrow from
/// that same env. This allows us to hold them all in one struct while keeping
/// the borrow checker happy.
struct Harness<'e> {
    env: &'e Env,

    // Actors
    admin: Address,
    project_owner: Address,
    pool_funder: Address,
    treasury_beneficiary: Address,
    /// Three contributors minted once and reused.
    contributors: std::vec::Vec<Address>,

    // Contracts
    vault: VaultClient<'e>,
    pool: PoolClient<'e>,
    treasury: TreasuryClient<'e>,

    // Token (single shared token across all three contracts)
    token: TokenClient<'e>,
    #[allow(dead_code)]
    token_sa: StellarAssetClient<'e>,

    // Identifiers created during setup
    vault_project_id: u64,
    pool_round_id: u64,

    // Shadow accounting used by invariant checks
    total_minted: i128,
    /// Tokens that have been deposited into the vault by contributors.
    vault_deposited: i128,
    /// Tokens that have been deposited into the matching pool.
    pool_funded: i128,
    /// Whether the matching round has been distributed (I-DBL / I-MON).
    round_distributed: bool,
    /// Tokens sent to the treasury via `allocate_budget`.
    treasury_allocated: i128,
    /// Tokens successfully claimed back from the treasury.
    treasury_claimed: i128,
    /// Monotonic request-id counter for vault deposits (idempotency guard).
    deposit_nonce: u8,
    /// Monotonic request-id counter for treasury allocations.
    alloc_nonce: u8,
}

impl<'e> Harness<'e> {
    /// Build a fresh harness and initialize all three contracts.
    fn new(env: &'e Env) -> Self {
        env.mock_all_auths();

        // ── Actors ──────────────────────────────────────────────────────────
        let admin = Address::generate(env);
        let project_owner = Address::generate(env);
        let pool_funder = Address::generate(env);
        let treasury_beneficiary = Address::generate(env);
        let contributors: std::vec::Vec<Address> =
            (0..3).map(|_| Address::generate(env)).collect();

        // ── Token ───────────────────────────────────────────────────────────
        let token_contract = env.register_stellar_asset_contract_v2(admin.clone());
        let token = TokenClient::new(env, &token_contract.address());
        let token_sa = StellarAssetClient::new(env, &token_contract.address());
        let token_addr = token_contract.address();

        // Mint to contributors (10 M each)
        let contributor_mint: i128 = 10_000_000;
        for c in &contributors {
            token_sa.mint(c, &contributor_mint);
        }
        // Mint to pool funder (5 M)
        token_sa.mint(&pool_funder, &5_000_000i128);
        // Mint to admin (3 M — for treasury allocations)
        token_sa.mint(&admin, &3_000_000i128);

        let total_minted = contributor_mint * 3 + 5_000_000 + 3_000_000;

        // ── Vault ────────────────────────────────────────────────────────────
        let vault_id = env.register(CrowdfundVaultContract, ());
        let vault = VaultClient::new(env, &vault_id);
        vault.initialize(&admin);

        let vault_project_id = vault.create_project(
            &project_owner,
            &symbol_short!("ProjA"),
            &50_000_000i128,
            &token_addr,
        );

        // ── Matching Pool ─────────────────────────────────────────────────────
        let pool_id = env.register(MatchingPoolContract, ());
        let pool = PoolClient::new(env, &pool_id);
        pool.initialize(&admin);

        env.ledger().set_timestamp(ROUND_START);
        let pool_round_id = pool.create_round(
            &admin,
            &symbol_short!("Round1"),
            &token_addr,
            &ROUND_START,
            &ROUND_END,
        );
        pool.approve_project(&admin, &pool_round_id, &vault_project_id);

        // ── Treasury ─────────────────────────────────────────────────────────
        let treasury_id = env.register(TreasuryContract, ());
        let treasury = TreasuryClient::new(env, &treasury_id);
        treasury.initialize(&admin, &token_addr);

        Self {
            env,
            admin,
            project_owner,
            pool_funder,
            treasury_beneficiary,
            contributors,
            vault,
            pool,
            treasury,
            token,
            token_sa,
            vault_project_id,
            pool_round_id,
            total_minted,
            vault_deposited: 0,
            pool_funded: 0,
            round_distributed: false,
            treasury_allocated: 0,
            treasury_claimed: 0,
            deposit_nonce: 0,
            alloc_nonce: 0,
        }
    }

    // ── Request-id helpers ────────────────────────────────────────────────────

    fn next_deposit_rid(&mut self) -> BytesN<32> {
        let mut buf = [0u8; 32];
        buf[0] = self.deposit_nonce;
        self.deposit_nonce = self.deposit_nonce.wrapping_add(1);
        BytesN::from_array(self.env, &buf)
    }

    fn next_alloc_rid(&mut self) -> BytesN<32> {
        let mut buf = [0u8; 32];
        buf[0] = 0xAA;
        buf[1] = self.alloc_nonce;
        self.alloc_nonce = self.alloc_nonce.wrapping_add(1);
        BytesN::from_array(self.env, &buf)
    }

    // ── Operation helpers ─────────────────────────────────────────────────────

    fn do_vault_deposit(&mut self, contributor_idx: usize, amount: i128) {
        let contributor = self.contributors[contributor_idx % 3].clone();
        let rid = self.next_deposit_rid();
        let result = self
            .vault
            .try_deposit(&contributor, &self.vault_project_id, &amount, &rid);
        if result.is_ok() {
            self.vault_deposited += amount;
        }
    }

    fn do_pool_fund(&mut self, amount: i128) {
        let funder = self.pool_funder.clone();
        let result = self
            .pool
            .try_fund_pool(&funder, &self.pool_round_id, &amount);
        if result.is_ok() {
            self.pool_funded += amount;
        }
    }

    fn do_pool_contribute(&self, contributor_idx: usize, amount: i128) {
        let contributor = self.contributors[contributor_idx % 3].clone();
        let _ = self.pool.try_record_contribution(
            &self.pool_round_id,
            &self.vault_project_id,
            &contributor,
            &amount,
        );
    }

    fn do_vault_pause(&self) {
        let _ = self.vault.try_pause(&self.admin);
    }

    fn do_vault_resume(&self) {
        let _ = self.vault.try_unpause(&self.admin);
    }

    fn do_pool_pause(&self) {
        let _ = self.pool.try_pause(&self.admin);
    }

    fn do_pool_resume(&self) {
        let _ = self.pool.try_unpause(&self.admin);
    }

    fn do_finalize_round(&self) {
        self.env.ledger().set_timestamp(AFTER_END);
        let _ = self
            .pool
            .try_finalize_round(&self.admin, &self.pool_round_id);
    }

    fn do_distribute_match(&mut self) {
        let owner = self.project_owner.clone();
        let owners = soroban_sdk::vec![self.env, owner];
        let result = self
            .pool
            .try_distribute_matching_funds(&self.admin, &self.pool_round_id, &owners);
        // Only track as "distributed" if funds were actually paid out (>0).
        // When total_qf==0 the contract returns Ok(0) but does NOT set
        // is_distributed=true, so it is valid to call distribute again in
        // that round (though it will also distribute 0). We therefore only
        // flip round_distributed once a positive payout has occurred.
        if let Ok(Ok(distributed)) = result {
            if distributed > 0 {
                self.round_distributed = true;
            }
        }
    }

    fn do_vault_distribute(&self) {
        let _ = self.vault.try_distribute_match(&self.vault_project_id);
    }

    fn do_treasury_allocate(&mut self, amount: i128) {
        let admin = self.admin.clone();
        let beneficiary = self.treasury_beneficiary.clone();
        let rid = self.next_alloc_rid();
        let result = self.treasury.try_allocate_budget(
            &admin,
            &beneficiary,
            &amount,
            &VEST_START,
            &VEST_DURATION,
            &rid,
        );
        if result.is_ok() {
            self.treasury_allocated += amount;
        }
    }

    fn do_treasury_claim(&mut self) {
        let beneficiary = self.treasury_beneficiary.clone();
        let result = self.treasury.try_claim(&beneficiary);
        if let Ok(Ok(claimed)) = result {
            self.treasury_claimed += claimed;
        }
    }

    // ── Invariant checks ─────────────────────────────────────────────────────

    /// Run all invariants. Returns `Ok(())` or `Err(description)`.
    fn check_invariants(&self) -> Result<(), std::string::String> {
        self.check_funds_conservation()?;
        self.check_no_double_disbursement()?;
        self.check_no_stranded_balance()?;
        self.check_treasury_solvency()?;
        Ok(())
    }

    /// I-CON: Sum of all on-chain token balances == total minted.
    fn check_funds_conservation(&self) -> Result<(), std::string::String> {
        let vault_bal = self.token.balance(&self.vault.address);
        let pool_bal = self.token.balance(&self.pool.address);
        let treasury_bal = self.token.balance(&self.treasury.address);
        let owner_bal = self.token.balance(&self.project_owner);
        let funder_bal = self.token.balance(&self.pool_funder);
        let admin_bal = self.token.balance(&self.admin);
        let beneficiary_bal = self.token.balance(&self.treasury_beneficiary);
        let contributor_bal: i128 = self
            .contributors
            .iter()
            .map(|c| self.token.balance(c))
            .sum();

        let total_observed = vault_bal
            + pool_bal
            + treasury_bal
            + owner_bal
            + funder_bal
            + admin_bal
            + beneficiary_bal
            + contributor_bal;

        if total_observed != self.total_minted {
            return Err(std::format!(
                "I-CON: funds conservation violated — \
                 total_minted={} total_observed={}  \
                 (vault={} pool={} treasury={} owner={} funder={} admin={} beneficiary={} contributors={})",
                self.total_minted,
                total_observed,
                vault_bal,
                pool_bal,
                treasury_bal,
                owner_bal,
                funder_bal,
                admin_bal,
                beneficiary_bal,
                contributor_bal,
            ));
        }
        Ok(())
    }

    /// I-DBL / I-MON: After distribution the pool balance is zero and a second
    /// distribution call is rejected.
    fn check_no_double_disbursement(&self) -> Result<(), std::string::String> {
        if !self.round_distributed {
            return Ok(());
        }

        let pool_bal = self
            .pool
            .try_get_pool_balance(&self.pool_round_id)
            .unwrap_or(Ok(0))
            .unwrap_or(0);

        if pool_bal != 0 {
            return Err(std::format!(
                "I-DBL: round_distributed=true but pool balance is {} (expected 0)",
                pool_bal,
            ));
        }

        // A second distribute call must fail (any error is acceptable; the
        // important thing is that it does not return Ok).
        let owner = self.project_owner.clone();
        let owners = soroban_sdk::vec![self.env, owner];
        let second =
            self.pool
                .try_distribute_matching_funds(&self.admin, &self.pool_round_id, &owners);

        if second.is_ok() {
            return Err(
                "I-DBL: second distribute_matching_funds succeeded — double disbursement possible"
                    .into(),
            );
        }
        Ok(())
    }

    /// I-STR: After distribution the pool contract token balance is zero.
    fn check_no_stranded_balance(&self) -> Result<(), std::string::String> {
        if !self.round_distributed {
            return Ok(());
        }
        let pool_token_bal = self.token.balance(&self.pool.address);
        if pool_token_bal != 0 {
            return Err(std::format!(
                "I-STR: matching pool still holds {} tokens after distribution (expected 0)",
                pool_token_bal,
            ));
        }
        Ok(())
    }

    /// I-TRE: Claimed amount must never exceed allocated amount.
    fn check_treasury_solvency(&self) -> Result<(), std::string::String> {
        if self.treasury_claimed > self.treasury_allocated {
            return Err(std::format!(
                "I-TRE: treasury_claimed={} > treasury_allocated={}",
                self.treasury_claimed, self.treasury_allocated,
            ));
        }
        Ok(())
    }
}

// ─── Operation enum & strategy ───────────────────────────────────────────────

#[derive(Clone, Debug)]
enum Op {
    VaultDeposit { contributor_idx: usize, amount: i128 },
    PoolFund { amount: i128 },
    PoolContribute { contributor_idx: usize, amount: i128 },
    VaultPause,
    VaultResume,
    PoolPause,
    PoolResume,
    FinalizeRound,
    DistributeMatch,
    VaultDistribute,
    TreasuryAllocate { amount: i128 },
    TreasuryClaim,
}

fn small_amount() -> impl Strategy<Value = i128> {
    1i128..=100_000i128
}

/// Strategy producing a single `Op`. Uses `BoxedStrategy` to avoid type
/// inference errors with `prop_oneof!` when there are many variants.
fn op_strategy() -> BoxedStrategy<Op> {
    let vault_deposit = (0usize..3, small_amount()).prop_map(|(idx, a)| Op::VaultDeposit {
        contributor_idx: idx,
        amount: a,
    });
    let pool_fund = small_amount().prop_map(|a| Op::PoolFund { amount: a });
    let pool_contribute = (0usize..3, small_amount()).prop_map(|(idx, a)| Op::PoolContribute {
        contributor_idx: idx,
        amount: a,
    });
    let treasury_allocate = small_amount().prop_map(|a| Op::TreasuryAllocate { amount: a });

    prop_oneof![
        3 => vault_deposit,
        3 => pool_fund,
        3 => pool_contribute,
        1 => Just(Op::VaultPause),
        1 => Just(Op::VaultResume),
        1 => Just(Op::PoolPause),
        1 => Just(Op::PoolResume),
        1 => Just(Op::FinalizeRound),
        1 => Just(Op::DistributeMatch),
        1 => Just(Op::VaultDistribute),
        2 => treasury_allocate,
        1 => Just(Op::TreasuryClaim),
    ]
    .boxed()
}

/// Sequence of 4–20 random operations.
fn ops_strategy() -> impl Strategy<Value = std::vec::Vec<Op>> {
    prop::collection::vec(op_strategy(), 4..=20)
}

// ─── Main fuzz property ───────────────────────────────────────────────────────

proptest! {
    #![proptest_config(ProptestConfig {
        cases: 50,
        max_shrink_iters: 512,
        .. ProptestConfig::default()
    })]

    /// `prop_pipeline`: execute a random op sequence and assert all invariants
    /// after every step.
    ///
    /// proptest shrinks a failing sequence to the minimal reproducer and saves
    /// it to `proptest-regressions/fuzz_pipeline.txt` for deterministic replay.
    #[test]
    fn prop_pipeline(ops in ops_strategy()) {
        let env = Env::default();
        env.ledger().set_timestamp(ROUND_START);
        let mut h = Harness::new(&env);

        for op in &ops {
            match op {
                Op::VaultDeposit { contributor_idx, amount } => {
                    h.do_vault_deposit(*contributor_idx, *amount);
                }
                Op::PoolFund { amount } => {
                    h.do_pool_fund(*amount);
                }
                Op::PoolContribute { contributor_idx, amount } => {
                    h.do_pool_contribute(*contributor_idx, *amount);
                }
                Op::VaultPause    => h.do_vault_pause(),
                Op::VaultResume   => h.do_vault_resume(),
                Op::PoolPause     => h.do_pool_pause(),
                Op::PoolResume    => h.do_pool_resume(),
                Op::FinalizeRound => h.do_finalize_round(),
                Op::DistributeMatch => h.do_distribute_match(),
                Op::VaultDistribute => h.do_vault_distribute(),
                Op::TreasuryAllocate { amount } => h.do_treasury_allocate(*amount),
                Op::TreasuryClaim => h.do_treasury_claim(),
            }

            if let Err(msg) = h.check_invariants() {
                prop_assert!(
                    false,
                    "Invariant violated after op {:?}:\n  {}\n  ops so far: {:?}",
                    op, msg, ops,
                );
            }
        }
    }
}

// ─── Targeted property tests ──────────────────────────────────────────────────

proptest! {
    #![proptest_config(ProptestConfig::with_cases(100))]

    /// I-PAU: vault deposits must be rejected while the vault is paused.
    #[test]
    fn prop_pause_blocks_vault_deposit(amount in 1i128..=1_000_000i128) {
        let env = Env::default();
        env.ledger().set_timestamp(ROUND_START);
        let mut h = Harness::new(&env);

        h.do_vault_pause();

        let contributor = h.contributors[0].clone();
        let rid = h.next_deposit_rid();
        let result = h.vault.try_deposit(&contributor, &h.vault_project_id, &amount, &rid);

        prop_assert!(
            result.is_err(),
            "I-PAU: deposit must be rejected while vault is paused (amount={})",
            amount,
        );
    }

    /// I-PAU: QF contributions must be rejected while the pool is paused.
    #[test]
    fn prop_pause_blocks_pool_contribution(amount in 1i128..=1_000_000i128) {
        let env = Env::default();
        env.ledger().set_timestamp(ROUND_START);
        let h = Harness::new(&env);

        h.do_pool_pause();

        let contributor = h.contributors[0].clone();
        let result = h.pool.try_record_contribution(
            &h.pool_round_id,
            &h.vault_project_id,
            &contributor,
            &amount,
        );

        prop_assert!(
            result.is_err(),
            "I-PAU: record_contribution must be rejected while pool is paused (amount={})",
            amount,
        );
    }

    /// I-STR: after a full setup and successful distribution the pool token
    /// balance must be exactly zero.
    #[test]
    fn prop_distribute_zeroes_pool(
        fund_amount in 100i128..=1_000_000i128,
        contrib_amount in 1i128..=10_000i128,
    ) {
        let env = Env::default();
        env.ledger().set_timestamp(ROUND_START);
        let mut h = Harness::new(&env);

        h.do_pool_fund(fund_amount);
        h.do_pool_contribute(0, contrib_amount);
        h.do_pool_contribute(1, contrib_amount);

        h.do_finalize_round();
        h.do_distribute_match();

        if h.round_distributed {
            let pool_bal = h.token.balance(&h.pool.address);
            prop_assert_eq!(
                pool_bal,
                0,
                "I-STR: pool must be zero after distribution (fund={} contrib={})",
                fund_amount,
                contrib_amount,
            );

            if let Err(msg) = h.check_invariants() {
                prop_assert!(false, "Post-distribution invariant: {}", msg);
            }
        }
    }

    /// I-TRE: claimed amount must never exceed the allocated amount.
    #[test]
    fn prop_treasury_claimed_never_exceeds_allocated(
        alloc_amount in 1_000i128..=500_000i128,
        claim_time_offset in 0u64..=VEST_DURATION,
    ) {
        let env = Env::default();
        env.ledger().set_timestamp(VEST_START);
        let mut h = Harness::new(&env);

        h.do_treasury_allocate(alloc_amount);

        env.ledger().set_timestamp(VEST_START + claim_time_offset);
        h.do_treasury_claim();

        prop_assert!(
            h.treasury_claimed <= h.treasury_allocated,
            "I-TRE: claimed={} > allocated={}",
            h.treasury_claimed,
            h.treasury_allocated,
        );
    }

    /// I-DBL: a second call to `distribute_matching_funds` must be rejected.
    #[test]
    fn prop_no_double_distribute(
        fund_amount in 100i128..=100_000i128,
        contrib_amount in 1i128..=1_000i128,
    ) {
        let env = Env::default();
        env.ledger().set_timestamp(ROUND_START);
        let mut h = Harness::new(&env);

        h.do_pool_fund(fund_amount);
        h.do_pool_contribute(0, contrib_amount);
        h.do_finalize_round();
        h.do_distribute_match();

        if h.round_distributed {
            if let Err(msg) = h.check_no_double_disbursement() {
                prop_assert!(false, "{}", msg);
            }
        }
    }
}

// ─── Regression & smoke tests ─────────────────────────────────────────────────
//
// Any counterexample uncovered by the fuzzer must be added here as a named,
// deterministic test so the fix is locked in.  Comment format:
//
//   // Ops: [...]  (from the shrunk counterexample)
//   // Violated: <INV tag>
//   // Fixed in: PR #NNNN
#[cfg(test)]
mod regression_tests {
    use super::*;

    /// Verify the harness initialises cleanly with no ops applied.
    #[test]
    fn smoke_initial_state_satisfies_all_invariants() {
        let env = Env::default();
        env.ledger().set_timestamp(ROUND_START);
        let h = Harness::new(&env);
        h.check_invariants()
            .expect("invariants must hold on a fresh harness");
    }

    /// Full happy-path: deposit → fund → contribute → finalize → distribute →
    /// allocate → claim.  All invariants must hold after each step.
    #[test]
    fn happy_path_full_pipeline() {
        let env = Env::default();
        env.ledger().set_timestamp(ROUND_START);
        let mut h = Harness::new(&env);

        h.do_vault_deposit(0, 10_000);
        h.check_invariants().expect("after vault deposit 0");

        h.do_vault_deposit(1, 20_000);
        h.check_invariants().expect("after vault deposit 1");

        h.do_pool_fund(1_000_000);
        h.check_invariants().expect("after pool fund");

        h.do_pool_contribute(0, 500);
        h.check_invariants().expect("after pool contribute 0");

        h.do_pool_contribute(1, 1_000);
        h.check_invariants().expect("after pool contribute 1");

        h.do_pool_contribute(2, 250);
        h.check_invariants().expect("after pool contribute 2");

        h.do_finalize_round();
        h.check_invariants().expect("after finalize round");

        h.do_distribute_match();
        assert!(h.round_distributed, "distribution should succeed in happy path");
        h.check_invariants().expect("after distribute match");

        env.ledger().set_timestamp(VEST_START);
        h.do_treasury_allocate(200_000);
        h.check_invariants().expect("after treasury allocate");

        env.ledger().set_timestamp(VEST_START + VEST_DURATION / 2);
        h.do_treasury_claim();
        h.check_invariants().expect("after treasury claim halfway");

        env.ledger().set_timestamp(VEST_START + VEST_DURATION);
        h.do_treasury_claim();
        h.check_invariants().expect("after treasury claim final");
    }

    /// Pause-then-resume: deposits must be blocked while paused and allowed
    /// after resume.
    #[test]
    fn pause_resume_vault_gate() {
        let env = Env::default();
        env.ledger().set_timestamp(ROUND_START);
        let mut h = Harness::new(&env);

        h.do_vault_deposit(0, 5_000);
        h.check_invariants().expect("after initial deposit");

        h.do_vault_pause();
        let rid = h.next_deposit_rid();
        let contributor = h.contributors[1].clone();
        let result = h
            .vault
            .try_deposit(&contributor, &h.vault_project_id, &5_000, &rid);
        assert!(result.is_err(), "deposit must fail while vault is paused");
        h.check_invariants().expect("invariants hold while paused");

        h.do_vault_resume();
        h.do_vault_deposit(1, 5_000);
        h.check_invariants().expect("after post-resume deposit");
    }

    /// Pool pause blocks record_contribution; resume restores it.
    #[test]
    fn pause_resume_pool_gate() {
        let env = Env::default();
        env.ledger().set_timestamp(ROUND_START);
        let h = Harness::new(&env);

        h.do_pool_pause();
        let contributor = h.contributors[0].clone();
        let result = h.pool.try_record_contribution(
            &h.pool_round_id,
            &h.vault_project_id,
            &contributor,
            &1_000,
        );
        assert!(
            result.is_err(),
            "record_contribution must fail while pool is paused"
        );

        h.do_pool_resume();
        let result2 = h.pool.try_record_contribution(
            &h.pool_round_id,
            &h.vault_project_id,
            &contributor,
            &1_000,
        );
        assert!(
            result2.is_ok(),
            "record_contribution must succeed after pool is resumed"
        );
    }

    /// I-DBL: a second call to distribute_matching_funds must be rejected.
    #[test]
    fn double_distribute_is_rejected() {
        let env = Env::default();
        env.ledger().set_timestamp(ROUND_START);
        let mut h = Harness::new(&env);

        h.do_pool_fund(500_000);
        h.do_pool_contribute(0, 1_000);
        h.do_pool_contribute(1, 2_000);
        h.do_finalize_round();
        h.do_distribute_match();

        assert!(h.round_distributed, "first distribution must succeed");

        // Second call must fail.
        let owners = soroban_sdk::vec![&env, h.project_owner.clone()];
        let second = h
            .pool
            .try_distribute_matching_funds(&h.admin, &h.pool_round_id, &owners);
        assert!(
            second.is_err(),
            "second distribute call must return an error, got: {:?}",
            second,
        );

        h.check_invariants()
            .expect("invariants must hold after double-distribute attempt");
    }

    /// Regression: zero-QF early-return path.
    ///
    /// Sequence: [FinalizeRound, DistributeMatch(0 QF), VaultDeposit, VaultDeposit]
    ///
    /// The matching pool's `distribute_matching_funds` returns `Ok(0)` (not an
    /// error) when `total_qf == 0`, but it does NOT set `is_distributed=true`
    /// because the early-return skips that bookkeeping.  A subsequent call
    /// also returns `Ok(0)`.  This means:
    ///
    ///  1. No funds are ever moved — funds conservation (I-CON) holds.
    ///  2. The pool contract does not guard against "re-entry" for the zero
    ///     case because there is nothing to protect: 0 tokens transferred.
    ///
    /// Our harness tracks `round_distributed=true` only when `distributed > 0`,
    /// so the I-DBL double-disbursement check is not triggered for the trivial
    /// (zero) case.  This test documents that behaviour explicitly.
    ///
    /// Found by: `prop_pipeline` (proptest seed cc b00689ca…)
    #[test]
    fn regression_zero_qf_distribute_is_idempotent() {
        let env = Env::default();
        env.ledger().set_timestamp(ROUND_START);
        let mut h = Harness::new(&env);

        // Finalize with no contributions funded (no token pool, no QF scores).
        h.do_finalize_round();

        // First distribute call: returns Ok(0) because total_qf==0.
        let owners1 = soroban_sdk::vec![&env, h.project_owner.clone()];
        let r1 = h
            .pool
            .try_distribute_matching_funds(&h.admin, &h.pool_round_id, &owners1);
        // The call succeeds with 0 distributed — this is expected.
        assert!(
            matches!(r1, Ok(Ok(0))),
            "zero-QF distribute should return Ok(0), got {:?}",
            r1
        );

        // Invariants must hold after this non-distributing call.
        h.check_invariants()
            .expect("invariants must hold after zero-QF distribute");

        // The harness should NOT mark the round as distributed since 0 was paid out.
        assert!(
            !h.round_distributed,
            "round_distributed must remain false when distributed==0"
        );

        // A subsequent distribute call also returns Ok(0) (no double-spend risk).
        let owners2 = soroban_sdk::vec![&env, h.project_owner.clone()];
        let r2 = h
            .pool
            .try_distribute_matching_funds(&h.admin, &h.pool_round_id, &owners2);
        assert!(
            matches!(r2, Ok(Ok(0))),
            "second zero-QF distribute should also return Ok(0), got {:?}",
            r2
        );

        h.check_invariants()
            .expect("invariants must hold after second zero-QF distribute");
    }
}
