use soroban_sdk::{contractevent, Address, String, Symbol};

#[contractevent]
pub struct InitializedEvent {
    pub admin: Address,
}

#[contractevent]
pub struct DeploymentSetEvent {
    #[topic]
    pub key: Symbol,
    pub admin: Address,
    pub contract_address: Address,
    pub version: String,
    pub environment: String,
}

#[contractevent]
pub struct DeploymentDeactivatedEvent {
    #[topic]
    pub key: Symbol,
    pub admin: Address,
}

#[contractevent]
pub struct AdminTransferredEvent {
    pub old_admin: Address,
    pub new_admin: Address,
}
