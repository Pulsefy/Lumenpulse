use crate::errors::RegistryError;
use crate::storage::LEDGER_THRESHOLD;
use crate::{ProtocolRegistryContract, ProtocolRegistryContractClient};
use soroban_sdk::{
    symbol_short,
    testutils::{Address as _, Ledger},
    Address, Env,
};

fn setup(env: &Env) -> (ProtocolRegistryContractClient<'_>, Address) {
    let admin = Address::generate(env);
    let id = env.register(ProtocolRegistryContract, ());
    let client = ProtocolRegistryContractClient::new(env, &id);
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
        Err(Ok(RegistryError::AlreadyInitialized))
    );
}

// ── Register ──────────────────────────────────────────────────────────────────

#[test]
fn test_register_module() {
    let env = Env::default();
    env.mock_all_auths();
    let (client, admin) = setup(&env);

    let vault_addr = Address::generate(&env);
    client.register_module(&admin, &symbol_short!("vault"), &vault_addr, &1u32);

    let entry = client.get_module(&symbol_short!("vault"));
    assert_eq!(entry.address, vault_addr);
    assert_eq!(entry.version, 1);
    assert!(entry.is_active);
}

#[test]
fn test_register_duplicate_fails() {
    let env = Env::default();
    env.mock_all_auths();
    let (client, admin) = setup(&env);

    let addr = Address::generate(&env);
    client.register_module(&admin, &symbol_short!("vault"), &addr, &1u32);
    assert_eq!(
        client.try_register_module(&admin, &symbol_short!("vault"), &addr, &2u32),
        Err(Ok(RegistryError::ModuleAlreadyRegistered))
    );
}

#[test]
fn test_non_admin_register_fails() {
    let env = Env::default();
    env.mock_all_auths();
    let (client, _) = setup(&env);

    let rando = Address::generate(&env);
    let addr = Address::generate(&env);
    assert_eq!(
        client.try_register_module(&rando, &symbol_short!("vault"), &addr, &1u32),
        Err(Ok(RegistryError::Unauthorized))
    );
}

// ── Update ────────────────────────────────────────────────────────────────────

#[test]
fn test_update_module() {
    let env = Env::default();
    env.mock_all_auths();
    let (client, admin) = setup(&env);

    let v1 = Address::generate(&env);
    client.register_module(&admin, &symbol_short!("pool"), &v1, &1u32);

    let v2 = Address::generate(&env);
    client.update_module(&admin, &symbol_short!("pool"), &v2, &2u32);

    let entry = client.get_module(&symbol_short!("pool"));
    assert_eq!(entry.address, v2);
    assert_eq!(entry.version, 2);
    assert!(entry.is_active);
}

#[test]
fn test_update_version_must_increment() {
    let env = Env::default();
    env.mock_all_auths();
    let (client, admin) = setup(&env);

    let addr = Address::generate(&env);
    client.register_module(&admin, &symbol_short!("pool"), &addr, &5u32);

    // Same version — must fail
    assert_eq!(
        client.try_update_module(&admin, &symbol_short!("pool"), &addr, &5u32),
        Err(Ok(RegistryError::VersionNotIncremented))
    );

    // Lower version — must fail
    assert_eq!(
        client.try_update_module(&admin, &symbol_short!("pool"), &addr, &3u32),
        Err(Ok(RegistryError::VersionNotIncremented))
    );
}

#[test]
fn test_update_nonexistent_module_fails() {
    let env = Env::default();
    env.mock_all_auths();
    let (client, admin) = setup(&env);

    let addr = Address::generate(&env);
    assert_eq!(
        client.try_update_module(&admin, &symbol_short!("ghost"), &addr, &1u32),
        Err(Ok(RegistryError::ModuleNotFound))
    );
}

// ── Resolve ───────────────────────────────────────────────────────────────────

#[test]
fn test_resolve_returns_active_address() {
    let env = Env::default();
    env.mock_all_auths();
    let (client, admin) = setup(&env);

    let addr = Address::generate(&env);
    client.register_module(&admin, &symbol_short!("token"), &addr, &1u32);

    assert_eq!(client.resolve(&symbol_short!("token")), addr);
}

#[test]
fn test_resolve_unknown_module_fails() {
    let env = Env::default();
    env.mock_all_auths();
    let (client, _) = setup(&env);

    assert_eq!(
        client.try_resolve(&symbol_short!("ghost")),
        Err(Ok(RegistryError::ModuleNotFound))
    );
}

// ── Deactivate / Activate ─────────────────────────────────────────────────────

#[test]
fn test_deactivate_module() {
    let env = Env::default();
    env.mock_all_auths();
    let (client, admin) = setup(&env);

    let addr = Address::generate(&env);
    client.register_module(&admin, &symbol_short!("vault"), &addr, &1u32);

    client.deactivate_module(&admin, &symbol_short!("vault"));

    assert!(!client.is_active(&symbol_short!("vault")));

    // resolve must refuse inactive modules
    assert_eq!(
        client.try_resolve(&symbol_short!("vault")),
        Err(Ok(RegistryError::ModuleInactive))
    );

    // get_module still returns the entry
    let entry = client.get_module(&symbol_short!("vault"));
    assert!(!entry.is_active);
}

#[test]
fn test_activate_module() {
    let env = Env::default();
    env.mock_all_auths();
    let (client, admin) = setup(&env);

    let addr = Address::generate(&env);
    client.register_module(&admin, &symbol_short!("vault"), &addr, &1u32);
    client.deactivate_module(&admin, &symbol_short!("vault"));
    client.activate_module(&admin, &symbol_short!("vault"));

    assert!(client.is_active(&symbol_short!("vault")));
    assert_eq!(client.resolve(&symbol_short!("vault")), addr);
}

#[test]
fn test_update_reactivates_deactivated_module() {
    let env = Env::default();
    env.mock_all_auths();
    let (client, admin) = setup(&env);

    let v1 = Address::generate(&env);
    client.register_module(&admin, &symbol_short!("vault"), &v1, &1u32);
    client.deactivate_module(&admin, &symbol_short!("vault"));

    let v2 = Address::generate(&env);
    client.update_module(&admin, &symbol_short!("vault"), &v2, &2u32);

    assert!(client.is_active(&symbol_short!("vault")));
}

// ── is_active ─────────────────────────────────────────────────────────────────

#[test]
fn test_is_active_unknown_returns_false() {
    let env = Env::default();
    env.mock_all_auths();
    let (client, _) = setup(&env);

    assert!(!client.is_active(&symbol_short!("ghost")));
}

// ── Multiple modules ──────────────────────────────────────────────────────────

#[test]
fn test_multiple_modules_independent() {
    let env = Env::default();
    env.mock_all_auths();
    let (client, admin) = setup(&env);

    let vault_addr = Address::generate(&env);
    let pool_addr = Address::generate(&env);
    let token_addr = Address::generate(&env);

    client.register_module(&admin, &symbol_short!("vault"), &vault_addr, &1u32);
    client.register_module(&admin, &symbol_short!("pool"), &pool_addr, &1u32);
    client.register_module(&admin, &symbol_short!("token"), &token_addr, &1u32);

    // Deactivating one doesn't affect the others
    client.deactivate_module(&admin, &symbol_short!("pool"));

    assert!(client.is_active(&symbol_short!("vault")));
    assert!(!client.is_active(&symbol_short!("pool")));
    assert!(client.is_active(&symbol_short!("token")));

    assert_eq!(client.resolve(&symbol_short!("vault")), vault_addr);
    assert_eq!(client.resolve(&symbol_short!("token")), token_addr);
}

// ── Pause ─────────────────────────────────────────────────────────────────────

#[test]
fn test_pause_blocks_register() {
    let env = Env::default();
    env.mock_all_auths();
    let (client, admin) = setup(&env);

    client.pause(&admin);

    let addr = Address::generate(&env);
    assert_eq!(
        client.try_register_module(&admin, &symbol_short!("vault"), &addr, &1u32),
        Err(Ok(RegistryError::ContractPaused))
    );
}

#[test]
fn test_pause_blocks_update() {
    let env = Env::default();
    env.mock_all_auths();
    let (client, admin) = setup(&env);

    let v1 = Address::generate(&env);
    client.register_module(&admin, &symbol_short!("vault"), &v1, &1u32);
    client.pause(&admin);

    let v2 = Address::generate(&env);
    assert_eq!(
        client.try_update_module(&admin, &symbol_short!("vault"), &v2, &2u32),
        Err(Ok(RegistryError::ContractPaused))
    );
}

#[test]
fn test_unpause_restores_writes() {
    let env = Env::default();
    env.mock_all_auths();
    let (client, admin) = setup(&env);

    client.pause(&admin);
    client.unpause(&admin);

    let addr = Address::generate(&env);
    client.register_module(&admin, &symbol_short!("vault"), &addr, &1u32);
    assert!(client.is_active(&symbol_short!("vault")));
}

// ── Admin transfer ────────────────────────────────────────────────────────────

#[test]
fn test_set_admin() {
    let env = Env::default();
    env.mock_all_auths();
    let (client, admin) = setup(&env);

    let new_admin = Address::generate(&env);
    client.set_admin(&admin, &new_admin);
    assert_eq!(client.get_admin(), new_admin);

    // old admin can no longer register
    let addr = Address::generate(&env);
    assert_eq!(
        client.try_register_module(&admin, &symbol_short!("vault"), &addr, &1u32),
        Err(Ok(RegistryError::Unauthorized))
    );

    // new admin can
    client.register_module(&new_admin, &symbol_short!("vault"), &addr, &1u32);
    assert!(client.is_active(&symbol_short!("vault")));
}

#[test]
fn test_ttl_extended_after_read_write() {
    let env = Env::default();
    env.mock_all_auths();
    let (client, admin) = setup(&env);

    let addr = Address::generate(&env);
    let name = symbol_short!("vault");
    client.register_module(&admin, &name, &addr, &1u32);

    // First threshold crossing: reads should re-bump both instance
    // (Admin/Paused) and the module's own persistent record.
    env.ledger().set_sequence_number(LEDGER_THRESHOLD + 1);
    assert_eq!(client.get_admin(), admin);
    assert_eq!(client.resolve(&name), addr);

    // Second threshold crossing: only survives if the prior reads actually
    // extended the TTL rather than leaving it to expire.
    env.ledger().set_sequence_number(2 * LEDGER_THRESHOLD + 2);
    assert_eq!(client.resolve(&name), addr);
    assert!(client.is_active(&name));

    // A write after a long gap must also succeed and keep protecting reads.
    let new_addr = Address::generate(&env);
    env.ledger().set_sequence_number(3 * LEDGER_THRESHOLD + 3);
    client.update_module(&admin, &name, &new_addr, &2u32);
    assert_eq!(client.resolve(&name), new_addr);
}
