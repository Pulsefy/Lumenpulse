use soroban_sdk::{contracttype, Address};

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
