# Access Control Contract

A Soroban smart contract implementing standardized role-based access control (RBAC) for the LumenPulse ecosystem. This contract manages roles, permissions, and trusted callers across multiple protocol contracts.

## Quick Start

### Building

```bash
cd apps/onchain/contracts/access_control
cargo build --target wasm32-unknown-unknown --release
```

### Deploying

```bash
# Deploy the contract
soroban contract deploy \
  --wasm target/wasm32-unknown-unknown/release/access_control.wasm \
  --network testnet

# Initialize with admin address
soroban contract invoke \
  --id <CONTRACT_ID> \
  --network testnet \
  -- initialize \
  --admin <ADMIN_ADDRESS>
```

### Testing

```bash
# Run all tests
cargo test

# Run specific test
cargo test test_grant_role -- --nocapture
```

## Architecture

### Data Structures

#### Role
```rust
pub struct Role {
    pub id: Symbol,           // Unique identifier (e.g., "admin", "editor")
    pub name: String,         // Human-readable name
}
```

#### Permission
```rust
pub struct Permission {
    pub id: Symbol,           // Unique identifier (e.g., "can_publish")
    pub description: String,  // Description of the permission
    pub resource: String,     // Resource this applies to (e.g., "news_feed")
}
```

#### TrustedCaller
```rust
pub struct TrustedCaller {
    pub address: Address,     // Contract address
    pub name: String,         // Contract name
    pub enabled: bool,        // Whether this caller is enabled
}
```

### Storage Model

```
UserRoles[Address] → Vec<Role>
RolePermissions[Symbol] → Vec<Permission>
TrustedCaller[Address] → TrustedCaller
Role[Symbol] → Role
Permission[Symbol] → Permission
ManagedResources → Vec<String>
```

## Admin Functions

### Role Management

**Create a role:**
```rust
fn create_role(env: Env, role_id: Symbol, role_name: String) -> Result<(), Error>
```

**Grant role to user:**
```rust
fn grant_role(env: Env, subject: Address, role: Role) -> Result<(), Error>
```

**Revoke role from user:**
```rust
fn revoke_role(env: Env, subject: Address, role: Role) -> Result<(), Error>
```

### Permission Management

**Create a permission:**
```rust
fn create_permission(
    env: Env,
    permission_id: Symbol,
    description: String,
    resource: String,
) -> Result<(), Error>
```

**Grant permission to role:**
```rust
fn grant_permission_to_role(
    env: Env,
    role: Role,
    permission: Permission,
) -> Result<(), Error>
```

**Revoke permission from role:**
```rust
fn revoke_permission_from_role(
    env: Env,
    role: Role,
    permission: Permission,
) -> Result<(), Error>
```

### Trusted Caller Management

**Add trusted caller:**
```rust
fn add_trusted_caller(
    env: Env,
    caller_address: Address,
    caller_name: String,
) -> Result<(), Error>
```

**Enable/disable trusted caller:**
```rust
fn set_trusted_caller_enabled(
    env: Env,
    caller_address: Address,
    enabled: bool,
) -> Result<(), Error>
```

**Remove trusted caller:**
```rust
fn remove_trusted_caller(env: Env, caller_address: Address) -> Result<(), Error>
```

## Query Functions

### Role Queries

**Check if user has role:**
```rust
fn has_role(env: Env, subject: Address, role: Role) -> bool
```

**Get all roles for user:**
```rust
fn get_roles(env: Env, subject: Address) -> Vec<Role>
```

**Get role details:**
```rust
fn get_role_info(env: Env, role: Role) -> RoleInfo
```

### Permission Queries

**Check if user has permission:**
```rust
fn has_permission(env: Env, subject: Address, permission: Permission) -> PermissionCheck
```

**Get all permissions for user:**
```rust
fn get_permissions(env: Env, subject: Address) -> Vec<Permission>
```

**Check multiple permissions:**
```rust
fn has_permissions(
    env: Env,
    subject: Address,
    permissions: Vec<Permission>,
    require_all: bool,  // true = ALL perms required, false = ANY perm sufficient
) -> PermissionCheck
```

### Trusted Caller Queries

**Check if caller is trusted:**
```rust
fn is_trusted_caller(env: Env, caller: Address) -> bool
```

**Get trusted caller info:**
```rust
fn get_trusted_caller(env: Env, caller: Address) -> TrustedCaller
```

**Get all trusted callers:**
```rust
fn get_all_trusted_callers(env: Env) -> Vec<Address>
```

### Authorization Helpers

**Verify authorization:**
```rust
fn verify_caller_authorization(
    env: Env,
    caller: Address,
    required_role: Role,
) -> PermissionCheck
```

### Resource Management

**Register managed resource:**
```rust
fn register_resource(env: Env, resource: String) -> Result<(), Error>
```

**Check if resource is managed:**
```rust
fn is_managed_resource(env: Env, resource: String) -> bool
```

**Get all managed resources:**
```rust
fn get_managed_resources(env: Env) -> Vec<String>
```

## Usage Patterns

### Pattern 1: Simple Role Check

```rust
// In your contract function
let policy = AccessControlClient::new(&env, &policy_address);
let admin_role = Role {
    id: Symbol::short("admin"),
    name: String::from_slice(&env, &"Administrator"),
};

if !policy.has_role(&caller, &admin_role) {
    return Err(Unauthorized);
}
// Proceed with admin operation
```

### Pattern 2: Permission-Based Authorization

```rust
// Check specific permission
let publish_perm = Permission {
    id: Symbol::short("publish"),
    description: String::from_slice(&env, &"Can publish articles"),
    resource: String::from_slice(&env, &"news_feed"),
};

let check = policy.has_permission(&user, &publish_perm);
if !check.granted {
    return Err(InsufficientPermissions);
}
```

### Pattern 3: Cross-Contract Security

```rust
let caller = env.invocation_context().get_invoker();
let policy = AccessControlClient::new(&env, &policy_address);

if !policy.is_trusted_caller(&caller) {
    return Err(UntrustedCaller);
}
// Allow the cross-contract call
```

### Pattern 4: Batch Permission Check

```rust
let mut perms = Vec::new(&env);
perms.push_back(read_permission);
perms.push_back(write_permission);

let check = policy.has_permissions(&user, &perms, true); // ALL perms required
if check.granted {
    // User can both read and write
}
```

## Integration with Other Contracts

### Example: Integrating with Contributor Registry

```rust
// In contributor_registry contract
use access_control_interface::AccessControlClient;

pub fn verify_contributor_permissions(
    env: Env,
    contributor: Address,
    access_control_addr: Address,
) -> Result<(), Error> {
    let policy = AccessControlClient::new(&env, &access_control_addr);
    
    let contributor_role = Role {
        id: Symbol::short("contributor"),
        name: String::from_slice(&env, &"Verified Contributor"),
    };
    
    if policy.has_role(&contributor, &contributor_role) {
        Ok(())
    } else {
        Err(NotContributor)
    }
}
```

## Error Handling

### Error Codes

- `ERR_NOTINIT` (1): Contract not initialized
- `ERR_ALRIND` (2): Already initialized
- `ERR_UNAUTH` (3): Unauthorized (not admin)
- `ERR_RNFND` (4): Role not found
- `ERR_REXS` (5): Role already exists
- `ERR_RGRAN` (6): Role already granted
- `ERR_RNGRAN` (7): Role not granted
- `ERR_PNFND` (8): Permission not found
- `ERR_PEXS` (9): Permission already exists
- `ERR_PGRAN` (10): Permission already granted
- `ERR_PNGRAN` (11): Permission not granted
- `ERR_ATRST` (12): Already trusted
- `ERR_NTRST` (13): Not trusted
- `ERR_RREG` (14): Resource already registered

### Handling Errors

```rust
match result {
    Ok(()) => { /* Success */ },
    Err(e) => {
        let error_code: Symbol = e.into();
        log!(&env, "Error: {:?}", error_code);
    }
}
```

## Security Best Practices

1. **Verify Admin Authority**: Always require authentication from the admin before privileged operations
2. **Audit Trail**: Log all role/permission changes through events (future enhancement)
3. **Least Privilege**: Grant only necessary permissions to roles
4. **Regular Audits**: Periodically review all roles, permissions, and trusted callers
5. **Role Rotation**: Implement time-limited roles for sensitive permissions
6. **Trusted Caller Review**: Maintain strict control over which contracts are trusted

## Performance Considerations

- **O(1) Role Lookups**: Direct address-based storage means role checks are fast
- **O(n) Permission Flattening**: Getting all permissions requires iterating through roles
- **Batch Operations**: Use `has_permissions()` for better efficiency than multiple checks

### Optimization Tips

```rust
// ❌ Inefficient - multiple calls
if policy.has_permission(&user, &perm1).granted {
    if policy.has_permission(&user, &perm2).granted {
        // ...
    }
}

// ✅ Better - batch call
let check = policy.has_permissions(
    &user,
    &vec![&env, perm1, perm2],
    true
);
```

## Deploying to Production

### Pre-Deployment Checklist

- [ ] All tests passing (`cargo test`)
- [ ] Contracts compile without warnings
- [ ] Access control contract initialized with secure admin key
- [ ] All required roles created
- [ ] All required permissions created
- [ ] Role-permission mappings verified
- [ ] Initial trusted callers registered
- [ ] Admin recovery plan documented

### Production Deployment

```bash
# Build for production
cargo build --target wasm32-unknown-unknown --release

# Deploy to mainnet
soroban contract deploy \
  --wasm target/wasm32-unknown-unknown/release/access_control.wasm \
  --network mainnet \
  --source-account production_account

# Initialize production instance
soroban contract invoke \
  --id <MAINNET_CONTRACT_ID> \
  --network mainnet \
  -- initialize \
  --admin <PRODUCTION_ADMIN_ADDRESS>
```

## Troubleshooting

### Contract Initialization Fails

**Cause**: Already initialized or invalid admin address

**Solution**: Check if already initialized; use `get_admins()` to verify

### Permission Check Returns False

**Cause**: User doesn't have any role with the permission

**Solution**: 
1. Verify user has a role: `get_roles()`
2. Verify role has permission: `get_role_info()`
3. Grant role or permission as needed

### Trusted Caller Not Working

**Cause**: Caller not registered or disabled

**Solution**: 
1. Call `get_trusted_caller()` to check status
2. Verify `enabled: true`
3. Use `add_trusted_caller()` or `set_trusted_caller_enabled()` to fix

## File Structure

```
access_control/
├── Cargo.toml
├── src/
│   ├── lib.rs                    # Main contract implementation
│   ├── errors.rs                 # Error type definitions
│   ├── storage.rs                # Data key definitions
│   └── tests.rs                  # Integration tests
└── README.md
```

## Contributing

See [CONTRIBUTING.md](../../../CONTRIBUTING.md) for guidelines on:
- Opening issues
- Submitting pull requests
- Code style
- Testing requirements

## License

MIT License. See [LICENSE](../../../LICENSE) for details.

---

**LumenPulse Team** • [Discord](https://discord.gg/lumenpulse) • [GitHub](https://github.com/Pulsefy/Lumenpulse)
