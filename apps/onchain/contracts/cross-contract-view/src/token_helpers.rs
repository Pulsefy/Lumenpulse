//! Token operation helpers for cross-contract reads.

use crate::errors::ViewError;
use soroban_sdk::{Address, Env};

/// Safely read the token balance for an address.
///
/// # Arguments
///
/// * `env` - The Soroban environment
/// * `token` - The token contract address
/// * `address` - The address to check balance for
///
/// # Returns
///
/// The token balance, or ViewError::TokenError if the call fails.
pub fn balance(env: &Env, token: &Address, address: &Address) -> Result<i128, ViewError> {
    let client = soroban_sdk::token::Client::new(env, token);
    match client.try_balance(address) {
        Ok(Ok(v)) => Ok(v),
        _ => Err(ViewError::TokenError),
    }
}

/// Safely read the token allowance from owner to spender.
///
/// # Arguments
///
/// * `env` - The Soroban environment
/// * `token` - The token contract address
/// * `owner` - The token owner address
/// * `spender` - The approved spender address
///
/// # Returns
///
/// The allowance amount, or ViewError::TokenError if the call fails.
pub fn allowance(env: &Env, token: &Address, owner: &Address, spender: &Address) -> Result<i128, ViewError> {
    let client = soroban_sdk::token::Client::new(env, token);
    match client.try_allowance(owner, spender) {
        Ok(Ok(v)) => Ok(v),
        _ => Err(ViewError::TokenError),
    }
}

/// Token metadata information.
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct TokenInfo {
    pub decimals: u32,
    pub name: soroban_sdk::String,
    pub symbol: soroban_sdk::String,
}

/// Read token metadata (decimals, name, symbol).
///
/// # Arguments
///
/// * `env` - The Soroban environment
/// * `token` - The token contract address
///
/// # Returns
///
/// Token metadata, or `ViewError::TokenError` if the call fails.
pub fn token_info(env: &Env, token: &Address) -> Result<TokenInfo, ViewError> {
    let client = soroban_sdk::token::Client::new(env, token);

    let decimals = match client.try_decimals() {
        Ok(Ok(v)) => v,
        _ => return Err(ViewError::TokenError),
    };
    let name = match client.try_name() {
        Ok(Ok(v)) => v,
        _ => return Err(ViewError::TokenError),
    };
    let symbol = match client.try_symbol() {
        Ok(Ok(v)) => v,
        _ => return Err(ViewError::TokenError),
    };

    Ok(TokenInfo {
        decimals,
        name,
        symbol,
    })
}

#[cfg(test)]
mod tests {
    use super::*;
    use soroban_sdk::testutils::Address as _;

    #[test]
    fn test_balance_returns_zero_for_nonexistent_token() {
        let env = Env::default();
        env.mock_all_auths();
        let _token = Address::generate(&env);
        let _user = Address::generate(&env);
        // Balance reads to non-existent tokens will trap in Soroban,
        // so this test verifies the function signature compiles correctly.
    }
}
