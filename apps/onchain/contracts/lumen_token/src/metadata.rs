use soroban_sdk::{Env, String};

use crate::storage::{LEDGER_BUMP, LEDGER_THRESHOLD};

#[derive(Clone)]
#[soroban_sdk::contracttype]
pub enum DataKey {
    Decimals,
    Name,
    Symbol,
}

pub fn read_decimal(e: &Env) -> u32 {
    let key = DataKey::Decimals;
    let val = e.storage().instance().get(&key).unwrap_or(0);
    e.storage()
        .instance()
        .extend_ttl(LEDGER_THRESHOLD, LEDGER_BUMP);
    val
}

pub fn read_name(e: &Env) -> String {
    let key = DataKey::Name;
    let val = e.storage().instance().get(&key).unwrap();
    e.storage()
        .instance()
        .extend_ttl(LEDGER_THRESHOLD, LEDGER_BUMP);
    val
}

pub fn read_symbol(e: &Env) -> String {
    let key = DataKey::Symbol;
    let val = e.storage().instance().get(&key).unwrap();
    e.storage()
        .instance()
        .extend_ttl(LEDGER_THRESHOLD, LEDGER_BUMP);
    val
}

pub fn write_metadata(e: &Env, decimal: u32, name: String, symbol: String) {
    e.storage().instance().set(&DataKey::Decimals, &decimal);
    e.storage().instance().set(&DataKey::Name, &name);
    e.storage().instance().set(&DataKey::Symbol, &symbol);
    e.storage()
        .instance()
        .extend_ttl(LEDGER_THRESHOLD, LEDGER_BUMP);
}
