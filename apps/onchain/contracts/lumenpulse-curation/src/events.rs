use crate::types::ProjectMetadata;
use event_versioning::{versioned_event, VersionedEvent};
use soroban_sdk::{contractevent, Address, Env, String};

// ── Event Struct Definitions ────────────────────────────────────────────────
//
// Every event below follows the canonical event-versioning convention
// (issue #1057, `event-versioning` crate): a `#[topic] pub version: u32`
// field as the first field, an `EVENT_VERSION` constant via
// `versioned_event!`, and an emission helper that sets `version` from that
// constant rather than a literal. See `event-versioning`'s crate docs for
// the full rationale and the rule for when to bump a version.

#[contractevent]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct ProjectProposedEvent {
    #[topic]
    pub version: u32,
    pub project_id: u64,
    pub proposer: Address,
    pub name: String,
}
versioned_event!(ProjectProposedEvent, 1);

#[contractevent]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct VoteCastEvent {
    #[topic]
    pub version: u32,
    pub project_id: u64,
    pub voter: Address,
    pub approve: bool,
    pub voting_power: u64,
}
versioned_event!(VoteCastEvent, 1);

#[contractevent]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct ProjectVerifiedEvent {
    #[topic]
    pub version: u32,
    pub project_id: u64,
}
versioned_event!(ProjectVerifiedEvent, 1);

#[contractevent]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct ProjectRejectedEvent {
    #[topic]
    pub version: u32,
    pub project_id: u64,
}
versioned_event!(ProjectRejectedEvent, 1);

#[contractevent]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct ProposalExpiredEvent {
    #[topic]
    pub version: u32,
    pub project_id: u64,
}
versioned_event!(ProposalExpiredEvent, 1);

// ── Direct Emission Helper Functions ─────────────────────────────────────────

pub fn emit_project_proposed(
    env: &Env,
    project_id: u64,
    proposer: &Address,
    metadata: &ProjectMetadata,
) {
    // Carry the name as-is (issue #1231): the previous implementation copied
    // it into a fixed 32-byte buffer and converted it to a `Symbol`, which
    // panicked for any name that wasn't exactly 32 bytes of
    // `[A-Za-z0-9_]` — i.e. almost every realistic project name, since
    // `ProjectMetadata::name` allows up to 100 arbitrary characters
    // (spaces, punctuation). `propose_project`, this contract's primary
    // entrypoint, could not complete for normal input. `String` has no such
    // restriction and needs no lossy round-trip.
    ProjectProposedEvent {
        version: ProjectProposedEvent::EVENT_VERSION,
        project_id,
        proposer: proposer.clone(),
        name: metadata.name.clone(),
    }
    .publish(env);
}

pub fn emit_vote_cast(
    env: &Env,
    project_id: u64,
    voter: &Address,
    approve: bool,
    voting_power: u64,
) {
    VoteCastEvent {
        version: VoteCastEvent::EVENT_VERSION,
        project_id,
        voter: voter.clone(),
        approve,
        voting_power,
    }
    .publish(env);
}

pub fn emit_project_verified(env: &Env, project_id: u64) {
    ProjectVerifiedEvent {
        version: ProjectVerifiedEvent::EVENT_VERSION,
        project_id,
    }
    .publish(env);
}

pub fn emit_project_rejected(env: &Env, project_id: u64) {
    ProjectRejectedEvent {
        version: ProjectRejectedEvent::EVENT_VERSION,
        project_id,
    }
    .publish(env);
}

pub fn emit_proposal_expired(env: &Env, project_id: u64) {
    ProposalExpiredEvent {
        version: ProposalExpiredEvent::EVENT_VERSION,
        project_id,
    }
    .publish(env);
}
