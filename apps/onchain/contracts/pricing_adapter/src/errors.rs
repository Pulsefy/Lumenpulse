use soroban_sdk::contracterror;

#[contracterror]
#[derive(Copy, Clone, Debug, Eq, PartialEq, PartialOrd, Ord)]
#[repr(u32)]
pub enum PricingAdapterError {
    NotInitialized = 1800,
    AlreadyInitialized = 1801,
    Unauthorized = 1802,
    PriceNotFound = 1803,
    InvalidPrice = 1804,
    StalePrice = 1805,
    PriceInvalidated = 1806,
}
