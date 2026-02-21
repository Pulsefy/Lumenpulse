use soroban_sdk::{symbol_short, Address, Env, Symbol};

#[derive(Clone)]
#[soroban_sdk::contracttype]
pub enum DataKey {
    Balance(Address),
    State(Address), // true = frozen
}

fn total_supply_key() -> Symbol {
    symbol_short!("TSUPPLY")
}

pub fn read_total_supply(e: &Env) -> i128 {
    e.storage().instance().get(&total_supply_key()).unwrap_or(0)
}

fn write_total_supply(e: &Env, supply: i128) {
    e.storage().instance().set(&total_supply_key(), &supply);
}

pub fn read_balance(e: &Env, addr: Address) -> i128 {
    let key = DataKey::Balance(addr);
    e.storage().persistent().get(&key).unwrap_or(0)
}

pub fn write_balance(e: &Env, addr: Address, amount: i128) {
    let key = DataKey::Balance(addr);
    e.storage().persistent().set(&key, &amount);
}

pub fn read_state(e: &Env, addr: Address) -> bool {
    let key = DataKey::State(addr);
    e.storage().persistent().get(&key).unwrap_or(false)
}

pub fn write_state(e: &Env, addr: Address, is_frozen: bool) {
    let key = DataKey::State(addr);
    e.storage().persistent().set(&key, &is_frozen);
}

pub fn check_not_frozen(e: &Env, addr: &Address) {
    if read_state(e, addr.clone()) {
        panic!("account is frozen");
    }
}

pub fn receive_balance(e: &Env, addr: Address, amount: i128) {
    check_not_frozen(e, &addr);
    let balance = read_balance(e, addr.clone());
    write_balance(e, addr, balance + amount);
    write_total_supply(e, read_total_supply(e) + amount);
    write_total_supply(e, read_total_supply(e) - amount);
}

pub fn spend_balance(e: &Env, addr: Address, amount: i128) {
    check_not_frozen(e, &addr);
    let balance = read_balance(e, addr.clone());
    if balance < amount {
        panic!("insufficient balance");
    }
    write_balance(e, addr, balance - amount);
}
