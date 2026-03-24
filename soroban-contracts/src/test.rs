//! # Unit Tests — Contributor Registry with Badge Tiering
//!
//! Tests cover every public function and all error paths.
//! Run with:  `cargo test --features testutils`

#![cfg(test)]

use soroban_sdk::{
    testutils::{Address as _, Ledger, LedgerInfo},
    Address, Env, Vec,
};

use crate::{
    ContributorRegistry, ContributorRegistryClient,
    ERR_UNAUTHORIZED, ERR_ALREADY_REGISTERED, ERR_NOT_FOUND,
    ERR_INVALID_BADGE, ERR_BADGE_ALREADY_HELD, ERR_BADGE_NOT_HELD,
    MAX_BADGE_ID,
};

// ─── Test helpers ─────────────────────────────────────────────────────────────

/// Stand up a fresh contract environment and return (env, client, admin).
fn setup() -> (Env, ContributorRegistryClient<'static>, Address) {
    let env = Env::default();
    env.mock_all_auths();

    let contract_id = env.register_contract(None, ContributorRegistry);
    let client: ContributorRegistryClient<'static> =
        ContributorRegistryClient::new(&env, &contract_id);

    let admin = Address::generate(&env);
    client.initialize(&admin);

    (env, client, admin)
}

/// Advance the ledger timestamp by `secs` seconds.
fn advance_time(env: &Env, secs: u64) {
    let current = env.ledger().timestamp();
    env.ledger().set(LedgerInfo {
        timestamp: current + secs,
        ..Default::default()
    });
}

// ─── Initialisation ───────────────────────────────────────────────────────────

#[test]
fn test_initialize_sets_admin() {
    let (_env, client, admin) = setup();
    assert_eq!(client.get_admin(), admin);
}

#[test]
#[should_panic]
fn test_double_initialize_panics() {
    let (env, client, _admin) = setup();
    let attacker = Address::generate(&env);
    client.initialize(&attacker); // Must panic — already initialised.
}

// ─── Admin transfer ───────────────────────────────────────────────────────────

#[test]
fn test_transfer_admin() {
    let (env, client, admin) = setup();
    let new_admin = Address::generate(&env);
    client.transfer_admin(&admin, &new_admin);
    assert_eq!(client.get_admin(), new_admin);
}

#[test]
#[should_panic]
fn test_transfer_admin_non_admin_panics() {
    let (env, client, _admin) = setup();
    let rando = Address::generate(&env);
    let new_admin = Address::generate(&env);
    client.transfer_admin(&rando, &new_admin); // ERR_UNAUTHORIZED
}

// ─── Contributor registration ─────────────────────────────────────────────────

#[test]
fn test_register_contributor_success() {
    let (env, client, _admin) = setup();
    let contributor = Address::generate(&env);

    client.register_contributor(&contributor);

    let data = client.get_contributor(&contributor).expect("contributor should exist");
    assert_eq!(data.address, contributor);
    assert_eq!(data.reputation_score, 0);
    assert_eq!(data.contribution_count, 0);
    assert_eq!(data.badge_bitmask, 0);
    assert_eq!(data.badges.len(), 0);
}

#[test]
fn test_contributor_count_increments() {
    let (env, client, _admin) = setup();
    assert_eq!(client.contributor_count(), 0);

    let c1 = Address::generate(&env);
    let c2 = Address::generate(&env);
    client.register_contributor(&c1);
    assert_eq!(client.contributor_count(), 1);
    client.register_contributor(&c2);
    assert_eq!(client.contributor_count(), 2);
}

#[test]
#[should_panic]
fn test_double_register_panics() {
    let (env, client, _admin) = setup();
    let contributor = Address::generate(&env);
    client.register_contributor(&contributor);
    client.register_contributor(&contributor); // ERR_ALREADY_REGISTERED
}

#[test]
fn test_get_contributor_returns_none_for_unknown() {
    let (env, client, _admin) = setup();
    let unknown = Address::generate(&env);
    assert!(client.get_contributor(&unknown).is_none());
}

// ─── award_badge ──────────────────────────────────────────────────────────────

#[test]
fn test_award_badge_sets_vector_and_bitmask() {
    let (env, client, admin) = setup();
    let contributor = Address::generate(&env);
    client.register_contributor(&contributor);

    // Award badge 1 (Contributor tier).
    client.award_badge(&admin, &contributor, &1u32);

    let data = client.get_contributor(&contributor).unwrap();
    assert_eq!(data.badges.len(), 1);
    assert_eq!(data.badges.get(0).unwrap(), 1u32);
    // Bit 1 should be set: bitmask == 0b10 == 2.
    assert_eq!(data.badge_bitmask, 2u64);
}

#[test]
fn test_award_multiple_badges() {
    let (env, client, admin) = setup();
    let contributor = Address::generate(&env);
    client.register_contributor(&contributor);

    client.award_badge(&admin, &contributor, &0u32); // Newcomer
    client.award_badge(&admin, &contributor, &3u32); // Veteran

    let data = client.get_contributor(&contributor).unwrap();
    assert_eq!(data.badges.len(), 2);
    // Bits 0 and 3 set: 0b1001 == 9.
    assert_eq!(data.badge_bitmask, 9u64);
}

#[test]
fn test_get_badges_helper() {
    let (env, client, admin) = setup();
    let contributor = Address::generate(&env);
    client.register_contributor(&contributor);
    client.award_badge(&admin, &contributor, &2u32);
    client.award_badge(&admin, &contributor, &5u32);

    let badges = client.get_badges(&contributor);
    assert_eq!(badges.len(), 2);
}

#[test]
fn test_has_badge_true_and_false() {
    let (env, client, admin) = setup();
    let contributor = Address::generate(&env);
    client.register_contributor(&contributor);
    client.award_badge(&admin, &contributor, &3u32);

    assert!(client.has_badge(&contributor, &3u32));
    assert!(!client.has_badge(&contributor, &0u32));
    assert!(!client.has_badge(&contributor, &5u32));
}

#[test]
fn test_get_badge_bitmask() {
    let (env, client, admin) = setup();
    let contributor = Address::generate(&env);
    client.register_contributor(&contributor);
    client.award_badge(&admin, &contributor, &0u32); // bit 0 → mask 1
    client.award_badge(&admin, &contributor, &2u32); // bit 2 → mask 4

    assert_eq!(client.get_badge_bitmask(&contributor), 5u64); // 0b101
}

#[test]
#[should_panic]
fn test_award_badge_non_admin_panics() {
    let (env, client, _admin) = setup();
    let contributor = Address::generate(&env);
    let rando = Address::generate(&env);
    client.register_contributor(&contributor);
    client.award_badge(&rando, &contributor, &1u32); // ERR_UNAUTHORIZED
}

#[test]
#[should_panic]
fn test_award_badge_unknown_contributor_panics() {
    let (env, client, admin) = setup();
    let unknown = Address::generate(&env);
    client.award_badge(&admin, &unknown, &1u32); // ERR_NOT_FOUND
}

#[test]
#[should_panic]
fn test_award_badge_invalid_id_panics() {
    let (env, client, admin) = setup();
    let contributor = Address::generate(&env);
    client.register_contributor(&contributor);
    client.award_badge(&admin, &contributor, &(MAX_BADGE_ID + 1)); // ERR_INVALID_BADGE
}

#[test]
#[should_panic]
fn test_award_duplicate_badge_panics() {
    let (env, client, admin) = setup();
    let contributor = Address::generate(&env);
    client.register_contributor(&contributor);
    client.award_badge(&admin, &contributor, &1u32);
    client.award_badge(&admin, &contributor, &1u32); // ERR_BADGE_ALREADY_HELD
}

// ─── revoke_badge ─────────────────────────────────────────────────────────────

#[test]
fn test_revoke_badge_removes_from_vector_and_bitmask() {
    let (env, client, admin) = setup();
    let contributor = Address::generate(&env);
    client.register_contributor(&contributor);

    client.award_badge(&admin, &contributor, &1u32);
    client.award_badge(&admin, &contributor, &3u32);
    // Before revoke: bits 1 and 3 → bitmask 0b1010 = 10.
    assert_eq!(client.get_badge_bitmask(&contributor), 10u64);

    client.revoke_badge(&admin, &contributor, &1u32);

    let data = client.get_contributor(&contributor).unwrap();
    assert_eq!(data.badges.len(), 1);
    assert_eq!(data.badges.get(0).unwrap(), 3u32);
    // Only bit 3 remains → bitmask 0b1000 = 8.
    assert_eq!(data.badge_bitmask, 8u64);
    assert!(!client.has_badge(&contributor, &1u32));
    assert!(client.has_badge(&contributor, &3u32));
}

#[test]
#[should_panic]
fn test_revoke_badge_not_held_panics() {
    let (env, client, admin) = setup();
    let contributor = Address::generate(&env);
    client.register_contributor(&contributor);
    client.revoke_badge(&admin, &contributor, &2u32); // ERR_BADGE_NOT_HELD
}

#[test]
#[should_panic]
fn test_revoke_badge_non_admin_panics() {
    let (env, client, _admin) = setup();
    let contributor = Address::generate(&env);
    let rando = Address::generate(&env);
    client.register_contributor(&contributor);
    client.revoke_badge(&rando, &contributor, &0u32); // ERR_UNAUTHORIZED
}

// ─── Reputation & contribution count ──────────────────────────────────────────

#[test]
fn test_update_reputation() {
    let (env, client, admin) = setup();
    let contributor = Address::generate(&env);
    client.register_contributor(&contributor);

    client.update_reputation(&admin, &contributor, &50u64);
    client.update_reputation(&admin, &contributor, &25u64);

    let data = client.get_contributor(&contributor).unwrap();
    assert_eq!(data.reputation_score, 75);
    assert_eq!(data.contribution_count, 2);
}

#[test]
#[should_panic]
fn test_update_reputation_non_admin_panics() {
    let (env, client, _admin) = setup();
    let contributor = Address::generate(&env);
    let rando = Address::generate(&env);
    client.register_contributor(&contributor);
    client.update_reputation(&rando, &contributor, &10u64); // ERR_UNAUTHORIZED
}

// ─── Tier multiplier (Vault integration) ─────────────────────────────────────

#[test]
fn test_get_tier_multiplier_no_badge_returns_base() {
    let (env, client, _admin) = setup();
    let contributor = Address::generate(&env);
    client.register_contributor(&contributor);

    // No badges → base rate 100 bps.
    assert_eq!(client.get_tier_multiplier(&contributor), 100u32);
}

#[test]
fn test_get_tier_multiplier_unknown_contributor_returns_base() {
    let (env, client, _admin) = setup();
    let unknown = Address::generate(&env);
    assert_eq!(client.get_tier_multiplier(&unknown), 100u32);
}

#[test]
fn test_get_tier_multiplier_newcomer() {
    let (env, client, admin) = setup();
    let contributor = Address::generate(&env);
    client.register_contributor(&contributor);
    client.award_badge(&admin, &contributor, &0u32); // Newcomer
    assert_eq!(client.get_tier_multiplier(&contributor), 100u32);
}

#[test]
fn test_get_tier_multiplier_contributor_tier() {
    let (env, client, admin) = setup();
    let contributor = Address::generate(&env);
    client.register_contributor(&contributor);
    client.award_badge(&admin, &contributor, &1u32); // Contributor tier
    assert_eq!(client.get_tier_multiplier(&contributor), 110u32);
}

#[test]
fn test_get_tier_multiplier_veteran() {
    let (env, client, admin) = setup();
    let contributor = Address::generate(&env);
    client.register_contributor(&contributor);
    client.award_badge(&admin, &contributor, &3u32); // Veteran
    assert_eq!(client.get_tier_multiplier(&contributor), 150u32);
}

#[test]
fn test_get_tier_multiplier_legend() {
    let (env, client, admin) = setup();
    let contributor = Address::generate(&env);
    client.register_contributor(&contributor);
    client.award_badge(&admin, &contributor, &5u32); // Legend
    assert_eq!(client.get_tier_multiplier(&contributor), 200u32);
}

#[test]
fn test_get_tier_multiplier_best_badge_wins() {
    /// Contributor holds Newcomer (0) AND Veteran (3) — should get Veteran's 150.
    let (env, client, admin) = setup();
    let contributor = Address::generate(&env);
    client.register_contributor(&contributor);
    client.award_badge(&admin, &contributor, &0u32); // Newcomer 100
    client.award_badge(&admin, &contributor, &3u32); // Veteran  150
    assert_eq!(client.get_tier_multiplier(&contributor), 150u32);
}

#[test]
fn test_multiplier_after_revoke_drops() {
    let (env, client, admin) = setup();
    let contributor = Address::generate(&env);
    client.register_contributor(&contributor);
    client.award_badge(&admin, &contributor, &4u32); // Core 175
    assert_eq!(client.get_tier_multiplier(&contributor), 175u32);

    client.revoke_badge(&admin, &contributor, &4u32);
    // No remaining tier badges → base 100.
    assert_eq!(client.get_tier_multiplier(&contributor), 100u32);
}

// ─── Edge cases ───────────────────────────────────────────────────────────────

#[test]
fn test_max_badge_id_is_valid() {
    let (env, client, admin) = setup();
    let contributor = Address::generate(&env);
    client.register_contributor(&contributor);
    // Badge 63 is the highest allowed; should succeed.
    client.award_badge(&admin, &contributor, &MAX_BADGE_ID);
    assert!(client.has_badge(&contributor, &MAX_BADGE_ID));
    // Bitmask bit 63 → 2^63.
    assert_eq!(client.get_badge_bitmask(&contributor), 1u64 << 63);
}

#[test]
fn test_has_badge_unknown_contributor_returns_false() {
    let (env, client, _admin) = setup();
    let unknown = Address::generate(&env);
    assert!(!client.has_badge(&unknown, &0u32));
}

#[test]
fn test_has_badge_out_of_range_returns_false() {
    let (env, client, _admin) = setup();
    let contributor = Address::generate(&env);
    client.register_contributor(&contributor);
    // Out-of-range badge IDs always return false without panicking.
    assert!(!client.has_badge(&contributor, &(MAX_BADGE_ID + 1)));
    assert!(!client.has_badge(&contributor, &u32::MAX));
}

#[test]
fn test_timestamps_update_on_activity() {
    let (env, client, admin) = setup();
    let contributor = Address::generate(&env);
    client.register_contributor(&contributor);

    let registered_at = client.get_contributor(&contributor).unwrap().registered_at;

    advance_time(&env, 3600); // +1 hour
    client.award_badge(&admin, &contributor, &1u32);

    let data = client.get_contributor(&contributor).unwrap();
    assert!(data.last_active > registered_at);
    assert_eq!(data.registered_at, registered_at); // registered_at must not change
}