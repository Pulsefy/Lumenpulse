//! # LumenPulse — Contributor Registry with Badge Tiering
//!
//! This Soroban smart contract extends the contributor-registry to support
//! on-chain "Badges" and tiers based on contribution history and reputation.
//!
//! ## Key Design Decisions
//! - Badges are stored as a `Vec<u32>` (integer IDs) to keep storage costs low.
//! - A bitmask u64 field is also maintained for ultra-cheap tier checks in Vault.
//! - Admin-gated `award_badge` / `revoke_badge` functions guard write access.
//! - `get_tier_multiplier` lets the Vault contract query reward multipliers.
//!
//! ## Badge ID Convention (extend as needed)
//! | ID | Badge Name       | Tier Multiplier |
//! |----|-----------------|-----------------|
//! |  0 | Newcomer         | 100 bps (1×)   |
//! |  1 | Contributor      | 110 bps (1.1×) |
//! |  2 | Trusted          | 125 bps (1.25×)|
//! |  3 | Veteran          | 150 bps (1.5×) |
//! |  4 | Core             | 175 bps (1.75×)|
//! |  5 | Legend           | 200 bps (2×)   |
//! |6–63| Reserved/Custom  | 100 bps (1×)   |

#![no_std]

use soroban_sdk::{
    contract, contractimpl, contracttype, symbol_short,
    Address, Env, Map, Symbol, Vec,
};

// ─── Storage key symbols ─────────────────────────────────────────────────────

const ADMIN_KEY: Symbol       = symbol_short!("ADMIN");
const REGISTRY_KEY: Symbol    = symbol_short!("REGISTRY");

// ─── Badge constants ──────────────────────────────────────────────────────────

/// Maximum badge ID supported by the bitmask (u64 holds bits 0–63).
pub const MAX_BADGE_ID: u32 = 63;

/// Basis-points multipliers for each tier badge (index = badge_id).
/// Values beyond index 5 default to 100 bps (1×).
const TIER_MULTIPLIERS_BPS: [u32; 6] = [
    100, // 0 — Newcomer   (1.00×)
    110, // 1 — Contributor(1.10×)
    125, // 2 — Trusted    (1.25×)
    150, // 3 — Veteran    (1.50×)
    175, // 4 — Core       (1.75×)
    200, // 5 — Legend     (2.00×)
];

// ─── Data types ───────────────────────────────────────────────────────────────

/// On-chain record stored for every registered contributor.
///
/// # Fields
/// * `address`          — Stellar account address of the contributor.
/// * `reputation_score` — Cumulative reputation points (updated externally).
/// * `contribution_count`— Total accepted contributions.
/// * `badges`           — Ordered list of awarded badge IDs (duplicates rejected).
/// * `badge_bitmask`    — u64 bitmask mirror of `badges` for cheap tier checks.
/// * `registered_at`    — Ledger timestamp of first registration.
/// * `last_active`      — Ledger timestamp of most recent update.
#[contracttype]
#[derive(Clone, Debug)]
pub struct ContributorData {
    pub address: Address,
    pub reputation_score: u64,
    pub contribution_count: u32,
    /// Vector of awarded badge IDs — primary badge storage (integer IDs keep
    /// storage costs low per the issue guideline).
    pub badges: Vec<u32>,
    /// Bitmask mirror of `badges` — bit N is set when badge ID N is awarded.
    /// Allows the Vault to do a single integer comparison instead of iterating
    /// the full vector when checking tier eligibility.
    pub badge_bitmask: u64,
    pub registered_at: u64,
    pub last_active: u64,
}

/// Events emitted by the contract (used in `Events::publish`).
#[contracttype]
pub enum ContractEvent {
    ContributorRegistered,
    BadgeAwarded,
    BadgeRevoked,
    ReputationUpdated,
}

// ─── Error codes (returned as u32 via panic) ─────────────────────────────────
// Using explicit numeric literals so callers can match them reliably.

/// Not authorised — caller is not the admin.
pub const ERR_UNAUTHORIZED: u32       = 1;
/// Contributor already exists in the registry.
pub const ERR_ALREADY_REGISTERED: u32 = 2;
/// Contributor not found in the registry.
pub const ERR_NOT_FOUND: u32          = 3;
/// Badge ID is out of the allowed range (0–63).
pub const ERR_INVALID_BADGE: u32      = 4;
/// Contributor already holds this badge.
pub const ERR_BADGE_ALREADY_HELD: u32 = 5;
/// Contributor does not hold this badge.
pub const ERR_BADGE_NOT_HELD: u32     = 6;

// ─── Internal helpers ─────────────────────────────────────────────────────────

fn load_registry(env: &Env) -> Map<Address, ContributorData> {
    env.storage()
        .persistent()
        .get(&REGISTRY_KEY)
        .unwrap_or(Map::new(env))
}

fn save_registry(env: &Env, registry: &Map<Address, ContributorData>) {
    env.storage().persistent().set(&REGISTRY_KEY, registry);
}

fn load_admin(env: &Env) -> Address {
    env.storage()
        .instance()
        .get(&ADMIN_KEY)
        .expect("admin not initialised")
}

fn require_admin(env: &Env, caller: &Address) {
    let admin = load_admin(env);
    if *caller != admin {
        panic!("{}", ERR_UNAUTHORIZED);
    }
}

/// Convert a `Vec<u32>` of badge IDs into a u64 bitmask.
fn badges_to_bitmask(badges: &Vec<u32>) -> u64 {
    let mut mask: u64 = 0;
    for id in badges.iter() {
        if id <= MAX_BADGE_ID {
            mask |= 1u64 << id;
        }
    }
    mask
}

/// Return the highest-tier multiplier (in basis points) for a bitmask.
/// Scans from the top tier down so the best multiplier wins.
fn best_multiplier_for_mask(mask: u64) -> u32 {
    // Iterate from highest tier badge down.
    for badge_id in (0..TIER_MULTIPLIERS_BPS.len()).rev() {
        if mask & (1u64 << badge_id) != 0 {
            return TIER_MULTIPLIERS_BPS[badge_id];
        }
    }
    // No recognised tier badge — base rate.
    100
}

// ─── Contract ────────────────────────────────────────────────────────────────

#[contract]
pub struct ContributorRegistry;

#[contractimpl]
impl ContributorRegistry {

    // ── Initialisation ───────────────────────────────────────────────────────

    /// Initialise the contract with an admin address.
    /// Must be called once immediately after deployment.
    pub fn initialize(env: Env, admin: Address) {
        // Prevent re-initialisation.
        if env.storage().instance().has(&ADMIN_KEY) {
            panic!("{}", ERR_UNAUTHORIZED);
        }
        env.storage().instance().set(&ADMIN_KEY, &admin);
    }

    // ── Admin management ─────────────────────────────────────────────────────

    /// Transfer admin role to a new address. Only the current admin may call.
    pub fn transfer_admin(env: Env, caller: Address, new_admin: Address) {
        caller.require_auth();
        require_admin(&env, &caller);
        env.storage().instance().set(&ADMIN_KEY, &new_admin);
    }

    /// Return the current admin address.
    pub fn get_admin(env: Env) -> Address {
        load_admin(&env)
    }

    // ── Contributor registration ──────────────────────────────────────────────

    /// Register a new contributor. Callable by anyone (self-registration).
    pub fn register_contributor(env: Env, contributor: Address) {
        contributor.require_auth();

        let mut registry = load_registry(&env);

        if registry.contains_key(contributor.clone()) {
            panic!("{}", ERR_ALREADY_REGISTERED);
        }

        let now = env.ledger().timestamp();
        let data = ContributorData {
            address: contributor.clone(),
            reputation_score: 0,
            contribution_count: 0,
            badges: Vec::new(&env),
            badge_bitmask: 0,
            registered_at: now,
            last_active: now,
        };

        registry.set(contributor.clone(), data);
        save_registry(&env, &registry);

        env.events().publish(
            (symbol_short!("contrib"), symbol_short!("reg")),
            contributor,
        );
    }

    // ── Badge management ─────────────────────────────────────────────────────

    /// Award a badge to a contributor.
    ///
    /// # Arguments
    /// * `admin`       — Must be the contract admin (checked on-chain).
    /// * `contributor` — Target contributor address.
    /// * `badge_id`    — Integer badge ID in range 0–63.
    ///
    /// Emits a `badge_award` event on success.
    pub fn award_badge(
        env: Env,
        admin: Address,
        contributor: Address,
        badge_id: u32,
    ) {
        admin.require_auth();
        require_admin(&env, &admin);

        if badge_id > MAX_BADGE_ID {
            panic!("{}", ERR_INVALID_BADGE);
        }

        let mut registry = load_registry(&env);

        let mut data = registry
            .get(contributor.clone())
            .unwrap_or_else(|| panic!("{}", ERR_NOT_FOUND));

        // Reject duplicates.
        for existing in data.badges.iter() {
            if existing == badge_id {
                panic!("{}", ERR_BADGE_ALREADY_HELD);
            }
        }

        data.badges.push_back(badge_id);
        data.badge_bitmask = badges_to_bitmask(&data.badges);
        data.last_active = env.ledger().timestamp();

        registry.set(contributor.clone(), data);
        save_registry(&env, &registry);

        env.events().publish(
            (symbol_short!("badge"), symbol_short!("award")),
            (contributor, badge_id),
        );
    }

    /// Revoke a previously awarded badge from a contributor.
    ///
    /// # Arguments
    /// * `admin`       — Must be the contract admin.
    /// * `contributor` — Target contributor address.
    /// * `badge_id`    — Badge ID to revoke.
    ///
    /// Emits a `badge_revoke` event on success.
    pub fn revoke_badge(
        env: Env,
        admin: Address,
        contributor: Address,
        badge_id: u32,
    ) {
        admin.require_auth();
        require_admin(&env, &admin);

        if badge_id > MAX_BADGE_ID {
            panic!("{}", ERR_INVALID_BADGE);
        }

        let mut registry = load_registry(&env);

        let mut data = registry
            .get(contributor.clone())
            .unwrap_or_else(|| panic!("{}", ERR_NOT_FOUND));

        // Find and remove the badge.
        let mut found = false;
        let mut new_badges: Vec<u32> = Vec::new(&env);
        for id in data.badges.iter() {
            if id == badge_id {
                found = true; // Skip — effectively removes it.
            } else {
                new_badges.push_back(id);
            }
        }

        if !found {
            panic!("{}", ERR_BADGE_NOT_HELD);
        }

        data.badges = new_badges;
        data.badge_bitmask = badges_to_bitmask(&data.badges);
        data.last_active = env.ledger().timestamp();

        registry.set(contributor.clone(), data);
        save_registry(&env, &registry);

        env.events().publish(
            (symbol_short!("badge"), symbol_short!("revoke")),
            (contributor, badge_id),
        );
    }

    // ── Reputation & contribution tracking ───────────────────────────────────

    /// Increment a contributor's reputation score and contribution count.
    /// Only admin may call to prevent score manipulation.
    pub fn update_reputation(
        env: Env,
        admin: Address,
        contributor: Address,
        score_delta: u64,
    ) {
        admin.require_auth();
        require_admin(&env, &admin);

        let mut registry = load_registry(&env);

        let mut data = registry
            .get(contributor.clone())
            .unwrap_or_else(|| panic!("{}", ERR_NOT_FOUND));

        data.reputation_score = data.reputation_score.saturating_add(score_delta);
        data.contribution_count = data.contribution_count.saturating_add(1);
        data.last_active = env.ledger().timestamp();

        registry.set(contributor.clone(), data);
        save_registry(&env, &registry);

        env.events().publish(
            (symbol_short!("rep"), symbol_short!("update")),
            (contributor, score_delta),
        );
    }

    // ── Vault-facing tier queries ─────────────────────────────────────────────

    /// Return the best reward multiplier (basis points) for a contributor.
    ///
    /// The Vault calls this when calculating matching-pool rewards.
    ///
    /// # Returns
    /// A u32 in basis points where 100 = 1×, 200 = 2×, etc.
    /// Returns 100 (base rate) if contributor is not found or has no tier badge.
    pub fn get_tier_multiplier(env: Env, contributor: Address) -> u32 {
        let registry = load_registry(&env);
        match registry.get(contributor) {
            Some(data) => best_multiplier_for_mask(data.badge_bitmask),
            None => 100, // base rate — safe default for Vault calls
        }
    }

    /// Return `true` if the contributor holds the specified badge.
    /// Uses the bitmask for O(1) lookup — safe for Vault hot-path calls.
    pub fn has_badge(env: Env, contributor: Address, badge_id: u32) -> bool {
        if badge_id > MAX_BADGE_ID {
            return false;
        }
        let registry = load_registry(&env);
        match registry.get(contributor) {
            Some(data) => data.badge_bitmask & (1u64 << badge_id) != 0,
            None => false,
        }
    }

    /// Return the bitmask directly for multi-badge checks in a single call.
    pub fn get_badge_bitmask(env: Env, contributor: Address) -> u64 {
        let registry = load_registry(&env);
        match registry.get(contributor) {
            Some(data) => data.badge_bitmask,
            None => 0,
        }
    }

    // ── Read queries ──────────────────────────────────────────────────────────

    /// Fetch the full `ContributorData` record for an address.
    pub fn get_contributor(env: Env, contributor: Address) -> Option<ContributorData> {
        let registry = load_registry(&env);
        registry.get(contributor)
    }

    /// Return the list of badge IDs held by a contributor.
    pub fn get_badges(env: Env, contributor: Address) -> Vec<u32> {
        let registry = load_registry(&env);
        match registry.get(contributor) {
            Some(data) => data.badges,
            None => Vec::new(&env),
        }
    }

    /// Return the total number of registered contributors.
    pub fn contributor_count(env: Env) -> u32 {
        let registry = load_registry(&env);
        registry.len()
    }
}