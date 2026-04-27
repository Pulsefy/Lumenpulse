use soroban_sdk::{contractevent, Address, Symbol};

#[contractevent]
pub struct SubscriberAddedEvent {
    #[topic]
    pub event_type: Symbol,
    pub source: Option<Address>,
    pub subscriber: Address,
}

#[contractevent]
pub struct SubscriberRemovedEvent {
    #[topic]
    pub event_type: Symbol,
    pub source: Option<Address>,
    pub subscriber: Address,
}

#[contractevent]
pub struct NotificationEmittedEvent {
    #[topic]
    pub source: Address,
    #[topic]
    pub event_type: Symbol,
}
