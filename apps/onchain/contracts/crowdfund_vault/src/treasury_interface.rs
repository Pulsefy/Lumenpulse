use soroban_sdk::{contractclient, Address, Env};

#[allow(dead_code)]
#[contractclient(name = "TreasuryClient")]
pub trait TreasuryTrait {
    fn allocate_budget(
        env: Env,
        admin: Address,
        beneficiary: Address,
        amount: i128,
        start_time: u64,
        duration: u64,
    ) -> Result<(), soroban_sdk::Val>;
}
