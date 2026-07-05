use soroban_sdk::{contractevent, Address};

#[contractevent]
pub struct InitializedEvent {
    pub admin: Address,
}

#[contractevent]
pub struct PriceUpdatedEvent {
    #[topic]
    pub asset: Address,
    pub admin: Address,
    pub price: i128,
}

#[allow(dead_code)]
#[contractevent]
pub struct OracleUpdatedEvent {
    #[topic]
    pub asset: Address,
    pub admin: Address,
    pub oracle: Address,
}

#[contractevent]
pub struct StalenessWindowSetEvent {
    #[topic]
    pub asset: Address,
    pub admin: Address,
    pub window: u64,
}

#[contractevent]
pub struct PriceInvalidatedEvent {
    #[topic]
    pub asset: Address,
    pub admin: Address,
}
