#![cfg(test)]

use access_control::{AccessControlContract};
use access_control_interface::{
    AccessControlClient, AccessControlTrait, Permission, PermissionCheck, Role,
};
use soroban_sdk::{
    testutils::{Address as _, Ledger},
    Env, String, Symbol,
};

#[test]
fn test_initialize_contract() {
    let env = Env::default();
    let admin_addr = Address::generate(&env);
    let contract_id = env.register_contract(None, AccessControlContract);

    let client = AccessControlClient::new(&env, &contract_id);

    let result = client.initialize(&admin_addr);
    assert!(result.is_ok());
}

#[test]
fn test_create_role() {
    let env = Env::default();
    let admin_addr = Address::generate(&env);
    let contract_id = env.register_contract(None, AccessControlContract);

    let client = AccessControlClient::new(&env, &contract_id);

    client.initialize(&admin_addr);

    let role_id = Symbol::short("admin");
    let role_name = String::from_slice(&env, &"Administrator");

    let result = client.create_role(&role_id, &role_name);
    assert!(result.is_ok());
}

#[test]
fn test_cannot_create_duplicate_role() {
    let env = Env::default();
    let admin_addr = Address::generate(&env);
    let contract_id = env.register_contract(None, AccessControlContract);

    let client = AccessControlClient::new(&env, &contract_id);
    client.initialize(&admin_addr);

    let role_id = Symbol::short("admin");
    let role_name = String::from_slice(&env, &"Administrator");

    client.create_role(&role_id, &role_name);

    // Try to create the same role again
    let result = client.create_role(&role_id, &role_name);
    assert!(result.is_err());
}

#[test]
fn test_grant_and_check_role() {
    let env = Env::default();
    let admin_addr = Address::generate(&env);
    let user_addr = Address::generate(&env);
    let contract_id = env.register_contract(None, AccessControlContract);

    let client = AccessControlClient::new(&env, &contract_id);
    client.initialize(&admin_addr);

    let role_id = Symbol::short("admin");
    let role_name = String::from_slice(&env, &"Administrator");
    client.create_role(&role_id, &role_name);

    let role = Role {
        id: role_id,
        name: role_name,
    };

    // Grant the role
    let result = client.grant_role(&user_addr, &role);
    assert!(result.is_ok());

    // Check if user has the role
    let has_role = client.has_role(&user_addr, &role);
    assert!(has_role);
}

#[test]
fn test_revoke_role() {
    let env = Env::default();
    let admin_addr = Address::generate(&env);
    let user_addr = Address::generate(&env);
    let contract_id = env.register_contract(None, AccessControlContract);

    let client = AccessControlClient::new(&env, &contract_id);
    client.initialize(&admin_addr);

    let role_id = Symbol::short("admin");
    let role_name = String::from_slice(&env, &"Administrator");
    client.create_role(&role_id, &role_name);

    let role = Role {
        id: role_id,
        name: role_name,
    };

    client.grant_role(&user_addr, &role);
    assert!(client.has_role(&user_addr, &role));

    // Revoke the role
    let result = client.revoke_role(&user_addr, &role);
    assert!(result.is_ok());

    // Verify role is revoked
    assert!(!client.has_role(&user_addr, &role));
}

#[test]
fn test_create_permission() {
    let env = Env::default();
    let admin_addr = Address::generate(&env);
    let contract_id = env.register_contract(None, AccessControlContract);

    let client = AccessControlClient::new(&env, &contract_id);
    client.initialize(&admin_addr);

    let perm_id = Symbol::short("publish");
    let description = String::from_slice(&env, &"Can publish news articles");
    let resource = String::from_slice(&env, &"news_feed");

    let result = client.create_permission(&perm_id, &description, &resource);
    assert!(result.is_ok());
}

#[test]
fn test_grant_permission_to_role() {
    let env = Env::default();
    let admin_addr = Address::generate(&env);
    let user_addr = Address::generate(&env);
    let contract_id = env.register_contract(None, AccessControlContract);

    let client = AccessControlClient::new(&env, &contract_id);
    client.initialize(&admin_addr);

    // Create role and permission
    let role_id = Symbol::short("editor");
    let role_name = String::from_slice(&env, &"Editor");
    client.create_role(&role_id, &role_name);

    let perm_id = Symbol::short("publish");
    let description = String::from_slice(&env, &"Can publish news articles");
    let resource = String::from_slice(&env, &"news_feed");
    client.create_permission(&perm_id, &description, &resource);

    let role = Role {
        id: role_id,
        name: role_name,
    };

    let permission = Permission {
        id: perm_id,
        description,
        resource,
    };

    // Grant permission to role
    let result = client.grant_permission_to_role(&role, &permission);
    assert!(result.is_ok());

    // Grant role to user
    client.grant_role(&user_addr, &role);

    // Check if user has permission
    let check = client.has_permission(&user_addr, &permission);
    assert!(check.granted);
}

#[test]
fn test_user_without_permission() {
    let env = Env::default();
    let admin_addr = Address::generate(&env);
    let user_addr = Address::generate(&env);
    let contract_id = env.register_contract(None, AccessControlContract);

    let client = AccessControlClient::new(&env, &contract_id);
    client.initialize(&admin_addr);

    let perm_id = Symbol::short("delete");
    let description = String::from_slice(&env, &"Can delete articles");
    let resource = String::from_slice(&env, &"news_feed");
    client.create_permission(&perm_id, &description, &resource);

    let permission = Permission {
        id: perm_id,
        description,
        resource,
    };

    // Check permission for user with no roles
    let check = client.has_permission(&user_addr, &permission);
    assert!(!check.granted);
}

#[test]
fn test_add_trusted_caller() {
    let env = Env::default();
    let admin_addr = Address::generate(&env);
    let caller_addr = Address::generate(&env);
    let contract_id = env.register_contract(None, AccessControlContract);

    let client = AccessControlClient::new(&env, &contract_id);
    client.initialize(&admin_addr);

    let caller_name = String::from_slice(&env, &"RewardContract");
    let result = client.add_trusted_caller(&caller_addr, &caller_name);
    assert!(result.is_ok());

    // Verify caller is trusted
    let is_trusted = client.is_trusted_caller(&caller_addr);
    assert!(is_trusted);
}

#[test]
fn test_remove_trusted_caller() {
    let env = Env::default();
    let admin_addr = Address::generate(&env);
    let caller_addr = Address::generate(&env);
    let contract_id = env.register_contract(None, AccessControlContract);

    let client = AccessControlClient::new(&env, &contract_id);
    client.initialize(&admin_addr);

    let caller_name = String::from_slice(&env, &"RewardContract");
    client.add_trusted_caller(&caller_addr, &caller_name);

    // Remove trusted caller
    let result = client.remove_trusted_caller(&caller_addr);
    assert!(result.is_ok());

    // Verify caller is no longer trusted
    let is_trusted = client.is_trusted_caller(&caller_addr);
    assert!(!is_trusted);
}

#[test]
fn test_verify_caller_authorization() {
    let env = Env::default();
    let admin_addr = Address::generate(&env);
    let user_addr = Address::generate(&env);
    let contract_id = env.register_contract(None, AccessControlContract);

    let client = AccessControlClient::new(&env, &contract_id);
    client.initialize(&admin_addr);

    // Create and grant role
    let role_id = Symbol::short("poster");
    let role_name = String::from_slice(&env, &"Poster");
    client.create_role(&role_id, &role_name);

    let role = Role {
        id: role_id,
        name: role_name,
    };

    client.grant_role(&user_addr, &role);

    // Verify authorization
    let check = client.verify_caller_authorization(&user_addr, &role);
    assert!(check.granted);
}

#[test]
fn test_register_and_check_resource() {
    let env = Env::default();
    let admin_addr = Address::generate(&env);
    let contract_id = env.register_contract(None, AccessControlContract);

    let client = AccessControlClient::new(&env, &contract_id);
    client.initialize(&admin_addr);

    let resource = String::from_slice(&env, &"portfolio_manager");
    let result = client.register_resource(&resource);
    assert!(result.is_ok());

    // Check if resource is managed
    let is_managed = client.is_managed_resource(&resource);
    assert!(is_managed);
}

#[test]
fn test_get_roles_for_user() {
    let env = Env::default();
    let admin_addr = Address::generate(&env);
    let user_addr = Address::generate(&env);
    let contract_id = env.register_contract(None, AccessControlContract);

    let client = AccessControlClient::new(&env, &contract_id);
    client.initialize(&admin_addr);

    // Create and grant multiple roles
    let role1_id = Symbol::short("admin");
    let role1_name = String::from_slice(&env, &"Administrator");
    client.create_role(&role1_id, &role1_name);

    let role2_id = Symbol::short("editor");
    let role2_name = String::from_slice(&env, &"Editor");
    client.create_role(&role2_id, &role2_name);

    let role1 = Role {
        id: role1_id,
        name: role1_name,
    };

    let role2 = Role {
        id: role2_id,
        name: role2_name,
    };

    client.grant_role(&user_addr, &role1);
    client.grant_role(&user_addr, &role2);

    // Get roles
    let roles = client.get_roles(&user_addr);
    assert_eq!(roles.len(), 2);
}

#[test]
fn test_get_permissions_for_user() {
    let env = Env::default();
    let admin_addr = Address::generate(&env);
    let user_addr = Address::generate(&env);
    let contract_id = env.register_contract(None, AccessControlContract);

    let client = AccessControlClient::new(&env, &contract_id);
    client.initialize(&admin_addr);

    // Create role with permissions
    let role_id = Symbol::short("editor");
    let role_name = String::from_slice(&env, &"Editor");
    client.create_role(&role_id, &role_name);

    let perm1_id = Symbol::short("publish");
    let perm1_desc = String::from_slice(&env, &"Publish content");
    let perm1_resource = String::from_slice(&env, &"news");
    client.create_permission(&perm1_id, &perm1_desc, &perm1_resource);

    let perm2_id = Symbol::short("comment");
    let perm2_desc = String::from_slice(&env, &"Add comments");
    let perm2_resource = String::from_slice(&env, &"news");
    client.create_permission(&perm2_id, &perm2_desc, &perm2_resource);

    let role = Role {
        id: role_id,
        name: role_name,
    };

    let perm1 = Permission {
        id: perm1_id,
        description: perm1_desc,
        resource: perm1_resource,
    };

    let perm2 = Permission {
        id: perm2_id,
        description: perm2_desc,
        resource: perm2_resource,
    };

    client.grant_permission_to_role(&role, &perm1);
    client.grant_permission_to_role(&role, &perm2);
    client.grant_role(&user_addr, &role);

    // Get permissions
    let permissions = client.get_permissions(&user_addr);
    assert_eq!(permissions.len(), 2);
}
