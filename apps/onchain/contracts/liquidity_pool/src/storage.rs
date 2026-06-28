use soroban_sdk::{contracttype, Address};

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
