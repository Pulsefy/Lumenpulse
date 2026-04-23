use crate::errors::ContributorError;
use crate::{ContributorRegistryContract, ContributorRegistryContractClient};
use soroban_sdk::{testutils::Address as _, Address, Env, String};

fn setup_test<'a>(env: &Env) -> (ContributorRegistryContractClient<'a>, Address, Address) {
    let admin = Address::generate(env);
    let contributor = Address::generate(env);

    // Register contract
    let contract_id = env.register(ContributorRegistryContract, ());
    let client = ContributorRegistryContractClient::new(env, &contract_id);

    (client, admin, contributor)
}

#[test]
fn test_initialize() {
    let env = Env::default();
    env.mock_all_auths();

    let (client, admin, _) = setup_test(&env);

    // Initialize contract
    client.initialize(&admin);

    // Verify admin is set
    assert_eq!(client.get_admin(), admin);
}

#[test]
fn test_double_initialization_fails() {
    let env = Env::default();
    env.mock_all_auths();

    let (client, admin, _) = setup_test(&env);

    // Initialize contract
    client.initialize(&admin);

    // Try to initialize again - should fail
    let result = client.try_initialize(&admin);
    assert_eq!(result, Err(Ok(ContributorError::AlreadyInitialized)));
}

#[test]
fn test_register_contributor() {
    let env = Env::default();
    env.mock_all_auths();

    let (client, admin, contributor) = setup_test(&env);

    // Initialize contract
    client.initialize(&admin);

    // Register contributor
    let github_handle = String::from_str(&env, "testuser");
    client.register_contributor(&contributor, &github_handle);

    // Verify contributor data
    let data = client.get_contributor(&contributor);
    assert_eq!(data.address, contributor);
    assert_eq!(data.github_handle, github_handle);
    assert_eq!(data.reputation_score, 0);
    // Verify timestamp is set to current ledger time
    assert_eq!(data.registered_timestamp, env.ledger().timestamp());
}

#[test]
fn test_get_contributor_by_github() {
    let env = Env::default();
    env.mock_all_auths();

    let (client, admin, contributor) = setup_test(&env);
    client.initialize(&admin);

    let github_handle = String::from_str(&env, "testuser");
    client.register_contributor(&contributor, &github_handle);

    let by_address = client.get_contributor(&contributor);
    let by_github = client.get_contributor_by_github(&github_handle);
    assert_eq!(by_github, by_address);
}

#[test]
fn test_register_contributor_not_initialized() {
    let env = Env::default();
    env.mock_all_auths();

    let (client, _, contributor) = setup_test(&env);

    // Try to register without initializing - should fail
    let github_handle = String::from_str(&env, "testuser");
    let result = client.try_register_contributor(&contributor, &github_handle);
    assert_eq!(result, Err(Ok(ContributorError::NotInitialized)));
}

#[test]
fn test_register_contributor_empty_github_handle() {
    let env = Env::default();
    env.mock_all_auths();

    let (client, admin, contributor) = setup_test(&env);

    // Initialize contract
    client.initialize(&admin);

    // Try to register with empty GitHub handle - should fail
    let github_handle = String::from_str(&env, "");
    let result = client.try_register_contributor(&contributor, &github_handle);
    assert_eq!(result, Err(Ok(ContributorError::InvalidGitHubHandle)));
}

#[test]
fn test_duplicate_registration_fails() {
    let env = Env::default();
    env.mock_all_auths();

    let (client, admin, contributor) = setup_test(&env);

    // Initialize contract
    client.initialize(&admin);

    // Register contributor
    let github_handle = String::from_str(&env, "testuser");
    client.register_contributor(&contributor, &github_handle);

    // Try to register again - should fail
    let result = client.try_register_contributor(&contributor, &github_handle);
    assert_eq!(result, Err(Ok(ContributorError::ContributorAlreadyExists)));
}

#[test]
fn test_duplicate_github_handle_fails_for_second_address() {
    let env = Env::default();
    env.mock_all_auths();

    let (client, admin, contributor1) = setup_test(&env);
    let contributor2 = Address::generate(&env);

    client.initialize(&admin);

    let github_handle = String::from_str(&env, "testuser");
    client.register_contributor(&contributor1, &github_handle);

    let result = client.try_register_contributor(&contributor2, &github_handle);
    assert_eq!(result, Err(Ok(ContributorError::GitHubHandleTaken)));
}

#[test]
fn test_update_contributor_github_handle_updates_index() {
    let env = Env::default();
    env.mock_all_auths();

    let (client, admin, contributor) = setup_test(&env);
    client.initialize(&admin);

    let old_handle = String::from_str(&env, "old_handle");
    let new_handle = String::from_str(&env, "new_handle");

    client.register_contributor(&contributor, &old_handle);
    client.update_contributor(&contributor, &new_handle);

    let old_lookup = client.try_get_contributor_by_github(&old_handle);
    assert_eq!(old_lookup, Err(Ok(ContributorError::ContributorNotFound)));

    let new_lookup = client.get_contributor_by_github(&new_handle);
    assert_eq!(new_lookup.address, contributor);
    assert_eq!(new_lookup.github_handle, new_handle);
}

#[test]
fn test_update_contributor_clears_stale_github_index_entry() {
    let env = Env::default();
    env.mock_all_auths();

    let (client, admin, contributor1) = setup_test(&env);
    let contributor2 = Address::generate(&env);

    client.initialize(&admin);

    let old_handle = String::from_str(&env, "old_handle");
    let new_handle = String::from_str(&env, "new_handle");
    client.register_contributor(&contributor1, &old_handle);
    client.update_contributor(&contributor1, &new_handle);

    // If the old index entry were stale, this registration would fail.
    client.register_contributor(&contributor2, &old_handle);
    let contributor2_data = client.get_contributor_by_github(&old_handle);
    assert_eq!(contributor2_data.address, contributor2);
}

#[test]
fn test_update_reputation() {
    let env = Env::default();
    env.mock_all_auths();

    let (client, admin, contributor) = setup_test(&env);

    // Initialize contract
    client.initialize(&admin);

    // Register contributor
    let github_handle = String::from_str(&env, "testuser");
    client.register_contributor(&contributor, &github_handle);

    // Update reputation
    let new_score: i64 = 100;
    client.update_reputation(&admin, &contributor, &new_score);

    // Verify reputation updated
    let data = client.get_contributor(&contributor);
    assert_eq!(data.reputation_score, new_score as u64);
}

#[test]
fn test_update_reputation_unauthorized() {
    let env = Env::default();
    env.mock_all_auths();

    let (client, admin, contributor) = setup_test(&env);

    // Initialize contract
    client.initialize(&admin);

    // Register contributor
    let github_handle = String::from_str(&env, "testuser");
    client.register_contributor(&contributor, &github_handle);

    // Non-admin tries to update reputation - should fail
    let non_admin = Address::generate(&env);
    let result = client.try_update_reputation(&non_admin, &contributor, &100);
    assert_eq!(result, Err(Ok(ContributorError::Unauthorized)));
}

#[test]
fn test_update_reputation_contributor_not_found() {
    let env = Env::default();
    env.mock_all_auths();

    let (client, admin, _) = setup_test(&env);

    // Initialize contract
    client.initialize(&admin);

    // Try to update reputation for non-existent contributor - should fail
    let non_existent = Address::generate(&env);
    let result = client.try_update_reputation(&admin, &non_existent, &100);
    assert_eq!(result, Err(Ok(ContributorError::ContributorNotFound)));
}

#[test]
fn test_get_contributor_not_found() {
    let env = Env::default();
    env.mock_all_auths();

    let (client, admin, _) = setup_test(&env);

    // Initialize contract
    client.initialize(&admin);

    // Try to get non-existent contributor
    let non_existent = Address::generate(&env);
    let result = client.try_get_contributor(&non_existent);
    assert_eq!(result, Err(Ok(ContributorError::ContributorNotFound)));
}

#[test]
fn test_multiple_contributors() {
    let env = Env::default();
    env.mock_all_auths();

    let (client, admin, contributor1) = setup_test(&env);
    let contributor2 = Address::generate(&env);
    let contributor3 = Address::generate(&env);

    // Initialize contract
    client.initialize(&admin);

    // Register multiple contributors
    let handle1 = String::from_str(&env, "user1");
    let handle2 = String::from_str(&env, "user2");
    let handle3 = String::from_str(&env, "user3");

    client.register_contributor(&contributor1, &handle1);
    client.register_contributor(&contributor2, &handle2);
    client.register_contributor(&contributor3, &handle3);

    // Update reputations
    client.update_reputation(&admin, &contributor1, &50);
    client.update_reputation(&admin, &contributor2, &75);
    client.update_reputation(&admin, &contributor3, &100);

    // Verify all contributors have correct data
    let data1 = client.get_contributor(&contributor1);
    let data2 = client.get_contributor(&contributor2);
    let data3 = client.get_contributor(&contributor3);

    assert_eq!(data1.github_handle, handle1);
    assert_eq!(data1.reputation_score, 50);

    assert_eq!(data2.github_handle, handle2);
    assert_eq!(data2.reputation_score, 75);

    assert_eq!(data3.github_handle, handle3);
    assert_eq!(data3.reputation_score, 100);
}

#[test]
fn test_reputation_can_be_updated_multiple_times() {
    let env = Env::default();
    env.mock_all_auths();

    let (client, admin, contributor) = setup_test(&env);

    // Initialize contract
    client.initialize(&admin);

    // Register contributor
    let github_handle = String::from_str(&env, "testuser");
    client.register_contributor(&contributor, &github_handle);

    // Update reputation multiple times
    client.update_reputation(&admin, &contributor, &10);
    assert_eq!(client.get_contributor(&contributor).reputation_score, 10);

    client.update_reputation(&admin, &contributor, &50);
    assert_eq!(client.get_contributor(&contributor).reputation_score, 60);

    client.update_reputation(&admin, &contributor, &100);
    assert_eq!(client.get_contributor(&contributor).reputation_score, 160);

    // Can also decrease reputation
    client.update_reputation(&admin, &contributor, &25);
    assert_eq!(client.get_contributor(&contributor).reputation_score, 185);
}

#[test]
fn test_reputation_can_be_updated_multiple_times_with_negative() {
    let env = Env::default();
    env.mock_all_auths();

    let (client, admin, contributor) = setup_test(&env);

    // Initialize contract
    client.initialize(&admin);

    // Register contributor
    let github_handle = String::from_str(&env, "testuser");
    client.register_contributor(&contributor, &github_handle);

    // Update reputation multiple times
    client.update_reputation(&admin, &contributor, &10);
    assert_eq!(client.get_contributor(&contributor).reputation_score, 10);

    client.update_reputation(&admin, &contributor, &50);
    assert_eq!(client.get_contributor(&contributor).reputation_score, 60);

    client.update_reputation(&admin, &contributor, &100);
    assert_eq!(client.get_contributor(&contributor).reputation_score, 160);

    // Can also decrease reputation
    client.update_reputation(&admin, &contributor, &-25);
    assert_eq!(client.get_contributor(&contributor).reputation_score, 135);
}

#[test]
fn test_reputation_can_be_updated_multiple_times_with_negative_check_under_flow() {
    let env = Env::default();
    env.mock_all_auths();

    let (client, admin, contributor) = setup_test(&env);

    // Initialize contract
    client.initialize(&admin);

    // Register contributor
    let github_handle = String::from_str(&env, "testuser");
    client.register_contributor(&contributor, &github_handle);

    // Update reputation multiple times
    client.update_reputation(&admin, &contributor, &10);
    assert_eq!(client.get_contributor(&contributor).reputation_score, 10);

    client.update_reputation(&admin, &contributor, &50);
    assert_eq!(client.get_contributor(&contributor).reputation_score, 60);

    client.update_reputation(&admin, &contributor, &-100);
    assert_eq!(client.get_contributor(&contributor).reputation_score, 0);
}

#[test]
fn test_reputation_get_reputation() {
    let env = Env::default();
    env.mock_all_auths();

    let (client, admin, contributor) = setup_test(&env);

    // Initialize contract
    client.initialize(&admin);

    // Register contributor
    let github_handle = String::from_str(&env, "testuser");
    client.register_contributor(&contributor, &github_handle);

    // Update reputation multiple times
    client.update_reputation(&admin, &contributor, &10);
    assert_eq!(client.get_reputation(&contributor), 10);

    client.update_reputation(&admin, &contributor, &-20);
    assert_eq!(client.get_reputation(&contributor), 0);

    client.update_reputation(&admin, &contributor, &50);
    assert_eq!(client.get_reputation(&contributor), 50);
}

// ---------------------------------------------------------------------------
// Upgradeability tests
// ---------------------------------------------------------------------------

#[test]
fn test_set_admin_transfers_role() {
    let env = Env::default();
    env.mock_all_auths();

    let (client, admin, _) = setup_test(&env);
    client.initialize(&admin);

    let new_admin = soroban_sdk::Address::generate(&env);
    client.set_admin(&admin, &new_admin);

    assert_eq!(
        client.get_admin(),
        new_admin,
        "admin must be updated after set_admin"
    );
}

#[test]
fn test_only_admin_can_upgrade() {
    let env = Env::default();
    env.mock_all_auths();

    let (client, admin, _) = setup_test(&env);
    client.initialize(&admin);

    let non_admin = soroban_sdk::Address::generate(&env);
    let dummy = soroban_sdk::BytesN::from_array(&env, &[0u8; 32]);

    let result = client.try_upgrade(&non_admin, &dummy);
    assert_eq!(
        result,
        Err(Ok(crate::errors::ContributorError::Unauthorized))
    );
}

#[test]
fn test_old_admin_cannot_upgrade_after_rotation() {
    let env = Env::default();
    env.mock_all_auths();

    let (client, admin, _) = setup_test(&env);
    client.initialize(&admin);

    let new_admin = soroban_sdk::Address::generate(&env);
    client.set_admin(&admin, &new_admin);

    let dummy = soroban_sdk::BytesN::from_array(&env, &[0u8; 32]);
    let result = client.try_upgrade(&admin, &dummy);
    assert_eq!(
        result,
        Err(Ok(crate::errors::ContributorError::Unauthorized))
    );
}
