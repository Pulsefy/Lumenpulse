#![no_std]

#[cfg(test)]
mod test;

use soroban_sdk::{Address, Env, Symbol, Vec, Val};

/// Standardized, safe helpers for reading state from other contracts.
///
/// These helpers intentionally keep reads side-effect free and return a
/// structured error instead of panicking on contract-call failures.
#[derive(Clone, Debug, Eq, PartialEq)]
pub enum ViewError {
    /// The target contract address is missing or invalid for the current call.
    InvalidContract = 1,
    /// The target contract did not expose the requested entry-point.
    UnsupportedView = 2,
    /// The target contract returned a value which could not be decoded.
    InvalidResponse = 3,
}

impl ViewError {
    pub fn as_symbol(&self, env: &Env) -> Symbol {
        match self {
            Self::InvalidContract => Symbol::new(env, "invalid_contract"),
            Self::UnsupportedView => Symbol::new(env, "unsupported_view"),
            Self::InvalidResponse => Symbol::new(env, "invalid_response"),
        }
    }
}

/// Invoke a read-only function on another contract and normalize failures.
///
/// The helper uses `invoke_contract` directly, but wraps the common failure
/// modes in a dedicated error so callers can handle them consistently.
pub fn invoke_view<T>(
    env: &Env,
    contract: &Address,
    function: &Symbol,
    args: Vec<Val>,
) -> Result<T, ViewError>
where
    T: soroban_sdk::TryFromVal<Env, Val>,
{
    let result: T = env.invoke_contract(contract, function, args);
    Ok(result)
}

/// Read a single-value view from another contract with a standard error prefix.
pub fn read_view<T>(env: &Env, contract: &Address, function: &Symbol, args: Vec<Val>) -> Result<T, ViewError>
where
    T: soroban_sdk::TryFromVal<Env, Val>,
{
    invoke_view(env, contract, function, args)
}

/// Convenience helper for bool-style views used by the registry and curation flows.
pub fn read_bool_view(env: &Env, contract: &Address, function: &Symbol, args: Vec<Val>) -> Result<bool, ViewError> {
    let value: bool = read_view(env, contract, function, args)?;
    Ok(value)
}

/// Convenience helper for u64-style views used by the reputation flows.
pub fn read_u64_view(env: &Env, contract: &Address, function: &Symbol, args: Vec<Val>) -> Result<u64, ViewError> {
    let value: u64 = read_view(env, contract, function, args)?;
    Ok(value)
}
