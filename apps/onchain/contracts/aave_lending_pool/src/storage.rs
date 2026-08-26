use soroban_sdk::{contracttype, Address};

pub const LEDGER_THRESHOLD: u32 = 120_960;
pub const LEDGER_BUMP: u32 = 518_400;

#[contracttype]
#[derive(Clone, Debug, Eq, PartialEq, PartialOrd, Ord)]
pub enum DataKey {
    Admin,
    // Reserve(asset) -> i128 (total deposited)
    Reserve(Address),
    // ATokenSupply(asset) -> i128 (total aTokens minted)
    ATokenSupply(Address),
    // UserATokenBalance(user, asset) -> i128
    UserATokenBalance(Address, Address),
    // UserDepositTimestamp(user, asset) -> u64
    UserDepositTimestamp(Address, Address),
    // TotalDebt(asset) -> i128 (for utilization calculation)
    TotalDebt(Address),
    // LastAccrualTime(asset) -> u64
    LastAccrualTime(Address),
}
