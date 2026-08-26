use soroban_sdk::contracterror;

#[contracterror]
#[derive(Copy, Clone, Debug, Eq, PartialEq, PartialOrd, Ord)]
#[repr(u32)]
pub enum PricingAdapterError {
    NotInitialized = 1000,
    AlreadyInitialized = 1001,
    Unauthorized = 1002,
    PriceNotFound = 1003,
    InvalidPrice = 1004,
    StalePrice = 1005,
    PriceInvalidated = 1006,
}
