use soroban_sdk::{contracttype, Address};

pub const LEDGER_THRESHOLD: u32 = 120_960;
pub const LEDGER_BUMP: u32 = 518_400;

#[contracttype]
#[derive(Clone, Debug, Eq, PartialEq, PartialOrd, Ord)]
pub enum DataKey {
    Admin,
    TokenA,
    TokenB,
    // Reserve balances
    ReserveA,
    ReserveB,
    // LP token tracking
    LPSupply,
    UserLPBalance(Address),
}
