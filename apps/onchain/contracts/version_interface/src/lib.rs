#![no_std]

use soroban_sdk::{contracttype, Env, String, Symbol};

/// Semantic version information for a contract.
/// Follows semver.org specification: MAJOR.MINOR.PATCH
/// - MAJOR: Incompatible API changes
/// - MINOR: Backwards-compatible functionality additions
/// - PATCH: Backwards-compatible bug fixes
#[contracttype]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct ContractVersion {
    /// Major version - indicates incompatible API changes
    pub major: u32,
    /// Minor version - indicates backwards-compatible additions
    pub minor: u32,
    /// Patch version - indicates backwards-compatible bug fixes
    pub patch: u32,
    /// Pre-release identifier (e.g., "alpha", "beta", "rc.1")
    /// Empty string for stable releases
    pub pre_release: String,
    /// Build metadata (e.g., commit hash, build timestamp)
    /// Empty string if not applicable
    pub build_metadata: String,
}

impl ContractVersion {
    /// Create a new stable version
    pub fn stable(env: &Env, major: u32, minor: u32, patch: u32) -> Self {
        Self {
            major,
            minor,
            patch,
            pre_release: String::from_str(env, ""),
            build_metadata: String::from_str(env, ""),
        }
    }

    /// Create a new pre-release version
    pub fn pre_release(env: &Env, major: u32, minor: u32, patch: u32, pre: &str) -> Self {
        Self {
            major,
            minor,
            patch,
            pre_release: String::from_str(env, pre),
            build_metadata: String::from_str(env, ""),
        }
    }

    /// Create a version with build metadata
    pub fn with_build(env: &Env, major: u32, minor: u32, patch: u32, build: &str) -> Self {
        Self {
            major,
            minor,
            patch,
            pre_release: String::from_str(env, ""),
            build_metadata: String::from_str(env, build),
        }
    }

    /// Returns true if this version is a pre-release
    pub fn is_pre_release(&self) -> bool {
        !self.pre_release.is_empty()
    }
}

/// Standard interface for contract version introspection.
/// Contracts implementing this trait expose their version information
/// for clients and operators to query without relying on off-chain manifests.
pub trait VersionTrait {
    /// Returns the contract's semantic version information.
    ///
    /// # Returns
    /// `ContractVersion` struct containing major, minor, patch, and optional pre-release/build metadata.
    ///
    /// # Example
    /// ```
    /// let version = contract.version();
    /// // Returns: ContractVersion { major: 1, minor: 2, patch: 3, pre_release: "", build_metadata: "" }
    /// ```
    fn version(env: Env) -> ContractVersion;

    /// Returns the contract's name identifier.
    /// This should be a short, canonical name for the contract type.
    ///
    /// # Returns
    /// `Symbol` representing the contract name (e.g., `Symbol::short("ContributorRegistry")`)
    ///
    /// # Example
    /// ```
    /// let name = contract.contract_name();
    /// // Returns: Symbol::short("ContributorRegistry")
    /// ```
    fn contract_name(env: Env) -> Symbol;

    /// Returns a human-readable description of the contract's purpose.
    ///
    /// # Returns
    /// `String` describing the contract's functionality.
    ///
    /// # Example
    /// ```
    /// let description = contract.contract_description();
    /// // Returns: "Manages contributor registration and reputation"
    /// ```
    fn contract_description(env: Env) -> String;
}
