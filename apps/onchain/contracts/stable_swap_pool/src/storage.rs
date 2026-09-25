use soroban_sdk::{contracttype, Address};

/// If an entry's remaining TTL drops below this many ledgers, the next
/// touch bumps it back out to `LEDGER_BUMP`. ~100_000 ledgers (~5.8 days
/// at 5s/ledger).
pub const LEDGER_THRESHOLD: u32 = 100_000;
/// TTL applied when bumping. ~518_400 ledgers (~30 days at 5s/ledger).
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
