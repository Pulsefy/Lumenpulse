use soroban_sdk::{contractevent, Address, Symbol};

/// Emitted when the vault is initialized.
#[contractevent]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct VaultInitializedEvent {
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
    /// The unique identifier of the provider from which yield was harvested.
    #[topic]
    pub provider_id: u32,
    /// The amount of yield earned.
    pub yield_earned: i128,
}
