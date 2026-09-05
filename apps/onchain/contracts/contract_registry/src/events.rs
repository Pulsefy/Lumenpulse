use soroban_sdk::{contractevent, Address, Symbol};

#[contractevent]
pub struct InitializedEvent {
    pub admin: Address,
}

#[contractevent]
pub struct ContractRegisteredEvent {
    #[topic]
    pub key: Symbol,
    pub address: Address,
    pub version: u32,
    pub env: Symbol,
}

#[contractevent]
pub struct ContractUpdatedEvent {
    #[topic]
    pub key: Symbol,
    pub version: u32,
    pub env: Symbol,
}
