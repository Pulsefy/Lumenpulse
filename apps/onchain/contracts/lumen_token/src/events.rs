use soroban_sdk::{contractevent, Address, BytesN, Env, Symbol};

pub const EVENT_VERSION_UPGRADED: u32 = 1u32;
pub const EVENT_VERSION_ADMIN_CHANGED: u32 = 1u32;
pub const EVENT_VERSION_BURN: u32 = 1u32;

pub mod schema_ids {
    use super::*;

    pub fn upgraded_v1(env: &Env) -> Symbol {
        Symbol::new(env, "admin.upgraded.v1")
    }

    pub fn admin_changed_v1(env: &Env) -> Symbol {
        Symbol::new(env, "admin.changed.v1")
    }

    pub fn burn_v1(env: &Env) -> Symbol {
        Symbol::new(env, "token.burned.v1")
    }
}

/// Emitted when the contract WASM is upgraded to a new hash.
#[contractevent]
pub struct UpgradedEvent {
    #[topic]
    pub admin: Address,
    pub new_wasm_hash: BytesN<32>,
    pub version: u32,
    pub schema_id: Symbol,
}

/// Emitted when the admin role is transferred to a new address.
#[contractevent]
pub struct AdminChangedEvent {
    #[topic]
    pub old_admin: Address,
    pub new_admin: Address,
    pub version: u32,
    pub schema_id: Symbol,
}

#[contractevent]
pub struct BurnEvent {
    #[topic]
    pub from: Address,
    pub amount: i128,
    pub version: u32,
    pub schema_id: Symbol,
}

pub fn publish_upgraded(env: &Env, admin: Address, new_wasm_hash: BytesN<32>) {
    UpgradedEvent {
        admin,
        new_wasm_hash,
        version: EVENT_VERSION_UPGRADED,
        schema_id: schema_ids::upgraded_v1(env),
    }
    .publish(env);
}

pub fn publish_admin_changed(env: &Env, old_admin: Address, new_admin: Address) {
    AdminChangedEvent {
        old_admin,
        new_admin,
        version: EVENT_VERSION_ADMIN_CHANGED,
        schema_id: schema_ids::admin_changed_v1(env),
    }
    .publish(env);
}

pub fn publish_burn(env: &Env, from: Address, amount: i128) {
    BurnEvent {
        from,
        amount,
        version: EVENT_VERSION_BURN,
        schema_id: schema_ids::burn_v1(env),
    }
    .publish(env);
}
