use soroban_sdk::{contracttype, Address, Symbol};

pub const LEDGER_THRESHOLD: u32 = 120_960;
pub const LEDGER_BUMP: u32 = 518_400;

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
