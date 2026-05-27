use soroban_sdk::{contracttype, Address, Symbol};

/// A single protocol module registration entry.
#[contracttype]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct ModuleEntry {
    /// Canonical module name (e.g. `symbol_short!("vault")`).
    pub name: Symbol,
    /// Currently active deployed address for this module.
    pub address: Address,
    /// Monotonically-increasing version counter; callers can detect upgrades.
    pub version: u32,
    /// Ledger timestamp when this version was registered.
    pub registered_at: u64,
    /// False once the module is decommissioned. `resolve` will refuse inactive modules.
    pub is_active: bool,
}

#[contracttype]
#[derive(Clone)]
pub enum DataKey {
    /// `Address` — the privileged admin.
    Admin,
    /// `bool`  — emergency pause flag.
    Paused,
    /// `ModuleEntry` keyed by module name Symbol.
    Module(Symbol),
}
