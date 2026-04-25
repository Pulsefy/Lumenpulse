# Access Control Interface

A reusable Soroban library contract defining the standardized trait and data types for access control across LumenPulse contracts.

## Overview

This is a **library-only contract** (not deployed independently). It provides:

- **`AccessControlTrait`**: The standardized interface all access control implementations must follow
- **Data Types**: `Role`, `Permission`, `TrustedCaller`, `PermissionCheck`, `RoleInfo`
- **Type Safety**: Ensures all contracts use consistent access control patterns
- **Zero On-Chain Cost**: Only used at compile-time for type checking

## What's Inside

### The AccessControlTrait

A comprehensive trait defining 13 key methods for access control:

```rust
pub trait AccessControlTrait {
    fn has_role(env: Env, subject: Address, role: Role) -> bool;
    fn has_permission(env: Env, subject: Address, permission: Permission) -> PermissionCheck;
    fn get_roles(env: Env, subject: Address) -> Vec<Role>;
    fn get_role_info(env: Env, role: Role) -> RoleInfo;
    fn get_permissions(env: Env, subject: Address) -> Vec<Permission>;
    fn is_trusted_caller(env: Env, caller: Address) -> bool;
    fn get_trusted_caller(env: Env, caller: Address) -> TrustedCaller;
    fn get_all_trusted_callers(env: Env) -> Vec<Address>;
    fn has_permissions(env: Env, subject: Address, permissions: Vec<Permission>, require_all: bool) -> PermissionCheck;
    fn verify_caller_authorization(env: Env, caller: Address, required_role: Role) -> PermissionCheck;
    fn get_admins(env: Env) -> Vec<Address>;
    fn is_managed_resource(env: Env, resource: String) -> bool;
    fn get_managed_resources(env: Env) -> Vec<String>;
}
```

### Data Types

#### Role
```rust
pub struct Role {
    pub id: Symbol,         // Unique identifier
    pub name: String,       // Human-readable name
}
```

#### Permission
```rust
pub struct Permission {
    pub id: Symbol,         // Unique identifier
    pub description: String,// What it allows
    pub resource: String,   // What it applies to
}
```

#### TrustedCaller
```rust
pub struct TrustedCaller {
    pub address: Address,   // Contract address
    pub name: String,       // Friendly name
    pub enabled: bool,      // Active status
}
```

#### PermissionCheck
```rust
pub struct PermissionCheck {
    pub granted: bool,      // Result of check
    pub reason: String,     // Why granted or denied
}
```

#### RoleInfo
```rust
pub struct RoleInfo {
    pub role: Role,
    pub permissions: Vec<Permission>,
    pub member_count: u32,
}
```

## Using This Library

### 1. Add to Your Contract's Cargo.toml

```toml
[dependencies]
access_control_interface = { path = "../access_control_interface" }
```

### 2. Import in Your Contract

```rust
use access_control_interface::{
    AccessControlTrait,
    AccessControlClient,
    Role,
    Permission,
    TrustedCaller,
    PermissionCheck,
};
```

### 3. Use the Client

```rust
let policy_address = Address::from_contract_id(&env, &policy_contract_id);
let policy_client = AccessControlClient::new(&env, &policy_address);

// Call any method from AccessControlTrait
let has_admin = policy_client.has_role(&user, &admin_role);
let can_publish = policy_client.has_permission(&user, &publish_perm);
let is_trusted = policy_client.is_trusted_caller(&caller);
```

## How It Works with Access Control Contract

1. **Define Interface**: This library defines the trait
2. **Implement Contract**: `access_control` contract implements `AccessControlTrait`
3. **Use in Other Contracts**: Other contracts import this library and use `AccessControlClient`
4. **Type Safety**: Rust compiler ensures all calls match the trait definition

```
┌─────────────────────────────────────────┐
│   Other LumenPulse Contracts            │
│   (news_feed, rewards, portfolio, etc)  │
└────────────┬────────────────────────────┘
             │
             └─→ AccessControlClient
                       ↓
┌──────────────────────────────────────────┐
│  access_control_interface (this library) │
│                                          │
│  Data Types: Role, Permission, etc.      │
│  AccessControlTrait definition           │
└──────────────────────────────────────────┘
                       ↑
                       │
┌──────────────────────────────────────────┐
│   access_control contract                │
│   Implements AccessControlTrait          │
│   Stores all on-chain data               │
└──────────────────────────────────────────┘
```

## Example Usage

### In a News Publishing Contract

```rust
use access_control_interface::{AccessControlClient, Role, Permission, Symbol, String};

pub fn publish_article(
    env: Env,
    publisher: Address,
    title: String,
) -> Result<u64, Error> {
    publisher.require_auth();
    
    // Initialize access control client
    let ac_address = /* get from config */;
    let ac_client = AccessControlClient::new(&env, &ac_address);
    
    // Define required role
    let editor_role = Role {
        id: Symbol::short("editor"),
        name: String::from_slice(&env, &"Editor"),
    };
    
    // Verify authorization
    let auth_check = ac_client.verify_caller_authorization(&publisher, &editor_role);
    if !auth_check.granted {
        return Err(Error::Unauthorized);
    }
    
    // Publish article
    Ok(store_article(&env, &title))
}
```

## Building

```bash
cd apps/onchain/contracts/access_control_interface
cargo build --target wasm32-unknown-unknown --release
```

Note: This is a library contract, so there's no binary output. The build is for verification and generating compiled artifacts used by dependent contracts.

## Testing

```bash
# Tests are run from the access_control contract which implements this trait
cd ../access_control
cargo test
```

## File Structure

```
access_control_interface/
├── Cargo.toml
└── src/
    └── lib.rs              # Trait definition and data types
```

## Design Principles

1. **Standardization**: All access control follows the same interface
2. **Flexibility**: Generic role and permission IDs allow for custom hierarchies
3. **Efficiency**: O(1) lookups for roles, flattened permission queries
4. **Security**: Trait requires explicit authorization verification
5. **Extensibility**: Data types are contracttype for compatibility

## Integration Points

### For Contract Developers

Use this library to:
- Query user roles and permissions
- Check if a caller is trusted
- Verify authorization before executing sensitive functions
- Build hierarchical permission systems

### For Platform Developers

Implement `AccessControlTrait` to:
- Create custom access control logic
- Integrate with external systems
- Extend with additional checks
- Support alternative authentication methods

## Why Library vs Contract?

**Library Advantages:**
- ✅ Type safety at compile-time
- ✅ Zero on-chain footprint
- ✅ Shared interface across all contracts
- ✅ Easy to version independently
- ✅ Enables contract clients for IDE autocomplete

**Contract Advantages:**
- ✅ Can be upgraded independently
- ✅ Can store state
- ✅ Can emit events
- ✅ Can be replaced with alternative implementation

This design uses both - the library for interface/types, access_control contract for implementation.

## Future Enhancements

- **Validators**: Trait methods for custom permission validators
- **Middleware**: Support for pre/post authorization hooks
- **Composition**: Ability to combine multiple access control contracts
- **Versioning**: Multiple numbered interfaces (e.g., v1, v2)

## Contributing

Contributions welcome! See [CONTRIBUTING.md](../../../CONTRIBUTING.md)

## License

MIT License. See [LICENSE](../../../LICENSE)

---

**Part of LumenPulse** • Powered by Stellar • Built with ❤️
