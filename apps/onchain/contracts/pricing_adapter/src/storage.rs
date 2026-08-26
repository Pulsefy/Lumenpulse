use soroban_sdk::{contracttype, Address};

pub const LEDGER_THRESHOLD: u32 = 120_960;
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
