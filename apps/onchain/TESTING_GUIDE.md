# Access Control Testing & Integration Guide

## Overview

This guide explains how to test the access control system and integrate it with other LumenPulse contracts.

## Running Tests

### Build the Contracts

```bash
cd apps/onchain

# Build all contracts including access control
cargo build --target wasm32-unknown-unknown

# Build in release mode (optimized)
cargo build --target wasm32-unknown-unknown --release
```

### Run Tests

```bash
cd apps/onchain

# Run all tests
cargo test --package access_control

# Run a specific test
cargo test --package access_control test_has_role -- --nocapture

# Run with output
cargo test --package access_control -- --nocapture

# Run all tests in the workspace
cargo test
```

### Test Coverage

The test suite covers:

- ✅ **Initialization**: Contract setup and admin management
- ✅ **Role Operations**: Create, grant, revoke, list roles
- ✅ **Permissions**: Create, grant, revoke, list permissions
- ✅ **Role-Permission Mapping**: Associating permissions with roles
- ✅ **Permission Checking**: Verifying permissions through role hierarchy
- ✅ **Trusted Callers**: Adding, removing, enabling/disabling trusted callers
- ✅ **Authorization Verification**: Checking caller authorization
- ✅ **Resource Management**: Registering and querying managed resources
- ✅ **Error Cases**: Duplicate roles, missing roles, unauthorized access

### Example Test Execution

```bash
$ cargo test --package access_control test_grant_role -- --nocapture

running 1 test

test test_grant_role ... ok

test result: ok. 1 passed; 0 failed; 0 ignored; 0 measured; 24 filtered out
```

## Integration with Your Contract

### Step 1: Add Dependency

In your contract's `Cargo.toml`:

```toml
[dependencies]
access_control_interface = { path = "../access_control_interface" }
soroban-sdk = { workspace = true }
```

### Step 2: Import Types

```rust
use access_control_interface::{
    AccessControlTrait,
    AccessControlClient,
    Role,
    Permission,
    PermissionCheck,
};
use soroban_sdk::{Symbol, String};
```

### Step 3: Get the Client

```rust
let access_control_address = /* Get from config or parameter */;
let ac_client = AccessControlClient::new(&env, &access_control_address);
```

### Step 4: Use in Your Functions

```rust
#[contract]
pub struct NewsPublisherContract;

#[contractimpl]
impl NewsPublisherContract {
    pub fn publish_news(
        env: Env,
        publisher: Address,
        ac_address: Address,
        title: String,
        content: String,
    ) -> Result<u64, Error> {
        publisher.require_auth();

        // Initialize access control client
        let ac_client = AccessControlClient::new(&env, &ac_address);

        // Define required role
        let editor_role = Role {
            id: Symbol::short("editor"),
            name: String::from_slice(&env, &"Editor"),
        };

        // Check authorization
        let check = ac_client.has_role(&publisher, &editor_role);
        if !check {
            return Err(Error::Unauthorized);
        }

        // Publish the news
        let news_id = Self::store_news(&env, &title, &content);
        Ok(news_id)
    }

    fn store_news(env: &Env, title: &String, content: &String) -> u64 {
        // Implementation
        1
    }
}

pub enum Error {
    Unauthorized = 1,
}
```

## Real-World Integration Examples

### Example 1: Reward Distribution with Trusted Caller Check

```rust
#[contractimpl]
impl RewardDistributorContract {
    /// Distribute rewards between contributors
    /// Can only be called by trusted contracts (e.g., curation contract)
    pub fn distribute_rewards(
        env: Env,
        ac_address: Address,
        contributors: Vec<Address>,
        amounts: Vec<i128>,
    ) -> Result<(), Error> {
        let caller = env.invocation_context().get_invoker();
        let ac_client = AccessControlClient::new(&env, &ac_address);

        // Verify caller is trusted
        if !ac_client.is_trusted_caller(&caller) {
            return Err(Error::UntrustedCaller);
        }

        // Process distribution
        for i in 0..contributors.len() {
            Self::transfer_reward(&env, &contributors.get(i).unwrap(), amounts.get(i).unwrap())?;
        }

        Ok(())
    }

    fn transfer_reward(env: &Env, recipient: &Address, amount: &i128) -> Result<(), Error> {
        // Transfer logic...
        Ok(())
    }
}

pub enum Error {
    UntrustedCaller = 1,
}
```

### Example 2: Portfolio Manager with Multiple Permissions

```rust
#[contractimpl]
impl PortfolioManagerContract {
    /// Execute a complex rebalancing requiring multiple permissions
    pub fn rebalance_portfolio(
        env: Env,
        ac_address: Address,
        manager: Address,
        new_allocation: Vec<(Address, i128)>,
    ) -> Result<(), Error> {
        manager.require_auth();

        let ac_client = AccessControlClient::new(&env, &ac_address);

        // Check multiple permissions
        let read_perm = Permission {
            id: Symbol::short("read"),
            description: String::from_slice(&env, &"Read portfolio"),
            resource: String::from_slice(&env, &"portfolio"),
        };

        let write_perm = Permission {
            id: Symbol::short("write"),
            description: String::from_slice(&env, &"Write portfolio"),
            resource: String::from_slice(&env, &"portfolio"),
        };

        // Verify both permissions
        let mut perms = Vec::new(&env);
        perms.push_back(read_perm);
        perms.push_back(write_perm);

        let check = ac_client.has_permissions(&manager, &perms, true); // require ALL
        if !check.granted {
            return Err(Error::InsufficientPermissions);
        }

        // Execute rebalancing
        Self::apply_allocation(&env, &manager, &new_allocation)?;
        Ok(())
    }

    fn apply_allocation(
        env: &Env,
        manager: &Address,
        allocation: &Vec<(Address, i128)>,
    ) -> Result<(), Error> {
        // Rebalancing logic...
        Ok(())
    }
}

pub enum Error {
    InsufficientPermissions = 1,
}
```

### Example 3: Contributor Registry with Role Verification

```rust
use access_control_interface::AccessControlTrait;

#[contractimpl]
impl ContributorRegistryContract {
    /// Register a new contributor (requires admin role)
    pub fn register_contributor(
        env: Env,
        ac_address: Address,
        github_handle: String,
        registrant: Address,
    ) -> Result<(), Error> {
        registrant.require_auth();

        let ac_client = AccessControlClient::new(&env, &ac_address);

        // Define admin role
        let admin_role = Role {
            id: Symbol::short("admin"),
            name: String::from_slice(&env, &"Administrator"),
        };

        // Check role
        if !ac_client.has_role(&registrant, &admin_role) {
            return Err(Error::NotAdmin);
        }

        // Register contributor
        Self::store_contributor(&env, &github_handle)?;
        Ok(())
    }

    fn store_contributor(env: &Env, github_handle: &String) -> Result<(), Error> {
        // Storage logic...
        Ok(())
    }
}

pub enum Error {
    NotAdmin = 1,
}
```

## Testing Your Integration

### Writing Integration Tests

```rust
#[cfg(test)]
mod tests {
    use super::*;
    use access_control::{AccessControlContract};
    use access_control_interface::AccessControlClient;
    use soroban_sdk::Env;

    #[test]
    fn test_news_publisher_with_access_control() {
        let env = Env::default();
        
        // Setup
        let admin = Address::generate(&env);
        let publisher = Address::generate(&env);
        let ac_contract_id = env.register_contract(None, AccessControlContract);
        let ac_client = AccessControlClient::new(&env, &ac_contract_id);

        // Initialize access control
        ac_client.initialize(&admin).unwrap();

        // Create editor role
        let editor_id = Symbol::short("editor");
        ac_client.create_role(&editor_id, &String::from_slice(&env, &"Editor")).unwrap();

        // Grant role to publisher
        let editor_role = Role {
            id: editor_id,
            name: String::from_slice(&env, &"Editor"),
        };
        ac_client.grant_role(&publisher, &editor_role).unwrap();

        // Verify publisher can publish
        let has_role = ac_client.has_role(&publisher, &editor_role);
        assert!(has_role);

        // Now test your contract's publish function...
    }

    #[test]
    fn test_permission_denied() {
        let env = Env::default();
        
        let admin = Address::generate(&env);
        let unauthorized_user = Address::generate(&env);
        let ac_contract_id = env.register_contract(None, AccessControlContract);
        let ac_client = AccessControlClient::new(&env, &ac_contract_id);

        ac_client.initialize(&admin).unwrap();

        let editor_role = Role {
            id: Symbol::short("editor"),
            name: String::from_slice(&env, &"Editor"),
        };

        // Verify unauthorized user doesn't have role
        let has_role = ac_client.has_role(&unauthorized_user, &editor_role);
        assert!(!has_role);
    }
}
```

### Running Your Integration Tests

```bash
# Run your contract tests (which include access control integration)
cargo test --package your_contract_name -- --nocapture

# Run all tests including access control
cargo test --workspace
```

## Deployment Checklist

### Pre-Deployment

- [ ] All tests passing: `cargo test --package access_control`
- [ ] Contracts compile: `cargo build --target wasm32-unknown-unknown --release`
- [ ] No compiler warnings
- [ ] Code reviewed
- [ ] Emergency recovery plan documented

### Deployment Steps

```bash
# 1. Build release binary
cd apps/onchain/contracts/access_control
cargo build --target wasm32-unknown-unknown --release

# 2. Deploy to testnet first
soroban contract deploy \
  --wasm target/wasm32-unknown-unknown/release/access_control.wasm \
  --network testnet \
  --source-account YOUR_TESTNET_ACCOUNT

# 3. Initialize
soroban contract invoke \
  --id <CONTRACT_ID> \
  --network testnet \
  -- initialize \
  --admin <ADMIN_ADDRESS>

# 4. Create roles and permissions (see Configuration section)
# 5. Test thoroughly on testnet
# 6. Deploy to mainnet following same steps with mainnet network
```

## Configuration

### Setting Up Roles and Permissions

```bash
# Create "admin" role
soroban contract invoke \
  --id <CONTRACT_ID> \
  --network testnet \
  -- create_role \
  --role_id "admin" \
  --role_name "Administrator"

# Create "editor" role
soroban contract invoke \
  --id <CONTRACT_ID> \
  --network testnet \
  -- create_role \
  --role_id "editor" \
  --role_name "Content Editor"

# Create "publish" permission
soroban contract invoke \
  --id <CONTRACT_ID> \
  --network testnet \
  -- create_permission \
  --permission_id "publish" \
  --description "Can publish articles" \
  --resource "news_feed"

# Grant permission to role
soroban contract invoke \
  --id <CONTRACT_ID> \
  --network testnet \
  -- grant_permission_to_role \
  --role_id "editor" \
  --permission_id "publish"

# Grant role to user
soroban contract invoke \
  --id <CONTRACT_ID> \
  --network testnet \
  -- grant_role \
  --subject <USER_ADDRESS> \
  --role_id "editor"
```

## Troubleshooting

### Test Failures

**Problem**: Tests fail with "Contract not initialized"

**Solution**: Ensure `client.initialize(&admin)` is called before tests

**Problem**: "Role not found" error

**Solution**: Create the role before granting it to a user

**Problem**: "Permission denied" on trusted caller

**Solution**: Use `add_trusted_caller()` and check `set_trusted_caller_enabled()`

### Compilation Errors

**Problem**: "Cannot find type in this scope"

**Solution**: Ensure you have the correct import:
```rust
use access_control_interface::{AccessControlTrait, Role, Permission};
```

**Problem**: "Mismatched types for String"

**Solution**: Use `String::from_slice(&env, &"your_string")` for Soroban strings

## Performance Tips

1. **Cache Roles**: Store frequently-checked roles locally instead of querying every time
2. **Batch Checks**: Use `has_permissions()` instead of multiple `has_permission()` calls
3. **Minimize Storage Reads**: Query all user roles once, then check locally

### Example: Caching

```rust
// Instead of this (inefficient):
if ac_client.has_permission(&user, &perm1).granted {
    if ac_client.has_permission(&user, &perm2).granted {
        // ...
    }
}

// Do this (efficient):
let perms = vec![&env, perm1, perm2];
let check = ac_client.has_permissions(&user, &perms, true);
if check.granted {
    // ...
}
```

## Next Steps

1. **Review** the [ACCESS_CONTROL_GUIDE.md](./ACCESS_CONTROL_GUIDE.md) for detailed API documentation
2. **Implement** access control in your contracts
3. **Test** thoroughly on testnet
4. **Deploy** to mainnet with audit and security review

For questions or issues, see [CONTRIBUTING.md](../../../CONTRIBUTING.md)
