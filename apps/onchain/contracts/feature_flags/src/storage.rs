use soroban_sdk::{contracttype, Symbol};

#[contracttype]
#[derive(Clone)]
pub enum DataKey {
    /// `Address` — the privileged admin.
    Admin,
    /// `bool` — enabled state for a named feature flag.
    Flag(Symbol),
}
