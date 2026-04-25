use access_control_interface::{Permission, Role};
use soroban_sdk::{contracttype, Address, String, Symbol};

#[contracttype]
#[derive(Clone)]
pub enum DataKey {
    // ── Initialization ────────────────────────────────────────
    Initialized,
    Admin,

    // ── Roles and Permissions ─────────────────────────────────
    Role(Symbol),
    Permission(Symbol),
    UserRoles(Address),
    RolePermissions(Symbol),

    // ── Trusted Callers ──────────────────────────────────────
    TrustedCaller(Address),

    // ── Resources ─────────────────────────────────────────────
    ManagedResources,
}
