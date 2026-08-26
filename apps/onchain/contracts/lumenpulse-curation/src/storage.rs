use soroban_sdk::{contracttype, Address, Env};

use crate::types::{ProposalState, VoteRecord};

// ─── TTL Constants ─────────────────────────────────────────────────────────────

pub const INSTANCE_TTL_THRESHOLD: u32 = 120_960;
pub const INSTANCE_BUMP_AMOUNT: u32 = 518_400;

pub const PERSISTENT_TTL_THRESHOLD: u32 = 120_960;
pub const PERSISTENT_BUMP_AMOUNT: u32 = 518_400;

pub const TEMPORARY_TTL_THRESHOLD: u32 = 17_280;
pub const TEMPORARY_BUMP_AMOUNT: u32 = 120_960;

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
    env.storage()
        .instance()
        .extend_ttl(INSTANCE_TTL_THRESHOLD, INSTANCE_BUMP_AMOUNT);
}

pub fn get_admin(env: &Env) -> Address {
    let admin = env.storage().instance().get(&DataKey::Admin).unwrap();
    env.storage()
        .instance()
        .extend_ttl(INSTANCE_TTL_THRESHOLD, INSTANCE_BUMP_AMOUNT);
    admin
}

// ── Deposit Token ─────────────────────────────────────────────────────────────

pub fn set_deposit_token(env: &Env, token: &Address) {
    env.storage().instance().set(&DataKey::DepositToken, token);
    env.storage()
        .instance()
        .extend_ttl(INSTANCE_TTL_THRESHOLD, INSTANCE_BUMP_AMOUNT);
}

pub fn get_deposit_token(env: &Env) -> Address {
    let token = env
        .storage()
        .instance()
        .get(&DataKey::DepositToken)
        .unwrap();
    env.storage()
        .instance()
        .extend_ttl(INSTANCE_TTL_THRESHOLD, INSTANCE_BUMP_AMOUNT);
    token
}

// ── Contributor Registry ──────────────────────────────────────────────────────

pub fn set_contributor_registry(env: &Env, registry: &Address) {
    env.storage()
        .instance()
        .set(&DataKey::ContributorRegistry, registry);
    env.storage()
        .instance()
        .extend_ttl(INSTANCE_TTL_THRESHOLD, INSTANCE_BUMP_AMOUNT);
}

pub fn get_contributor_registry(env: &Env) -> Address {
    let reg = env
        .storage()
        .instance()
        .get(&DataKey::ContributorRegistry)
        .unwrap();
    env.storage()
        .instance()
        .extend_ttl(INSTANCE_TTL_THRESHOLD, INSTANCE_BUMP_AMOUNT);
    reg
}

// ── Project ID Counter ────────────────────────────────────────────────────────

pub fn set_next_project_id(env: &Env, id: u64) {
    env.storage().instance().set(&DataKey::NextProjectId, &id);
    env.storage()
        .instance()
        .extend_ttl(INSTANCE_TTL_THRESHOLD, INSTANCE_BUMP_AMOUNT);
}

pub fn get_next_project_id(env: &Env) -> u64 {
    let id = env
        .storage()
        .instance()
        .get(&DataKey::NextProjectId)
        .unwrap_or(1u64);
    env.storage()
        .instance()
        .extend_ttl(INSTANCE_TTL_THRESHOLD, INSTANCE_BUMP_AMOUNT);
    id
}

// ── Proposals ─────────────────────────────────────────────────────────────────

pub fn save_proposal(env: &Env, project_id: u64, proposal: &ProposalState) {
    let key = DataKey::Proposal(project_id);
    env.storage().persistent().set(&key, proposal);
    env.storage()
        .persistent()
        .extend_ttl(&key, PERSISTENT_TTL_THRESHOLD, PERSISTENT_BUMP_AMOUNT);
}

pub fn get_proposal(env: &Env, project_id: u64) -> Option<ProposalState> {
    let key = DataKey::Proposal(project_id);
    if let Some(prop) = env.storage().persistent().get(&key) {
        env.storage()
            .persistent()
            .extend_ttl(&key, PERSISTENT_TTL_THRESHOLD, PERSISTENT_BUMP_AMOUNT);
        Some(prop)
    } else {
        None
    }
}

// ── Votes ─────────────────────────────────────────────────────────────────────

pub fn has_voted(env: &Env, project_id: u64, voter: &Address) -> bool {
    let key = DataKey::VotedFlag(project_id, voter.clone());
    let voted = env.storage().temporary().has(&key);
    if voted {
        env.storage()
            .temporary()
            .extend_ttl(&key, TEMPORARY_TTL_THRESHOLD, TEMPORARY_BUMP_AMOUNT);
    }
    voted
}

pub fn record_vote(env: &Env, project_id: u64, voter: &Address) {
    let key = DataKey::VotedFlag(project_id, voter.clone());
    env.storage().temporary().set(&key, &true);
    env.storage()
        .temporary()
        .extend_ttl(&key, TEMPORARY_TTL_THRESHOLD, TEMPORARY_BUMP_AMOUNT);
}

pub fn save_vote_record(env: &Env, project_id: u64, voter: &Address, record: &VoteRecord) {
    let key = DataKey::VoteRecord(project_id, voter.clone());
    env.storage().persistent().set(&key, record);
    env.storage()
        .persistent()
        .extend_ttl(&key, PERSISTENT_TTL_THRESHOLD, PERSISTENT_BUMP_AMOUNT);
}

pub fn get_vote_record(env: &Env, project_id: u64, voter: &Address) -> Option<VoteRecord> {
    let key = DataKey::VoteRecord(project_id, voter.clone());
    if let Some(record) = env.storage().persistent().get(&key) {
        env.storage()
            .persistent()
            .extend_ttl(&key, PERSISTENT_TTL_THRESHOLD, PERSISTENT_BUMP_AMOUNT);
        Some(record)
    } else {
        None
    }
}
