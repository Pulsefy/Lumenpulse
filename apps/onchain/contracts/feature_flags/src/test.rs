use crate::errors::FlagError;
use crate::{FeatureFlagsContract, FeatureFlagsContractClient};
use soroban_sdk::{symbol_short, testutils::Address as _, Address, Env};

fn setup(env: &Env) -> (FeatureFlagsContractClient<'_>, Address) {
    let admin = Address::generate(env);
    let id = env.register(FeatureFlagsContract, ());
    let client = FeatureFlagsContractClient::new(env, &id);
    client.initialize(&admin);
    (client, admin)
}

// ── Initialization ────────────────────────────────────────────────────────────

#[test]
fn test_initialize() {
    let env = Env::default();
    env.mock_all_auths();
    let (client, admin) = setup(&env);
    assert_eq!(client.get_admin(), admin);
}

#[test]
fn test_double_init_fails() {
    let env = Env::default();
    env.mock_all_auths();
    let (client, admin) = setup(&env);
    assert_eq!(
        client.try_initialize(&admin),
        Err(Ok(FlagError::AlreadyInitialized))
    );
}

// ── Default values ────────────────────────────────────────────────────────────

#[test]
fn test_unset_flag_defaults_false() {
    let env = Env::default();
    env.mock_all_auths();
    let (client, _) = setup(&env);
    // A flag that has never been set must deterministically return false.
    assert!(!client.is_enabled(&symbol_short!("newFeat")));
}

#[test]
fn test_get_flag_unset_returns_not_found() {
    let env = Env::default();
    env.mock_all_auths();
    let (client, _) = setup(&env);
    assert_eq!(
        client.try_get_flag(&symbol_short!("ghost")),
        Err(Ok(FlagError::FlagNotFound))
    );
}

// ── Flag gating ───────────────────────────────────────────────────────────────

#[test]
fn test_set_flag_enables_feature() {
    let env = Env::default();
    env.mock_all_auths();
    let (client, admin) = setup(&env);

    client.set_flag(&admin, &symbol_short!("newFeat"), &true);
    assert!(client.is_enabled(&symbol_short!("newFeat")));
    assert_eq!(client.get_flag(&symbol_short!("newFeat")), true);
}

#[test]
fn test_set_flag_disables_feature() {
    let env = Env::default();
    env.mock_all_auths();
    let (client, admin) = setup(&env);

    client.set_flag(&admin, &symbol_short!("newFeat"), &true);
    client.set_flag(&admin, &symbol_short!("newFeat"), &false);

    assert!(!client.is_enabled(&symbol_short!("newFeat")));
    // get_flag now returns explicit false (not FlagNotFound)
    assert_eq!(client.get_flag(&symbol_short!("newFeat")), false);
}

#[test]
fn test_multiple_flags_are_independent() {
    let env = Env::default();
    env.mock_all_auths();
    let (client, admin) = setup(&env);

    client.set_flag(&admin, &symbol_short!("alpha"), &true);
    client.set_flag(&admin, &symbol_short!("beta"), &false);

    assert!(client.is_enabled(&symbol_short!("alpha")));
    assert!(!client.is_enabled(&symbol_short!("beta")));
    assert!(!client.is_enabled(&symbol_short!("gamma"))); // never set
}

// ── Access control ────────────────────────────────────────────────────────────

#[test]
fn test_non_admin_cannot_set_flag() {
    let env = Env::default();
    env.mock_all_auths();
    let (client, _) = setup(&env);

    let rando = Address::generate(&env);
    assert_eq!(
        client.try_set_flag(&rando, &symbol_short!("newFeat"), &true),
        Err(Ok(FlagError::Unauthorized))
    );
}

#[test]
fn test_set_admin_transfers_role() {
    let env = Env::default();
    env.mock_all_auths();
    let (client, admin) = setup(&env);

    let new_admin = Address::generate(&env);
    client.set_admin(&admin, &new_admin);
    assert_eq!(client.get_admin(), new_admin);

    // Old admin can no longer set flags.
    assert_eq!(
        client.try_set_flag(&admin, &symbol_short!("newFeat"), &true),
        Err(Ok(FlagError::Unauthorized))
    );

    // New admin can.
    client.set_flag(&new_admin, &symbol_short!("newFeat"), &true);
    assert!(client.is_enabled(&symbol_short!("newFeat")));
}

// ── Observability (event emission) ────────────────────────────────────────────

#[test]
fn test_flag_set_emits_event() {
    let env = Env::default();
    env.mock_all_auths();
    let (client, admin) = setup(&env);

    client.set_flag(&admin, &symbol_short!("newFeat"), &true);

    // Verify at least one event was emitted (soroban-sdk records all published events).
    assert!(!env.events().all().is_empty());
}
