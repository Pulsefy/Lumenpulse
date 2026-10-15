use soroban_sdk::{contracttype, Address};

/// If an entry's remaining TTL drops below this many ledgers, the next
/// touch extends it back out to `LEDGER_BUMP`. ~100_000 ledgers (~5.8 days
/// at 5s/ledger).
pub const LEDGER_THRESHOLD: u32 = 100_000;
/// TTL applied when extending. ~518_400 ledgers (~30 days at 5s/ledger).
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
