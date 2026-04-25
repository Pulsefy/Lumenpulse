use soroban_sdk::{symbol_short, Address, Env};

use crate::types::ProjectMetadata;

pub fn emit_project_proposed(
    env: &Env,
    project_id: u64,
    proposer: &Address,
    metadata: &ProjectMetadata,
) {
    env.events().publish(
        (symbol_short!("proposed"), project_id),
        (proposer.clone(), metadata.name.clone()),
    );
}

pub fn emit_vote_cast(
    env: &Env,
    project_id: u64,
    voter: &Address,
    approve: bool,
    voting_power: u64,
) {
    env.events().publish(
        (symbol_short!("voted"), project_id),
        (voter.clone(), approve, voting_power),
    );
}

pub fn emit_project_verified(env: &Env, project_id: u64) {
    env.events()
        .publish((symbol_short!("verified"), project_id), ());
}

pub fn emit_project_rejected(env: &Env, project_id: u64) {
    env.events()
        .publish((symbol_short!("rejected"), project_id), ());
}

pub fn emit_proposal_expired(env: &Env, project_id: u64) {
    env.events()
        .publish((symbol_short!("expired"), project_id), ());
}
