# Quick Reference Guide: Notifications + Yield Vault

## Quick Start Checklist

- [ ] Read CROSS_CONTRACT_NOTIFICATIONS_IMPLEMENTATION.md
- [ ] Read YIELD_VAULT_IMPLEMENTATION.md
- [ ] Review INTEGRATION_GUIDE_NOTIFICATIONS_YIELD.md
- [ ] Run tests in contracts/tests/
- [ ] Deploy on testnet
- [ ] Integrate with your contract

## Contract Locations

```
contracts/
├── notification_broker/         # Central notification hub
│   └── src/
│       ├── lib.rs              # Main implementation
│       ├── errors.rs           # Error types
│       ├── events.rs           # Event emissions
│       └── storage.rs          # Data structures
│
├── notification_interface/      # Trait for receivers
│   └── src/
│       └── lib.rs              # Notification struct + trait
│
├── yield_vault/                # Multi-provider yield wrapper
│   └── src/
│       ├── lib.rs              # Main implementation
│       ├── events.rs           # Event emissions
│       └── storage.rs          # Data structures
│
├── aave_lending_pool/          # Mock Aave (interest-bearing)
├── stable_swap_pool/           # Mock Curve (stablecoin AMM)
└── liquidity_pool/             # Mock Uniswap (AMM)
```

## API Reference

### NotificationBroker

```rust
// Initialize broker
pub fn initialize(env: Env, admin: Address) -> Result<(), NotificationBrokerError>

// Get current admin
pub fn admin(env: Env) -> Result<Address, NotificationBrokerError>

// Subscribe to events
pub fn subscribe(
    env: Env,
    listener: Address,
    source: Address,
    event_type: Option<Symbol>
) -> Result<(), NotificationBrokerError>

// Unsubscribe from events
pub fn unsubscribe(
    env: Env,
    listener: Address,
    source: Address,
    event_type: Option<Symbol>
) -> Result<(), NotificationBrokerError>

// Emit notification to all subscribers
pub fn notify(
    env: Env,
    source: Address,
    notification: Notification
) -> Result<u32, NotificationBrokerError>

// Check subscription status
pub fn is_subscribed(
    env: Env,
    listener: Address,
    source: Address,
    event_type: Option<Symbol>
) -> Result<bool, NotificationBrokerError>

// Get all listeners for source
pub fn get_listeners_for_source(
    env: Env,
    source: Address
) -> Result<Vec<Address>, NotificationBrokerError>
```

### YieldVault

```rust
// Initialize vault
pub fn initialize(
    env: Env,
    admin: Address,
    asset: Address
) -> Result<(), Symbol>

// Register yield provider
pub fn register_provider(
    env: Env,
    name: Symbol,
    address: Address,
    priority: u32
) -> Result<u32, Symbol>

// Deposit tokens to vault
pub fn deposit(
    env: Env,
    amount: i128,
    user: Address
) -> Result<i128, Symbol>

// Withdraw tokens from vault
pub fn withdraw(
    env: Env,
    amount: i128,
    user: Address
) -> Result<i128, Symbol>

// Harvest yield from provider
pub fn harvest_yield(
    env: Env,
    provider_id: u32
) -> Result<i128, Symbol>

// Get user balance
pub fn balance_of(env: Env, user: Address) -> i128

// Get total vault AUM
pub fn get_total_aum(env: Env) -> i128

// Get total harvested yield
pub fn get_total_yield_harvested(env: Env) -> i128

// Get provider info
pub fn get_provider(
    env: Env,
    provider_id: u32
) -> Result<YieldProvider, Symbol>
```

## Common Patterns

### Pattern 1: Subscribe to Events

```rust
// Subscribe to all deposits
notification_broker.subscribe(
    my_address,
    yield_vault,
    None  // None = all events from yield_vault
)?;

// Subscribe to specific event type
notification_broker.subscribe(
    my_address,
    yield_vault,
    Some(Symbol::new(&env, "yield_harvested"))
)?;
```

### Pattern 2: Handle Notifications

```rust
// Implement in your contract
pub fn on_notify(notification: Notification) {
    if notification.event_type == Symbol::new(&env, "yield_harvested") {
        // Handle yield harvested
    }
}
```

### Pattern 3: Deposit and Track

```rust
// User deposits
yield_vault.deposit(amount, user)?;

// Listen for deposit event
// Your contract receives notification automatically
// Update internal state based on event data
```

### Pattern 4: Harvest and Distribute

```rust
// Admin harvests yield
let yield_earned = yield_vault.harvest_yield(provider_id)?;

// Notification sent to all subscribers
// Distributor contract receives event
// Calculates and sends shares to users
```

## Event Data Structures

### Notification
```rust
pub struct Notification {
    pub source: Address,        // Who emitted (e.g., YieldVault)
    pub event_type: Symbol,     // What happened (e.g., "deposit")
    pub data: Bytes,            // Event details (encoded)
}
```

### YieldProvider
```rust
pub struct YieldProvider {
    pub id: u32,
    pub name: Symbol,
    pub address: Address,
    pub priority: u32,
    pub total_deposited: i128,
    pub total_withdrawn: i128,
    pub total_yield_earned: i128,
    pub is_active: bool,
}
```

## Error Codes

### NotificationBrokerError
```
NotInitialized          - Broker not initialized
AlreadyInitialized      - Already initialized
SubscriptionNotFound    - Subscription doesn't exist
```

### YieldVault Errors (as Symbol)
```
"already_initialized"    - Vault already initialized
"not_initialized"        - Vault not initialized
"invalid_amount"         - Invalid deposit/withdrawal amount
"insufficient_balance"   - User balance too low
"provider_not_found"     - Provider doesn't exist
"no_providers_available" - No active providers
```

## Gas Estimates (Approximate)

| Operation | Gas Cost |
|-----------|----------|
| Initialize Broker | 2,500 |
| Subscribe | 3,500 |
| Notify (1 listener) | 4,000 |
| Notify (10 listeners) | 15,000 |
| Deposit (Yield Vault) | 5,000 |
| Withdraw (Yield Vault) | 4,000 |
| Harvest Yield | 3,000 |

## Common Mistakes to Avoid

❌ **Mistake 1**: Forgetting to implement `on_notify` trait
```rust
// Wrong: Contract doesn't implement receiver trait
pub struct MyContract;

// Right: Implement NotificationReceiverTrait
pub struct MyContract;
#[contractimpl]
impl NotificationReceiverTrait for MyContract {
    pub fn on_notify(notification: Notification) { ... }
}
```

❌ **Mistake 2**: Subscribing to wrong address
```rust
// Wrong: Listener is the vault (should be caller)
broker.subscribe(yield_vault_address, yield_vault_address, None)?;

// Right: Listener is your contract
broker.subscribe(my_contract_address, yield_vault_address, None)?;
```

❌ **Mistake 3**: Not handling event decoding
```rust
// Wrong: Assuming data format without decoding
let amount = notification.data as i128;

// Right: Properly decode event data
let (user, amount, provider_id) = decode_deposit_data(notification.data)?;
```

❌ **Mistake 4**: No error handling in notification
```rust
// Wrong: Panic on error in notification handler
pub fn on_notify(notification: Notification) {
    let data = decode(notification.data).unwrap(); // Panics!
}

// Right: Handle errors gracefully
pub fn on_notify(notification: Notification) {
    match decode(notification.data) {
        Ok(data) => { /* process */ }
        Err(_) => { /* handle error */ }
    }
}
```

## Testing Examples

### Test 1: Basic Subscription

```rust
#[test]
fn test_subscribe() {
    let env = Env::default();
    let broker = NotificationBrokerContract::new();
    
    broker.initialize(admin)?;
    broker.subscribe(listener, source, None)?;
    assert!(broker.is_subscribed(listener, source, None)?);
}
```

### Test 2: Notification Delivery

```rust
#[test]
fn test_notify() {
    let env = Env::default();
    
    // Setup
    broker.subscribe(listener, source, Some("event"))?;
    
    // Emit notification
    let count = broker.notify(
        source,
        Notification {
            source,
            event_type: "event",
            data: Bytes::from_slice(&env, &[1,2,3])
        }
    )?;
    
    // Should notify 1 listener
    assert_eq!(count, 1);
}
```

### Test 3: Vault Deposit

```rust
#[test]
fn test_vault_deposit() {
    let env = Env::default();
    
    // Setup
    vault.initialize(admin, asset)?;
    vault.register_provider("aave", aave_addr, 100)?;
    
    // Deposit
    vault.deposit(1000, user)?;
    
    // Verify
    assert_eq!(vault.balance_of(user), 1000);
    assert_eq!(vault.get_total_aum(), 1000);
}
```

## Deployment Checklist

- [ ] Deploy NotificationInterface
- [ ] Deploy NotificationBroker
  - [ ] Initialize with admin
- [ ] Deploy YieldVault
  - [ ] Initialize with admin and asset
  - [ ] Register all providers
- [ ] Deploy Analytics Service
  - [ ] Implement on_notify
  - [ ] Subscribe to YieldVault
- [ ] Deploy Rewards Distributor
  - [ ] Implement on_notify
  - [ ] Subscribe to YieldVault
- [ ] Integrate with CrowdfundVault
- [ ] Run integration tests
- [ ] Security audit
- [ ] Deploy to mainnet

## Useful Commands

```bash
# Build contracts
cd apps/onchain
cargo build --release

# Run tests
cargo test

# Deploy to local network
soroban contract deploy \
  --wasm apps/onchain/contracts/notification_broker/target/wasm32-unknown-unknown/release/notification_broker.wasm

# Invoke contract
soroban contract invoke --id CONTRACT_ID --fn initialize

# Check contract state
soroban contract read-state --id CONTRACT_ID
```

## Documentation Files

| File | Purpose |
|------|---------|
| CROSS_CONTRACT_NOTIFICATIONS_IMPLEMENTATION.md | Full notifications spec |
| YIELD_VAULT_IMPLEMENTATION.md | Full vault spec |
| INTEGRATION_GUIDE_NOTIFICATIONS_YIELD.md | How to use together |
| QUICK_REFERENCE.md | This file |

## FAQ

**Q: Can I subscribe to multiple event types?**
A: Yes, call subscribe() multiple times with different event_type.

**Q: What happens if a listener fails?**
A: Notification delivery continues to other listeners (best-effort).

**Q: How do I calculate my yield share?**
A: `user_share = (user_balance * 10000) / total_aum; yield_claim = (total_yield * user_share) / 10000`

**Q: Can I unsubscribe?**
A: Yes, call unsubscribe() with same parameters as subscribe().

**Q: What if a provider becomes inactive?**
A: New deposits go to next priority provider; existing funds stay in inactive provider.

**Q: How often should I harvest?**
A: Daily or weekly; depends on yield rate and gas costs.

## Support

- **Issues**: GitHub Issues
- **Discussions**: GitHub Discussions
- **Examples**: See `contracts/tests/`
- **Docs**: See markdown files in apps/onchain/

## License

MIT License - See LICENSE file
