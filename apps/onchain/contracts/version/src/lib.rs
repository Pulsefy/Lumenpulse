#![no_std]

use soroban_sdk::{contracttype, Env, Symbol};

/// Stable version descriptor returned by every core Lumenpulse contract's
/// `version()` method.
///
/// # Fields
///
/// | Field           | Description |
/// |-----------------|-------------|
/// | `contract`      | Soroban [`Symbol`] identifying the contract (e.g. `"lumen_token"`). |
/// | `major`         | Breaking-change counter. Clients compiled against a **different** major are **incompatible**. |
/// | `minor`         | Additive, backwards-compatible feature increments. Safe for clients to ignore. |
/// | `patch`         | Backwards-compatible bug-fix increments. Always safe to upgrade. |
/// | `min_interface` | The oldest `major` version this contract can still inter-operate with. A client whose deployed `major` is **less than** this value **must upgrade** before calling the contract. When no backwards-compatibility window is offered, `min_interface == major`. |
///
/// # Stability
///
/// This struct is marked `#[contracttype]` so it is part of the on-chain ABI.
/// Field names and types **must not change** without a `major` bump on the
/// `version` crate itself.
///
/// # Upgrade conventions
///
/// | Change type                                 | Bump |
/// |---------------------------------------------|------|
/// | New or changed method signature / data type | `major` (and consider raising `min_interface`) |
/// | New optional method / additive feature      | `minor` |
/// | Internal fix, no interface change           | `patch` |
#[contracttype]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct ContractVersion {
    /// Soroban Symbol naming the contract (max 32 chars, ASCII alphanumeric + `_`).
    pub contract: Symbol,
    /// Breaking-change counter.
    pub major: u32,
    /// Additive feature counter.
    pub minor: u32,
    /// Bug-fix counter.
    pub patch: u32,
    /// Oldest `major` this deployment can inter-operate with.
    pub min_interface: u32,
}

impl ContractVersion {
    /// Construct a version constant without needing the `Env` in scope; the
    /// `Symbol` is created lazily from a `&str` literal at call time.
    ///
    /// # Panics
    ///
    /// Panics if `name` contains characters outside the Soroban Symbol
    /// alphabet (ASCII alphanumeric and `_`, max 32 chars) — caught at
    /// compile-time in tests.
    pub fn new(
        env: &Env,
        name: &str,
        major: u32,
        minor: u32,
        patch: u32,
        min_interface: u32,
    ) -> Self {
        Self {
            contract: Symbol::new(env, name),
            major,
            minor,
            patch,
            min_interface,
        }
    }
}
