#![no_std]

mod errors;
mod storage;

use access_control_interface::{
    AccessControlTrait, Permission, PermissionCheck, Role, RoleInfo, TrustedCaller,
};
use errors::AccessControlError;
use soroban_sdk::{
    contract, contractimpl, Address, Bytes, Env, Map, String, Symbol, Vec,
};
use storage::DataKey;

#[contract]
pub struct AccessControlContract;

#[contractimpl]
impl AccessControlContract {
    /// Initialize the access control contract with an admin address
    ///
    /// # Arguments
    ///
    /// * `admin` - The initial administrator address
    ///
    /// # Returns
    ///
    /// `Ok(())` on success, or an error if already initialized
    pub fn initialize(env: Env, admin: Address) -> Result<(), AccessControlError> {
        // Require auth from the admin being set
        admin.require_auth();

        if env.storage().instance().has(&DataKey::Admin) {
            return Err(AccessControlError::AlreadyInitialized);
        }

        env.storage().instance().set(&DataKey::Admin, &admin);
        env.storage().instance().set(&DataKey::Initialized, &true);

        Ok(())
    }

    /// Helper: Ensure the contract is initialized
    fn ensure_initialized(env: &Env) -> Result<(), AccessControlError> {
        if !env
            .storage()
            .instance()
            .get::<_, bool>(&DataKey::Initialized)
            .unwrap_or(false)
        {
            return Err(AccessControlError::NotInitialized);
        }
        Ok(())
    }

    /// Helper: Ensure caller is admin
    fn ensure_admin(env: &Env, caller: &Address) -> Result<(), AccessControlError> {
        Self::ensure_initialized(env)?;

        let admin: Address = env
            .storage()
            .instance()
            .get(&DataKey::Admin)
            .ok_or(AccessControlError::NotInitialized)?;

        if *caller != admin {
            return Err(AccessControlError::Unauthorized);
        }
        Ok(())
    }

    /// Create a new role
    ///
    /// # Arguments
    ///
    /// * `role_id` - Unique identifier for the role
    /// * `role_name` - Human-readable name for the role
    ///
    /// # Returns
    ///
    /// `Ok(())` on success, or an error if the role already exists
    pub fn create_role(
        env: Env,
        role_id: Symbol,
        role_name: String,
    ) -> Result<(), AccessControlError> {
        Self::ensure_initialized(&env)?;

        let caller = env.invocation_context().get_invoker();
        Self::ensure_admin(&env, &caller)?;

        if env
            .storage()
            .persistent()
            .has(&DataKey::Role(role_id.clone()))
        {
            return Err(AccessControlError::RoleAlreadyExists);
        }

        let role = Role {
            id: role_id.clone(),
            name: role_name,
        };

        env.storage()
            .persistent()
            .set(&DataKey::Role(role_id), &role);

        Ok(())
    }

    /// Assign a role to an address
    ///
    /// # Arguments
    ///
    /// * `subject` - The address to assign the role to
    /// * `role` - The role to assign
    ///
    /// # Returns
    ///
    /// `Ok(())` on success, or an error if the role doesn't exist or user already has it
    pub fn grant_role(env: Env, subject: Address, role: Role) -> Result<(), AccessControlError> {
        Self::ensure_initialized(&env)?;

        let caller = env.invocation_context().get_invoker();
        Self::ensure_admin(&env, &caller)?;

        if !env
            .storage()
            .persistent()
            .has(&DataKey::Role(role.id.clone()))
        {
            return Err(AccessControlError::RoleNotFound);
        }

        let mut user_roles: Vec<Role> = env
            .storage()
            .persistent()
            .get(&DataKey::UserRoles(subject.clone()))
            .unwrap_or_else(|| Vec::new(&env));

        if user_roles.contains(&role) {
            return Err(AccessControlError::RoleAlreadyGranted);
        }

        user_roles.push_back(role);
        env.storage()
            .persistent()
            .set(&DataKey::UserRoles(subject), &user_roles);

        Ok(())
    }

    /// Revoke a role from an address
    ///
    /// # Arguments
    ///
    /// * `subject` - The address to revoke the role from
    /// * `role` - The role to revoke
    ///
    /// # Returns
    ///
    /// `Ok(())` on success, or an error if the user doesn't have the role
    pub fn revoke_role(env: Env, subject: Address, role: Role) -> Result<(), AccessControlError> {
        Self::ensure_initialized(&env)?;

        let caller = env.invocation_context().get_invoker();
        Self::ensure_admin(&env, &caller)?;

        let mut user_roles: Vec<Role> = env
            .storage()
            .persistent()
            .get(&DataKey::UserRoles(subject.clone()))
            .unwrap_or_else(|| Vec::new(&env));

        let mut found = false;
        let mut new_roles = Vec::new(&env);

        for stored_role in user_roles.iter() {
            if stored_role == role {
                found = true;
            } else {
                new_roles.push_back(stored_role);
            }
        }

        if !found {
            return Err(AccessControlError::RoleNotGranted);
        }

        env.storage()
            .persistent()
            .set(&DataKey::UserRoles(subject), &new_roles);

        Ok(())
    }

    /// Create a new permission
    ///
    /// # Arguments
    ///
    /// * `permission_id` - Unique identifier for the permission
    /// * `description` - Description of what the permission grants
    /// * `resource` - The resource this permission applies to
    ///
    /// # Returns
    ///
    /// `Ok(())` on success, or an error if the permission already exists
    pub fn create_permission(
        env: Env,
        permission_id: Symbol,
        description: String,
        resource: String,
    ) -> Result<(), AccessControlError> {
        Self::ensure_initialized(&env)?;

        let caller = env.invocation_context().get_invoker();
        Self::ensure_admin(&env, &caller)?;

        if env
            .storage()
            .persistent()
            .has(&DataKey::Permission(permission_id.clone()))
        {
            return Err(AccessControlError::PermissionAlreadyExists);
        }

        let permission = Permission {
            id: permission_id.clone(),
            description,
            resource,
        };

        env.storage()
            .persistent()
            .set(&DataKey::Permission(permission_id), &permission);

        Ok(())
    }

    /// Grant a permission to a role
    ///
    /// This associates a permission with a role, so all users with that role
    /// will have the permission.
    ///
    /// # Arguments
    ///
    /// * `role` - The role to grant the permission to
    /// * `permission` - The permission to grant
    ///
    /// # Returns
    ///
    /// `Ok(())` on success, or an error if role/permission doesn't exist
    pub fn grant_permission_to_role(
        env: Env,
        role: Role,
        permission: Permission,
    ) -> Result<(), AccessControlError> {
        Self::ensure_initialized(&env)?;

        let caller = env.invocation_context().get_invoker();
        Self::ensure_admin(&env, &caller)?;

        if !env
            .storage()
            .persistent()
            .has(&DataKey::Role(role.id.clone()))
        {
            return Err(AccessControlError::RoleNotFound);
        }

        if !env
            .storage()
            .persistent()
            .has(&DataKey::Permission(permission.id.clone()))
        {
            return Err(AccessControlError::PermissionNotFound);
        }

        let mut role_permissions: Vec<Permission> = env
            .storage()
            .persistent()
            .get(&DataKey::RolePermissions(role.id.clone()))
            .unwrap_or_else(|| Vec::new(&env));

        if role_permissions.contains(&permission) {
            return Err(AccessControlError::PermissionAlreadyGranted);
        }

        role_permissions.push_back(permission);
        env.storage()
            .persistent()
            .set(&DataKey::RolePermissions(role.id), &role_permissions);

        Ok(())
    }

    /// Revoke a permission from a role
    ///
    /// # Arguments
    ///
    /// * `role` - The role to revoke the permission from
    /// * `permission` - The permission to revoke
    ///
    /// # Returns
    ///
    /// `Ok(())` on success, or an error if the role doesn't have the permission
    pub fn revoke_permission_from_role(
        env: Env,
        role: Role,
        permission: Permission,
    ) -> Result<(), AccessControlError> {
        Self::ensure_initialized(&env)?;

        let caller = env.invocation_context().get_invoker();
        Self::ensure_admin(&env, &caller)?;

        let mut role_permissions: Vec<Permission> = env
            .storage()
            .persistent()
            .get(&DataKey::RolePermissions(role.id.clone()))
            .unwrap_or_else(|| Vec::new(&env));

        let mut found = false;
        let mut new_permissions = Vec::new(&env);

        for stored_perm in role_permissions.iter() {
            if stored_perm == permission {
                found = true;
            } else {
                new_permissions.push_back(stored_perm);
            }
        }

        if !found {
            return Err(AccessControlError::PermissionNotGranted);
        }

        env.storage()
            .persistent()
            .set(&DataKey::RolePermissions(role.id), &new_permissions);

        Ok(())
    }

    /// Add a trusted caller
    ///
    /// Trusted callers are addresses that are pre-approved for cross-contract calls.
    ///
    /// # Arguments
    ///
    /// * `caller_address` - The address to trust
    /// * `caller_name` - Human-readable name for the caller
    ///
    /// # Returns
    ///
    /// `Ok(())` on success, or an error if the caller is already trusted
    pub fn add_trusted_caller(
        env: Env,
        caller_address: Address,
        caller_name: String,
    ) -> Result<(), AccessControlError> {
        Self::ensure_initialized(&env)?;

        let caller = env.invocation_context().get_invoker();
        Self::ensure_admin(&env, &caller)?;

        if env
            .storage()
            .persistent()
            .has(&DataKey::TrustedCaller(caller_address.clone()))
        {
            return Err(AccessControlError::AlreadyTrusted);
        }

        let trusted = TrustedCaller {
            address: caller_address.clone(),
            name: caller_name,
            enabled: true,
        };

        env.storage()
            .persistent()
            .set(&DataKey::TrustedCaller(caller_address), &trusted);

        Ok(())
    }

    /// Remove a trusted caller
    ///
    /// # Arguments
    ///
    /// * `caller_address` - The address to untrust
    ///
    /// # Returns
    ///
    /// `Ok(())` on success, or an error if the caller is not trusted
    pub fn remove_trusted_caller(
        env: Env,
        caller_address: Address,
    ) -> Result<(), AccessControlError> {
        Self::ensure_initialized(&env)?;

        let caller = env.invocation_context().get_invoker();
        Self::ensure_admin(&env, &caller)?;

        if !env
            .storage()
            .persistent()
            .has(&DataKey::TrustedCaller(caller_address.clone()))
        {
            return Err(AccessControlError::NotTrusted);
        }

        env.storage()
            .persistent()
            .remove(&DataKey::TrustedCaller(caller_address));

        Ok(())
    }

    /// Enable or disable a trusted caller
    ///
    /// # Arguments
    ///
    /// * `caller_address` - The address to enable/disable
    /// * `enabled` - Whether to enable or disable
    ///
    /// # Returns
    ///
    /// `Ok(())` on success, or an error if the caller is not trusted
    pub fn set_trusted_caller_enabled(
        env: Env,
        caller_address: Address,
        enabled: bool,
    ) -> Result<(), AccessControlError> {
        Self::ensure_initialized(&env)?;

        let caller = env.invocation_context().get_invoker();
        Self::ensure_admin(&env, &caller)?;

        let mut trusted: TrustedCaller = env
            .storage()
            .persistent()
            .get(&DataKey::TrustedCaller(caller_address.clone()))
            .ok_or(AccessControlError::NotTrusted)?;

        trusted.enabled = enabled;
        env.storage()
            .persistent()
            .set(&DataKey::TrustedCaller(caller_address), &trusted);

        Ok(())
    }

    /// Register a managed resource
    ///
    /// Resources are logical groupings that permissions can apply to.
    /// This helps organize permissions by domain.
    ///
    /// # Arguments
    ///
    /// * `resource` - The resource identifier
    ///
    /// # Returns
    ///
    /// `Ok(())` on success, or an error if the resource is already registered
    pub fn register_resource(env: Env, resource: String) -> Result<(), AccessControlError> {
        Self::ensure_initialized(&env)?;

        let caller = env.invocation_context().get_invoker();
        Self::ensure_admin(&env, &caller)?;

        let mut resources: Vec<String> = env
            .storage()
            .persistent()
            .get(&DataKey::ManagedResources)
            .unwrap_or_else(|| Vec::new(&env));

        if resources.contains(&resource) {
            return Err(AccessControlError::ResourceAlreadyRegistered);
        }

        resources.push_back(resource);
        env.storage()
            .persistent()
            .set(&DataKey::ManagedResources, &resources);

        Ok(())
    }
}

#[contractimpl]
impl AccessControlTrait for AccessControlContract {
    fn has_role(env: Env, subject: Address, role: Role) -> bool {
        let user_roles: Vec<Role> = env
            .storage()
            .persistent()
            .get(&DataKey::UserRoles(subject))
            .unwrap_or_else(|| Vec::new(&env));

        user_roles.contains(&role)
    }

    fn has_permission(env: Env, subject: Address, permission: Permission) -> PermissionCheck {
        let user_roles: Vec<Role> = env
            .storage()
            .persistent()
            .get(&DataKey::UserRoles(subject))
            .unwrap_or_else(|| Vec::new(&env));

        for role in user_roles.iter() {
            let role_perms: Vec<Permission> = env
                .storage()
                .persistent()
                .get(&DataKey::RolePermissions(role.id.clone()))
                .unwrap_or_else(|| Vec::new(&env));

            if role_perms.contains(&permission) {
                return PermissionCheck {
                    granted: true,
                    reason: String::from_slice(&env, &"Permission granted through role"),
                };
            }
        }

        PermissionCheck {
            granted: false,
            reason: String::from_slice(&env, &"No role with this permission found"),
        }
    }

    fn get_roles(env: Env, subject: Address) -> Vec<Role> {
        env.storage()
            .persistent()
            .get(&DataKey::UserRoles(subject))
            .unwrap_or_else(|| Vec::new(&env))
    }

    fn get_role_info(env: Env, role: Role) -> RoleInfo {
        let permissions: Vec<Permission> = env
            .storage()
            .persistent()
            .get(&DataKey::RolePermissions(role.id.clone()))
            .unwrap_or_else(|| Vec::new(&env));

        // Count members with this role
        let mut member_count = 0u32;
        // This is approximate as we don't iterate through all addresses in persistent storage
        // In production, maintain a separate counter or use events

        RoleInfo {
            role,
            permissions,
            member_count,
        }
    }

    fn get_permissions(env: Env, subject: Address) -> Vec<Permission> {
        let user_roles: Vec<Role> = env
            .storage()
            .persistent()
            .get(&DataKey::UserRoles(subject))
            .unwrap_or_else(|| Vec::new(&env));

        let mut all_permissions = Vec::new(&env);

        for role in user_roles.iter() {
            let role_perms: Vec<Permission> = env
                .storage()
                .persistent()
                .get(&DataKey::RolePermissions(role.id.clone()))
                .unwrap_or_else(|| Vec::new(&env));

            for perm in role_perms.iter() {
                if !all_permissions.contains(&perm) {
                    all_permissions.push_back(perm);
                }
            }
        }

        all_permissions
    }

    fn is_trusted_caller(env: Env, caller: Address) -> bool {
        let trusted: Option<TrustedCaller> = env
            .storage()
            .persistent()
            .get(&DataKey::TrustedCaller(caller));

        match trusted {
            Some(tc) => tc.enabled,
            None => false,
        }
    }

    fn get_trusted_caller(env: Env, caller: Address) -> TrustedCaller {
        env.storage()
            .persistent()
            .get(&DataKey::TrustedCaller(caller))
            .unwrap_or_else(|| TrustedCaller {
                address: caller,
                name: String::from_slice(&env, &"Unknown"),
                enabled: false,
            })
    }

    fn get_all_trusted_callers(env: Env) -> Vec<Address> {
        // This would require iterating through persistent storage
        // For now, return empty - in production, maintain a list or use events
        Vec::new(&env)
    }

    fn has_permissions(
        env: Env,
        subject: Address,
        permissions: Vec<Permission>,
        require_all: bool,
    ) -> PermissionCheck {
        let mut granted_count = 0u32;

        for perm in permissions.iter() {
            let check = Self::has_permission(env.clone(), subject.clone(), perm);
            if check.granted {
                granted_count += 1;
            }
        }

        let total = permissions.len() as u32;
        let all_granted = granted_count == total;
        let any_granted = granted_count > 0;

        let result = if require_all { all_granted } else { any_granted };

        PermissionCheck {
            granted: result,
            reason: if result {
                String::from_slice(&env, &"Permissions check passed")
            } else {
                String::from_slice(&env, &"Permissions check failed")
            },
        }
    }

    fn verify_caller_authorization(
        env: Env,
        caller: Address,
        required_role: Role,
    ) -> PermissionCheck {
        if !Self::has_role(env.clone(), caller.clone(), required_role) {
            return PermissionCheck {
                granted: false,
                reason: String::from_slice(&env, &"Caller does not have required role"),
            };
        }

        PermissionCheck {
            granted: true,
            reason: String::from_slice(&env, &"Caller is authorized"),
        }
    }

    fn get_admins(env: Env) -> Vec<Address> {
        let admin: Option<Address> = env.storage().instance().get(&DataKey::Admin);
        let mut admins = Vec::new(&env);
        if let Some(a) = admin {
            admins.push_back(a);
        }
        admins
    }

    fn is_managed_resource(env: Env, resource: String) -> bool {
        let resources: Vec<String> = env
            .storage()
            .persistent()
            .get(&DataKey::ManagedResources)
            .unwrap_or_else(|| Vec::new(&env));

        resources.contains(&resource)
    }

    fn get_managed_resources(env: Env) -> Vec<String> {
        env.storage()
            .persistent()
            .get(&DataKey::ManagedResources)
            .unwrap_or_else(|| Vec::new(&env))
    }
}
