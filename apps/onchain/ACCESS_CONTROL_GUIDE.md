# Shared Cross-Contract Access Policy Interface

## Overview

The Shared Cross-Contract Access Policy Interface is a standardized, reusable solution for managing access control across LumenPulse Soroban smart contracts. It provides a flexible, role-based access control (RBAC) system that enables contracts to:

- **Define and manage roles** - Create named role identifiers with permission mappings
- **Query permissions** - Check if an address has specific permissions through role hierarchies
- **Verify trusted callers** - Identify pre-approved cross-contract callers
- **Manage resources** - Organize permissions by logical domains
- **Authorize function calls** - Protect sensitive contract functions with role requirements

## Architecture

### Two-Tier Structure

1. **`access_control_interface`** - A library contract that defines the shared trait
   - Provides the `AccessControlTrait` interface
   - Defines data structures (`Role`, `Permission`, `TrustedCaller`, etc.)
   - Enables other contracts to import and use the interface
   - Zero on-chain footprint (library only)

2. **`access_control`** - The main implementation contract
   - Implements `AccessControlTrait`
   - Manages role-permission hierarchies
   - Stores access control data on-chain
   - Can be deployed once and referenced by multiple contracts

### Data Model

```
Address
  ├─→ Roles[]
      ├─→ Role { id, name }
          └─→ Permissions[]
              ├─→ Permission { id, description, resource }
```

Each address can have multiple roles, and each role grants multiple permissions. This hierarchical structure allows for efficient permission aggregation.

### Key Concepts

- **Role**: A named grouping of permissions (e.g., "admin", "editor", "viewer")
- **Permission**: A fine-grained access right tied to a resource (e.g., "can_publish" on "news_feed")
- **Resource**: A logical domain for permissions (e.g., "portfolio", "news", "rewards")
- **Trusted Caller**: A pre-approved contract address for cross-contract calls

## Interface Methods

### Role Management

#### `has_role(subject: Address, role: Role) -> bool`
Check if an address has a specific role.

```rust
let admin_role = Role { id: Symbol::short("admin"), name: "Administrator" };
if AccessControlClient::has_role(&subject, &admin_role) {
    // User is an admin
}
```

#### `grant_role(subject: Address, role: Role) -> Result<(), Error>`
Assign a role to an address (admin-only).

```rust
admin_client.grant_role(&new_admin, &admin_role)?;
```

#### `revoke_role(subject: Address, role: Role) -> Result<(), Error>`
Remove a role from an address (admin-only).

```rust
admin_client.revoke_role(&user, &editor_role)?;
```

#### `get_roles(subject: Address) -> Vec<Role>`
Get all roles assigned to an address.

```rust
let roles = client.get_roles(&user_address);
for role in roles {
    log!(&env, "User has role: {}", role.name);
}
```

### Permission Management

#### `has_permission(subject: Address, permission: Permission) -> PermissionCheck`
Check if an address has a specific permission through any of their roles.

```rust
let check = client.has_permission(&user, &publish_permission);
if check.granted {
    // User can publish
} else {
    log!(&env, "Reason: {}", check.reason);
}
```

#### `create_permission(id: Symbol, description: String, resource: String) -> Result`
Create a new permission (admin-only).

```rust
admin_client.create_permission(
    &Symbol::short("publish"),
    &String::from_slice(&env, &"Can publish articles"),
    &String::from_slice(&env, &"news_feed")
)?;
```

#### `grant_permission_to_role(role: Role, permission: Permission) -> Result`
Associate a permission with a role (admin-only).

```rust
admin_client.grant_permission_to_role(&editor_role, &publish_permission)?;
```

#### `get_permissions(subject: Address) -> Vec<Permission>`
Get all permissions for an address (flattened across all roles).

```rust
let all_perms = client.get_permissions(&user);
log!(&env, "User has {} permissions", all_perms.len());
```

### Cross-Contract Caller Verification

#### `is_trusted_caller(caller: Address) -> bool`
Check if an address is a trusted caller.

```rust
if AccessControlClient::is_trusted_caller(&calling_contract) {
    // Allow cross-contract call
}
```

#### `add_trusted_caller(address: Address, name: String) -> Result`
Register a contract as a trusted caller (admin-only).

```rust
admin_client.add_trusted_caller(
    &reward_contract_address,
    &String::from_slice(&env, &"RewardDistribution")
)?;
```

#### `get_trusted_caller(caller: Address) -> TrustedCaller`
Get information about a trusted caller.

```rust
let caller_info = client.get_trusted_caller(&contract_address);
log!(&env, "Caller: {} (enabled: {})", caller_info.name, caller_info.enabled);
```

### Resource Management

#### `register_resource(resource: String) -> Result`
Register a managed resource (admin-only).

```rust
admin_client.register_resource(&String::from_slice(&env, &"portfolio_manager"))?;
```

#### `is_managed_resource(resource: String) -> bool`
Check if a resource is managed by this access control contract.

```rust
if client.is_managed_resource(&resource_name) {
    // This access control contract manages this resource
}
```

### Authorization Helpers

#### `verify_caller_authorization(caller: Address, required_role: Role) -> PermissionCheck`
Verify that a caller has the required role for a function.

```rust
let check = client.verify_caller_authorization(&caller, &admin_role);
if !check.granted {
    return Err(AccessControlError::Unauthorized);
}
```

#### `has_permissions(subject: Address, permissions: Vec<Permission>, require_all: bool) -> PermissionCheck`
Check multiple permissions at once.

```rust
let check = client.has_permissions(
    &user,
    &vec![&env, publish_perm, admin_perm],
    false  // ANY permission is sufficient
)?;
```

## Usage Examples

### Example 1: News Publishing Contract

```rust
use access_control_interface::{AccessControlTrait, AccessControlClient, Role, Permission};
use soroban_sdk::{contract, contractimpl, Symbol, String, Env, Address};

#[contract]
pub struct NewsPublisherContract;

#[contractimpl]
impl NewsPublisherContract {
    /// Publish a news article (requires editor role)
    pub fn publish_article(
        env: Env,
        publisher: Address,
        title: String,
        content: String,
    ) -> Result<u64, NewsError> {
        publisher.require_auth();

        // Create access control client
        let policy_contract = env.current_contract_address(); // Replace with actual policy address
        let policy = AccessControlClient::new(&env, &policy_contract);

        // Define required role
        let editor_role = Role {
            id: Symbol::short("editor"),
            name: String::from_slice(&env, &"Editor"),
        };

        // Check authorization
        let auth_check = policy.verify_caller_authorization(&publisher, &editor_role);
        if !auth_check.granted {
            return Err(NewsError::Unauthorized);
        }

        // Proceed with publishing
        let article_id = Self::store_article(&env, &publisher, &title, &content);
        Ok(article_id)
    }

    fn store_article(
        env: &Env,
        publisher: &Address,
        title: &String,
        content: &String,
    ) -> u64 {
        // Store article logic here
        1
    }
}

#[derive(Debug, Clone, Copy)]
pub enum NewsError {
    Unauthorized = 1,
}
```

### Example 2: Cross-Contract Reward Distribution

```rust
use access_control_interface::{AccessControlTrait, AccessControlClient};
use soroban_sdk::{contract, contractimpl, Address, Env, Symbol, String};

#[contract]
pub struct RewardDistributorContract;

#[contractimpl]
impl RewardDistributorContract {
    /// Distribute rewards (can only be called by trusted contracts)
    pub fn distribute_rewards(
        env: Env,
        recipient: Address,
        amount: i128,
    ) -> Result<(), RewardError> {
        let caller = env.invocation_context().get_invoker();
        let policy_contract = /* Get from config */;
        let policy = AccessControlClient::new(&env, &policy_contract);

        // Verify caller is a trusted contract
        if !policy.is_trusted_caller(&caller) {
            return Err(RewardError::UntrustedCaller);
        }

        // Process reward distribution
        Self::transfer_rewards(&env, &recipient, amount)?;
        Ok(())
    }

    fn transfer_rewards(env: &Env, recipient: &Address, amount: i128) -> Result<(), RewardError> {
        // Transfer logic here
        Ok(())
    }
}

#[derive(Debug)]
pub enum RewardError {
    UntrustedCaller = 1,
}
```

### Example 3: Multi-Permission Authorization

```rust
use access_control_interface::{AccessControlTrait, AccessControlClient, Permission};
use soroban_sdk::{contract, contractimpl, Address, Env, Symbol, String, Vec};

#[contract]
pub struct PortfolioManagerContract;

#[contractimpl]
impl PortfolioManagerContract {
    /// Complex operation requiring multiple permissions
    pub fn execute_portfolio_rebalance(
        env: Env,
        manager: Address,
        assets: Vec<Address>,
    ) -> Result<(), PortfolioError> {
        manager.require_auth();

        let policy_contract = /* Get actual address */;
        let policy = AccessControlClient::new(&env, &policy_contract);

        // Define multiple required permissions
        let mut required_perms = Vec::new(&env);
        
        let read_portfolio = Permission {
            id: Symbol::short("read_portfolio"),
            description: String::from_slice(&env, &"Can read portfolio"),
            resource: String::from_slice(&env, &"portfolio"),
        };

        let execute_tx = Permission {
            id: Symbol::short("execute_tx"),
            description: String::from_slice(&env, &"Can execute transactions"),
            resource: String::from_slice(&env, &"trades"),
        };

        required_perms.push_back(read_portfolio);
        required_perms.push_back(execute_tx);

        // Check that manager has ALL required permissions
        let check = policy.has_permissions(&manager, &required_perms, true);
        if !check.granted {
            return Err(PortfolioError::InsufficientPermissions);
        }

        // Execute rebalancing
        Self::rebalance_assets(&env, &manager, &assets)?;
        Ok(())
    }

    fn rebalance_assets(env: &Env, manager: &Address, assets: &Vec<Address>) -> Result<(), PortfolioError> {
        // Rebalance logic here
        Ok(())
    }
}

pub enum PortfolioError {
    InsufficientPermissions = 1,
}
```

## Setup & Integration

### 1. Add Dependencies

Update your contract's `Cargo.toml`:

```toml
[dependencies]
access_control_interface = { path = "../access_control_interface" }
```

### 2. Initialize Access Control Contract

Deploy and initialize once:

```bash
cd access_control
soroban contract build
soroban contract deploy \
  --wasm target/wasm32-unknown-unknown/release/access_control.wasm \
  --network testnet
```

Store the deployed address as a constant in your contract or configuration.

### 3. Import and Use in Your Contract

```rust
use access_control_interface::{AccessControlTrait, AccessControlClient};

let policy_address = Address::from_contract_id(&env, &policy_contract_id);
let policy_client = AccessControlClient::new(&env, &policy_address);
```

### 4. Configure Roles and Permissions

Using a test script or admin CLI:

```shell
# Create roles
soroban contract invoke \
  --id <policy_contract_id> \
  -- create_role \
  --role_id "admin" \
  --role_name "Administrator"

# Create permissions
soroban contract invoke \
  --id <policy_contract_id> \
  -- create_permission \
  --permission_id "publish" \
  --description "Can publish content" \
  --resource "news_feed"

# Grant permission to role
soroban contract invoke \
  --id <policy_contract_id> \
  -- grant_permission_to_role \
  --role_id "editor" \
  --permission_id "publish"
```

## Testing

### Running Tests

```bash
cd apps/onchain
cargo test --package access_control

# Or with specific test
cargo test --package access_control test_has_permission -- --nocapture
```

### Test Coverage

The test suite includes:
- ✅ Contract initialization
- ✅ Role creation and lifecycle
- ✅ Permission creation and hierarchies
- ✅ Role-permission associations
- ✅ User role assignments
- ✅ Permission checking through role hierarchies
- ✅ Trusted caller management
- ✅ Resource registration
- ✅ Multi-role user queries
- ✅ Multi-permission flattening
- ✅ Authorization verification

## Gas Optimization Considerations

1. **Role Caching**: Cache frequently-checked roles in your contract to reduce reads
2. **Permission Batching**: Use `has_permissions()` instead of multiple `has_permission()` calls
3. **Resource Grouping**: Organize permissions by resource to batch checks
4. **Storage Keys**: Role/permission lookups use direct symbol/address keys for O(1) access

## Security Considerations

1. **Admin Key Management**: Securely manage the admin private key
2. **Trusted Caller Audit**: Regularly review trusted callers
3. **Permission Minimization**: Grant only necessary permissions to roles
4. **Authorization Checks**: Always verify caller authorization at function entry
5. **Multisig Support**: Consider using contributor registry with multisig for critical operations

## Integration with Existing Contracts

### Updating Contributor Registry

```rust
use access_control_interface::{AccessControlClient, Role, Symbol};

// In contributor verification
let policy_client = AccessControlClient::new(&env, &policy_address);
let contributor_role = Role {
    id: Symbol::short("contributor"),
    name: String::from_slice(&env, &"Contributor"),
};

if policy_client.has_role(&address, &contributor_role) {
    // Verified as contributor
}
```

### Updating Reward Distribution

```rust
// In reward minting contract
if policy_client.is_trusted_caller(&calling_contract) {
    // Safe to call reward distribution
}
```

## Future Enhancements

- **Time-Based Roles**: Roles that expire after a certain time
- **Delegation**: Allow users to temporarily delegate permissions
- **Audit Logging**: Event emission for all role/permission changes
- **Role Hierarchies**: Parent-child role relationships
- **Dynamic Permissions**: Permissions computed at call time based on contract state
- **Multi-Sig Role Changes**: Require multiple approvals for sensitive changes

## Support & Questions

For issues, questions, or contributions:
- Open an issue in the repository
- Refer to [CONTRIBUTING.md](../../../CONTRIBUTING.md)
- Check the [LumenPulse Discord](https://discord.gg/lumenpulse)

## License

MIT. See [LICENSE](../../../LICENSE) for details.
