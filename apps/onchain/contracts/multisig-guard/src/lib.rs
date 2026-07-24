#![no_std]

mod errors;
mod events;
pub mod storage;

use soroban_sdk::{Address, Env, Val, Vec};

pub use errors::MultisigError;
pub use storage::{
    MultisigConfig, MultisigDataKey, Proposal, ProposalStatus, Signer, MAX_SIGNERS,
    PROPOSAL_TTL_SECS,
};

pub fn get_config(env: &Env) -> Result<MultisigConfig, MultisigError> {
    env.storage()
        .instance()
        .get(&MultisigDataKey::MultisigConfig)
        .ok_or(MultisigError::NotInitialized)
}

pub fn find_signer(
    config: &MultisigConfig,
    addr: &Address,
) -> Result<Signer, MultisigError> {
    for s in config.signers.iter() {
        if s.address == *addr {
            return Ok(s);
        }
    }
    Err(MultisigError::Unauthorized)
}

pub fn validate_config(signers: &Vec<Signer>, threshold: u32) -> Result<(), MultisigError> {
    if signers.is_empty() || threshold == 0 {
        return Err(MultisigError::InvalidConfig);
    }
    if signers.len() > MAX_SIGNERS {
        return Err(MultisigError::TooManySigners);
    }
    let total: u32 = signers.iter().map(|s| s.weight).sum();
    if threshold > total {
        return Err(MultisigError::InvalidConfig);
    }
    Ok(())
}

pub fn get_proposal(env: &Env, proposal_id: u64) -> Result<Proposal, MultisigError> {
    env.storage()
        .instance()
        .get(&MultisigDataKey::Proposal(proposal_id))
        .ok_or(MultisigError::ProposalNotFound)
}

fn assert_active(env: &Env, proposal: &Proposal) -> Result<(), MultisigError> {
    match proposal.status {
        ProposalStatus::Pending | ProposalStatus::Approved => {}
        _ => return Err(MultisigError::ProposalNotActive),
    }
    if env.ledger().timestamp() > proposal.expires_at {
        return Err(MultisigError::ProposalExpired);
    }
    Ok(())
}

fn next_id(env: &Env) -> u64 {
    let id: u64 = env
        .storage()
        .instance()
        .get(&MultisigDataKey::NextProposalId)
        .unwrap_or(0);
    env.storage()
        .instance()
        .set(&MultisigDataKey::NextProposalId, &(id + 1));
    id
}

pub fn configure(
    env: &Env,
    signers: Vec<Signer>,
    threshold: u32,
) -> Result<(), MultisigError> {
    validate_config(&signers, threshold)?;

    let bootstrapper = signers.get(0).ok_or(MultisigError::InvalidConfig)?;
    bootstrapper.address.require_auth();

    let config = MultisigConfig {
        signers: signers.clone(),
        threshold,
    };
    env.storage()
        .instance()
        .set(&MultisigDataKey::MultisigConfig, &config);
    env.storage()
        .instance()
        .set(&MultisigDataKey::NextProposalId, &0u64);
    env.storage().instance().extend_ttl(
        storage::LEDGER_THRESHOLD,
        storage::LEDGER_BUMP,
    );
    Ok(())
}

pub fn replace_config(
    env: &Env,
    signers: Vec<Signer>,
    threshold: u32,
) -> Result<(), MultisigError> {
    validate_config(&signers, threshold)?;
    let config = MultisigConfig {
        signers: signers.clone(),
        threshold,
    };
    env.storage()
        .instance()
        .set(&MultisigDataKey::MultisigConfig, &config);
    Ok(())
}

pub fn propose(
    env: &Env,
    proposer: Address,
    action: Vec<Val>,
) -> Result<u64, MultisigError> {
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
        .set(&MultisigDataKey::Proposal(id), &proposal);

    events::publish_proposal_created(
        env,
        id,
        proposer,
        action,
        weight_collected,
        config.threshold,
    );

    Ok(id)
}

pub fn sign(
    env: &Env,
    signer_addr: Address,
    proposal_id: u64,
) -> Result<ProposalStatus, MultisigError> {
    signer_addr.require_auth();

    let config = get_config(env)?;
    let signer = find_signer(&config, &signer_addr)?;
    let mut proposal = get_proposal(env, proposal_id)?;

    assert_active(env, &proposal)?;

    for existing in proposal.signers.iter() {
        if existing == signer_addr {
            return Err(MultisigError::ProposalAlreadySigned);
        }
    }

    proposal.signers.push_back(signer_addr.clone());
    proposal.weight_collected += signer.weight;

    if proposal.weight_collected >= config.threshold {
        proposal.status = ProposalStatus::Approved;
    }

    env.storage()
        .instance()
        .set(&MultisigDataKey::Proposal(proposal_id), &proposal);

    events::publish_signature_collected(
        env,
        proposal_id,
        signer_addr,
        proposal.weight_collected,
        config.threshold,
        proposal.status,
    );

    Ok(proposal.status)
}

pub fn consume_approval(
    env: &Env,
    executor: &Address,
    proposal_id: u64,
    expected_action: &Vec<Val>,
) -> Result<(), MultisigError> {
    executor.require_auth();

    let config = get_config(env)?;
    find_signer(&config, executor)?;

    let mut proposal = get_proposal(env, proposal_id)?;

    assert_active(env, &proposal)?;

    if proposal.status != ProposalStatus::Approved {
        return Err(MultisigError::ProposalNotApproved);
    }
    if &proposal.action != expected_action {
        return Err(MultisigError::WrongProposalAction);
    }

    proposal.status = ProposalStatus::Executed;
    env.storage()
        .instance()
        .set(&MultisigDataKey::Proposal(proposal_id), &proposal);

    events::publish_proposal_executed(env, proposal_id, executor.clone(), expected_action.clone());

    Ok(())
}

pub fn cancel(
    env: &Env,
    signer_addr: Address,
    proposal_id: u64,
) -> Result<(), MultisigError> {
    signer_addr.require_auth();

    let config = get_config(env)?;
    find_signer(&config, &signer_addr)?;

    let mut proposal = get_proposal(env, proposal_id)?;

    match proposal.status {
        ProposalStatus::Pending | ProposalStatus::Approved => {}
        _ => return Err(MultisigError::ProposalNotActive),
    }

    proposal.status = ProposalStatus::Cancelled;
    env.storage()
        .instance()
        .set(&MultisigDataKey::Proposal(proposal_id), &proposal);

    events::publish_proposal_cancelled(env, proposal_id, signer_addr);

    Ok(())
}

pub fn expire(env: &Env, proposal_id: u64) -> Result<(), MultisigError> {
    let mut proposal = get_proposal(env, proposal_id)?;

    match proposal.status {
        ProposalStatus::Pending | ProposalStatus::Approved => {}
        _ => return Err(MultisigError::ProposalNotActive),
    }

    if env.ledger().timestamp() <= proposal.expires_at {
        return Err(MultisigError::ProposalNotActive);
    }

    proposal.status = ProposalStatus::Expired;
    env.storage()
        .instance()
        .set(&MultisigDataKey::Proposal(proposal_id), &proposal);

    Ok(())
}
