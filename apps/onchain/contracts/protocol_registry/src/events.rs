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
