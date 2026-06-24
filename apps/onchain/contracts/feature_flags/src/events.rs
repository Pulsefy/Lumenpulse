use soroban_sdk::{contractevent, Address, Symbol};

#[contractevent]
pub struct InitializedEvent {
    pub admin: Address,
}

/// Emitted whenever a flag value changes so off-chain observers can track state.
#[contractevent]
pub struct FlagSetEvent {
    #[topic]
    pub flag: Symbol,
    pub enabled: bool,
    pub updated_by: Address,
}

#[contractevent]
pub struct AdminTransferredEvent {
    pub old_admin: Address,
    pub new_admin: Address,
}
