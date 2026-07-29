use soroban_sdk::{contractevent, Address, BytesN};

/// Canonical event version. Bump this when the schema of any event in this
/// module changes so consumers can detect the difference.
pub const EVENT_VERSION: u32 = 1;

#[contractevent]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct VestingCreatedEvent {
    /// Schema version for consumer-side migration detection.
    pub version: u32,
    #[topic]
    pub beneficiary: Address,
    pub amount: i128,
    pub start_time: u64,
    pub duration: u64,
}

#[contractevent]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct TokensClaimedEvent {
    /// Schema version for consumer-side migration detection.
    pub version: u32,
    #[topic]
    pub beneficiary: Address,
    pub amount_claimed: i128,
    pub remaining: i128,
}

#[contractevent]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct UpgradedEvent {
    /// Schema version for consumer-side migration detection.
    pub version: u32,
    #[topic]
    pub admin: Address,
    pub new_wasm_hash: BytesN<32>,
}

/// Emitted when the admin role is transferred to a new address.
#[contractevent]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct AdminChangedEvent {
    /// Schema version for consumer-side migration detection.
    pub version: u32,
    #[topic]
    pub old_admin: Address,
    pub new_admin: Address,
}

/// Emitted when a beneficiary approves a delegate for claim actions.
#[contractevent]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct DelegateApprovedEvent {
    /// Schema version for consumer-side migration detection.
    pub version: u32,
    #[topic]
    pub beneficiary: Address,
    pub delegate: Address,
}

/// Emitted when a beneficiary revokes a delegate.
#[contractevent]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct DelegateRevokedEvent {
    /// Schema version for consumer-side migration detection.
    pub version: u32,
    #[topic]
    pub beneficiary: Address,
    pub delegate: Address,
}

/// Emitted when a delegate executes a claim on behalf of a beneficiary.
#[contractevent]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct DelegatedClaimEvent {
    /// Schema version for consumer-side migration detection.
    pub version: u32,
    #[topic]
    pub beneficiary: Address,
    pub delegate: Address,
    pub amount_claimed: i128,
    pub remaining: i128,
}
