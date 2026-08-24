//! N-of-M weighted quorum approval for privileged protocol-registry actions.
//!
//! The registry historically gated every privileged action behind a single
//! `admin` address. This module adds a multi-admin approval lifecycle so
//! sensitive changes require agreement from several signers before executing.
//!
//! Design notes:
//! - Storage uses its own `QuorumKey` enum rather than extending the existing
//!   `storage::DataKey`. Soroban assigns XDR discriminants in declaration
//!   order, so separate key spaces mean this feature cannot shift the
//!   discriminants of already-deployed keys.
//! - `RegistryAction` binds the action's parameters at proposal time, so an
//!   approval cannot be replayed against different arguments.
//! - Weights are relative and the threshold uses the same unit, so a plain
//!   N-of-M policy is every signer at weight 1 with `threshold = N`.

use soroban_sdk::{contracttype, Address, Env, Symbol, Vec};

use crate::errors::RegistryError;
use crate::events;

/// Hard cap on signer set size, to keep per-call iteration cost bounded.
pub const MAX_SIGNERS: u32 = 10;

/// Proposals expire 72 hours after creation if the threshold is never reached.
pub const PROPOSAL_TTL_SECS: u64 = 72 * 60 * 60;

const LEDGER_THRESHOLD: u32 = 120_960; // ~1 week
const LEDGER_BUMP: u32 = 241_920; // ~2 weeks

/// Storage keys owned by the quorum module.
#[contracttype]
#[derive(Clone)]
pub enum QuorumKey {
    Config,
    Proposal(u64),
    NextProposalId,
}

/// A registered approver and its relative voting weight.
#[contracttype]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct Signer {
    pub address: Address,
    pub weight: u32,
}

/// N-of-M quorum configuration.
#[contracttype]
#[derive(Clone, Debug)]
pub struct QuorumConfig {
    pub signers: Vec<Signer>,
    pub threshold: u32,
}

/// Parameters for a module registration or upgrade proposal.
#[contracttype]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct ModuleProposal {
    pub name: Symbol,
    pub address: Address,
    pub version: u32,
}

/// Privileged registry actions that can be put to a quorum vote.
#[contracttype]
#[derive(Clone, Debug, Eq, PartialEq)]
pub enum RegistryAction {
    RegisterModule(ModuleProposal),
    UpdateModule(ModuleProposal),
    DeactivateModule(Symbol),
    ActivateModule(Symbol),
    SetAdmin(Address),
    /// Distinct from `SetAdmin` so an admin-rotation approval can never be
    /// redirected into a signer-set takeover.
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
    /// Addresses that already approved; used to reject double-signing.
    pub signers: Vec<Address>,
    pub weight_collected: u32,
}

pub(crate) fn get_config(env: &Env) -> Result<QuorumConfig, RegistryError> {
    env.storage()
        .instance()
        .get(&QuorumKey::Config)
        .ok_or(RegistryError::QuorumNotConfigured)
}

pub(crate) fn find_signer(config: &QuorumConfig, addr: &Address) -> Result<Signer, RegistryError> {
    for s in config.signers.iter() {
        if s.address == *addr {
            return Ok(s);
        }
    }
    Err(RegistryError::Unauthorized)
}

/// Validate a candidate config: non-empty, bounded, reachable threshold.
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

pub(crate) fn get_proposal(env: &Env, proposal_id: u64) -> Result<RegistryProposal, RegistryError> {
    env.storage()
        .instance()
        .get(&QuorumKey::Proposal(proposal_id))
        .ok_or(RegistryError::ProposalNotFound)
}

/// The id the next proposal will receive. Read-only.
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

fn take_next_id(env: &Env) -> u64 {
    let id = next_proposal_id(env);
    env.storage()
        .instance()
        .set(&QuorumKey::NextProposalId, &(id + 1));
    id
}

fn bump_ttl(env: &Env) {
    env.storage()
        .instance()
        .extend_ttl(LEDGER_THRESHOLD, LEDGER_BUMP);
}

/// Install the initial quorum policy. The first signer bootstraps it and must
/// authenticate the call.
pub(crate) fn configure(
    env: &Env,
    signers: Vec<Signer>,
    threshold: u32,
) -> Result<(), RegistryError> {
    if env.storage().instance().has(&QuorumKey::Config) {
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
    bump_ttl(env);

    events::QuorumConfiguredEvent {
        bootstrapper: bootstrapper.address,
        threshold,
        signer_count,
    }
    .publish(env);

    Ok(())
}

/// Replace the signer set / threshold. Only reachable through an executed
/// `SetQuorumConfig` proposal.
pub(crate) fn replace_config(
    env: &Env,
    signers: Vec<Signer>,
    threshold: u32,
) -> Result<(), RegistryError> {
    validate_config(&signers, threshold)?;

    let signer_count = signers.len();
    let config = QuorumConfig { signers, threshold };
    env.storage().instance().set(&QuorumKey::Config, &config);
    bump_ttl(env);

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
    let id = take_next_id(env);

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
    bump_ttl(env);

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

/// Add a signer's weight to an in-flight proposal. Re-signing is rejected, so
/// one approver cannot reach the threshold alone by calling this repeatedly.
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
    bump_ttl(env);

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

/// Consume an approved proposal's authority exactly once, marking it Executed.
///
/// Fails if the proposal is missing, not approved, expired, already spent, or
/// if `expected_action` differs from the approved action - including its bound
/// parameters.
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
    bump_ttl(env);

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
    bump_ttl(env);

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
    bump_ttl(env);

    Ok(())
}
