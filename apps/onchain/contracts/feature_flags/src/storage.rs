use soroban_sdk::{contracttype, Address, Symbol};

pub const LEDGER_THRESHOLD: u32 = 120_960;
pub const LEDGER_BUMP: u32 = 518_400;

#[contracttype]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct FlagEntry {
    pub key: Symbol,
    pub enabled: bool,
    pub toggled_by: Address,
    pub updated_at: u64,
}

#[contracttype]
#[derive(Clone)]
pub enum DataKey {
    Admin,
    Paused,
    Flag(Symbol),
    FlagList,
}
