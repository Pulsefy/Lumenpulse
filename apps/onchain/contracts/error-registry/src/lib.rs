//! Standardized Error Code Registry for LumenPulse Contracts
//!
//! This module defines a documented allocation scheme that assigns each contract
//! a distinct error code range. This prevents overlapping error codes across
//! contracts, making it possible to diagnose failures unambiguously across the
//! entire stack.
//!
//! # Allocation Scheme
//!
//! Each contract is assigned a base range of 1000 error codes:
//! - Base code = ContractIndex * 1000
//! - Contract-specific errors start at Base + 1
//! - Base + 0 is reserved for "NotInitialized" (common to all)
//! - Base + 1 is reserved for "AlreadyInitialized" (common to all)
//! - Base + 2 is reserved for "Unauthorized" (common to all)
//!
//! ## Contract Index Assignments
//!
//! | Index | Contract | Base Range | Common Errors |
//! |-------|----------|------------|---------------|
//! | 1 | contributor_registry | 1000-1999 | 1000, 1001, 1002 |
//! | 2 | treasury | 2000-2999 | 2000, 2001, 2002 |
//! | 3 | vesting_wallet | 3000-3999 | 3000, 3001, 3002 |
//! | 4 | pricing_adapter | 4000-4999 | 4000, 4001, 4002 |
//! | 5 | crowdfund_vault | 5000-5999 | 5000, 5001, 5002 |
//! | 6 | stable_swap_pool | 6000-6999 | 6000, 6001, 6002 |
//! | 7 | liquidity_pool | 7000-7999 | 7000, 7001, 7002 |
//! | 8 | matching_pool | 8000-8999 | 8000, 8001, 8002 |
//! | 9 | yield_vault | 9000-9999 | 9000, 9001, 9002 |
//! | 10 | contract_registry | 10000-10999 | 10000, 10001, 10002 |
//! | 11 | project_registry | 11000-11999 | 11000, 11001, 11002 |
//! | 12 | protocol_registry | 12000-12999 | 12000, 12001, 12002 |
//! | 13 | notification_broker | 13000-13999 | 13000, 13001, 13002 |
//! | 14 | lumenpulse_curation | 14000-14999 | 14000, 14001, 14002 |
//! | 15 | feature_flags | 15000-15999 | 15000, 15001, 15002 |
//! | 16 | idempotency_guard | 16000-16999 | 16000, 16001, 16002 |
//! | 17 | reentrancy_guard | 17000-17999 | 17000, 17001, 17002 |
//! | 18 | upgradable_contract | 18000-18999 | 18000, 18001, 18002 |
//! | 19 | version_interface | 19000-19999 | 19000, 19001, 19002 |
//! | 20 | event_versioning | 20000-20999 | 20000, 20001, 20002 |
//! | 21 | cross_contract_view | 21000-21999 | 21000, 21001, 21002 |
//! | 22 | lumen_token | 22000-22999 | 22000, 22001, 22002 |
//!
//! # Usage
//!
//! The `contract_error_code!` macro is available for *naming* the allocation
//! scheme and for use from build scripts and non-`#[contracterror]` contexts:
//!
//! ```rust
//! use error_registry::{contract_error_code, ContractId};
//!
//! assert_eq!(contract_error_code!(ContractId::Treasury, 0), 2000);
//! assert_eq!(contract_error_code!(ContractId::VestingWallet, 5), 3005);
//! ```
//!
//! ## Why contract enums spell out their discriminants
//!
//! `#[contracterror]` (soroban-sdk) only accepts **integer literals** as
//! discriminants — it rejects macro calls, path expressions, and any other
//! `syn::Expr` that is not a `Lit::Int`. A declaration like
//! `NotInitialized = contract_error_code!(ContractId::Treasury, 0)` therefore
//! fails to compile with:
//!
//! ```text
//! error: unsupported discriminant value on enum variant
//! ```
//!
//! So each contract writes its `#[contracterror]` discriminants as plain
//! literals that *conform to* the ranges this crate defines. The registry is the
//! single source of truth for *which* range belongs to *which* contract, and
//! [`resolve_error_code`] is the single source of truth for turning a code
//! emitted by any contract back into its contract name and meaning. The
//! `test_no_overlapping_ranges` test below fails CI if two contracts are ever
//! assigned the same range.
//!
//! # Backend Resolution
//!
//! The backend can resolve any error code to a human-readable message using
//! the generated reference mapping provided by this crate.

/// Contract identifiers for error code allocation.
/// Each contract gets a unique index that determines its base error code range.
#[derive(Copy, Clone, Debug, Eq, PartialEq, PartialOrd, Ord)]
#[repr(u32)]
pub enum ContractId {
    ContributorRegistry = 1,
    Treasury = 2,
    VestingWallet = 3,
    PricingAdapter = 4,
    CrowdfundVault = 5,
    StableSwapPool = 6,
    LiquidityPool = 7,
    MatchingPool = 8,
    YieldVault = 9,
    ContractRegistry = 10,
    ProjectRegistry = 11,
    ProtocolRegistry = 12,
    NotificationBroker = 13,
    LumenpulseCuration = 14,
    FeatureFlags = 15,
    IdempotencyGuard = 16,
    ReentrancyGuard = 17,
    UpgradableContract = 18,
    VersionInterface = 19,
    EventVersioning = 20,
    CrossContractView = 21,
    LumenToken = 22,
}

impl ContractId {
    /// Get the base error code for this contract (ContractId * 1000).
    pub const fn base_code(self) -> u32 {
        (self as u32) * 1000
    }

    /// Get the human-readable name of this contract.
    pub const fn name(self) -> &'static str {
        match self {
            ContractId::ContributorRegistry => "contributor_registry",
            ContractId::Treasury => "treasury",
            ContractId::VestingWallet => "vesting_wallet",
            ContractId::PricingAdapter => "pricing_adapter",
            ContractId::CrowdfundVault => "crowdfund_vault",
            ContractId::StableSwapPool => "stable_swap_pool",
            ContractId::LiquidityPool => "liquidity_pool",
            ContractId::MatchingPool => "matching_pool",
            ContractId::YieldVault => "yield_vault",
            ContractId::ContractRegistry => "contract_registry",
            ContractId::ProjectRegistry => "project_registry",
            ContractId::ProtocolRegistry => "protocol_registry",
            ContractId::NotificationBroker => "notification_broker",
            ContractId::LumenpulseCuration => "lumenpulse_curation",
            ContractId::FeatureFlags => "feature_flags",
            ContractId::IdempotencyGuard => "idempotency_guard",
            ContractId::ReentrancyGuard => "reentrancy_guard",
            ContractId::UpgradableContract => "upgradable_contract",
            ContractId::VersionInterface => "version_interface",
            ContractId::EventVersioning => "event_versioning",
            ContractId::CrossContractView => "cross_contract_view",
            ContractId::LumenToken => "lumen_token",
        }
    }

    /// Get all known contract IDs.
    pub const fn all() -> &'static [ContractId] {
        &[
            ContractId::ContributorRegistry,
            ContractId::Treasury,
            ContractId::VestingWallet,
            ContractId::PricingAdapter,
            ContractId::CrowdfundVault,
            ContractId::StableSwapPool,
            ContractId::LiquidityPool,
            ContractId::MatchingPool,
            ContractId::YieldVault,
            ContractId::ContractRegistry,
            ContractId::ProjectRegistry,
            ContractId::ProtocolRegistry,
            ContractId::NotificationBroker,
            ContractId::LumenpulseCuration,
            ContractId::FeatureFlags,
            ContractId::IdempotencyGuard,
            ContractId::ReentrancyGuard,
            ContractId::UpgradableContract,
            ContractId::VersionInterface,
            ContractId::EventVersioning,
            ContractId::CrossContractView,
            ContractId::LumenToken,
        ]
    }

    /// Get the allocated error code range for this contract: `[base, base + 1000)`.
    pub const fn allocated_range(self) -> (u32, u32) {
        let base = self.base_code();
        (base, base + 1000)
    }

    /// Check if a given error code falls within this contract's allocated range.
    pub const fn is_valid_code(self, code: u32) -> bool {
        let base = self.base_code();
        code >= base && code < base + 1000
    }

    /// Assert that an error code falls within this contract's allocated range.
    /// Panics with a descriptive error message if the code is out of range.
    pub fn assert_code_in_range(self, code: u32) {
        assert!(
            self.is_valid_code(code),
            "Error code {} is outside allocated range [{}, {}) for contract '{}'",
            code,
            self.base_code(),
            self.base_code() + 1000,
            self.name()
        );
    }
}

/// Assert that an error code belongs to the allocated range of the specified contract.
pub fn assert_contract_code_in_range(contract: ContractId, code: u32) {
    contract.assert_code_in_range(code);
}

/// Macro to compute standardized error codes.
/// Usage: `contract_error_code!(ContractId::MyContract, variant_index)`
#[macro_export]
macro_rules! contract_error_code {
    ($contract:expr, $variant:expr) => {
        ($contract as u32) * 1000 + $variant
    };
}

/// Common error codes shared by all contracts (offset from base).
pub mod common {
    /// Contract has not been initialized.
    pub const NOT_INITIALIZED: u32 = 0;
    /// Contract has already been initialized.
    pub const ALREADY_INITIALIZED: u32 = 1;
    /// Caller is not authorized for this operation.
    pub const UNAUTHORIZED: u32 = 2;
}

/// Resolve an error code to its contract and variant.
/// Returns (contract_name, variant_index) if the code falls within a known range.
pub fn resolve_error_code(code: u32) -> Option<(&'static str, u32)> {
    for contract in ContractId::all() {
        let base = contract.base_code();
        if code >= base && code < base + 1000 {
            let variant = code - base;
            return Some((contract.name(), variant));
        }
    }
    None
}

/// Get a human-readable description for a common error variant.
pub fn common_error_description(variant: u32) -> Option<&'static str> {
    match variant {
        common::NOT_INITIALIZED => Some("Contract has not been initialized"),
        common::ALREADY_INITIALIZED => Some("Contract has already been initialized"),
        common::UNAUTHORIZED => Some("Caller is not authorized for this operation"),
        _ => None,
    }
}

/// Resolve an error code to its human-readable description.
pub fn resolve_error_message(code: u32) -> Option<&'static str> {
    let (_, variant) = resolve_error_code(code)?;
    common_error_description(variant)
}

/// Resolve a contract name and message/variant description back to its error code.
pub fn resolve_code_from_message(contract: &str, message: &str) -> Option<u32> {
    for entry in generate_error_reference() {
        if entry.contract == contract && (entry.description == message || entry.variant == message)
        {
            return Some(entry.code);
        }
    }
    None
}

/// Convert a numeric error code to a fully qualified message:
/// `<contract>: <description>`
pub fn code_to_message(code: u32) -> Option<String> {
    let (contract, variant) = resolve_error_code(code)?;
    let desc = common_error_description(variant)?;
    Some(format!("{}: {}", contract, desc))
}

/// Parse a fully qualified message `<contract>: <description>` back to its numeric error code.
pub fn message_to_code(message: &str) -> Option<u32> {
    let (contract, desc) = message.split_once(": ")?;
    resolve_code_from_message(contract, desc)
}

/// Look up a registered error by its exact numeric code in the error registry.
pub fn get_registered_error(code: u32) -> Option<ErrorReferenceEntry> {
    let (contract_name, variant) = resolve_error_code(code)?;
    let (variant_name, desc) = match variant {
        common::NOT_INITIALIZED => ("NotInitialized", "Contract has not been initialized"),
        common::ALREADY_INITIALIZED => (
            "AlreadyInitialized",
            "Contract has already been initialized",
        ),
        common::UNAUTHORIZED => (
            "Unauthorized",
            "Caller is not authorized for this operation",
        ),
        _ => return None,
    };
    Some(ErrorReferenceEntry {
        contract: contract_name,
        code,
        variant: variant_name,
        description: desc,
        is_common: true,
    })
}

/// Generate a complete error code reference for documentation.
/// This can be used to generate markdown or JSON reference docs.
pub fn generate_error_reference() -> Vec<ErrorReferenceEntry> {
    let mut entries = Vec::new();

    for contract in ContractId::all() {
        let base = contract.base_code();
        entries.push(ErrorReferenceEntry {
            contract: contract.name(),
            code: base + common::NOT_INITIALIZED,
            variant: "NotInitialized",
            description: "Contract has not been initialized",
            is_common: true,
        });
        entries.push(ErrorReferenceEntry {
            contract: contract.name(),
            code: base + common::ALREADY_INITIALIZED,
            variant: "AlreadyInitialized",
            description: "Contract has already been initialized",
            is_common: true,
        });
        entries.push(ErrorReferenceEntry {
            contract: contract.name(),
            code: base + common::UNAUTHORIZED,
            variant: "Unauthorized",
            description: "Caller is not authorized for this operation",
            is_common: true,
        });
    }

    entries
}

/// A single entry in the error code reference documentation.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct ErrorReferenceEntry {
    pub contract: &'static str,
    pub code: u32,
    pub variant: &'static str,
    pub description: &'static str,
    pub is_common: bool,
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_base_codes() {
        assert_eq!(ContractId::ContributorRegistry.base_code(), 1000);
        assert_eq!(ContractId::Treasury.base_code(), 2000);
        assert_eq!(ContractId::VestingWallet.base_code(), 3000);
        assert_eq!(ContractId::PricingAdapter.base_code(), 4000);
        assert_eq!(ContractId::StableSwapPool.base_code(), 6000);
        assert_eq!(ContractId::LumenToken.base_code(), 22000);
    }

    #[test]
    fn test_contract_error_code_macro() {
        assert_eq!(contract_error_code!(ContractId::Treasury, 0), 2000);
        assert_eq!(contract_error_code!(ContractId::Treasury, 1), 2001);
        assert_eq!(contract_error_code!(ContractId::Treasury, 10), 2010);
        assert_eq!(contract_error_code!(ContractId::VestingWallet, 5), 3005);
    }

    #[test]
    fn test_resolve_error_code() {
        // Common errors
        assert_eq!(resolve_error_code(2000), Some(("treasury", 0)));
        assert_eq!(resolve_error_code(2001), Some(("treasury", 1)));
        assert_eq!(resolve_error_code(2002), Some(("treasury", 2)));

        // Contract-specific
        assert_eq!(resolve_error_code(2010), Some(("treasury", 10)));

        // Different contract
        assert_eq!(resolve_error_code(3005), Some(("vesting_wallet", 5)));

        // Out of range
        assert_eq!(resolve_error_code(999), None);
        assert_eq!(resolve_error_code(23000), None);
    }

    #[test]
    fn test_no_overlapping_ranges() {
        let mut codes = std::collections::HashSet::new();

        for contract in ContractId::all() {
            let base = contract.base_code();
            for i in 0..1000 {
                let code = base + i;
                assert!(
                    codes.insert(code),
                    "Overlapping error code {} for contract {}",
                    code,
                    contract.name()
                );
            }
        }
    }

    #[test]
    fn test_common_error_descriptions() {
        assert_eq!(
            common_error_description(0),
            Some("Contract has not been initialized")
        );
        assert_eq!(
            common_error_description(1),
            Some("Contract has already been initialized")
        );
        assert_eq!(
            common_error_description(2),
            Some("Caller is not authorized for this operation")
        );
        assert_eq!(common_error_description(3), None);
    }

    #[test]
    fn test_generate_reference() {
        let reference = generate_error_reference();
        // 22 contracts * 3 common errors = 66 entries
        assert_eq!(reference.len(), 66);

        // Check first entry
        assert_eq!(reference[0].contract, "contributor_registry");
        assert_eq!(reference[0].code, 1000);
        assert_eq!(reference[0].variant, "NotInitialized");
        assert!(reference[0].is_common);
    }

    #[test]
    fn test_is_valid_code_and_range_check() {
        let treasury = ContractId::Treasury;
        let (start, end) = treasury.allocated_range();
        assert_eq!(start, 2000);
        assert_eq!(end, 3000);

        assert!(treasury.is_valid_code(2000));
        assert!(treasury.is_valid_code(2999));
        assert!(!treasury.is_valid_code(1999));
        assert!(!treasury.is_valid_code(3000));

        treasury.assert_code_in_range(2000);
        assert_contract_code_in_range(ContractId::Treasury, 2500);
    }

    #[test]
    #[should_panic(expected = "outside allocated range")]
    fn test_code_outside_allocated_range_panics() {
        assert_contract_code_in_range(ContractId::Treasury, 3000);
    }

    #[test]
    fn test_get_registered_error() {
        let entry = get_registered_error(2000).expect("should find 2000");
        assert_eq!(entry.contract, "treasury");
        assert_eq!(entry.code, 2000);
        assert_eq!(entry.variant, "NotInitialized");
        assert_eq!(entry.description, "Contract has not been initialized");
        assert!(entry.is_common);

        assert_eq!(get_registered_error(2003), None);
        assert_eq!(get_registered_error(999), None);
    }

    #[test]
    fn test_resolve_error_message() {
        assert_eq!(
            resolve_error_message(1000),
            Some("Contract has not been initialized")
        );
        assert_eq!(
            resolve_error_message(2001),
            Some("Contract has already been initialized")
        );
        assert_eq!(
            resolve_error_message(3002),
            Some("Caller is not authorized for this operation")
        );
        assert_eq!(resolve_error_message(3003), None);
    }

    #[test]
    fn test_round_trip_message() {
        for entry in generate_error_reference() {
            let msg = resolve_error_message(entry.code).expect("message should resolve");
            assert_eq!(msg, entry.description);
            let code = resolve_code_from_message(entry.contract, msg).expect("code should resolve");
            assert_eq!(code, entry.code);
        }
    }

    #[test]
    fn test_round_trip_qualified_message() {
        for entry in generate_error_reference() {
            let msg = code_to_message(entry.code).expect("should format message");
            let expected_msg = format!("{}: {}", entry.contract, entry.description);
            assert_eq!(msg, expected_msg);
            let code = message_to_code(&msg).expect("should parse message");
            assert_eq!(code, entry.code);
        }

        assert_eq!(message_to_code("unknown: message"), None);
        assert_eq!(message_to_code("malformed"), None);
    }
}
