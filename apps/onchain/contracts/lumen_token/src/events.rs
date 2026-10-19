use soroban_sdk::{contractevent, Address, BytesN};

/// Emitted when the contract WASM is upgraded to a new hash.
#[contractevent]
pub struct UpgradedEvent {
    #[topic]
    pub admin: Address,
    pub new_wasm_hash: BytesN<32>,
}

/// Emitted when the admin role is transferred to a new address.
#[contractevent]
pub struct AdminChangedEvent {
    #[topic]
    pub old_admin: Address,
    pub new_admin: Address,
}

#[contractevent]
pub struct BurnEvent {
    #[topic]
    pub from: Address,
    pub amount: i128,
}

#[contractevent]
pub struct MintEvent {
    #[topic]
    pub to: Address,
    pub amount: i128,
}

/// Emitted by `freeze`/`unfreeze`; `frozen` distinguishes which happened.
#[contractevent]
pub struct AccountStateChangedEvent {
    #[topic]
    pub id: Address,
    pub frozen: bool,
}

#[contractevent]
pub struct AllowanceChangedEvent {
    #[topic]
    pub from: Address,
    #[topic]
    pub spender: Address,
    pub amount: i128,
    pub expiration_ledger: u32,
}

/// Emitted by both `transfer` and `transfer_from` — the underlying economic
/// event (a balance moved from one account to another) is the same either
/// way; the spender who authorized a `transfer_from` isn't included here,
/// since `from`/`to`/`amount` is what the indexer needs to attribute it.
#[contractevent]
pub struct TransferEvent {
    #[topic]
    pub from: Address,
    #[topic]
    pub to: Address,
    pub amount: i128,
}
