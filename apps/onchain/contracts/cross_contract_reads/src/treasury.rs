/// Safe wrappers for reading state from the Lumenpulse streaming treasury
/// contract.
///
/// The `TreasuryReadTrait` below exposes **only the view methods** of the
/// treasury.  The write method (`allocate_budget`) mutates state on the remote
/// contract and must remain in the calling contract's own call site — it is
/// intentionally absent here.
///
/// The generated `TreasuryReadClient` is the SDK client used by the helpers.
use soroban_sdk::{contractclient, Address, Env};

use crate::error::CrossContractError;

/// View-only surface of the Lumenpulse treasury contract.
#[allow(dead_code)]
#[contractclient(name = "TreasuryReadClient")]
pub trait TreasuryReadTrait {
    /// Returns how many tokens have been unlocked and not yet claimed by
    /// `beneficiary` in the streaming treasury.
    fn get_unlocked(env: Env, beneficiary: Address) -> Result<i128, soroban_sdk::Val>;

    /// Returns the admin address stored in the treasury contract.
    fn get_admin(env: Env) -> Result<Address, soroban_sdk::Val>;

    /// Returns the token address stored in the treasury contract.
    fn get_token(env: Env) -> Result<Address, soroban_sdk::Val>;
}

/// Read the amount currently unlocked for `beneficiary` from the treasury
/// contract at `treasury_addr`.
///
/// # Errors
/// - [`CrossContractError::CallFailed`] — if the treasury contract traps or
///   returns an error (e.g. stream not found, contract not initialised).
/// - [`CrossContractError::Overflow`] — if the returned value cannot be
///   represented as a positive `i128`.
///
/// # Example
/// ```rust,ignore
/// let unlocked = cross_contract_reads::treasury::treasury_get_unlocked(
///     &env,
///     &treasury_contract_addr,
///     &beneficiary_addr,
/// )
/// .map_err(|_| MyError::CrossContractFailed)?;
/// ```
pub fn treasury_get_unlocked(
    env: &Env,
    treasury_addr: &Address,
    beneficiary: &Address,
) -> Result<i128, CrossContractError> {
    let client = TreasuryReadClient::new(env, treasury_addr);
    client
        .get_unlocked(beneficiary)
        .map_err(|_| CrossContractError::CallFailed)
}

/// Read the admin address stored in the treasury contract at `treasury_addr`.
///
/// # Errors
/// - [`CrossContractError::CallFailed`] — if the call traps or returns an
///   error (e.g. contract not initialised).
pub fn treasury_get_admin(
    env: &Env,
    treasury_addr: &Address,
) -> Result<Address, CrossContractError> {
    let client = TreasuryReadClient::new(env, treasury_addr);
    client
        .get_admin()
        .map_err(|_| CrossContractError::CallFailed)
}

/// Read the token address stored in the treasury contract at `treasury_addr`.
///
/// # Errors
/// - [`CrossContractError::CallFailed`] — if the call traps or returns an
///   error (e.g. contract not initialised).
pub fn treasury_get_token(
    env: &Env,
    treasury_addr: &Address,
) -> Result<Address, CrossContractError> {
    let client = TreasuryReadClient::new(env, treasury_addr);
    client
        .get_token()
        .map_err(|_| CrossContractError::CallFailed)
}
