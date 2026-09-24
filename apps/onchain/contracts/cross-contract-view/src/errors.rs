//! Standardized error types for cross-contract view operations.

use soroban_sdk::contracterror;

/// Error types for cross-contract view operations.
///
/// These errors provide standardized error codes and messages for
/// common failure modes when reading from other contracts.
#[contracterror]
#[derive(Copy, Clone, Debug, Eq, PartialEq, PartialOrd, Ord)]
#[repr(u32)]
pub enum ViewError {
    /// The requested data was not found in storage.
    NotFound = 1200,

    /// The contract is not initialized.
    NotInitialized = 1201,

    /// The caller is not authorized to perform this action.
    Unauthorized = 1202,

    /// The target contract address is invalid or not registered.
    InvalidContract = 1203,

    /// The operation failed due to a type mismatch or conversion error.
    TypeMismatch = 1204,

    /// Storage operation failed (e.g., TTL extension).
    StorageError = 1205,

    /// The token operation failed.
    TokenError = 1206,

    /// Cross-contract call failed.
    CrossContractCallFailed = 1207,
}

impl ViewError {
    /// Returns a human-readable description of the error.
    pub const fn as_str(&self) -> &'static str {
        match self {
            ViewError::NotFound => "Data not found in storage",
            ViewError::NotInitialized => "Contract not initialized",
            ViewError::Unauthorized => "Caller is not authorized",
            ViewError::InvalidContract => "Invalid or unregistered contract address",
            ViewError::TypeMismatch => "Type conversion failed",
            ViewError::StorageError => "Storage operation failed",
            ViewError::TokenError => "Token operation failed",
            ViewError::CrossContractCallFailed => "Cross-contract call failed",
        }
    }
}
