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
    /// All configured price sources are either stale or invalidated.
    /// Distinct from PriceNotFound (no sources exist) and StalePrice
    /// (single-source stale). Consumers must not proceed with a default price.
    AllSourcesExhausted = 8,
}
