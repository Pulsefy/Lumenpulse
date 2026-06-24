use crate::errors::DeploymentRegistryError;
use crate::{DeploymentMetadataRegistryContract, DeploymentMetadataRegistryContractClient};
use soroban_sdk::{
    testutils::{Address as _, Ledger},
    Address, Env,
};
use soroban_sdk::{String, Symbol};

fn setup(env: &Env) -> (DeploymentMetadataRegistryContractClient<'_>, Address) {
    let admin = Address::generate(env);
    let id = env.register(DeploymentMetadataRegistryContract, ());
    let client = DeploymentMetadataRegistryContractClient::new(env, &id);
    client.initialize(&admin);
    (client, admin)
}

fn s(env: &Env, value: &str) -> String {
    String::from_str(env, value)
}

fn key(env: &Env, value: &str) -> Symbol {
    Symbol::new(env, value)
}

#[test]
fn initialize_sets_admin() {
    let env = Env::default();
    env.mock_all_auths();

    let (client, admin) = setup(&env);

    assert_eq!(client.get_admin(), admin);
}

#[test]
fn double_initialize_fails() {
    let env = Env::default();
    env.mock_all_auths();

    let (client, admin) = setup(&env);

    assert_eq!(
        client.try_initialize(&admin),
        Err(Ok(DeploymentRegistryError::AlreadyInitialized))
    );
}

#[test]
fn admin_can_store_contract_metadata() {
    let env = Env::default();
    env.mock_all_auths();
    env.ledger().with_mut(|ledger| ledger.timestamp = 42);

    let (client, admin) = setup(&env);
    let contract_address = Address::generate(&env);
    let name = key(&env, "crowdfund_vault");

    client.set_deployment(
        &admin,
        &name,
        &contract_address,
        &s(&env, "1.0.0"),
        &s(&env, "testnet"),
    );

    let entry = client.get_deployment(&name);
    assert_eq!(entry.key, name);
    assert_eq!(entry.contract_address, contract_address);
    assert_eq!(entry.version, s(&env, "1.0.0"));
    assert_eq!(entry.environment, s(&env, "testnet"));
    assert_eq!(entry.updated_at, 42);
    assert!(entry.active);
}

#[test]
fn non_admin_update_fails() {
    let env = Env::default();
    env.mock_all_auths();

    let (client, _) = setup(&env);
    let caller = Address::generate(&env);
    let contract_address = Address::generate(&env);

    assert_eq!(
        client.try_set_deployment(
            &caller,
            &key(&env, "treasury"),
            &contract_address,
            &s(&env, "1.0.0"),
            &s(&env, "testnet"),
        ),
        Err(Ok(DeploymentRegistryError::Unauthorized))
    );
}

#[test]
fn clients_can_query_active_deployment_map() {
    let env = Env::default();
    env.mock_all_auths();

    let (client, admin) = setup(&env);
    let treasury = Address::generate(&env);
    let token = Address::generate(&env);

    client.set_deployment(
        &admin,
        &key(&env, "treasury"),
        &treasury,
        &s(&env, "1.0.0"),
        &s(&env, "testnet"),
    );
    client.set_deployment(
        &admin,
        &key(&env, "lumen_token"),
        &token,
        &s(&env, "1.0.0"),
        &s(&env, "testnet"),
    );

    let active = client.get_active_deployments();

    assert_eq!(active.len(), 2);
    assert_eq!(
        active.get(key(&env, "treasury")).unwrap().contract_address,
        treasury
    );
    assert_eq!(
        active
            .get(key(&env, "lumen_token"))
            .unwrap()
            .contract_address,
        token
    );
}

#[test]
fn inactive_deployments_are_omitted_from_active_map() {
    let env = Env::default();
    env.mock_all_auths();

    let (client, admin) = setup(&env);
    let token = Address::generate(&env);
    let token_key = key(&env, "lumen_token");

    client.set_deployment(
        &admin,
        &token_key,
        &token,
        &s(&env, "1.0.0"),
        &s(&env, "testnet"),
    );
    client.deactivate_deployment(&admin, &token_key);

    let entry = client.get_deployment(&token_key);
    let active = client.get_active_deployments();

    assert!(!entry.active);
    assert_eq!(active.len(), 0);
}

#[test]
fn metadata_fields_are_required() {
    let env = Env::default();
    env.mock_all_auths();

    let (client, admin) = setup(&env);
    let contract_address = Address::generate(&env);

    assert_eq!(
        client.try_set_deployment(
            &admin,
            &key(&env, "pricing_adapter"),
            &contract_address,
            &s(&env, ""),
            &s(&env, "testnet"),
        ),
        Err(Ok(DeploymentRegistryError::EmptyVersion))
    );
    assert_eq!(
        client.try_set_deployment(
            &admin,
            &key(&env, "pricing_adapter"),
            &contract_address,
            &s(&env, "1.0.0"),
            &s(&env, ""),
        ),
        Err(Ok(DeploymentRegistryError::EmptyEnvironment))
    );
}

#[test]
fn admin_transfer_changes_update_authority() {
    let env = Env::default();
    env.mock_all_auths();

    let (client, admin) = setup(&env);
    let new_admin = Address::generate(&env);
    let contract_address = Address::generate(&env);

    client.set_admin(&admin, &new_admin);

    assert_eq!(
        client.try_set_deployment(
            &admin,
            &key(&env, "treasury"),
            &contract_address,
            &s(&env, "1.0.0"),
            &s(&env, "testnet"),
        ),
        Err(Ok(DeploymentRegistryError::Unauthorized))
    );

    client.set_deployment(
        &new_admin,
        &key(&env, "treasury"),
        &contract_address,
        &s(&env, "1.0.0"),
        &s(&env, "testnet"),
    );
    assert_eq!(
        client
            .get_deployment(&key(&env, "treasury"))
            .contract_address,
        contract_address
    );
}
