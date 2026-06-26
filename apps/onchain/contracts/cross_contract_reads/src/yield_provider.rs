/// Safe wrappers for reading state from external yield-provider contracts.
///
/// The trait definition below mirrors the `YieldProviderTrait` that was
/// previously duplicated inside `crowdfund_vault`. By centralising it here,
/// all contracts that need to *read* from a yield provider share one
/// authoritative client type.
///
/// **Write calls** (`deposit`, `withdraw`) are intentionally excluded from
/// this module; they mutate state and belong in the calling contract's own
/// business logic.
use soroban_sdk::{contractclient, Address, Env};

use crate::error::CrossContractError;

/// Minimal trait exposing only the **view** surface of a yield-provider
/// contract.  The generated `YieldProviderReadClient` is the SDK client used
/// by the helper functions below.
#[allow(dead_code)]
#[contractclient(name = "YieldProviderReadClient")]
pub trait YieldProviderReadTrait {
    /// Returns the principal-token balance held by `address` inside the
    /// yield provider.
    fn balance(env: Env, address: Address) -> i128;
}

/// Read the balance held by `account` inside the yield-provider contract at
/// `provider_addr`.
///
/// # Errors
/// - [`CrossContractError::CallFailed`] — if the provider contract traps or
///   is not deployed at the given address.
/// - [`CrossContractError::NotFound`] — if the returned balance is negative
///   (which would indicate a bug in the provider).
///
/// # Example
/// ```rust,ignore
/// let bal = cross_contract_reads::yield_provider::yield_balance(
///     &env,
///     &provider_address,
///     &vault_address,
/// )
/// .map_err(|_| MyError::CrossContractFailed)?;
/// ```
pub fn yield_balance(
    env: &Env,
    provider_addr: &Address,
    account: &Address,
) -> Result<i128, CrossContractError> {
    let client = YieldProviderReadClient::new(env, provider_addr);
    let bal = client.balance(account);
    if bal < 0 {
        return Err(CrossContractError::NotFound);
    }
    Ok(bal)
}
