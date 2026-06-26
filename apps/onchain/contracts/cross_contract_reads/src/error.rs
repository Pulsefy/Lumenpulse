use soroban_sdk::contracterror;

/// Canonical error type returned by every cross-contract read helper.
///
/// Callers map this to their own contract error enum with a single `.map_err`
/// line, e.g.:
///
/// ```rust,ignore
/// use cross_contract_reads::CrossContractError;
///
/// cross_contract_reads::token::token_balance(&env, &token_addr, &account)
///     .map_err(|_| MyContractError::CrossContractFailed)?;
/// ```
#[contracterror]
#[derive(Copy, Clone, Debug, Eq, PartialEq, PartialOrd, Ord)]
#[repr(u32)]
pub enum CrossContractError {
    /// The remote contract call panicked, trapped, or returned an SDK error value.
    CallFailed = 1,
    /// The remote call succeeded but returned a `None`/zero result where a
    /// value was expected (e.g. contract not initialised on the other side).
    NotFound = 2,
    /// Arithmetic overflow occurred while interpreting the numeric result
    /// returned by the remote contract.
    Overflow = 3,
}
