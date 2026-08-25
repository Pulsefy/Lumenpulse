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
pub struct MintedEvent {
    #[topic]
    pub to: Address,
    pub amount: i128,
}

#[contractevent]
pub struct TransferEvent {
    #[topic]
    pub from: Address,
    #[topic]
    pub to: Address,
    pub amount: i128,
}

#[contractevent]
pub struct FreezeEvent {
    #[topic]
    pub id: Address,
}

#[contractevent]
pub struct UnfreezeEvent {
    #[topic]
    pub id: Address,
}

#[contractevent]
pub struct ApprovalEvent {
    #[topic]
    pub from: Address,
    #[topic]
    pub spender: Address,
    pub amount: i128,
}
