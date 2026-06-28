use soroban_sdk::{contracttype, Address, Symbol};

#[contracttype]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct YieldProvider {
    pub id: u32,
    pub name: Symbol,
    pub address: Address,
    pub priority: u32,
    pub total_deposited: i128,
    pub total_withdrawn: i128,
    pub total_yield_earned: i128,
    pub is_active: bool,
}

#[contracttype]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct ProviderMetrics {
    pub apy: u32, // In basis points (e.g., 500 = 5%)
    pub tvl: i128,
    pub risk_rating: u32, // 1-10
}

#[contracttype]
#[derive(Clone, Debug, Eq, PartialEq, PartialOrd, Ord)]
pub enum DataKey {
    Admin,
    Asset,
    ProviderCount,
    // Provider(id) -> YieldProvider
    Provider(u32),
    // UserBalance(user) -> i128
    UserBalance(Address),
    // UserProviderAllocation(user, provider_id) -> i128
    UserProviderAllocation(Address, u32),
    // Metrics tracking
    TotalAUM,
    TotalYieldHarvested,
}
