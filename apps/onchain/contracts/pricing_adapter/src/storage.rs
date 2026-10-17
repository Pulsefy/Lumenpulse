use soroban_sdk::{contracttype, Address, Vec};

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
    /// Ordered list of price source identifiers for fallback chain.
    /// Each source is identified by a BytesN<32> source_id.
    /// The first entry in the vector is the primary source, subsequent entries
    /// are fallbacks tried in order when earlier sources are stale or invalidated.
    AssetPriceSources(Address), // Vec<BytesN<32>>
    /// Per-source price data: (source_id, asset) -> price
    SourcePrice(Address, soroban_sdk::BytesN<32>),
    /// Per-source timestamp: (source_id, asset) -> timestamp
    SourcePriceTimestamp(Address, soroban_sdk::BytesN<32>),
    /// Per-source invalidation flag: (source_id, asset) -> bool
    SourcePriceInvalidated(Address, soroban_sdk::BytesN<32>),
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

/// Result from querying a price, including which source produced it and its age.
#[derive(Clone, Debug, Eq, PartialEq)]
#[contracttype]
pub struct PriceResult {
    pub price: i128,
    /// Identifier of the source that produced this price
    pub source_id: soroban_sdk::BytesN<32>,
    /// Age of the price in seconds (current timestamp - price timestamp)
    pub age_seconds: u64,
}
