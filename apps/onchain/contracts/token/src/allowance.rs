use soroban_sdk::{Address, Env};

#[derive(Clone)]
#[soroban_sdk::contracttype]
pub enum DataKey {
    Allowance(AllowanceDataKey),
}

#[derive(Clone)]
#[soroban_sdk::contracttype]
pub struct AllowanceDataKey {
    pub from: Address,
    pub spender: Address,
}

#[derive(Clone)]
#[soroban_sdk::contracttype]
pub struct AllowanceValue {
    pub amount: i128,
    pub expiration_ledger: u32,
}

pub fn read_allowance(e: &Env, from: Address, spender: Address) -> AllowanceValue {
    let key = DataKey::Allowance(AllowanceDataKey { from, spender });
    e.storage().temporary().get(&key).unwrap_or(AllowanceValue {
        amount: 0,
        expiration_ledger: 0,
    })
}

pub fn write_allowance(
    e: &Env,
    from: Address,
    spender: Address,
    amount: i128,
    expiration_ledger: u32,
) {
    let key = DataKey::Allowance(AllowanceDataKey { from, spender });
    e.storage().temporary().set(
        &key,
        &AllowanceValue {
            amount,
            expiration_ledger,
        },
    );
}

pub fn spend_allowance(e: &Env, from: Address, spender: Address, amount: i128) {
    let allowance = read_allowance(e, from.clone(), spender.clone());
    if allowance.amount < amount {
        panic!("insufficient allowance");
    }
    // If expiration_ledger is 0, it means no expiration? Or should we handle that?
    // Usually 0 means expired or not set.
    // Let's assume strict expiration.
    if allowance.expiration_ledger < e.ledger().sequence() {
        panic!("allowance expired");
    }
    write_allowance(
        e,
        from,
        spender,
        allowance.amount - amount,
        allowance.expiration_ledger,
    );
}
