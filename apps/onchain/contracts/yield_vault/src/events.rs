use soroban_sdk::{contractevent, Address, Symbol};

/// Canonical event version. Bump this when the schema of any event in this
/// module changes so consumers can detect the difference.
pub const EVENT_VERSION: u32 = 1;

/// Emitted when the vault is initialized.
#[contractevent]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct VaultInitializedEvent {
    /// Schema version for consumer-side migration detection.
    pub version: u32,
    /// The address granted admin privileges.
    #[topic]
    pub admin: Address,
    /// The address of the underlying asset token.
    pub asset: Address,
}

/// Emitted when a new yield provider is registered.
#[contractevent]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct ProviderRegisteredEvent {
    /// Schema version for consumer-side migration detection.
    pub version: u32,
    /// The address of the provider (contract).
    #[topic]
    pub address: Address,
    /// The unique identifier assigned to the provider.
    #[topic]
    pub provider_id: u32,
    /// The name of the provider.
    pub name: Symbol,
    /// The allocation priority for this provider.
    pub priority: u32,
}

/// Emitted when a user deposits assets into the vault.
#[contractevent]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct DepositEvent {
    /// Schema version for consumer-side migration detection.
    pub version: u32,
    /// The address of the user making the deposit.
    #[topic]
    pub user: Address,
    /// The unique identifier of the provider receiving the deposit.
    #[topic]
    pub provider_id: u32,
    /// The amount of assets deposited.
    pub amount: i128,
}

/// Emitted when a user withdraws assets from the vault.
#[contractevent]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct WithdrawEvent {
    /// Schema version for consumer-side migration detection.
    pub version: u32,
    /// The address of the user making the withdrawal.
    #[topic]
    pub user: Address,
    /// The amount of assets withdrawn.
    pub amount: i128,
}

/// Emitted when yield is harvested from a provider.
#[contractevent]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct YieldHarvestedEvent {
    /// Schema version for consumer-side migration detection.
    pub version: u32,
    /// The unique identifier of the provider from which yield was harvested.
    #[topic]
    pub provider_id: u32,
    /// The amount of yield earned.
    pub yield_earned: i128,
}
