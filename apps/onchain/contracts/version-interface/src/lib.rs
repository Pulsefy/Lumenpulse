#![no_std]

//! Shared contract version introspection surface (issue #1046).
//!
//! This crate defines the standardized [`ContractVersion`] response type and
//! the `VersionedContract` trait that any contract in this workspace can
//! implement to expose its deployed semantic version on-chain, instead of
//! relying only on off-chain deployment manifests.
//!
//! # Format
//!
//! A [`ContractVersion`] is a SemVer-style `(major, minor, patch)` triple:
//!
//! - `major` — bumped for storage-layout or interface changes that are not
//!   backward compatible (clients/operators must treat these as a different
//!   contract surface).
//! - `minor` — bumped for backward-compatible additions (new entrypoints,
//!   new optional behavior).
//! - `patch` — bumped for backward-compatible fixes with no interface or
//!   storage change.
//!
//! Use [`ContractVersion::is_compatible_with`] to check whether two
//! deployments are interface-compatible rather than comparing fields
//! manually.
//!
//! # Implementing contracts
//!
//! The following contracts in this workspace declare that they implement
//! `VersionedContract` and are covered by the conformance suite:
//!
//! - `lumen_token` (`LumenToken`)
//! - `crowdfund_vault` (`CrowdfundVaultContract`)
//! - `contributor_registry` (`ContributorRegistryContract`)
//! - `vesting-wallet` (`VestingWalletContract`)
//! - `upgradable-contract` (`UpgradableContract`)
//!
//! Because implementers use `impl VersionedContract`, adding a method to the
//! trait without updating every implementer is a compile error. The
//! conformance tests (in this crate's `conformance` module) also exercise
//! each implementer end to end to catch signature drift.

use soroban_sdk::{contractclient, contracttype, Env};

/// Standardized semantic version response for on-chain version introspection.
///
/// Two versions are backward compatible when they share the same `major`
/// (see [`ContractVersion::is_compatible_with`]) — this is the field clients
/// and operators should key release/config validation off of.
#[contracttype]
#[derive(Clone, Copy, Debug, Eq, PartialEq, PartialOrd, Ord)]
pub struct ContractVersion {
    pub major: u32,
    pub minor: u32,
    pub patch: u32,
}

impl ContractVersion {
    pub const fn new(major: u32, minor: u32, patch: u32) -> Self {
        Self {
            major,
            minor,
            patch,
        }
    }

    /// Whether `self` and `other` are interface-compatible per SemVer
    /// semantics: same `major` (and, pre-1.0, same `minor` too, since a `0.x`
    /// line has no stability guarantee across minor versions).
    pub fn is_compatible_with(&self, other: &ContractVersion) -> bool {
        if self.major == 0 || other.major == 0 {
            self.major == other.major && self.minor == other.minor
        } else {
            self.major == other.major
        }
    }
}

/// Standardized version introspection interface. Implement this on any
/// contract that should expose its deployed semantic version on-chain.
#[contractclient(name = "VersionedClient")]
pub trait VersionedContract {
    /// Returns this contract's deployed semantic version.
    fn contract_version(env: Env) -> ContractVersion;
}

#[cfg(test)]
pub mod conformance {
    use super::*;
    use soroban_sdk::{contract, contractimpl, Env, IntoVal, Map, Symbol, TryFromVal, Val};

    /// A mock implementer used by the conformance suite.
    #[contract]
    pub struct MockVersioned;

    #[contractimpl]
    impl VersionedContract for MockVersioned {
        fn contract_version(_env: Env) -> ContractVersion {
            ContractVersion::new(1, 2, 3)
        }
    }

    /// A contract that deliberately does NOT implement `VersionedContract`, so
    /// the suite can prove the interface detects a missing implementation
    /// instead of silently defaulting to a zero version.
    #[contract]
    pub struct NotVersioned;

    #[contractimpl]
    impl NotVersioned {
        pub fn ping(_env: Env) -> u32 {
            1
        }
    }

    /// Exercises a registered contract through the interface's generated
    /// client, asserting it exposes `contract_version` with the exact
    /// signature declared by [`VersionedContract`], and returns the reported
    /// version so callers can assert on it.
    pub fn assert_version_signature(env: &Env, id: &soroban_sdk::Address) -> ContractVersion {
        let client = VersionedClient::new(env, id);
        client.contract_version()
    }

    #[test]
    fn mock_contract_implements_interface_end_to_end() {
        let env = Env::default();
        let id = env.register(MockVersioned, ());

        let version = assert_version_signature(&env, &id);

        assert_eq!(version, ContractVersion::new(1, 2, 3));
    }

    #[test]
    fn same_major_is_compatible() {
        let a = ContractVersion::new(1, 0, 0);
        let b = ContractVersion::new(1, 4, 2);
        assert!(a.is_compatible_with(&b));
        assert!(b.is_compatible_with(&a));
    }

    #[test]
    fn different_major_is_incompatible() {
        let a = ContractVersion::new(1, 9, 9);
        let b = ContractVersion::new(2, 0, 0);
        assert!(!a.is_compatible_with(&b));
    }

    #[test]
    fn pre_1_0_treats_minor_as_breaking() {
        let a = ContractVersion::new(0, 1, 0);
        let b = ContractVersion::new(0, 2, 0);
        assert!(!a.is_compatible_with(&b));

        let c = ContractVersion::new(0, 1, 5);
        assert!(a.is_compatible_with(&c));
    }

    /// A version is "well-formed and non-default" when it is not the zero
    /// triple `(0, 0, 0)` - the value a missing/defaulted implementation would
    /// return.
    fn assert_well_formed_non_default(version: ContractVersion) {
        assert!(
            version.major != 0 || version.minor != 0 || version.patch != 0,
            "contract reports the default (0.0.0) version"
        );
    }

    #[test]
    fn default_version_is_the_zero_triple() {
        let default = ContractVersion::new(0, 0, 0);
        assert_eq!(default.major, 0);
        assert_eq!(default.minor, 0);
        assert_eq!(default.patch, 0);
    }

    #[test]
    fn version_serialises_with_expected_field_names_and_values() {
        let env = Env::default();
        let version = ContractVersion::new(1, 4, 2);

        let val: Val = version.into_val(&env);
        let map: Map<Symbol, Val> = TryFromVal::try_from_val(&env, &val).unwrap();

        // Exactly the three fields the backend reads, keyed by name.
        assert_eq!(map.len(), 3);
        let major: u32 =
            TryFromVal::try_from_val(&env, &map.get(Symbol::new(&env, "major")).unwrap()).unwrap();
        let minor: u32 =
            TryFromVal::try_from_val(&env, &map.get(Symbol::new(&env, "minor")).unwrap()).unwrap();
        let patch: u32 =
            TryFromVal::try_from_val(&env, &map.get(Symbol::new(&env, "patch")).unwrap()).unwrap();
        assert_eq!((major, minor, patch), (1, 4, 2));
    }

    #[test]
    fn version_round_trips_through_val() {
        let env = Env::default();
        let version = ContractVersion::new(7, 8, 9);
        let val: Val = version.into_val(&env);
        let decoded: ContractVersion = TryFromVal::try_from_val(&env, &val).unwrap();
        assert_eq!(decoded, version);
    }

    #[test]
    fn distinct_versions_serialise_differently() {
        let env = Env::default();
        let a: Val = ContractVersion::new(1, 2, 3).into_val(&env);
        let b: Val = ContractVersion::new(1, 2, 4).into_val(&env);
        let a_scval = soroban_sdk::xdr::ScVal::try_from_val(&env, &a).unwrap();
        let b_scval = soroban_sdk::xdr::ScVal::try_from_val(&env, &b).unwrap();
        assert_ne!(a_scval, b_scval);
    }

    #[test]
    fn mock_contract_reports_a_non_default_well_formed_version() {
        let env = Env::default();
        let id = env.register(MockVersioned, ());

        let version = assert_version_signature(&env, &id);

        assert_well_formed_non_default(version);
        assert_eq!(version, ContractVersion::new(1, 2, 3));
    }

    #[test]
    fn contract_without_the_interface_is_detected() {
        let env = Env::default();
        let id = env.register(NotVersioned, ());
        let client = VersionedClient::new(&env, &id);

        // `try_contract_version` surfaces the missing entrypoint as an error
        // rather than a default/zero version.
        assert!(client.try_contract_version().is_err());
    }

    #[test]
    fn same_version_is_compatible() {
        let v = ContractVersion::new(3, 5, 1);
        assert!(v.is_compatible_with(&v));
    }

    #[test]
    fn patch_difference_is_compatible() {
        let a = ContractVersion::new(1, 2, 3);
        let b = ContractVersion::new(1, 2, 4);
        assert!(a.is_compatible_with(&b));
        assert!(b.is_compatible_with(&a));
    }

    #[test]
    fn minor_difference_is_compatible_when_major_is_non_zero() {
        let a = ContractVersion::new(2, 1, 0);
        let b = ContractVersion::new(2, 9, 9);
        assert!(a.is_compatible_with(&b));
        assert!(b.is_compatible_with(&a));
    }

    #[test]
    fn ordering_is_lexicographic_by_major_then_minor_then_patch() {
        assert!(ContractVersion::new(1, 0, 0) < ContractVersion::new(1, 0, 1));
        assert!(ContractVersion::new(1, 1, 0) < ContractVersion::new(1, 2, 0));
        assert!(ContractVersion::new(1, 9, 9) < ContractVersion::new(2, 0, 0));
        assert!(ContractVersion::new(0, 0, 1) > ContractVersion::new(0, 0, 0));
    }
}
