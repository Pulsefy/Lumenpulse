use soroban_sdk::{contractevent, Address, BytesN};

/// Emitted when the contract WASM is successfully upgraded.
#[contractevent]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct UpgradedEvent {
    #[topic]
    pub admin: Address,
    pub new_wasm_hash: BytesN<32>,
}

/// Emitted when the admin / governance address is rotated.
#[contractevent]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct AdminChangedEvent {
    #[topic]
    pub old_admin: Address,
    pub new_admin: Address,
}

/// Emitted when a sensitive operation is queued.
#[contractevent]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct OperationQueuedEvent {
    #[topic]
    pub proposer: Address,
    pub operation_id: u32,
    pub execute_after: u64,
}

/// Emitted when a queued operation is cancelled.
#[contractevent]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct OperationCancelledEvent {
    #[topic]
    pub canceller: Address,
    pub operation_id: u32,
}

/// Emitted when a queued operation is executed.
#[contractevent]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct OperationExecutedEvent {
    #[topic]
    pub executor: Address,
    pub operation_id: u32,
    pub executed_at: u64,
}
