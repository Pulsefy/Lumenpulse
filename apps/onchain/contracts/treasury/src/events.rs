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

/// Emitted by `allocate_budget_with_cliff`. Carries the cliff timestamp so
/// indexers and admin tooling can render cliff-aware schedules.
#[contractevent]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct CliffStreamCreatedEvent {
    #[topic]
    pub beneficiary: Address,
    pub amount: i128,
    pub start_time: u64,
    pub duration: u64,
    pub cliff_time: u64,
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
pub struct MultisigConfiguredEvent {
    #[topic]
    pub configured_by: Address,
    pub threshold: u32,
    pub signer_count: u32,
}

#[contractevent]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct ProposalExpiredEvent {
    #[topic]
    pub proposal_id: u64,
    pub expired_at: u64,
}

#[contractevent]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct AdminChangedEvent {
    #[topic]
    pub old_admin: Address,
    pub new_admin: Address,
}

#[contractevent]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct StreamCancelledEvent {
    #[topic]
    pub beneficiary: Address,
    pub total_unlocked: i128,
    pub refundable: i128,
    pub cancelled_at: u64,
}

#[contractevent]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct EmergencyStopEvent {
    #[topic]
    pub beneficiary: Address,
    pub reason: soroban_sdk::String,
    pub full_refund: i128,
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

pub fn publish_cliff_stream_created(
    env: &Env,
    beneficiary: Address,
    amount: i128,
    start_time: u64,
    duration: u64,
    cliff_time: u64,
) {
    CliffStreamCreatedEvent {
        beneficiary,
        amount,
        start_time,
        duration,
        cliff_time,
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
    MultisigConfiguredEvent {
        configured_by,
        threshold,
        signer_count,
    }
    .publish(env);
}

pub fn publish_proposal_expired(env: &Env, proposal_id: u64, expired_at: u64) {
    ProposalExpiredEvent {
        proposal_id,
        expired_at,
    }
    .publish(env);
}

pub fn publish_admin_changed(env: &Env, old_admin: Address, new_admin: Address) {
    AdminChangedEvent {
        old_admin,
        new_admin,
    }
    .publish(env);
}

pub fn publish_stream_cancelled(
    env: &Env,
    beneficiary: Address,
    total_unlocked: i128,
    refundable: i128,
    cancelled_at: u64,
) {
    StreamCancelledEvent {
        beneficiary,
        total_unlocked,
        refundable,
        cancelled_at,
    }
    .publish(env);
}

pub fn publish_emergency_stop(
    env: &Env,
    beneficiary: Address,
    reason: soroban_sdk::String,
    full_refund: i128,
) {
    EmergencyStopEvent {
        beneficiary,
        reason,
        full_refund,
    }
    .publish(env);
}
