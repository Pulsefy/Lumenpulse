use soroban_sdk::{contracttype, Address, Symbol};

/// If an entry's remaining TTL drops below this many ledgers, the next
/// touch bumps it back out to `LEDGER_BUMP`. ~100_000 ledgers (~5.8 days
/// at 5s/ledger).
pub const LEDGER_THRESHOLD: u32 = 100_000;
/// TTL applied when bumping. ~518_400 ledgers (~30 days at 5s/ledger).
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
