use soroban_sdk::{contracttype, Address};

#[derive(Clone)]
#[contracttype]
pub enum DataKey {
    Admin,
    AssetPrice(Address),
    AssetOracle(Address),
    AssetDecimals(Address),
    PriceTimestamp(Address), // asset -> u64 (ledger timestamp of last set_price call)
    StalenessWindow(Address), // asset -> u64 (max age in seconds; 0 = no staleness check)
    PriceInvalidated(Address), // asset -> bool (explicit admin invalidation flag)
}

/// Full price state returned by get_price_data.
/// `is_stale` and `is_invalidated` are derived at query time so callers always
/// see the current validity assessment without a separate call.
#[contracttype]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct PriceData {
    pub price: i128,
    pub timestamp: u64,
    pub staleness_window: u64,
    pub is_invalidated: bool,
    pub is_stale: bool,
}
