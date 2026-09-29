use event_versioning::{versioned_event, VersionedEvent};
use soroban_sdk::{contractevent, Address, Env};

use crate::storage::{ProposalAction, ProposalStatus};

// Every event below follows the canonical event-versioning convention
// (issue #1057, `event-versioning` crate): a `#[topic] pub version: u32`
// field as the first field, an `EVENT_VERSION` constant via
// `versioned_event!`, and a publish helper that sets `version` from that
// constant rather than a literal. See `event-versioning`'s crate docs for
// the full rationale and the rule for when to bump a version.

#[contractevent]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct StreamCreatedEvent {
    #[topic]
    pub version: u32,
    #[topic]
    pub beneficiary: Address,
    pub amount: i128,
    pub start_time: u64,
    pub duration: u64,
}
versioned_event!(StreamCreatedEvent, 1);

/// Emitted by `allocate_budget_with_cliff`. Carries the cliff timestamp so
/// indexers and admin tooling can render cliff-aware schedules.
#[contractevent]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct CliffStreamCreatedEvent {
    #[topic]
    pub version: u32,
    #[topic]
    pub beneficiary: Address,
    pub amount: i128,
    pub start_time: u64,
    pub duration: u64,
    pub cliff_time: u64,
}
versioned_event!(CliffStreamCreatedEvent, 1);

#[contractevent]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct TokensClaimedEvent {
    #[topic]
    pub version: u32,
    #[topic]
    pub beneficiary: Address,
    pub amount_claimed: i128,
    pub remaining: i128,
}
versioned_event!(TokensClaimedEvent, 1);

#[contractevent]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct BeneficiaryRotatedEvent {
    #[topic]
    pub version: u32,
    #[topic]
    pub old_beneficiary: Address,
    #[topic]
    pub new_beneficiary: Address,
    pub claimed_amount: i128,
    pub remaining_amount: i128,
}
versioned_event!(BeneficiaryRotatedEvent, 1);

// ── Multisig proposal events ─────────────────────────────────

#[contractevent]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct ProposalCreatedEvent {
    #[topic]
    pub version: u32,
    #[topic]
    pub proposal_id: u64,
    pub proposer: Address,
    pub action: ProposalAction,
    pub weight_collected: u32,
    pub threshold: u32,
}
versioned_event!(ProposalCreatedEvent, 1);

#[contractevent]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct SignatureCollectedEvent {
    #[topic]
    pub version: u32,
    #[topic]
    pub proposal_id: u64,
    pub signer: Address,
    pub weight_collected: u32,
    pub threshold: u32,
    pub status: ProposalStatus,
}
versioned_event!(SignatureCollectedEvent, 1);

#[contractevent]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct ProposalExecutedEvent {
    #[topic]
    pub version: u32,
    #[topic]
    pub proposal_id: u64,
    pub executor: Address,
    pub action: ProposalAction,
}
versioned_event!(ProposalExecutedEvent, 1);

#[contractevent]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct ProposalCancelledEvent {
    #[topic]
    pub version: u32,
    #[topic]
    pub proposal_id: u64,
    pub cancelled_by: Address,
}
versioned_event!(ProposalCancelledEvent, 1);

#[contractevent]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct MultisigConfiguredEvent {
    #[topic]
    pub version: u32,
    #[topic]
    pub configured_by: Address,
    pub threshold: u32,
    pub signer_count: u32,
}
versioned_event!(MultisigConfiguredEvent, 1);

#[contractevent]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct ProposalExpiredEvent {
    #[topic]
    pub version: u32,
    #[topic]
    pub proposal_id: u64,
    pub expired_at: u64,
}
versioned_event!(ProposalExpiredEvent, 1);

#[contractevent]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct AdminChangedEvent {
    #[topic]
    pub version: u32,
    #[topic]
    pub old_admin: Address,
    pub new_admin: Address,
}
versioned_event!(AdminChangedEvent, 1);

#[contractevent]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct StreamCancelledEvent {
    #[topic]
    pub version: u32,
    #[topic]
    pub beneficiary: Address,
    pub total_unlocked: i128,
    pub refundable: i128,
    pub cancelled_at: u64,
}
versioned_event!(StreamCancelledEvent, 1);

#[contractevent]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct EmergencyStopEvent {
    #[topic]
    pub version: u32,
    #[topic]
    pub beneficiary: Address,
    pub reason: soroban_sdk::String,
    pub full_refund: i128,
}
versioned_event!(EmergencyStopEvent, 1);

// ── Publish helpers ──────────────────────────────────────────

pub fn publish_stream_created(
    env: &Env,
    beneficiary: Address,
    amount: i128,
    start_time: u64,
    duration: u64,
) {
    StreamCreatedEvent {
        version: StreamCreatedEvent::EVENT_VERSION,
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
        version: CliffStreamCreatedEvent::EVENT_VERSION,
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
        version: TokensClaimedEvent::EVENT_VERSION,
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
        version: BeneficiaryRotatedEvent::EVENT_VERSION,
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
        version: ProposalCreatedEvent::EVENT_VERSION,
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
        version: SignatureCollectedEvent::EVENT_VERSION,
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
        version: ProposalExecutedEvent::EVENT_VERSION,
        proposal_id,
        executor,
        action,
    }
    .publish(env);
}

pub fn publish_proposal_cancelled(env: &Env, proposal_id: u64, cancelled_by: Address) {
    ProposalCancelledEvent {
        version: ProposalCancelledEvent::EVENT_VERSION,
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
        version: MultisigConfiguredEvent::EVENT_VERSION,
        configured_by,
        threshold,
        signer_count,
    }
    .publish(env);
}

pub fn publish_proposal_expired(env: &Env, proposal_id: u64, expired_at: u64) {
    ProposalExpiredEvent {
        version: ProposalExpiredEvent::EVENT_VERSION,
        proposal_id,
        expired_at,
    }
    .publish(env);
}

pub fn publish_admin_changed(env: &Env, old_admin: Address, new_admin: Address) {
    AdminChangedEvent {
        version: AdminChangedEvent::EVENT_VERSION,
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
        version: StreamCancelledEvent::EVENT_VERSION,
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
        version: EmergencyStopEvent::EVENT_VERSION,
        beneficiary,
        reason,
        full_refund,
    }
    .publish(env);
}
