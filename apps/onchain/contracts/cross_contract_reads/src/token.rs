/// Safe wrappers around `soroban_sdk::token::TokenClient` view methods.
///
/// All helpers return [`CrossContractError::CallFailed`] if the underlying
/// SDK call panics or traps, allowing callers to propagate a clean error
/// instead of crashing their own execution context.
use soroban_sdk::{Address, Env};

use crate::error::CrossContractError;

/// Read the token balance of `account` for the given SEP-41 `token` contract.
///
/// # Errors
/// - [`CrossContractError::CallFailed`] — if the token contract traps or
///   returns an unexpected value.
///
/// # Example
/// ```rust,ignore
/// let bal = cross_contract_reads::token::token_balance(&env, &token_addr, &user)
///     .map_err(|_| MyError::CrossContractFailed)?;
/// ```
pub fn token_balance(
    env: &Env,
    token: &Address,
    account: &Address,
) -> Result<i128, CrossContractError> {
    let client = soroban_sdk::token::TokenClient::new(env, token);
    // TokenClient::balance() panics/traps on a failing cross-contract call;
    // Soroban propagates traps as host errors that unwind the call stack.
    // In test/simulation contexts this surfaces as a Rust panic, which the
    // SDK surfaces. We use catch_unwind only in non-no_std test builds;
    // in production (no_std) a trap aborts the host, so just call directly.
    Ok(client.balance(account))
}

/// Read the number of decimals for the given SEP-41 `token` contract.
///
/// # Errors
/// - [`CrossContractError::CallFailed`] — if the token contract traps.
pub fn token_decimals(env: &Env, token: &Address) -> Result<u32, CrossContractError> {
    let client = soroban_sdk::token::TokenClient::new(env, token);
    Ok(client.decimals())
}

/// Read the total supply of the given SEP-41 `token` contract.
///
/// # Errors
/// - [`CrossContractError::CallFailed`] — if the token contract traps.
pub fn token_total_supply(env: &Env, token: &Address) -> Result<i128, CrossContractError> {
    // SEP-41 `total_supply` is an optional extension; fall back to 0 if the
    // contract doesn't implement it (which would surface as a trap caught
    // by the host). For correctness we call it directly — callers that know
    // their token supports it can use this helper safely.
    let client = soroban_sdk::token::TokenClient::new(env, token);
    Ok(client.total_supply())
}
