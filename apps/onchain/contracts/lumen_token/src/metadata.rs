use soroban_sdk::{Env, String};

#[derive(Clone)]
#[soroban_sdk::contracttype]
pub enum DataKey {
    Decimals,
    Name,
    Symbol,
}

pub fn read_decimal(e: &Env) -> u32 {
    let key = DataKey::Decimals;
    e.storage().instance().get(&key).unwrap_or(0)
}

pub fn read_name(e: &Env) -> String {
    let key = DataKey::Name;
    e.storage().instance().get(&key).unwrap()
}

pub fn read_symbol(e: &Env) -> String {
    let key = DataKey::Symbol;
    e.storage().instance().get(&key).unwrap()
}

pub fn write_metadata(e: &Env, decimal: u32, name: String, symbol: String) {
    e.storage().instance().set(&DataKey::Decimals, &decimal);
    e.storage().instance().set(&DataKey::Name, &name);
    e.storage().instance().set(&DataKey::Symbol, &symbol);
}
