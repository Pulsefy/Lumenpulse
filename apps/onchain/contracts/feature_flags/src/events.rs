use soroban_sdk::{contractevent, Address, Env, Symbol};

pub const EVENT_VERSION_INITIALIZED: u32 = 1u32;
pub const EVENT_VERSION_FLAG_SET: u32 = 1u32;
pub const EVENT_VERSION_ADMIN_TRANSFERRED: u32 = 1u32;

pub mod schema_ids {
    use super::*;

    pub fn initialized_v1(env: &Env) -> Symbol {
        Symbol::new(env, "sys.initialized.v1")
    }

    pub fn flag_set_v1(env: &Env) -> Symbol {
        Symbol::new(env, "admin.flag_set.v1")
    }

    pub fn admin_transferred_v1(env: &Env) -> Symbol {
        Symbol::new(env, "admin.transferred.v1")
    }
}

#[contractevent]
pub struct InitializedEvent {
    pub admin: Address,
    pub version: u32,
    pub schema_id: Symbol,
}

#[contractevent]
pub struct FlagSetEvent {
    #[topic]
    pub key: Symbol,
    pub enabled: bool,
    pub toggled_by: Address,
    pub version: u32,
    pub schema_id: Symbol,
}

#[contractevent]
pub struct AdminTransferredEvent {
    pub old_admin: Address,
    pub new_admin: Address,
    pub version: u32,
    pub schema_id: Symbol,
}

pub fn publish_initialized(env: &Env, admin: Address) {
    InitializedEvent {
        admin,
        version: EVENT_VERSION_INITIALIZED,
        schema_id: schema_ids::initialized_v1(env),
    }
    .publish(env);
}

pub fn publish_flag_set(
    env: &Env,
    key: Symbol,
    enabled: bool,
    toggled_by: Address,
) {
    FlagSetEvent {
        key,
        enabled,
        toggled_by,
        version: EVENT_VERSION_FLAG_SET,
        schema_id: schema_ids::flag_set_v1(env),
    }
    .publish(env);
}

pub fn publish_admin_transferred(
    env: &Env,
    old_admin: Address,
    new_admin: Address,
) {
    AdminTransferredEvent {
        old_admin,
        new_admin,
        version: EVENT_VERSION_ADMIN_TRANSFERRED,
        schema_id: schema_ids::admin_transferred_v1(env),
    }
    .publish(env);
}
