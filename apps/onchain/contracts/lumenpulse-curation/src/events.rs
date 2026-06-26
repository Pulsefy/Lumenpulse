use crate::types::ProjectMetadata;
use soroban_sdk::{contractevent, Address, Env, Symbol};

// ── Event Struct Definitions ────────────────────────────────────────────────

#[contractevent]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct ProjectProposedEvent {
    pub project_id: u64,
    pub proposer: Address,
    pub name: Symbol,
}

#[contractevent]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct VoteCastEvent {
    pub project_id: u64,
    pub voter: Address,
    pub approve: bool,
    pub voting_power: u64,
}

#[contractevent]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct ProjectVerifiedEvent {
    pub project_id: u64,
}

#[contractevent]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct ProjectRejectedEvent {
    pub project_id: u64,
}

#[contractevent]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct ProposalExpiredEvent {
    pub project_id: u64,
}

// ── Direct Emission Helper Functions ─────────────────────────────────────────

pub fn emit_project_proposed(
    env: &Env,
    project_id: u64,
    proposer: &Address,
    metadata: &ProjectMetadata,
) {
    // 1. Create a stack buffer to unpack the host string characters (max 32 bytes for typical project names)
    let mut buffer = [0u8; 32];

    // 2. Copy the string contents into the stack array copy slot
    metadata.name.copy_into_slice(&mut buffer);

    // 3. Convert the populated buffer bytes slice into a native Rust string slice safely
    let name_str = core::str::from_utf8(&buffer)
        .unwrap_or("")
        .trim_matches(char::from(0)); // Clean out unallocated trailing null bytes

    // 4. Instantiation mapping via the valid native primitive string slice
    let project_name_symbol = Symbol::new(env, name_str);

    ProjectProposedEvent {
        project_id,
        proposer: proposer.clone(),
        name: project_name_symbol,
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
        project_id,
        voter: voter.clone(),
        approve,
        voting_power,
    }
    .publish(env);
}

pub fn emit_project_verified(env: &Env, project_id: u64) {
    ProjectVerifiedEvent { project_id }.publish(env);
}

pub fn emit_project_rejected(env: &Env, project_id: u64) {
    ProjectRejectedEvent { project_id }.publish(env);
}

pub fn emit_proposal_expired(env: &Env, project_id: u64) {
    ProposalExpiredEvent { project_id }.publish(env);
}
