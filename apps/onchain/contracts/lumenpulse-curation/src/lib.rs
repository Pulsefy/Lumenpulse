#![no_std]

mod errors;
mod events;
mod storage;
mod types;

pub use errors::CurationError;
pub use types::{ProjectMetadata, ProjectStatus, ProposalState, VoteRecord};

use soroban_sdk::{contract, contractimpl, token, Address, Env};

use events::*;
use storage::*;

// ─── Constants ───────────────────────────────────────────────────────────────

/// Minimum XLM deposit (in stroops) required to propose a project.
/// Returned if the project is verified; burned/redistributed otherwise.
const PROPOSAL_DEPOSIT_STROOPS: i128 = 10_000_000; // 1 XLM

/// Fraction of total reputation that must vote YES to auto-verify.
/// 30% threshold (stored as basis points: 3000 / 10000).
const VERIFY_THRESHOLD_BPS: u32 = 3_000;

/// Voting window in ledgers (~5 seconds each). 7 days ≈ 120_960 ledgers.
const VOTING_WINDOW_LEDGERS: u32 = 120_960;

/// Minimum absolute YES votes before threshold math kicks in.
const MIN_YES_VOTES: u32 = 5;

// ─── Contract ────────────────────────────────────────────────────────────────

#[contract]
pub struct CommunityCurationContract;

#[contractimpl]
impl CommunityCurationContract {
    // ── Admin ────────────────────────────────────────────────────────────────

    /// Initialise the contract. Must be called once by the deployer.
    ///
    /// # Arguments
    /// * `admin`                – Admin address (can update parameters).
    /// * `deposit_token`        – Token accepted for proposal deposits (e.g. XLM wrapped).
    /// * `contributor_registry` – Address of the existing contributor-registry contract
    ///                            from which reputation scores are read.
    pub fn initialize(
        env: Env,
        admin: Address,
        deposit_token: Address,
        contributor_registry: Address,
    ) -> Result<(), CurationError> {
        if has_admin(&env) {
            return Err(CurationError::AlreadyInitialized);
        }
        admin.require_auth();
        set_admin(&env, &admin);
        set_deposit_token(&env, &deposit_token);
        set_contributor_registry(&env, &contributor_registry);
        set_next_project_id(&env, 1u64);
        Ok(())
    }

    // ── Core Entrypoints ─────────────────────────────────────────────────────

    /// Propose a new project for community curation.
    ///
    /// Caller must:
    ///   1. Approve `PROPOSAL_DEPOSIT_STROOPS` of the deposit token to this contract.
    ///   2. Call this function — the deposit is pulled atomically.
    ///
    /// Returns the newly assigned `project_id`.
    pub fn propose_project(
        env: Env,
        proposer: Address,
        metadata: ProjectMetadata,
    ) -> Result<u64, CurationError> {
        proposer.require_auth();

        // Validate metadata
        validate_metadata(&metadata)?;

        // Pull deposit
        let token_client = token::Client::new(&env, &get_deposit_token(&env));
        token_client.transfer(
            &proposer,
            &env.current_contract_address(),
            &PROPOSAL_DEPOSIT_STROOPS,
        );

        // Assign ID and persist
        let project_id = get_next_project_id(&env);
        set_next_project_id(&env, project_id + 1);

        let proposal = ProposalState {
            project_id,
            proposer: proposer.clone(),
            metadata: metadata.clone(),
            status: ProjectStatus::Pending,
            yes_votes: 0,
            no_votes: 0,
            total_voting_power_snapshot: 0, // filled lazily on first vote
            deposit_returned: false,
            created_ledger: env.ledger().sequence(),
            voting_ends_ledger: env.ledger().sequence() + VOTING_WINDOW_LEDGERS,
        };

        save_proposal(&env, project_id, &proposal);

        emit_project_proposed(&env, project_id, &proposer, &metadata);

        Ok(project_id)
    }

    /// Cast a vote on a pending project.
    ///
    /// Voting power = the voter's reputation score from the contributor-registry.
    /// Each address may vote exactly once per project.
    ///
    /// * `approve` – `true` = YES (verify), `false` = NO (reject).
    pub fn vote_to_verify(
        env: Env,
        voter: Address,
        project_id: u64,
        approve: bool,
    ) -> Result<(), CurationError> {
        voter.require_auth();

        let mut proposal = get_proposal(&env, project_id).ok_or(CurationError::ProjectNotFound)?;

        // Only vote on pending proposals within the window
        if proposal.status != ProjectStatus::Pending {
            return Err(CurationError::VotingClosed);
        }
        if env.ledger().sequence() > proposal.voting_ends_ledger {
            return Err(CurationError::VotingWindowExpired);
        }

        // Prevent double-voting
        if has_voted(&env, project_id, &voter) {
            return Err(CurationError::AlreadyVoted);
        }

        // Fetch voting power from contributor-registry
        let voting_power = Self::get_reputation(&env, &voter);
        if voting_power == 0 {
            return Err(CurationError::InsufficientReputation);
        }

        // Snapshot total voting power on first vote (gas-efficient approximation)
        if proposal.total_voting_power_snapshot == 0 {
            proposal.total_voting_power_snapshot = Self::get_total_reputation(&env);
        }

        // Record vote
        record_vote(&env, project_id, &voter);
        let vote_record = VoteRecord {
            voter: voter.clone(),
            project_id,
            approve,
            voting_power,
            ledger: env.ledger().sequence(),
        };
        save_vote_record(&env, project_id, &voter, &vote_record);

        if approve {
            proposal.yes_votes = proposal.yes_votes.saturating_add(voting_power);
        } else {
            proposal.no_votes = proposal.no_votes.saturating_add(voting_power);
        }

        // Check auto-verification threshold
        let status_changed = Self::evaluate_threshold(&env, &mut proposal);

        save_proposal(&env, project_id, &proposal);

        emit_vote_cast(&env, project_id, &voter, approve, voting_power);

        if status_changed {
            match proposal.status {
                ProjectStatus::Verified => {
                    emit_project_verified(&env, project_id);
                    // Return deposit to proposer
                    Self::return_deposit_inner(&env, &mut proposal);
                    save_proposal(&env, project_id, &proposal);
                }
                ProjectStatus::Rejected => {
                    emit_project_rejected(&env, project_id);
                }
                _ => {}
            }
        }

        Ok(())
    }

    /// Finalise a proposal whose voting window has expired without hitting a
    /// threshold automatically. Anyone can call this to clean up state.
    pub fn finalize_proposal(env: Env, project_id: u64) -> Result<ProjectStatus, CurationError> {
        let mut proposal = get_proposal(&env, project_id).ok_or(CurationError::ProjectNotFound)?;

        if proposal.status != ProjectStatus::Pending {
            return Ok(proposal.status.clone());
        }

        if env.ledger().sequence() <= proposal.voting_ends_ledger {
            return Err(CurationError::VotingWindowNotExpired);
        }

        // Expired without threshold → Rejected; deposit burned (stays in contract)
        proposal.status = ProjectStatus::Rejected;
        save_proposal(&env, project_id, &proposal);
        emit_proposal_expired(&env, project_id);

        Ok(ProjectStatus::Rejected)
    }

    // ── Admin Helpers ────────────────────────────────────────────────────────

    /// Admin can forcibly reject a project (e.g., legal/compliance reasons).
    pub fn admin_reject(env: Env, project_id: u64) -> Result<(), CurationError> {
        get_admin(&env).require_auth();

        let mut proposal = get_proposal(&env, project_id).ok_or(CurationError::ProjectNotFound)?;

        if proposal.status != ProjectStatus::Pending {
            return Err(CurationError::VotingClosed);
        }

        proposal.status = ProjectStatus::Rejected;
        save_proposal(&env, project_id, &proposal);
        emit_project_rejected(&env, project_id);
        Ok(())
    }

    // ── Queries ──────────────────────────────────────────────────────────────

    /// Returns `true` if the project has Verified status (eligible for matching).
    pub fn is_verified(env: Env, project_id: u64) -> bool {
        get_proposal(&env, project_id)
            .map(|p| p.status == ProjectStatus::Verified)
            .unwrap_or(false)
    }

    /// Full proposal state for off-chain dashboards.
    pub fn get_proposal_state(env: Env, project_id: u64) -> Option<ProposalState> {
        get_proposal(&env, project_id)
    }

    /// Voter's record for a given project (None = not voted).
    pub fn get_vote(env: Env, project_id: u64, voter: Address) -> Option<VoteRecord> {
        get_vote_record(&env, project_id, &voter)
    }

    pub fn get_deposit_amount(_env: Env) -> i128 {
        PROPOSAL_DEPOSIT_STROOPS
    }

    pub fn get_voting_window_ledgers(_env: Env) -> u32 {
        VOTING_WINDOW_LEDGERS
    }

    pub fn get_verify_threshold_bps(_env: Env) -> u32 {
        VERIFY_THRESHOLD_BPS
    }

    // ── Internal Helpers ─────────────────────────────────────────────────────

    /// Cross-contract call into contributor-registry to read a voter's reputation.
    fn get_reputation(env: &Env, voter: &Address) -> u64 {
        // contributor-registry exposes: get_reputation(address) -> u64
        let registry = get_contributor_registry(env);
        env.invoke_contract(
            &registry,
            &soroban_sdk::Symbol::new(env, "get_reputation"),
            soroban_sdk::vec![env, voter.to_val()],
        )
    }

    /// Cross-contract call to read the sum of all reputations (total supply proxy).
    fn get_total_reputation(env: &Env) -> u64 {
        let registry = get_contributor_registry(env);
        env.invoke_contract(
            &registry,
            &soroban_sdk::Symbol::new(env, "total_reputation"),
            soroban_sdk::vec![env],
        )
    }

    /// Check whether YES votes cross the threshold; update status in place.
    /// Returns `true` if status changed.
    fn evaluate_threshold(_env: &Env, proposal: &mut ProposalState) -> bool {
        let total = proposal.total_voting_power_snapshot;
        if total == 0 {
            return false;
        }

        let yes = proposal.yes_votes;
        let no = proposal.no_votes;

        // Auto-verify: absolute minimum + percentage threshold both met
        let yes_bps = (yes as u128)
            .saturating_mul(10_000)
            .checked_div(total as u128)
            .unwrap_or(0) as u32;

        if yes >= MIN_YES_VOTES as u64 && yes_bps >= VERIFY_THRESHOLD_BPS {
            proposal.status = ProjectStatus::Verified;
            return true;
        }

        // Auto-reject: NO votes exceed 50% — clear majority against
        let no_bps = (no as u128)
            .saturating_mul(10_000)
            .checked_div(total as u128)
            .unwrap_or(0) as u32;

        if no_bps > 5_000 {
            proposal.status = ProjectStatus::Rejected;
            return true;
        }

        false
    }

    /// Transfer the deposit back to the proposer (idempotent guard).
    fn return_deposit_inner(env: &Env, proposal: &mut ProposalState) {
        if proposal.deposit_returned {
            return;
        }
        let token_client = token::Client::new(env, &get_deposit_token(env));
        token_client.transfer(
            &env.current_contract_address(),
            &proposal.proposer,
            &PROPOSAL_DEPOSIT_STROOPS,
        );
        proposal.deposit_returned = true;
    }
}

// ─── Metadata Validation ─────────────────────────────────────────────────────

fn validate_metadata(m: &ProjectMetadata) -> Result<(), CurationError> {
    if m.name.is_empty() || m.name.len() > 100 {
        return Err(CurationError::InvalidMetadata);
    }
    if m.description.is_empty() || m.description.len() > 1000 {
        return Err(CurationError::InvalidMetadata);
    }
    Ok(())
}
