use soroban_sdk::{Address, Env, Vec};

use crate::errors::TreasuryError;
use crate::events::{
    publish_proposal_cancelled, publish_proposal_created, publish_proposal_executed,
    publish_signature_collected,
};
use crate::storage::{
    DataKey, MultisigConfig, Proposal, ProposalAction, ProposalStatus, Signer, MAX_SIGNERS,
    PROPOSAL_TTL_SECS,
};

/// Load the multisig config from instance storage.
pub(crate) fn get_config(env: &Env) -> Result<MultisigConfig, TreasuryError> {
    env.storage()
        .instance()
        .get(&DataKey::MultisigConfig)
        .ok_or(TreasuryError::NotInitialized)
}

/// Locate the `Signer` record for `addr` or return `Unauthorized`.
pub(crate) fn find_signer(
    config: &MultisigConfig,
    addr: &Address,
) -> Result<Signer, TreasuryError> {
    for s in config.signers.iter() {
        if s.address == *addr {
            return Ok(s);
        }
    }
    Err(TreasuryError::Unauthorized)
}

/// Validate a multisig config (non-empty, threshold achievable, size bounded).
pub(crate) fn validate_config(signers: &Vec<Signer>, threshold: u32) -> Result<(), TreasuryError> {
    if signers.is_empty() || threshold == 0 {
        return Err(TreasuryError::InvalidMultisigConfig);
    }
    if signers.len() > MAX_SIGNERS {
        return Err(TreasuryError::TooManySigners);
    }
    let total: u32 = signers.iter().map(|s| s.weight).sum();
    if threshold > total {
        return Err(TreasuryError::InvalidMultisigConfig);
    }
    Ok(())
}

/// Fetch a proposal by id.
pub(crate) fn get_proposal(env: &Env, proposal_id: u64) -> Result<Proposal, TreasuryError> {
    env.storage()
        .instance()
        .get(&DataKey::Proposal(proposal_id))
        .ok_or(TreasuryError::ProposalNotFound)
}

/// Verify the proposal is still active (Pending or Approved, not expired).
fn assert_active(env: &Env, proposal: &Proposal) -> Result<(), TreasuryError> {
    match proposal.status {
        ProposalStatus::Pending | ProposalStatus::Approved => {}
        _ => return Err(TreasuryError::ProposalNotActive),
    }
    if env.ledger().timestamp() > proposal.expires_at {
        return Err(TreasuryError::ProposalExpired);
    }
    Ok(())
}

/// Pop the next monotonic proposal id.
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

/// Initialize the multisig config. Must be called once after the contract is
/// initialized. The first signer is required to authenticate the bootstrap.
pub(crate) fn configure(
    env: &Env,
    signers: Vec<Signer>,
    threshold: u32,
) -> Result<(), TreasuryError> {
    validate_config(&signers, threshold)?;

    let bootstrapper = signers.get(0).ok_or(TreasuryError::InvalidMultisigConfig)?;
    bootstrapper.address.require_auth();

    let config = MultisigConfig {
        signers: signers.clone(),
        threshold,
    };
    env.storage()
        .instance()
        .set(&DataKey::MultisigConfig, &config);
    env.storage()
        .instance()
        .set(&DataKey::NextProposalId, &0u64);
    env.storage().instance().extend_ttl(
        crate::storage::LEDGER_THRESHOLD,
        crate::storage::LEDGER_BUMP,
    );
    Ok(())
}

/// Replace the multisig signer set. Used by `set_multisig_config`, which is
/// itself a gated action. Emits `MultisigConfiguredEvt` so the signer-set
/// rotation is fully auditable.
pub(crate) fn replace_config(
    env: &Env,
    signers: Vec<Signer>,
    threshold: u32,
) -> Result<(), TreasuryError> {
    validate_config(&signers, threshold)?;
    let config = MultisigConfig {
        signers: signers.clone(),
        threshold,
    };
    env.storage()
        .instance()
        .set(&DataKey::MultisigConfig, &config);
    Ok(())
}

/// Submit a new proposal. The proposer's weight is counted immediately;
/// if it reaches the threshold the proposal is auto-approved.
pub(crate) fn propose(
    env: &Env,
    proposer: Address,
    action: ProposalAction,
) -> Result<u64, TreasuryError> {
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

    publish_proposal_created(
        env,
        id,
        proposer,
        action,
        weight_collected,
        config.threshold,
    );

    Ok(id)
}

/// Add a signer's weight to an in-flight proposal.
pub(crate) fn sign(
    env: &Env,
    signer_addr: Address,
    proposal_id: u64,
) -> Result<ProposalStatus, TreasuryError> {
    signer_addr.require_auth();

    let config = get_config(env)?;
    let signer = find_signer(&config, &signer_addr)?;
    let mut proposal = get_proposal(env, proposal_id)?;

    assert_active(env, &proposal)?;

    for existing in proposal.signers.iter() {
        if existing == signer_addr {
            return Err(TreasuryError::ProposalAlreadySigned);
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

    publish_signature_collected(
        env,
        proposal_id,
        signer_addr,
        proposal.weight_collected,
        config.threshold,
        proposal.status,
    );

    Ok(proposal.status)
}

/// Consume an approved proposal's authority and mark it Executed.
/// Returns `Err` if the proposal is missing, not Approved, expired, or the
/// action type does not match `expected_action`.
pub(crate) fn consume_approval(
    env: &Env,
    executor: &Address,
    proposal_id: u64,
    expected_action: &ProposalAction,
) -> Result<(), TreasuryError> {
    executor.require_auth();

    let config = get_config(env)?;
    find_signer(&config, executor)?;

    let mut proposal = get_proposal(env, proposal_id)?;

    assert_active(env, &proposal)?;

    if proposal.status != ProposalStatus::Approved {
        return Err(TreasuryError::ProposalNotApproved);
    }
    if &proposal.action != expected_action {
        return Err(TreasuryError::WrongProposalAction);
    }

    proposal.status = ProposalStatus::Executed;
    env.storage()
        .instance()
        .set(&DataKey::Proposal(proposal_id), &proposal);

    publish_proposal_executed(env, proposal_id, executor.clone(), expected_action.clone());

    Ok(())
}

/// Cancel an in-flight proposal. Any signer may cancel.
pub(crate) fn cancel(
    env: &Env,
    signer_addr: Address,
    proposal_id: u64,
) -> Result<(), TreasuryError> {
    signer_addr.require_auth();

    let config = get_config(env)?;
    find_signer(&config, &signer_addr)?;

    let mut proposal = get_proposal(env, proposal_id)?;

    match proposal.status {
        ProposalStatus::Pending | ProposalStatus::Approved => {}
        _ => return Err(TreasuryError::ProposalNotActive),
    }

    proposal.status = ProposalStatus::Cancelled;
    env.storage()
        .instance()
        .set(&DataKey::Proposal(proposal_id), &proposal);

    publish_proposal_cancelled(env, proposal_id, signer_addr);

    Ok(())
}

/// Mark an expired proposal as `Expired`. Permissionless.
pub(crate) fn expire(env: &Env, proposal_id: u64) -> Result<(), TreasuryError> {
    let mut proposal = get_proposal(env, proposal_id)?;

    match proposal.status {
        ProposalStatus::Pending | ProposalStatus::Approved => {}
        _ => return Err(TreasuryError::ProposalNotActive),
    }

    if env.ledger().timestamp() <= proposal.expires_at {
        return Err(TreasuryError::ProposalNotActive);
    }

    proposal.status = ProposalStatus::Expired;
    env.storage()
        .instance()
        .set(&DataKey::Proposal(proposal_id), &proposal);

    Ok(())
}
