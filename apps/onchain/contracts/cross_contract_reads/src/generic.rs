/// Generic escape-hatch for cross-contract view calls not covered by the
/// typed helpers in [`crate::token`], [`crate::yield_provider`], or
/// [`crate::treasury`].
///
/// Prefer the typed helpers where they exist; use `invoke_view` only when you
/// need to call an interface that has no dedicated module yet.
use soroban_sdk::{Address, Env, Symbol, Val, Vec};

use crate::error::CrossContractError;

/// Invoke an arbitrary view (read-only) function on a remote contract and
/// return the raw [`Val`].
///
/// # Parameters
/// - `env` — the current contract environment.
/// - `contract` — address of the contract to call.
/// - `fn_name` — name of the function to invoke (must be a valid Soroban
///   symbol, i.e. at most 32 characters, only `[a-zA-Z0-9_]`).
/// - `args` — positional arguments encoded as a `Vec<Val>`.
///
/// # Errors
/// - [`CrossContractError::CallFailed`] — if the remote call traps, panics,
///   or the host returns an error.
///
/// # Example
/// ```rust,ignore
/// use soroban_sdk::{vec, Val};
/// use cross_contract_reads::generic::invoke_view;
/// use cross_contract_reads::CrossContractError;
///
/// let args: soroban_sdk::Vec<Val> = vec![&env, beneficiary.into_val(&env)];
/// let result: Val = invoke_view(&env, &some_contract, "get_metadata", args)
///     .map_err(|_| MyError::CrossContractFailed)?;
/// ```
pub fn invoke_view(
    env: &Env,
    contract: &Address,
    fn_name: &str,
    args: Vec<Val>,
) -> Result<Val, CrossContractError> {
    let sym = Symbol::new(env, fn_name);
    Ok(env.invoke_contract(contract, &sym, args))
}
