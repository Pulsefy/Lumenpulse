use soroban_sdk::{contracttype, Address, Symbol};

#[contracttype]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct ListenerSubscription {
    pub listener: Address,
    pub source: Address,
    pub event_type: Option<Symbol>,
    pub timestamp: u64,
}

#[contracttype]
#[derive(Clone, Debug, Eq, PartialEq, PartialOrd, Ord)]
pub enum DataKey {
    Admin,
    // Subscription(listener, source, event_type)
    Subscription(Address, Address, Option<Symbol>),
    // ListenersForSource(source) -> Vec<Address>
    ListenersForSource(Address),
}
