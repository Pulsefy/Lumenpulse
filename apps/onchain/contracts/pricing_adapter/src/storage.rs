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
    /// Instance: the ordered `Vec<u32>` of source ids price reads walk.
    /// Unset means `[PRIMARY_SOURCE]`, the original single source.
    PriceSources,
    /// Persistent: the `SourcePriceRecord` a non-primary source holds for an
    /// asset, keyed by (source id, asset). The primary source keeps using the
    /// `AssetPrice*` keys above, so existing records need no migration.
    SourcePrice(u32, Address),
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

/// The price a non-primary source reports for one asset, written by
/// `set_source_price` and read by the source selection rule.
#[derive(Clone, Debug, Eq, PartialEq)]
#[contracttype]
pub struct SourcePriceRecord {
    pub price: i128,
    /// Ledger timestamp the price was set at.
    pub timestamp: u64,
    pub invalidated: bool,
}

/// A price picked by the source selection rule, with the id of the source
/// that produced it and the age of that price, in seconds, at read time.
#[derive(Clone, Debug, Eq, PartialEq)]
#[contracttype]
pub struct PriceQuote {
    pub price: i128,
    pub source: u32,
    pub age_seconds: u64,
}
