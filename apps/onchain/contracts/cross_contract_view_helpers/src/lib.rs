#![no_std]

use soroban_sdk::{Address, Env, IntoVal, InvokeError, Symbol, TryFromVal, Val, Vec};

/// Standardized cross-contract view call failure reason.
#[derive(Clone, Debug, Eq, PartialEq)]
pub enum ViewCallError {
    ContractNotSet,
    CallFailed,
    InvalidResponse,
}

/// Invoke a view function on a target contract and return the decoded result.
pub fn invoke_view<T>(
    env: &Env,
    contract: &Address,
    fn_name: &Symbol,
    args: Vec<Val>,
) -> Result<T, ViewCallError>
where
    T: TryFromVal<Env, Val>,
{
    if contract.as_ref().is_empty() {
        return Err(ViewCallError::ContractNotSet);
    }

    match env.try_invoke_contract::<T, InvokeError>(contract, fn_name, args) {
        Ok(Ok(val)) => Ok(val),
        Ok(Err(_)) => Err(ViewCallError::InvalidResponse),
        Err(_) => Err(ViewCallError::CallFailed),
    }
}

/// Convenience helper for zero-argument view calls.
pub fn invoke_view0<T>(
    env: &Env,
    contract: &Address,
    fn_name: &Symbol,
) -> Result<T, ViewCallError>
where
    T: TryFromVal<Env, Val>,
{
    invoke_view(env, contract, fn_name, Vec::new(env))
}

/// Convenience helper for single-argument view calls.
pub fn invoke_view1<A, T>(
    env: &Env,
    contract: &Address,
    fn_name: &Symbol,
    arg: A,
) -> Result<T, ViewCallError>
where
    A: IntoVal<Env>,
    T: TryFromVal<Env, Val>,
{
    invoke_view(env, contract, fn_name, vec![env, arg.into_val(env)])
}
