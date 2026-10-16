use soroban_sdk::{contracttype, Address};

/// If an entry's remaining TTL drops below this many ledgers, the next
/// touch extends it back out to `LEDGER_BUMP`. ~100_000 ledgers (~5.8 days
/// at 5s/ledger).
pub const LEDGER_THRESHOLD: u32 = 100_000;
/// TTL applied when extending. ~518_400 ledgers (~30 days at 5s/ledger).
pub const LEDGER_BUMP: u32 = 518_400;

#[derive(Clone)]
#[contracttype]
pub enum DataKey {
    Admin,
    AssetPrice(Address),
    AssetOracle(Address),
    AssetDecimals(Address), // Stores decimals if needed for normalization
    AssetPriceTimestamp(Address), // ledger timestamp the price was last set
    AssetPriceInvalidated(Address), // explicit admin-set invalidation flag
    MaxPriceAge,            // instance: u64 seconds; unset = DEFAULT_MAX_PRICE_AGE
    MaxDeviationBps,        // instance: u32 bps; unset = DEFAULT_MAX_DEVIATION_BPS
    Sources(Address),       // persistent: Vec<Address> of registered sources for an asset
    SourceReport(Address, Address), // persistent: (asset, source) -> SourceReport
}

/// A single source's latest price report.
#[derive(Clone, Debug, Eq, PartialEq)]
#[contracttype]
pub struct SourceReport {
    pub price: i128,
    pub timestamp: u64,
}

/// Freshness classification for a stored price, exposed to consumers so
/// they can inspect a price's state without triggering `get_price`'s
/// rejection.
#[derive(Clone, Copy, Debug, Eq, PartialEq)]
#[contracttype]
pub enum PriceState {
    Fresh,
    Stale,
    Invalidated,
}
