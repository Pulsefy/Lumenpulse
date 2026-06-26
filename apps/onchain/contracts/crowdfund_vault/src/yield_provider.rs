/// Local yield-provider contractclient — **write calls only**.
///
/// The `deposit` and `withdraw` methods are state-mutating and must be called
/// directly from business logic that owns authorization.
///
/// The **read-only** `balance` query is now provided by the shared crate:
///
/// ```rust,ignore
/// // Preferred — use the shared helper for reads:
/// use cross_contract_reads::yield_provider::yield_balance;
///
/// let bal = yield_balance(&env, &provider_addr, &account)
///     .map_err(|_| CrowdfundError::CrossContractFailed)?;
/// ```
use soroban_sdk::{contractclient, Address, Env};

#[allow(dead_code)]
#[contractclient(name = "YieldProviderClient")]
pub trait YieldProviderTrait {
    /// Deposit funds into the yield provider.
    fn deposit(env: Env, from: Address, amount: i128);

    /// Withdraw funds from the yield provider.
    fn withdraw(env: Env, to: Address, amount: i128);

    /// Get the balance of an address in the yield provider (in principal
    /// tokens).
    ///
    /// **Prefer `cross_contract_reads::yield_provider::yield_balance` for
    /// read-only access** — it returns a `Result` and integrates with the
    /// canonical error handling pattern.
    fn balance(env: Env, address: Address) -> i128;
}
