# Access Control Quick Reference

A cheat sheet for common access control patterns in LumenPulse contracts.

## Quick Setup

### 1. Add Dependency
```toml
[dependencies]
access_control_interface = { path = "../access_control_interface" }
```

### 2. Import
```rust
use access_control_interface::{AccessControlClient, Role, Permission, AccessControlTrait};
```

### 3. Get Client
```rust
let ac_client = AccessControlClient::new(&env, &ac_address);
```

## Common Patterns

### Check if User Has Role

```rust
let role = Role {
    id: Symbol::short("admin"),
    name: String::from_slice(&env, &"Administrator"),
};

if ac_client.has_role(&user, &role) {
    // User is admin
}
```

### Check if User Has Permission

```rust
let permission = Permission {
    id: Symbol::short("publish"),
    description: String::from_slice(&env, &"Can publish"),
    resource: String::from_slice(&env, &"news"),
};

let check = ac_client.has_permission(&user, &permission);
if check.granted {
    // User can publish
}
```

### Require Role in Function

```rust
pub fn admin_function(env: Env, ac_addr: Address, caller: Address) -> Result<(), Error> {
    caller.require_auth();
    
    let ac_client = AccessControlClient::new(&env, &ac_addr);
    let admin_role = Role {
        id: Symbol::short("admin"),
        name: String::from_slice(&env, &"Administrator"),
    };

    let check = ac_client.verify_caller_authorization(&caller, &admin_role);
    if !check.granted {
        return Err(Error::Unauthorized);
    }

    // Admin operation
    Ok(())
}
```

### Check Multiple Permissions

```rust
let mut perms = Vec::new(&env);
perms.push_back(read_perm);
perms.push_back(write_perm);

// ALL permissions required
let check = ac_client.has_permissions(&user, &perms, true);
if !check.granted {
    return Err(Error::InsufficientPermissions);
}
```

### Verify Trusted Caller (Cross-Contract)

```rust
pub fn cross_contract_call(env: Env, ac_addr: Address) -> Result<(), Error> {
    let caller = env.invocation_context().get_invoker();
    let ac_client = AccessControlClient::new(&env, &ac_addr);

    if !ac_client.is_trusted_caller(&caller) {
        return Err(Error::UntrustedCaller);
    }

    // Proceed with cross-contract logic
    Ok(())
}
```

### Get All User's Permissions

```rust
let permissions = ac_client.get_permissions(&user);
for perm in permissions.iter() {
    log!(&env, "User can: {}", perm.description);
}
```

### Get All User's Roles

```rust
let roles = ac_client.get_roles(&user);
for role in roles.iter() {
    log!(&env, "User has role: {}", role.name);
}
```

## Admin Operations

### Create Role (Admin Only)
```rust
ac_client.create_role(
    &Symbol::short("moderator"),
    &String::from_slice(&env, &"Moderator"),
)?;
```

### Grant Role to User (Admin Only)
```rust
ac_client.grant_role(&user_addr, &role)?;
```

### Create Permission (Admin Only)
```rust
ac_client.create_permission(
    &Symbol::short("delete"),
    &String::from_slice(&env, &"Can delete content"),
    &String::from_slice(&env, &"news"),
)?;
```

### Link Permission to Role (Admin Only)
```rust
ac_client.grant_permission_to_role(&role, &permission)?;
```

### Add Trusted Caller (Admin Only)
```rust
ac_client.add_trusted_caller(
    &contract_address,
    &String::from_slice(&env, &"RewardContract"),
)?;
```

### Register Resource (Admin Only)
```rust
ac_client.register_resource(
    &String::from_slice(&env, &"portfolio_manager")
)?;
```

## Error Handling

### Handle Permission Check Results

```rust
match ac_client.has_permission(&user, &permission).granted {
    true => {
        // Permission granted
    }
    false => {
        let reason = ac_client.has_permission(&user, &permission).reason;
        log!(&env, "Permission denied: {}", reason);
        return Err(Error::PermissionDenied);
    }
}
```

### Handle Create Operations

```rust
match ac_client.create_role(&role_id, &role_name) {
    Ok(()) => {
        // Role created
    }
    Err(_) => {
        return Err(Error::RoleCreationFailed);
    }
}
```

## Data Structures Reference

### Role
```rust
Role {
    id: Symbol,         // "admin", "editor", etc.
    name: String,       // "Administrator", "Content Editor"
}
```

### Permission
```rust
Permission {
    id: Symbol,         // "publish", "delete", etc.
    description: String,// "Can publish articles"
    resource: String,   // "news_feed", "portfolio", etc.
}
```

### PermissionCheck
```rust
PermissionCheck {
    granted: bool,      // true if permission granted
    reason: String,     // Why it was granted/denied
}
```

### TrustedCaller
```rust
TrustedCaller {
    address: Address,   // Contract address
    name: String,       // "RewardDistributor"
    enabled: bool,      // Whether active
}
```

## Symbol/String Constants

Use these constants for consistency across contracts:

### Roles
```rust
Symbol::short("admin")         // Administrator
Symbol::short("editor")         // Content Editor
Symbol::short("moderator")      // Content Moderator
Symbol::short("contributor")    // Verified Contributor
Symbol::short("viewer")         // Regular User
```

### Permissions
```rust
Symbol::short("publish")        // Can publish content
Symbol::short("edit")           // Can edit content
Symbol::short("delete")         // Can delete content
Symbol::short("read")           // Can read content
Symbol::short("rate")           // Can rate content
Symbol::short("comment")        // Can comment on content
```

### Resources
```rust
"news_feed"                     // News aggregation
"portfolio"                     // Portfolio management
"rewards"                       // Reward distribution
"contributions"                 // User contributions
"comments"                      // Comments/ratings
"governance"                    // Governance voting
```

## Complete Example Function

```rust
#[contractimpl]
impl YourContract {
    /// Publish news (requires editor role and publish permission)
    pub fn publish_news(
        env: Env,
        ac_address: Address,
        publisher: Address,
        title: String,
        content: String,
    ) -> Result<u64, PublishError> {
        publisher.require_auth();

        let ac_client = AccessControlClient::new(&env, &ac_address);

        // Check role
        let editor_role = Role {
            id: Symbol::short("editor"),
            name: String::from_slice(&env, &"Editor"),
        };

        let auth = ac_client.verify_caller_authorization(&publisher, &editor_role);
        if !auth.granted {
            return Err(PublishError::NotEditor);
        }

        // Check permission
        let publish_perm = Permission {
            id: Symbol::short("publish"),
            description: String::from_slice(&env, &"Can publish articles"),
            resource: String::from_slice(&env, &"news_feed"),
        };

        let perm_check = ac_client.has_permission(&publisher, &publish_perm);
        if !perm_check.granted {
            return Err(PublishError::CantPublish);
        }

        // Store the news
        let news_id = Self::store_news(&env, &title, &content);
        Ok(news_id)
    }

    fn store_news(env: &Env, title: &String, content: &String) -> u64 {
        // Implementation
        1
    }
}

pub enum PublishError {
    NotEditor = 1,
    CantPublish = 2,
}
```

## Testing Patterns

### Basic Test Setup
```rust
#[test]
fn test_my_integration() {
    let env = Env::default();
    let admin = Address::generate(&env);
    let user = Address::generate(&env);
    
    // Register and initialize access control
    let ac_id = env.register_contract(None, AccessControlContract);
    let ac_client = AccessControlClient::new(&env, &ac_id);
    ac_client.initialize(&admin).unwrap();
    
    // Your test assertions
}
```

### Testing Role Assignment
```rust
#[test]
fn test_role_assignment() {
    let env = Env::default();
    let admin = Address::generate(&env);
    let user = Address::generate(&env);
    
    let ac_id = env.register_contract(None, AccessControlContract);
    let ac = AccessControlClient::new(&env, &ac_id);
    ac.initialize(&admin).unwrap();
    
    let role = Role {
        id: Symbol::short("admin"),
        name: String::from_slice(&env, &"Admin"),
    };
    
    ac.create_role(&role.id, &role.name).unwrap();
    ac.grant_role(&user, &role).unwrap();
    
    assert!(ac.has_role(&user, &role));
}
```

## Tips & Tricks

1. **Use Short Symbols**: Limited space in symbols, keep IDs short (`"admin"` not `"administrator"`)
2. **Consistent Naming**: Use same symbol IDs across all contracts for interoperability
3. **Cache Results**: Store role/permission checks to avoid repeated queries
4. **Batch Operations**: Group multiple permission checks into one call
5. **Clear Error Messages**: Include permission reason in logs for debugging

## Performance Notes

- Role checks: O(1) - Direct lookup
- Permission flattening: O(n) where n = number of user roles
- Batch permission checks: More efficient than individual checks
- Storage: Each role/permission costs minimal gas, no complex indexing needed

---

For more details, see [ACCESS_CONTROL_GUIDE.md](./ACCESS_CONTROL_GUIDE.md)
