#![no_std]

use soroban_sdk::{contractclient, contracttype, Address, Bytes, Env, String, Symbol, Vec};

/// Represents a role in the access control system
/// Roles are named identifiers that group permissions together
#[contracttype]
#[derive(Clone, Debug, Eq, PartialEq, Ord, PartialOrd)]
pub struct Role {
    pub id: Symbol,
    pub name: String,
}

/// Represents a permission in the access control system
/// Permissions are fine-grained access rights
#[contracttype]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct Permission {
    pub id: Symbol,
    pub description: String,
    pub resource: String, // e.g., "news_feed", "portfolio", "rewards"
}

/// Represents a trusted caller that can invoke specific functions
#[contracttype]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct TrustedCaller {
    pub address: Address,
    pub name: String,
    pub enabled: bool,
}

/// Response struct for permission checks
#[contracttype]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct PermissionCheck {
    pub granted: bool,
    pub reason: String,
}

/// Response struct for role information
#[contracttype]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct RoleInfo {
    pub role: Role,
    pub permissions: Vec<Permission>,
    pub member_count: u32,
}

/// Access Control Policy interface trait
/// 
/// This trait provides a standardized interface for access control across contracts.
/// Contracts implementing this trait can:
/// - Define and manage roles
/// - Assign/revoke permissions
/// - Query permissions and roles for addresses
/// - Verify trusted callers
/// - Manage role memberships
///
/// # Example Usage
///
/// ```ignore
/// // Check if an address has a specific role
/// let has_admin = policy.has_role(env.clone(), &address, &admin_role);
///
/// // Check if an address has a specific permission
/// let can_publish = policy.has_permission(env.clone(), &address, &publish_perm);
///
/// // Get all roles for an address
/// let roles = policy.get_roles(env.clone(), &address);
///
/// // Verify if a caller is trusted
/// let is_trusted = policy.is_trusted_caller(env.clone(), &caller_address);
/// ```
#[contractclient(name = "AccessControlClient")]
pub trait AccessControlTrait {
    /// Check if an address has a specific role
    ///
    /// # Arguments
    ///
    /// * `subject` - The address to check
    /// * `role` - The role to verify
    ///
    /// # Returns
    ///
    /// `true` if the address has the role, `false` otherwise
    fn has_role(env: Env, subject: Address, role: Role) -> bool;

    /// Check if an address has a specific permission
    ///
    /// This method traverses the role-permission hierarchy to determine
    /// if the subject ultimately has the requested permission.
    ///
    /// # Arguments
    ///
    /// * `subject` - The address to check
    /// * `permission` - The permission to verify
    ///
    /// # Returns
    ///
    /// A `PermissionCheck` struct indicating if permission is granted and why
    fn has_permission(env: Env, subject: Address, permission: Permission) -> PermissionCheck;

    /// Get all roles assigned to an address
    ///
    /// # Arguments
    ///
    /// * `subject` - The address to query
    ///
    /// # Returns
    ///
    /// A vector of all roles assigned to the subject
    fn get_roles(env: Env, subject: Address) -> Vec<Role>;

    /// Get information about a specific role
    ///
    /// # Arguments
    ///
    /// * `role` - The role to query
    ///
    /// # Returns
    ///
    /// A `RoleInfo` struct containing the role details, permissions, and member count
    fn get_role_info(env: Env, role: Role) -> RoleInfo;

    /// Get all permissions for an address (flattened across all roles)
    ///
    /// # Arguments
    ///
    /// * `subject` - The address to query
    ///
    /// # Returns
    ///
    /// A vector of all permissions the address has through any role
    fn get_permissions(env: Env, subject: Address) -> Vec<Permission>;

    /// Check if an address is a trusted caller
    ///
    /// Trusted callers are pre-approved addresses that can invoke privileged functions.
    /// This is useful for contracts that need to call other contracts.
    ///
    /// # Arguments
    ///
    /// * `caller` - The address to verify
    ///
    /// # Returns
    ///
    /// `true` if the caller is trusted and enabled, `false` otherwise
    fn is_trusted_caller(env: Env, caller: Address) -> bool;

    /// Get information about a trusted caller
    ///
    /// # Arguments
    ///
    /// * `caller` - The address to query
    ///
    /// # Returns
    ///
    /// The `TrustedCaller` info, or a default disabled caller if not found
    fn get_trusted_caller(env: Env, caller: Address) -> TrustedCaller;

    /// Get all trusted callers
    ///
    /// # Returns
    ///
    /// A vector of all trusted caller addresses
    fn get_all_trusted_callers(env: Env) -> Vec<Address>;

    /// Check multiple permissions at once for batch verification
    ///
    /// # Arguments
    ///
    /// * `subject` - The address to check
    /// * `permissions` - The permissions to verify
    /// * `require_all` - If true, all permissions must be granted; if false, any is sufficient
    ///
    /// # Returns
    ///
    /// A `PermissionCheck` indicating overall result
    fn has_permissions(
        env: Env,
        subject: Address,
        permissions: Vec<Permission>,
        require_all: bool,
    ) -> PermissionCheck;

    /// Verify that the immediate caller is authorized to call this function
    ///
    /// This is a convenience method that combines role/permission checks with caller verification.
    /// It should be called at the start of protected functions.
    ///
    /// # Arguments
    ///
    /// * `caller` - The address attempting to call a protected function
    /// * `required_role` - The role required to call the function
    ///
    /// # Returns
    ///
    /// A `PermissionCheck` indicating if the caller is authorized
    fn verify_caller_authorization(
        env: Env,
        caller: Address,
        required_role: Role,
    ) -> PermissionCheck;

    /// Get the administrator address(es) for this access control contract
    ///
    /// # Returns
    ///
    /// A vector of administrator addresses
    fn get_admins(env: Env) -> Vec<Address>;

    /// Determine if this contract recognizes a specific resource
    ///
    /// # Arguments
    ///
    /// * `resource` - The resource identifier
    ///
    /// # Returns
    ///
    /// `true` if the resource is managed by this access control contract
    fn is_managed_resource(env: Env, resource: String) -> bool;

    /// Get all managed resources
    ///
    /// # Returns
    ///
    /// A vector of all resource identifiers managed by this access control contract
    fn get_managed_resources(env: Env) -> Vec<String>;
}
