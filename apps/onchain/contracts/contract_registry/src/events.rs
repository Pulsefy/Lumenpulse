use soroban_sdk::{contractevent, Address, Symbol};

#[contractevent]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct InitializedEvent {
    pub admin: Address,
}

#[contractevent]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct ContractRegisteredEvent {
    #[topic]
    pub key: Symbol,
    pub address: Address,
    pub version: u32,
    pub env: Symbol,
}

#[contractevent]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct ContractUpdatedEvent {
    #[topic]
    pub key: Symbol,
    pub version: u32,
    pub env: Symbol,
}
