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

    // The physical storage TTL is a separate concern from the logical
    // `expiration_ledger` enforced in `spend_allowance` below: without this,
    // the entry could be archived (and silently read back as a zero
    // allowance via `read_allowance`'s `unwrap_or`) long before the caller's
    // chosen expiration is reached. Align the two by extending the storage
    // TTL out to `expiration_ledger` itself whenever the allowance is live.
    if amount > 0 {
        let live_for = expiration_ledger.saturating_sub(e.ledger().sequence());
        if live_for > 0 {
            e.storage().temporary().extend_ttl(&key, live_for, live_for);
        }
    }
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
