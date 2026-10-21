use soroban_sdk::contracterror;

#[contracterror]
#[derive(Copy, Clone, Debug, Eq, PartialEq, PartialOrd, Ord)]
#[repr(u32)]
pub enum PricingAdapterError {
    NotInitialized = 1,
    AlreadyInitialized = 2,
    Unauthorized = 3,
    PriceNotFound = 4,
    InvalidPrice = 5,
    StalePrice = 6,
    PriceInvalidated = 7,
    /// Two or more price sources are configured and none of them has a
    /// fresh, non-invalidated price for the asset. No default is returned.
    PriceSourcesExhausted = 8,
    /// `set_price_sources` got an empty list, a repeated source id or more
    /// than `MAX_PRICE_SOURCES` entries.
    InvalidPriceSources = 9,
}
