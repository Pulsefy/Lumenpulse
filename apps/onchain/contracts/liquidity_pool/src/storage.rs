use soroban_sdk::{contracttype, Address};

pub const LEDGER_THRESHOLD: u32 = 120_960;
pub const LEDGER_BUMP: u32 = 518_400;

#[contracttype]
#[derive(Clone, Debug, Eq, PartialEq, PartialOrd, Ord)]
pub enum DataKey {
    Admin,
    Token0,
    Token1,
    // Reserves
    Reserve0,
    Reserve1,
    // LP tokens
    LPSupply,
    UserLPBalance(Address),
    // Fee tracking
    AccruedFees0,
    AccruedFees1,
    LastFeeAccrual,
}
