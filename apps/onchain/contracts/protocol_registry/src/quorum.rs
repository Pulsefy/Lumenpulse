//! N-of-M weighted quorum approval for privileged protocol-registry actions.
//!
//! The registry historically gated every privileged action behind a single
//! `admin` address. This module adds a multi-admin approval lifecycle so that
//! sensitive changes (module registration/upgrade, deactivation, admin
//! rotation) require agreement from several signers before they can execute.
//!
//! Design notes:
//!
//! - Storage uses its own [`QuorumKey`] enum rather than extending the
//!   pre-existing `storage::DataKey`. Soroban assigns XDR discriminants in
//!   declaration order, so keeping the two key spaces separate means this
//!   feature cannot shift the discriminants of already-deployed keys.
//! - [`RegistryAction`] binds the action's *parameters* at proposal time. A
//!   proposal approved to register `vault -> AAA v1` cannot be replayed at
//!   execution time against a different address or version, because
//!   [`consume_approval`] compares the whole action payload.
//! - Weights are relative and the threshold is expressed in the same unit, so
//!   a plain N-of-M policy is just "every signer has weight 1, threshold = N".

use soroban_sdk::{contracttype, Address, Env, Symbol, Vec};

use crate::errors::RegistryError;
use crate::events;

/// Hard cap on the signer set size, to keep per-call iteration cost bounded.
pub const MAX_SIGNERS: u32 = 10;

/// Proposals expire 72 hours after creation if the threshold is never reached.
pub const PROPOSAL_TTL_SECS: u64 = 72 * 60 * 60;

const LEDGER_THRESHOLD: u32 = 120_960; // ~1 week
const LEDGER_BUMP: u32 = 241_920; // ~2 weeks

/// Storage keys owned by the quorum module.
#[contracttype]
#[derive(Clone)]
pub enum QuorumKey {
    /// `QuorumConfig` — the signer set and threshold.
    Config,
    /// `RegistryProposal` keyed by proposal id.
    Proposal(u64),
    /// `u64` — monotonic proposal id counter.
    NextProposalId,
}

/// A registered approver and its relative voting weight.
#[contracttype]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct Signer {
    pub address: Address,
    /// Relative weight; the threshold is expressed in the same unit.
    pub weight: u32,
}

/// N-of-M quorum configuration.
#[contracttype]
#[derive(Clone, Debug)]
pub struct QuorumConfig {
    pub signers: Vec<Signer>,
    /// Total weight required before a proposal becomes executable.
    pub threshold: u32,
}

/// Parameters for a module registration or upgrade proposal.
///
/// Carried as a single struct so [`RegistryAction`] only needs single-field
/// variants, and so the full parameter set is covered by the equality check in
/// [`consume_approval`].
#[contracttype]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct ModuleProposal {
    pub name: Symbol,
    pub address: Address,
    pub version: u32,
}

/// The set of privileged registry actions that can be put to a quorum vote.
#[contracttype]
#[derive(Clone, Debug, Eq, PartialEq)]
pub enum RegistryAction {
    /// Register a brand new module.
    RegisterModule(ModuleProposal),
    /// Point an existing module at a new address/version.
    UpdateModule(ModuleProposal),
    /// Mark a module inactive so `resolve` refuses it.
    DeactivateModule(Symbol),
    /// Re-enable a previously deactivated module.
    ActivateModule(Symbol),
    /// Rotate the registry admin address.
    SetAdmin(Address),
    /// Replace the quorum signer set / threshold. Distinct from `SetAdmin` so
    /// an admin-rotation approval can never be redirected into a signer-set
    /// takeover.
    SetQuorumConfig,
}

#[contracttype]
#[derive(Copy, Clone, Debug, Eq, PartialEq)]
#[repr(u32)]
pub enum ProposalStatus {
    Pending = 0,
    Approved = 1,
    Executed = 2,
    Expired = 3,
    Cancelled = 4,
}

/// On-chain record of a single registry proposal.
#[contracttype]
#[derive(Clone, Debug)]
pub struct RegistryProposal {
    pub id: u64,
    pub action: RegistryAction,
    pub proposer: Address,
    pub created_at: u64,
    pub expires_at: u64,
    pub status: ProposalStatus,
    /// Addresses that have already approved; used to reject double-signing.
    pub signers: Vec<Address>,
    pub weight_collected: u32,
}

/// Load the quorum config, or `QuorumNotConfigured` if it was never set up.
pub(crate) fn get_config(env: &Env) -> Result<QuorumConfig, RegistryError> {
    env.storage()
        .instance()
        .get(&QuorumKey::Config)
        .ok_or(RegistryError::QuorumNotConfigured)
}

/// Returns true once a quorum policy has been installed.
pub(crate) fn is_configured(env: &Env) -> bool {
    env.storage().instance().has(&QuorumKey::Config)
}

/// Locate the signer record for `addr`, or reject as `Unauthorized`.
pub(crate) fn find_signer(config: &QuorumConfig, addr: &Address) -> Result<Signer, RegistryError> {
    for s in config.signers.iter() {
        if s.address == *addr {
            return Ok(s);
        }
    }
    Err(RegistryError::Unauthorized)
}

/// Validate a candidate config: non-empty, bounded, and a reachable threshold.
///
/// Rejecting `threshold > total_weight` matters because such a policy would
/// permanently deadlock every gated action.
pub(crate) fn validate_config(signers: &Vec<Signer>, threshold: u32) -> Result<(), RegistryError> {
    if signers.is_empty() || threshold == 0 {
        return Err(RegistryError::InvalidQuorumConfig);
    }
    if signers.len() > MAX_SIGNERS {
        return Err(RegistryError::TooManySigners);
    }
    let mut total: u32 = 0;
    for s in signers.iter() {
        if s.weight == 0 {
            return Err(RegistryError::InvalidQuorumConfig);
        }
        total = total
            .checked_add(s.weight)
            .ok_or(RegistryError::InvalidQuorumConfig)?;
    }
    if threshold > total {
        return Err(RegistryError::InvalidQuorumConfig);
    }
    Ok(())
}

/// Fetch a proposal by id.
pub(crate) fn get_proposal(env: &Env, proposal_id: u64) -> Result<RegistryProposal, RegistryError> {
    env.storage()
        .instance()
        .get(&QuorumKey::Proposal(proposal_id))
        .ok_or(RegistryError::ProposalNotFound)
}

/// The id the next proposal will receive. Read-only; does not advance the
/// counter.
pub(crate) fn next_proposal_id(env: &Env) -> u64 {
    env.storage()
        .instance()
        .get(&QuorumKey::NextProposalId)
        .unwrap_or(0)
}

/// Verify a proposal is still in flight (Pending or Approved, not expired).
fn assert_active(env: &Env, proposal: &RegistryProposal) -> Result<(), RegistryError> {
    match proposal.status {
        ProposalStatus::Pending | ProposalStatus::Approved => {}
        _ => return Err(RegistryError::ProposalNotActive),
    }
    if env.ledger().timestamp() > proposal.expires_at {
        return Err(RegistryError::ProposalExpired);
    }
    Ok(())
}

/// Pop the next monotonic proposal id.
fn next_id(env: &Env) -> u64 {
    let id: u64 = next_proposal_id(env);
    env.storage()
        .instance()
        .set(&QuorumKey::NextProposalId, &(id + 1));
    id
}

fn bump_instance_ttl(env: &Env) {
    env.storage()
        .instance()
        .extend_ttl(LEDGER_THRESHOLD, LEDGER_BUMP);
}

/// Install the initial quorum policy. The first signer bootstraps the policy
/// and must authenticate the call.
pub(crate) fn configure(
    env: &Env,
    signers: Vec<Signer>,
    threshold: u32,
) -> Result<(), RegistryError> {
    if is_configured(env) {
        return Err(RegistryError::QuorumAlreadyConfigured);
    }
    validate_config(&signers, threshold)?;

    let bootstrapper = signers.get(0).ok_or(RegistryError::InvalidQuorumConfig)?;
    bootstrapper.address.require_auth();

    let signer_count = signers.len();
    let config = QuorumConfig { signers, threshold };
    env.storage().instance().set(&QuorumKey::Config, &config);
    env.storage()
        .instance()
        .set(&QuorumKey::NextProposalId, &0u64);
    bump_instance_ttl(env);

    events::QuorumConfiguredEvent {
        bootstrapper: bootstrapper.address,
        threshold,
        signer_count,
    }
    .publish(env);

    Ok(())
}

/// Replace the signer set / threshold. Only reachable through an executed
/// `SetQuorumConfig` proposal, so rotating the approver set is itself gated.
pub(crate) fn replace_config(
    env: &Env,
    signers: Vec<Signer>,
    threshold: u32,
) -> Result<(), RegistryError> {
    validate_config(&signers, threshold)?;

    let signer_count = signers.len();
    let config = QuorumConfig { signers, threshold };
    env.storage().instance().set(&QuorumKey::Config, &config);
    bump_instance_ttl(env);

    events::QuorumReconfiguredEvent {
        threshold,
        signer_count,
    }
    .publish(env);

    Ok(())
}

/// Submit a proposal. The proposer must be a signer and its weight counts
/// immediately, so a 1-of-M policy auto-approves on creation.
pub(crate) fn propose(
    env: &Env,
    proposer: Address,
    action: RegistryAction,
) -> Result<u64, RegistryError> {
    proposer.require_auth();

    let config = get_config(env)?;
    let signer = find_signer(&config, &proposer)?;

    let now = env.ledger().timestamp();
    let id = next_id(env);

    let mut signers_vec = Vec::new(env);
    signers_vec.push_back(proposer.clone());

    let weight_collected = signer.weight;
    let status = if weight_collected >= config.threshold {
        ProposalStatus::Approved
    } else {
        ProposalStatus::Pending
    };

    let proposal = RegistryProposal {
        id,
        action: action.clone(),
        proposer: proposer.clone(),
        created_at: now,
        expires_at: now.saturating_add(PROPOSAL_TTL_SECS),
        status,
        signers: signers_vec,
        weight_collected,
    };

    env.storage()
        .instance()
        .set(&QuorumKey::Proposal(id), &proposal);
    bump_instance_ttl(env);

    events::ProposalCreatedEvent {
        proposal_id: id,
        proposer,
        action,
        weight_collected,
        threshold: config.threshold,
        status,
    }
    .publish(env);

    Ok(id)
}

/// Add a signer's weight to an in-flight proposal.
///
/// Re-signing is rejected with `ProposalAlreadySigned`, so one approver cannot
/// reach the threshold alone by calling this repeatedly.
pub(crate) fn sign(
    env: &Env,
    signer_addr: Address,
    proposal_id: u64,
) -> Result<ProposalStatus, RegistryError> {
    signer_addr.require_auth();

    let config = get_config(env)?;
    let signer = find_signer(&config, &signer_addr)?;
    let mut proposal = get_proposal(env, proposal_id)?;

    assert_active(env, &proposal)?;

    for existing in proposal.signers.iter() {
        if existing == signer_addr {
            return Err(RegistryError::ProposalAlreadySigned);
        }
    }

    proposal.signers.push_back(signer_addr.clone());
    proposal.weight_collected = proposal.weight_collected.saturating_add(signer.weight);

    if proposal.weight_collected >= config.threshold {
        proposal.status = ProposalStatus::Approved;
    }

    env.storage()
        .instance()
        .set(&QuorumKey::Proposal(proposal_id), &proposal);
    bump_instance_ttl(env);

    events::SignatureCollectedEvent {
        proposal_id,
        signer: signer_addr,
        weight_collected: proposal.weight_collected,
        threshold: config.threshold,
        status: proposal.status,
    }
    .publish(env);

    Ok(proposal.status)
}

/// Consume an approved proposal's authority exactly once and mark it Executed.
///
/// Fails if the proposal is missing, not yet approved, expired, already
/// executed, or if `expected_action` does not match the approved action -
/// including its bound parameters.
pub(crate) fn consume_approval(
    env: &Env,
    executor: &Address,
    proposal_id: u64,
    expected_action: &RegistryAction,
) -> Result<(), RegistryError> {
    executor.require_auth();

    let config = get_config(env)?;
    find_signer(&config, executor)?;

    let mut proposal = get_proposal(env, proposal_id)?;

    assert_active(env, &proposal)?;

    if proposal.status != ProposalStatus::Approved {
        return Err(RegistryError::ProposalNotApproved);
    }
    if &proposal.action != expected_action {
        return Err(RegistryError::WrongProposalAction);
    }

    proposal.status = ProposalStatus::Executed;
    env.storage()
        .instance()
        .set(&QuorumKey::Proposal(proposal_id), &proposal);
    bump_instance_ttl(env);

    events::ProposalExecutedEvent {
        proposal_id,
        executor: executor.clone(),
        action: expected_action.clone(),
    }
    .publish(env);

    Ok(())
}

/// Cancel an in-flight proposal. Any signer may cancel.
pub(crate) fn cancel(
    env: &Env,
    signer_addr: Address,
    proposal_id: u64,
) -> Result<(), RegistryError> {
    signer_addr.require_auth();

    let config = get_config(env)?;
    find_signer(&config, &signer_addr)?;

    let mut proposal = get_proposal(env, proposal_id)?;

    match proposal.status {
        ProposalStatus::Pending | ProposalStatus::Approved => {}
        _ => return Err(RegistryError::ProposalNotActive),
    }

    proposal.status = ProposalStatus::Cancelled;
    env.storage()
        .instance()
        .set(&QuorumKey::Proposal(proposal_id), &proposal);
    bump_instance_ttl(env);

    events::ProposalCancelledEvent {
        proposal_id,
        signer: signer_addr,
    }
    .publish(env);

    Ok(())
}

/// Mark a lapsed proposal `Expired`. Permissionless: expiry is a fact of the
/// ledger clock, not a privileged decision.
pub(crate) fn expire(env: &Env, proposal_id: u64) -> Result<(), RegistryError> {
    let mut proposal = get_proposal(env, proposal_id)?;

    match proposal.status {
        ProposalStatus::Pending | ProposalStatus::Approved => {}
        _ => return Err(RegistryError::ProposalNotActive),
    }

    if env.ledger().timestamp() <= proposal.expires_at {
        return Err(RegistryError::ProposalNotActive);
    }

    proposal.status = ProposalStatus::Expired;
    env.storage()
        .instance()
        .set(&QuorumKey::Proposal(proposal_id), &proposal);
    bump_instance_ttl(env);

    Ok(())
}
