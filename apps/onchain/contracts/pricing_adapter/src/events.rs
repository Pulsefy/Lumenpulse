use soroban_sdk::{contractevent, Address, Vec};

#[contractevent]
pub struct InitializedEvent {
    pub admin: Address,
}

#[contractevent]
pub struct PriceUpdatedEvent {
    #[topic]
    pub asset: Address,
    pub admin: Address,
    pub source: Address,
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
pub struct PriceInvalidatedEvent {
    #[topic]
    pub asset: Address,
    pub admin: Address,
    pub source: Address,
}

#[contractevent]
pub struct StalenessWindowUpdatedEvent {
    #[topic]
    pub admin: Address,
    pub max_age_seconds: u64,
}

#[contractevent]
pub struct SourcesUpdatedEvent {
    #[topic]
    pub asset: Address,
    pub admin: Address,
    pub sources: Vec<Address>,
}
