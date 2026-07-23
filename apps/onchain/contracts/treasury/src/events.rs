use soroban_sdk::{contractevent, Address, Env};

use crate::storage::{ProposalAction, ProposalStatus};

// ── Event Versioning ────────────────────────────────────────────────────────
//
// All events in this contract carry a `version` field as their first element.
// Bump `EVENT_VERSION` when the fields of any event are added, removed, or
// re-ordered. Consumers MUST check the `version` field they receive against
// the expected value to detect schema drift at runtime.
//
// See apps/onchain/EVENTS_GUIDE.md for the canonical pattern.

/// Current schema version for every event emitted by this contract.
/// Consumers should call `get_event_version()` on the deployed contract to
/// detect whether their parser is up to date.
pub const EVENT_VERSION: u32 = 1;

#[contractevent]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct StreamCreatedEvent {
    pub version: u32,
    #[topic]
    pub beneficiary: Address,
    pub amount: i128,
    pub start_time: u64,
    pub duration: u64,
}

#[contractevent]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct TokensClaimedEvent {
    pub version: u32,
    #[topic]
    pub beneficiary: Address,
    pub amount_claimed: i128,
    pub remaining: i128,
}

#[contractevent]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct BeneficiaryRotatedEvent {
    pub version: u32,
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
    pub version: u32,
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
    pub version: u32,
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
    pub version: u32,
    #[topic]
    pub proposal_id: u64,
    pub executor: Address,
    pub action: ProposalAction,
}

#[contractevent]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct ProposalCancelledEvent {
    pub version: u32,
    #[topic]
    pub proposal_id: u64,
    pub cancelled_by: Address,
}

#[contractevent]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct MultisigConfiguredEvt {
    pub version: u32,
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
        version: EVENT_VERSION,
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
        version: EVENT_VERSION,
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
        version: EVENT_VERSION,
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
        version: EVENT_VERSION,
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
        version: EVENT_VERSION,
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
        version: EVENT_VERSION,
        proposal_id,
        executor,
        action,
    }
    .publish(env);
}

pub fn publish_proposal_cancelled(env: &Env, proposal_id: u64, cancelled_by: Address) {
    ProposalCancelledEvent {
        version: EVENT_VERSION,
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
        version: EVENT_VERSION,
        configured_by,
        threshold,
        signer_count,
    }
    .publish(env);
}

// ── Stream lifecycle events ──────────────────────────────────

#[contractevent]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct StreamCancelledEvent {
    pub version: u32,
    #[topic]
    pub beneficiary: Address,
    pub total_unlocked: i128,
    pub refunded: i128,
    pub current_time: u64,
}

#[contractevent]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct EmergencyStopEvent {
    pub version: u32,
    #[topic]
    pub beneficiary: Address,
    pub reason: soroban_sdk::String,
    pub refunded: i128,
}

pub fn publish_stream_cancelled(
    env: &Env,
    beneficiary: &Address,
    total_unlocked: i128,
    refunded: i128,
    current_time: u64,
) {
    StreamCancelledEvent {
        version: EVENT_VERSION,
        beneficiary: beneficiary.clone(),
        total_unlocked,
        refunded,
        current_time,
    }
    .publish(env);
}

pub fn publish_emergency_stop(
    env: &Env,
    beneficiary: &Address,
    reason: soroban_sdk::String,
    refunded: i128,
) {
    EmergencyStopEvent {
        version: EVENT_VERSION,
        beneficiary: beneficiary.clone(),
        reason,
        refunded,
    }
    .publish(env);
}
