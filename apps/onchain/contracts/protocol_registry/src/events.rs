use soroban_sdk::{contractevent, Address, Symbol};

#[contractevent]
pub struct InitializedEvent {
    pub admin: Address,
}

#[contractevent]
pub struct ModuleRegisteredEvent {
    #[topic]
    pub name: Symbol,
    pub address: Address,
    pub version: u32,
}

#[contractevent]
pub struct ModuleUpdatedEvent {
    #[topic]
    pub name: Symbol,
    pub old_address: Address,
    pub new_address: Address,
    pub old_version: u32,
    pub new_version: u32,
}

#[contractevent]
pub struct ModuleDeactivatedEvent {
    #[topic]
    pub name: Symbol,
    pub admin: Address,
}

#[contractevent]
pub struct ModuleActivatedEvent {
    #[topic]
    pub name: Symbol,
    pub admin: Address,
}

#[contractevent]
pub struct AdminTransferredEvent {
    pub old_admin: Address,
    pub new_admin: Address,
}

/// Emitted when the registry is paused.
#[contractevent]
pub struct ContractPauseEvent {
    #[topic]
    pub admin: Address,
    pub paused: bool,
}

/// Emitted when the contract WASM is upgraded.
#[contractevent]
pub struct UpgradedEvent {
    #[topic]
    pub admin: Address,
    pub new_wasm_hash: soroban_sdk::BytesN<32>,
}
