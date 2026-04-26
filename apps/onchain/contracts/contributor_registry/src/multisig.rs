use soroban_sdk::{contracttype, Address, Env, Vec};

use crate::errors::ContributorError;
use crate::events::{
    ProposalCancelledEvent, ProposalCreatedEvent, ProposalExecutedEvent, SignatureCollectedEvent,
};
use crate::storage::DataKey;

// ── Constants ────────────────────────────────────────────────

/// Proposals expire after 72 hours if threshold is never reached.
pub const PROPOSAL_TTL_SECS: u64 = 72 * 60 * 60;

/// Hard cap on the signer set size to keep iteration costs bounded.
pub const MAX_SIGNERS: u32 = 10;

// ── Types ────────────────────────────────────────────────────

/// A registered signer with a voting weight.
#[contracttype]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct Signer {
    pub address: Address,
    /// Relative weight; threshold is expressed in the same unit.
    pub weight: u32,
}

/// The N-of-M configuration stored on-chain.
#[contracttype]
#[derive(Clone, Debug)]
pub struct MultisigConfig {
    pub signers: Vec<Signer>,
    /// Minimum total weight required to approve a proposal.
    pub threshold: u32,
}

/// Every sensitive action gets its own variant so an approval for
/// `Upgrade` can never be replayed as a `SetAdmin`.
#[contracttype]
#[derive(Clone, Debug, Eq, PartialEq)]
pub enum ProposalAction {
    Upgrade,
    SetAdmin,
    UpdateReputation,
    GrantBadge,
    RevokeBadge,
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

/// Full on-chain proposal record.
#[contracttype]
#[derive(Clone, Debug)]
pub struct Proposal {
    pub id: u64,
    pub action: ProposalAction,
    pub proposer: Address,
    pub created_at: u64,
    pub expires_at: u64,
    pub status: ProposalStatus,
    pub signers: Vec<Address>,
    pub weight_collected: u32,
}

// ── Internal helpers ─────────────────────────────────────────

pub(crate) fn get_config(env: &Env) -> Result<MultisigConfig, ContributorError> {
    env.storage()
        .instance()
        .get(&DataKey::MultisigConfig)
        .ok_or(ContributorError::NotInitialized)
}

pub(crate) fn find_signer(
    config: &MultisigConfig,
    addr: &Address,
) -> Result<Signer, ContributorError> {
    for s in config.signers.iter() {
        if s.address == *addr {
            return Ok(s);
        }
    }
    Err(ContributorError::Unauthorized)
}

pub(crate) fn validate_config(
    signers: &Vec<Signer>,
    threshold: u32,
) -> Result<(), ContributorError> {
    if signers.is_empty() || threshold == 0 {
        return Err(ContributorError::InvalidMultisigConfig);
    }
    if signers.len() > MAX_SIGNERS {
        return Err(ContributorError::TooManySigners);
    }
    let total: u32 = signers.iter().map(|s| s.weight).sum();
    if threshold > total {
        return Err(ContributorError::InvalidMultisigConfig);
    }
    Ok(())
}

pub(crate) fn get_proposal(env: &Env, proposal_id: u64) -> Result<Proposal, ContributorError> {
    env.storage()
        .instance()
        .get(&DataKey::Proposal(proposal_id))
        .ok_or(ContributorError::ProposalNotFound)
}

fn assert_active(env: &Env, proposal: &Proposal) -> Result<(), ContributorError> {
    match proposal.status {
        ProposalStatus::Pending | ProposalStatus::Approved => {}
        _ => return Err(ContributorError::InvalidProposalStatus),
    }
    if env.ledger().timestamp() > proposal.expires_at {
        return Err(ContributorError::ProposalExpired);
    }
    Ok(())
}

fn next_id(env: &Env) -> u64 {
    let id: u64 = env
        .storage()
        .instance()
        .get(&DataKey::NextProposalId)
        .unwrap_or(0);
    env.storage()
        .instance()
        .set(&DataKey::NextProposalId, &(id + 1));
    id
}

// ── Public multisig operations ───────────────────────────────

pub(crate) fn propose(
    env: &Env,
    proposer: Address,
    action: ProposalAction,
) -> Result<u64, ContributorError> {
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

    let proposal = Proposal {
        id,
        action: action.clone(),
        proposer: proposer.clone(),
        created_at: now,
        expires_at: now + PROPOSAL_TTL_SECS,
        status,
        signers: signers_vec,
        weight_collected,
    };

    env.storage()
        .instance()
        .set(&DataKey::Proposal(id), &proposal);

    ProposalCreatedEvent {
        proposal_id: id,
        proposer,
        action,
        weight_collected,
        threshold: config.threshold,
    }
    .publish(env);

    Ok(id)
}

pub(crate) fn sign(
    env: &Env,
    signer_addr: Address,
    proposal_id: u64,
) -> Result<ProposalStatus, ContributorError> {
    signer_addr.require_auth();

    let config = get_config(env)?;
    let signer = find_signer(&config, &signer_addr)?;
    let mut proposal = get_proposal(env, proposal_id)?;

    assert_active(env, &proposal)?;

    for existing in proposal.signers.iter() {
        if existing == signer_addr {
            return Err(ContributorError::AlreadySigned);
        }
    }

    proposal.signers.push_back(signer_addr.clone());
    proposal.weight_collected += signer.weight;

    if proposal.weight_collected >= config.threshold {
        proposal.status = ProposalStatus::Approved;
    }

    env.storage()
        .instance()
        .set(&DataKey::Proposal(proposal_id), &proposal);

    SignatureCollectedEvent {
        proposal_id,
        signer: signer_addr,
        weight_collected: proposal.weight_collected,
        threshold: config.threshold,
        status: proposal.status,
    }
    .publish(env);

    Ok(proposal.status)
}

pub(crate) fn consume_approval(
    env: &Env,
    executor: &Address,
    proposal_id: u64,
    expected_action: &ProposalAction,
) -> Result<(), ContributorError> {
    executor.require_auth();

    let config = get_config(env)?;
    find_signer(&config, executor)?;

    let mut proposal = get_proposal(env, proposal_id)?;

    assert_active(env, &proposal)?;

    if proposal.status != ProposalStatus::Approved {
        return Err(ContributorError::BelowThreshold);
    }
    if &proposal.action != expected_action {
        return Err(ContributorError::InvalidProposalStatus);
    }

    proposal.status = ProposalStatus::Executed;
    env.storage()
        .instance()
        .set(&DataKey::Proposal(proposal_id), &proposal);

    ProposalExecutedEvent {
        proposal_id,
        executor: executor.clone(),
        action: expected_action.clone(),
    }
    .publish(env);

    Ok(())
}

pub(crate) fn cancel(
    env: &Env,
    signer_addr: Address,
    proposal_id: u64,
) -> Result<(), ContributorError> {
    signer_addr.require_auth();

    let config = get_config(env)?;
    find_signer(&config, &signer_addr)?;

    let mut proposal = get_proposal(env, proposal_id)?;

    match proposal.status {
        ProposalStatus::Pending | ProposalStatus::Approved => {}
        _ => return Err(ContributorError::InvalidProposalStatus),
    }

    proposal.status = ProposalStatus::Cancelled;
    env.storage()
        .instance()
        .set(&DataKey::Proposal(proposal_id), &proposal);

    ProposalCancelledEvent {
        proposal_id,
        cancelled_by: signer_addr,
    }
    .publish(env);

    Ok(())
}

pub(crate) fn expire(env: &Env, proposal_id: u64) -> Result<(), ContributorError> {
    let mut proposal = get_proposal(env, proposal_id)?;

    match proposal.status {
        ProposalStatus::Pending | ProposalStatus::Approved => {}
        _ => return Err(ContributorError::InvalidProposalStatus),
    }

    if env.ledger().timestamp() <= proposal.expires_at {
        return Err(ContributorError::InvalidProposalStatus);
    }

    proposal.status = ProposalStatus::Expired;
    env.storage()
        .instance()
        .set(&DataKey::Proposal(proposal_id), &proposal);

    Ok(())
}
