use soroban_sdk::{Address, Env};

use crate::storage::{LEDGER_BUMP, LEDGER_THRESHOLD};

pub fn has_administrator(e: &Env) -> bool {
    let key = DataKey::Admin;
    e.storage().instance().has(&key)
}

pub fn read_administrator(e: &Env) -> Address {
    let key = DataKey::Admin;
    let admin = e.storage().instance().get(&key).unwrap();
    e.storage()
        .instance()
        .extend_ttl(LEDGER_THRESHOLD, LEDGER_BUMP);
    admin
}

pub fn write_administrator(e: &Env, id: &Address) {
    let key = DataKey::Admin;
    e.storage().instance().set(&key, id);
    e.storage()
        .instance()
        .extend_ttl(LEDGER_THRESHOLD, LEDGER_BUMP);
}

#[derive(Clone)]
#[soroban_sdk::contracttype]
pub enum DataKey {
    Admin,
}
