use soroban_sdk::{contractevent, Address, Env};

use crate::storage::{ProposalAction, ProposalStatus};

#[contractevent]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct StreamCreatedEvent {
    #[topic]
    pub beneficiary: Address,
    pub amount: i128,
    pub start_time: u64,
    pub duration: u64,
}

#[contractevent]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct TokensClaimedEvent {
    #[topic]
    pub beneficiary: Address,
    pub amount_claimed: i128,
    pub remaining: i128,
}

#[contractevent]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct BeneficiaryRotatedEvent {
    #[topic]
    pub old_beneficiary: Address,
    #[topic]
    pub new_beneficiary: Address,
    pub claimed_amount: i128,
    pub remaining_amount: i128,
}

// ── Multisig proposal events ─────────────────────────────────

#[contractevent]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct ProposalCreatedEvent {
    #[topic]
    pub proposal_id: u64,
    pub proposer: Address,
    pub action: ProposalAction,
    pub weight_collected: u32,
    pub threshold: u32,
}

#[contractevent]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct SignatureCollectedEvent {
    #[topic]
    pub proposal_id: u64,
    pub signer: Address,
    pub weight_collected: u32,
    pub threshold: u32,
    pub status: ProposalStatus,
}

#[contractevent]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct ProposalExecutedEvent {
    #[topic]
    pub proposal_id: u64,
    pub executor: Address,
    pub action: ProposalAction,
}

#[contractevent]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct ProposalCancelledEvent {
    #[topic]
    pub proposal_id: u64,
    pub cancelled_by: Address,
}

#[contractevent]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct MultisigConfiguredEvt {
    #[topic]
    pub configured_by: Address,
    pub threshold: u32,
    pub signer_count: u32,
}

// ── Publish helpers ──────────────────────────────────────────

pub fn publish_stream_created(
    env: &Env,
    beneficiary: Address,
    amount: i128,
    start_time: u64,
    duration: u64,
) {
    StreamCreatedEvent {
        beneficiary,
        amount,
        start_time,
        duration,
    }
    .publish(env);
}

pub fn publish_tokens_claimed(
    env: &Env,
    beneficiary: Address,
    amount_claimed: i128,
    remaining: i128,
) {
    TokensClaimedEvent {
        beneficiary,
        amount_claimed,
        remaining,
    }
    .publish(env);
}

pub fn publish_beneficiary_rotated(
    env: &Env,
    old_beneficiary: Address,
    new_beneficiary: Address,
    claimed_amount: i128,
    remaining_amount: i128,
) {
    BeneficiaryRotatedEvent {
        old_beneficiary,
        new_beneficiary,
        claimed_amount,
        remaining_amount,
    }
    .publish(env);
}

pub fn publish_proposal_created(
    env: &Env,
    proposal_id: u64,
    proposer: Address,
    action: ProposalAction,
    weight_collected: u32,
    threshold: u32,
) {
    ProposalCreatedEvent {
        proposal_id,
        proposer,
        action,
        weight_collected,
        threshold,
    }
    .publish(env);
}

pub fn publish_signature_collected(
    env: &Env,
    proposal_id: u64,
    signer: Address,
    weight_collected: u32,
    threshold: u32,
    status: ProposalStatus,
) {
    SignatureCollectedEvent {
        proposal_id,
        signer,
        weight_collected,
        threshold,
        status,
    }
    .publish(env);
}

pub fn publish_proposal_executed(
    env: &Env,
    proposal_id: u64,
    executor: Address,
    action: ProposalAction,
) {
    ProposalExecutedEvent {
        proposal_id,
        executor,
        action,
    }
    .publish(env);
}

pub fn publish_proposal_cancelled(env: &Env, proposal_id: u64, cancelled_by: Address) {
    ProposalCancelledEvent {
        proposal_id,
        cancelled_by,
    }
    .publish(env);
}

pub fn publish_multisig_configured(
    env: &Env,
    configured_by: Address,
    threshold: u32,
    signer_count: u32,
) {
    MultisigConfiguredEvt {
        configured_by,
        threshold,
        signer_count,
    }
    .publish(env);
}
