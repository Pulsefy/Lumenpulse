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

#[test]
fn test_unset_flag_defaults_to_disabled() {
    let env = Env::default();
    env.mock_all_auths();
    let (client, _) = setup(&env);

    assert!(!client.is_enabled(&symbol_short!("unknown")));
}

#[test]
fn test_set_and_check_flag() {
    let env = Env::default();
    env.mock_all_auths();
    let (client, admin) = setup(&env);

    client.set_flag(&admin, &symbol_short!("new_vault"), &true);

    assert!(client.is_enabled(&symbol_short!("new_vault")));

    let entry = client.get_flag(&symbol_short!("new_vault"));
    assert!(entry.is_some());
    let entry = entry.unwrap();
    assert_eq!(entry.key, symbol_short!("new_vault"));
    assert!(entry.enabled);
}

#[test]
fn test_disable_flag() {
    let env = Env::default();
    env.mock_all_auths();
    let (client, admin) = setup(&env);

    client.set_flag(&admin, &symbol_short!("new_vault"), &true);
    assert!(client.is_enabled(&symbol_short!("new_vault")));

    client.set_flag(&admin, &symbol_short!("new_vault"), &false);
    assert!(!client.is_enabled(&symbol_short!("new_vault")));
}

#[test]
fn test_non_admin_set_flag_fails() {
    let env = Env::default();
    env.mock_all_auths();
    let (client, _) = setup(&env);

    let rando = Address::generate(&env);
    assert_eq!(
        client.try_set_flag(&rando, &symbol_short!("test"), &true),
        Err(Ok(FlagError::Unauthorized))
    );
}

#[test]
fn test_pause_blocks_set_flag() {
    let env = Env::default();
    env.mock_all_auths();
    let (client, admin) = setup(&env);

    client.pause(&admin);

    assert_eq!(
        client.try_set_flag(&admin, &symbol_short!("test"), &true),
        Err(Ok(FlagError::ContractPaused))
    );
}

#[test]
fn test_unpause_restores_writes() {
    let env = Env::default();
    env.mock_all_auths();
    let (client, admin) = setup(&env);

    client.pause(&admin);
    client.unpause(&admin);

    client.set_flag(&admin, &symbol_short!("test"), &true);
    assert!(client.is_enabled(&symbol_short!("test")));
}

#[test]
fn test_set_admin() {
    let env = Env::default();
    env.mock_all_auths();
    let (client, admin) = setup(&env);

    let new_admin = Address::generate(&env);
    client.set_admin(&admin, &new_admin);
    assert_eq!(client.get_admin(), new_admin);

    let _rando = Address::generate(&env);
    assert_eq!(
        client.try_set_flag(&admin, &symbol_short!("test"), &true),
        Err(Ok(FlagError::Unauthorized))
    );

    client.set_flag(&new_admin, &symbol_short!("test"), &true);
    assert!(client.is_enabled(&symbol_short!("test")));
}

#[test]
fn test_list_flags() {
    let env = Env::default();
    env.mock_all_auths();
    let (client, admin) = setup(&env);

    let flags = client.list_flags();
    assert_eq!(flags.len(), 0);

    client.set_flag(&admin, &symbol_short!("flag_a"), &true);
    client.set_flag(&admin, &symbol_short!("flag_b"), &true);
    client.set_flag(&admin, &symbol_short!("flag_c"), &false);

    let flags = client.list_flags();
    assert_eq!(flags.len(), 3);
}

#[test]
fn test_get_flag_unknown_returns_none() {
    let env = Env::default();
    env.mock_all_auths();
    let (client, _) = setup(&env);

    assert!(client.get_flag(&symbol_short!("ghost")).is_none());
}
