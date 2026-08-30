use soroban_sdk::contracterror;

#[contracterror]
#[derive(Copy, Clone, Debug, Eq, PartialEq, PartialOrd, Ord)]
#[repr(u32)]
pub enum PricingAdapterError {
    NotInitialized = 2001,
    AlreadyInitialized = 2002,
    Unauthorized = 2003,
    PriceNotFound = 2004,
    InvalidPrice = 2005,
    StalePrice = 2006,
    PriceInvalidated = 2007,
}
