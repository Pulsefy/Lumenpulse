use soroban_sdk::{contracttype, Address, Env};

use crate::types::{ProposalState, VoteRecord};

// ─── Storage Keys ─────────────────────────────────────────────────────────────

#[contracttype]
pub enum DataKey {
    Admin,
    DepositToken,
    ContributorRegistry,
    NextProjectId,
    Proposal(u64),
    VotedFlag(u64, Address),  // (project_id, voter) → bool
    VoteRecord(u64, Address), // (project_id, voter) → VoteRecord
}

// ── Admin ─────────────────────────────────────────────────────────────────────

pub fn has_admin(env: &Env) -> bool {
    env.storage().instance().has(&DataKey::Admin)
}

pub fn set_admin(env: &Env, admin: &Address) {
    env.storage().instance().set(&DataKey::Admin, admin);
}

pub fn get_admin(env: &Env) -> Address {
    env.storage().instance().get(&DataKey::Admin).unwrap()
}

// ── Deposit Token ─────────────────────────────────────────────────────────────

pub fn set_deposit_token(env: &Env, token: &Address) {
    env.storage().instance().set(&DataKey::DepositToken, token);
}

pub fn get_deposit_token(env: &Env) -> Address {
    env.storage()
        .instance()
        .get(&DataKey::DepositToken)
        .unwrap()
}

// ── Contributor Registry ──────────────────────────────────────────────────────

pub fn set_contributor_registry(env: &Env, registry: &Address) {
    env.storage()
        .instance()
        .set(&DataKey::ContributorRegistry, registry);
}

pub fn get_contributor_registry(env: &Env) -> Address {
    env.storage()
        .instance()
        .get(&DataKey::ContributorRegistry)
        .unwrap()
}

// ── Project ID Counter ────────────────────────────────────────────────────────

pub fn set_next_project_id(env: &Env, id: u64) {
    env.storage().instance().set(&DataKey::NextProjectId, &id);
}

pub fn get_next_project_id(env: &Env) -> u64 {
    env.storage()
        .instance()
        .get(&DataKey::NextProjectId)
        .unwrap_or(1u64)
}

// ── Proposals ─────────────────────────────────────────────────────────────────

pub fn save_proposal(env: &Env, project_id: u64, proposal: &ProposalState) {
    env.storage()
        .persistent()
        .set(&DataKey::Proposal(project_id), proposal);
}

pub fn get_proposal(env: &Env, project_id: u64) -> Option<ProposalState> {
    env.storage()
        .persistent()
        .get(&DataKey::Proposal(project_id))
}

// ── Votes ─────────────────────────────────────────────────────────────────────

pub fn has_voted(env: &Env, project_id: u64, voter: &Address) -> bool {
    env.storage()
        .temporary()
        .has(&DataKey::VotedFlag(project_id, voter.clone()))
}

pub fn record_vote(env: &Env, project_id: u64, voter: &Address) {
    // Store the flag in temporary storage; it can expire but serves its purpose
    // within any practical voting window.
    env.storage()
        .temporary()
        .set(&DataKey::VotedFlag(project_id, voter.clone()), &true);
}

pub fn save_vote_record(env: &Env, project_id: u64, voter: &Address, record: &VoteRecord) {
    env.storage()
        .persistent()
        .set(&DataKey::VoteRecord(project_id, voter.clone()), record);
}

pub fn get_vote_record(env: &Env, project_id: u64, voter: &Address) -> Option<VoteRecord> {
    env.storage()
        .persistent()
        .get(&DataKey::VoteRecord(project_id, voter.clone()))
}
