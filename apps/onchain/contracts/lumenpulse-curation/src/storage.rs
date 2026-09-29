use soroban_sdk::{contracttype, Address, Env};

use crate::types::{ProposalState, VoteRecord};

/// If an entry's remaining TTL drops below this many ledgers, the next
/// touch extends it back out to `LEDGER_BUMP`. ~100_000 ledgers (~5.8 days
/// at 5s/ledger).
pub const LEDGER_THRESHOLD: u32 = 100_000;
/// TTL applied when extending. ~518_400 ledgers (~30 days at 5s/ledger).
pub const LEDGER_BUMP: u32 = 518_400;

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

/// Extends the shared instance-storage TTL (covers `Admin`, `DepositToken`,
/// `ContributorRegistry`, and `NextProjectId` together, since instance TTL
/// is a single value for the whole contract instance, not per-key).
fn bump_instance_ttl(env: &Env) {
    env.storage()
        .instance()
        .extend_ttl(LEDGER_THRESHOLD, LEDGER_BUMP);
}

// ── Admin ─────────────────────────────────────────────────────────────────────

pub fn has_admin(env: &Env) -> bool {
    env.storage().instance().has(&DataKey::Admin)
}

pub fn set_admin(env: &Env, admin: &Address) {
    env.storage().instance().set(&DataKey::Admin, admin);
    bump_instance_ttl(env);
}

pub fn get_admin(env: &Env) -> Address {
    let admin = env.storage().instance().get(&DataKey::Admin).unwrap();
    bump_instance_ttl(env);
    admin
}

// ── Deposit Token ─────────────────────────────────────────────────────────────

pub fn set_deposit_token(env: &Env, token: &Address) {
    env.storage().instance().set(&DataKey::DepositToken, token);
    bump_instance_ttl(env);
}

pub fn get_deposit_token(env: &Env) -> Address {
    let token = env
        .storage()
        .instance()
        .get(&DataKey::DepositToken)
        .unwrap();
    bump_instance_ttl(env);
    token
}

// ── Contributor Registry ──────────────────────────────────────────────────────

pub fn set_contributor_registry(env: &Env, registry: &Address) {
    env.storage()
        .instance()
        .set(&DataKey::ContributorRegistry, registry);
    bump_instance_ttl(env);
}

pub fn get_contributor_registry(env: &Env) -> Address {
    let registry = env
        .storage()
        .instance()
        .get(&DataKey::ContributorRegistry)
        .unwrap();
    bump_instance_ttl(env);
    registry
}

// ── Project ID Counter ────────────────────────────────────────────────────────

pub fn set_next_project_id(env: &Env, id: u64) {
    env.storage().instance().set(&DataKey::NextProjectId, &id);
    bump_instance_ttl(env);
}

pub fn get_next_project_id(env: &Env) -> u64 {
    let id = env
        .storage()
        .instance()
        .get(&DataKey::NextProjectId)
        .unwrap_or(1u64);
    bump_instance_ttl(env);
    id
}

// ── Proposals ─────────────────────────────────────────────────────────────────

pub fn save_proposal(env: &Env, project_id: u64, proposal: &ProposalState) {
    let key = DataKey::Proposal(project_id);
    env.storage().persistent().set(&key, proposal);
    env.storage()
        .persistent()
        .extend_ttl(&key, LEDGER_THRESHOLD, LEDGER_BUMP);
}

pub fn get_proposal(env: &Env, project_id: u64) -> Option<ProposalState> {
    let key = DataKey::Proposal(project_id);
    let proposal = env.storage().persistent().get(&key);
    if proposal.is_some() {
        env.storage()
            .persistent()
            .extend_ttl(&key, LEDGER_THRESHOLD, LEDGER_BUMP);
    }
    proposal
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
    let key = DataKey::VoteRecord(project_id, voter.clone());
    env.storage().persistent().set(&key, record);
    env.storage()
        .persistent()
        .extend_ttl(&key, LEDGER_THRESHOLD, LEDGER_BUMP);
}

pub fn get_vote_record(env: &Env, project_id: u64, voter: &Address) -> Option<VoteRecord> {
    let key = DataKey::VoteRecord(project_id, voter.clone());
    let record = env.storage().persistent().get(&key);
    if record.is_some() {
        env.storage()
            .persistent()
            .extend_ttl(&key, LEDGER_THRESHOLD, LEDGER_BUMP);
    }
    record
}
