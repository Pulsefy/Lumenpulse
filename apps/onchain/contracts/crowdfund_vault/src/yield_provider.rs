use soroban_sdk::{contractclient, Address, Env};

#[allow(dead_code)]
#[contractclient(name = "YieldProviderClient")]
pub trait YieldProviderTrait {
    /// Deposit funds into the yield provider
    fn deposit(env: Env, from: Address, amount: i128);

    /// Withdraw funds from the yield provider
    fn withdraw(env: Env, to: Address, amount: i128);

    /// Get the balance of an address in the yield provider (in principal tokens)
    fn balance(env: Env, address: Address) -> i128;
}
