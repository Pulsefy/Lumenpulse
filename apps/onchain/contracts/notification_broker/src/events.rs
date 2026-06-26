use soroban_sdk::{contractevent, Address, Symbol};

#[contractevent]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct InitializedEvent {
    pub admin: Address,
}

#[contractevent]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct SubscriptionEvent {
    #[topic]
    pub listener: Address,
    #[topic]
    pub source: Address,
    pub event_type: Option<Symbol>,
    pub action: Symbol, // "subscribe" or "unsubscribe"
}

#[contractevent]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct NotificationEmittedEvent {
    #[topic]
    pub source: Address,
    pub event_type: Symbol,
    pub notified_count: u32,
}
