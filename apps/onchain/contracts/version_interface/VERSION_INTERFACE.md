# Contract Version Introspection Interface

## Overview

This document describes the standardized version introspection interface for Lumenpulse contracts. This interface allows clients and operators to query deployed contract versions on-chain without relying solely on off-chain manifests.

## Version Interface

### ContractVersion Struct

The `ContractVersion` struct follows semantic versioning (semver.org) with the following fields:

```rust
pub struct ContractVersion {
    pub major: u32,        // Incompatible API changes
    pub minor: u32,        // Backwards-compatible functionality additions
    pub patch: u32,        // Backwards-compatible bug fixes
    pub pre_release: String,  // Pre-release identifier (e.g., "alpha", "beta", "rc.1")
    pub build_metadata: String,  // Build metadata (e.g., commit hash, build timestamp)
}
```

### VersionTrait Interface

Contracts implementing version introspection expose three methods:

```rust
pub trait VersionTrait {
    fn version(env: Env) -> ContractVersion;
    fn contract_name(env: Env) -> Symbol;
    fn contract_description(env: Env) -> String;
}
```

## Response Format

### version()

Returns a `ContractVersion` struct with the following structure:

| Field | Type | Description |
|-------|------|-------------|
| `major` | `u32` | Major version - indicates incompatible API changes |
| `minor` | `u32` | Minor version - indicates backwards-compatible additions |
| `patch` | `u32` | Patch version - indicates backwards-compatible bug fixes |
| `pre_release` | `String` | Pre-release identifier (empty for stable releases) |
| `build_metadata` | `String` | Build metadata (empty if not applicable) |

**Example responses:**
- Stable release: `{ major: 1, minor: 2, patch: 3, pre_release: "", build_metadata: "" }`
- Pre-release: `{ major: 1, minor: 2, patch: 3, pre_release: "beta", build_metadata: "" }`
- With build metadata: `{ major: 1, minor: 2, patch: 3, pre_release: "", build_metadata: "abc123" }`

### contract_name()

Returns a `Symbol` representing the canonical contract name.

**Examples:**
- `Symbol::short("ContributorRegistry")`
- `Symbol::short("MatchingPool")`
- `Symbol::short("Treasury")`

### contract_description()

Returns a `String` with a human-readable description of the contract's purpose.

**Examples:**
- `"Manages contributor registration, reputation, and governance"`
- `"Manages quadratic funding rounds and matching fund distribution"`
- `"Manages treasury streams and multisig governance"`

## Version Semantics

### Major Version Changes (X.0.0)

Indicates incompatible API changes. Clients should verify compatibility before upgrading.

Examples:
- Breaking changes to function signatures
- Removal of previously available functions
- Changes to data structures that affect storage layout

### Minor Version Changes (1.X.0)

Indicates backwards-compatible functionality additions. Existing clients continue to work without modification.

Examples:
- Addition of new functions
- Addition of optional parameters to existing functions
- New events emitted without breaking existing event parsing

### Patch Version Changes (1.0.X)

Indicates backwards-compatible bug fixes. No API changes.

Examples:
- Bug fixes that don't affect the public interface
- Performance improvements
- Documentation updates

### Pre-release Identifiers

Pre-release versions indicate development or testing releases:

- `alpha`: Early development, unstable API
- `beta`: Feature-complete, testing phase
- `rc.N`: Release candidate, final testing before stable release

Pre-release versions have lower precedence than the corresponding stable version:
- `1.0.0-alpha` < `1.0.0-beta` < `1.0.0-rc.1` < `1.0.0`

## Usage Examples

### Querying Contract Version (Soroban SDK)

```rust
use version_interface::{ContractVersion, VersionClient};

let contract_id = Address::from_string(&env, "CB..."); // Contract address
let client = VersionClient::new(&env, &contract_id);

let version = client.version(&env);
let name = client.contract_name(&env);
let description = client.contract_description(&env);
```

### Version Comparison

```rust
let env = Env::default();
let v1 = ContractVersion::stable(&env, 1, 2, 3);
let v2 = ContractVersion::stable(&env, 1, 2, 4);

// v2 is a newer patch version
assert!(v2.patch > v1.patch);
```

### Checking for Incompatible Upgrades

```rust
let current_version = client.version(&env);
let new_version = ContractVersion::stable(&env, 2, 0, 0);

// Major version change indicates incompatible upgrade
if new_version.major > current_version.major {
    // Require manual review and migration
}
```

## Implemented Contracts

The following core contracts implement the version introspection interface:

| Contract | Version | Name | Description |
|----------|---------|------|-------------|
| ContributorRegistry | 1.0.0 | ContributorRegistry | Manages contributor registration, reputation, and governance |
| ProjectRegistry | 1.0.0 | ProjectRegistry | Manages project registration and verification |
| ProtocolRegistry | 1.0.0 | ProtocolRegistry | Manages protocol module registration and versioning |
| MatchingPool | 1.0.0 | MatchingPool | Manages quadratic funding rounds and matching fund distribution |
| Treasury | 1.0.0 | Treasury | Manages treasury streams and multisig governance |
| YieldVault | 1.0.0 | YieldVault | Manages yield generation across multiple providers |

## Backend Integration

### Release Validation

Backend systems can validate contract versions before allowing operations:

```rust
let required_version = ContractVersion::stable(&env, 1, 0, 0);
let deployed_version = client.version(&env);

if deployed_version.major < required_version.major {
    return Err("Contract version too old");
}
```

### Configuration Management

Backend configuration can be dynamically adjusted based on deployed contract versions:

```rust
let version = client.version(&env);
match (version.major, version.minor) {
    (1, 0) => configure_v1_features(),
    (2, 0) => configure_v2_features(),
    _ => configure_default_features(),
}
```

## Stability Guarantees

The version introspection interface is stable and will not change in incompatible ways. Future versions may add optional fields to the `ContractVersion` struct, but existing fields will remain unchanged.

## Migration Guide

When upgrading contracts with major version changes:

1. Query the current version using `version()`
2. Review the changelog for breaking changes
3. Test compatibility with your client code
4. Deploy the new contract
5. Verify the new version using `version()`
6. Update backend configuration if needed

## Testing

Each contract includes tests for version introspection:

```rust
#[test]
fn test_version_introspection() {
    let env = Env::default();
    let contract_id = env.register_contract(None, Contract);
    
    let client = VersionClient::new(&env, &contract_id);
    let version = client.version(&env);
    
    assert_eq!(version.major, 1);
    assert_eq!(version.minor, 0);
    assert_eq!(version.patch, 0);
    
    // Test helper methods
    let stable_ver = ContractVersion::stable(&env, 1, 2, 3);
    assert_eq!(stable_ver.major, 1);
    assert_eq!(stable_ver.minor, 2);
    assert_eq!(stable_ver.patch, 3);
    assert!(!stable_ver.is_pre_release());
    
    let pre_ver = ContractVersion::pre_release(&env, 1, 2, 3, "beta");
    assert!(pre_ver.is_pre_release());
}
```
