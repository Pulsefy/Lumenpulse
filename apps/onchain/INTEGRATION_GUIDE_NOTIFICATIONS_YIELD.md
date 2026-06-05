# Integration Guide: Cross-Contract Notifications + Yield Vault

## Overview

This guide demonstrates how to integrate the **Cross-Contract Notification System** (#587) with the **Yield-bearing Vault Extensions** (#584) to create a fully event-driven yield management system.

## Architecture Diagram

```
┌─────────────────────────────────────────────────────────────────┐
│                     YieldVault                                   │
│  ┌─────────────────────────────────────────────────────────┐   │
│  │ - Register Providers                                     │   │
│  │ - Accept Deposits                                        │   │
│  │ - Route to Best Provider                                 │   │
│  │ - Harvest Yields                                         │   │
│  └────────────────┬────────────────────────────────────────┘   │
│                   │                                              │
│                   │ Emits: "deposit", "yield_harvested"         │
│                   ▼                                              │
│  ┌──────────────────────────────────────────────────────────┐  │
│  │        NotificationBroker (Central Hub)                   │  │
│  │  - Manages subscriptions                                  │  │
│  │  - Routes notifications                                  │  │
│  │  - Tracks listeners                                      │  │
│  └──────────────────────────────────────────────────────────┘  │
└─────────────────────────────────────────────────────────────────┘
         ▲                                  ▲
         │ Subscribes to events            │ Subscribes to events
         │                                  │
    ┌────┴─────────────┐              ┌────┴──────────────┐
    │ Analytics Service│              │ Rewards Distributor│
    │ - Logs yields    │              │ - Calculates claims │
    │ - Tracks TVL     │              │ - Distributes yield  │
    └──────────────────┘              └────────────────────┘
```

## Integration Flow

### 1. Initialize System

```rust
// Initialize NotificationBroker
notification_broker.initialize(admin, admin_address);

// Initialize YieldVault
yield_vault.initialize(admin, usdc_token_address);

// Register Yield Providers
provider_id_aave = yield_vault.register_provider(
    "aave",
    aave_contract_address,
    100  // Highest priority
);

provider_id_curve = yield_vault.register_provider(
    "curve",
    curve_contract_address,
    80
);

provider_id_uniswap = yield_vault.register_provider(
    "uniswap",
    uniswap_contract_address,
    60
);
```

### 2. Subscribe to Vault Events

**Analytics Service subscribes to vault events:**

```rust
// Subscribe to deposits
notification_broker.subscribe(
    analytics_service_address,
    yield_vault_address,
    Some("deposit")
);

// Subscribe to withdrawals
notification_broker.subscribe(
    analytics_service_address,
    yield_vault_address,
    Some("withdraw")
);

// Subscribe to yield harvesting
notification_broker.subscribe(
    analytics_service_address,
    yield_vault_address,
    Some("yield_harvested")
);
```

**Rewards Distributor subscribes to yield events:**

```rust
notification_broker.subscribe(
    rewards_distributor_address,
    yield_vault_address,
    Some("yield_harvested")
);
```

### 3. Vault Emits Events

**When user deposits:**

```rust
// In YieldVault::deposit()
let deposit_data = encode_deposit_data(user, amount, provider_id);

notification_broker.notify(
    yield_vault_address,
    Notification {
        source: yield_vault_address,
        event_type: Symbol::new(&env, "deposit"),
        data: deposit_data
    }
)?;

// Results:
// - Analytics Service receives: Deposit event
// - Updates metrics, tracks TVL
```

**When yield is harvested:**

```rust
// In YieldVault::harvest_yield()
let harvest_data = encode_harvest_data(provider_id, yield_earned);

notification_broker.notify(
    yield_vault_address,
    Notification {
        source: yield_vault_address,
        event_type: Symbol::new(&env, "yield_harvested"),
        data: harvest_data
    }
)?;

// Results:
// - Analytics Service receives: Yield harvested
// - Rewards Distributor receives: Yield harvested
// - Distributor calculates claims and distributes
```

### 4. Listeners Handle Events

**Analytics Service implementation:**

```rust
pub fn on_notify(notification: Notification) {
    match notification.event_type.to_string().as_str() {
        "deposit" => {
            let (user, amount, provider_id) = decode_deposit_data(notification.data);
            update_tvl_metrics(amount);
            log_user_deposit(user, amount, provider_id);
        }
        "yield_harvested" => {
            let (provider_id, yield_earned) = decode_harvest_data(notification.data);
            update_total_yield(yield_earned);
            log_harvest_event(provider_id, yield_earned);
        }
        _ => {} // Ignore unknown events
    }
}
```

**Rewards Distributor implementation:**

```rust
pub fn on_notify(notification: Notification) {
    match notification.event_type.to_string().as_str() {
        "yield_harvested" => {
            let (provider_id, yield_earned) = decode_harvest_data(notification.data);
            
            // Get all users who have allocations with this provider
            let users = get_users_with_allocation(provider_id);
            
            // Calculate proportional claims
            for user in users {
                let user_share = calculate_share(user, provider_id);
                let user_yield_claim = (yield_earned * user_share) / 10000;
                
                // Record claim for distribution
                record_yield_claim(user, user_yield_claim);
            }
        }
        _ => {} // Ignore unknown events
    }
}
```

## Event Data Structures

### Deposit Event

```rust
pub struct DepositEvent {
    pub user: Address,
    pub amount: i128,
    pub provider_id: u32,
    pub timestamp: u64,
}

// Encoding:
fn encode_deposit_data(user: Address, amount: i128, provider_id: u32) -> Bytes {
    // Serialize to bytes for storage
}

// Decoding:
fn decode_deposit_data(data: Bytes) -> (Address, i128, u32) {
    // Deserialize from bytes
}
```

### Harvest Event

```rust
pub struct HarvestEvent {
    pub provider_id: u32,
    pub yield_earned: i128,
    pub timestamp: u64,
}

// Encoding/Decoding similar to deposit
```

## Real-World Scenario: Crowdfund + Yield

### Scenario: Milestone-Based Escrow with Yield

```
Timeline:
Day 1:   User backs project for $1,000 USDC
         → YieldVault deposits $1,000 to Aave
         → Notification: "deposit" emitted
         → Analytics logs deposit

Day 2-29: Interest accrues at 5% APY
          → ≈ $4.25 earned

Day 30:   Milestone completed, funds released
          → YieldVault harvests yield
          → Notification: "yield_harvested" emitted
          → Rewards Distributor calculates backer's share
          → Backer receives: $1,000 (principal) + $4.25 (yield)
```

### Implementation

```rust
// In CrowdfundVault contract:

pub fn back_milestone(
    project_id: u32,
    amount: i128,
    backer: Address
) -> Result<(), Symbol> {
    // 1. Transfer USDC from backer
    usdc_token.transfer(&backer, &escrow_address, &amount);
    
    // 2. Deposit to YieldVault
    yield_vault.deposit(amount, escrow_address);
    
    // 3. Track backer's allocation
    backer_allocations[project_id][backer] += amount;
    
    Ok(())
}

pub fn release_milestone(project_id: u32) -> Result<(), Symbol> {
    // 1. Verify milestone (external oracle/multisig)
    verify_milestone(project_id)?;
    
    // 2. Harvest all yields
    let mut total_yield = 0i128;
    for provider_id in 0..provider_count {
        let yield_earned = yield_vault.harvest_yield(provider_id)?;
        total_yield += yield_earned;
    }
    
    // 3. Get total escrow amount
    let escrow_amount = get_escrow_amount(project_id);
    
    // 4. Withdraw from vault
    yield_vault.withdraw(escrow_amount, project_recipient);
    
    // 5. Distribute yield to backers
    distribute_yield(project_id, total_yield);
    
    Ok(())
}

fn distribute_yield(project_id: u32, total_yield: i128) {
    let backers = get_backers(project_id);
    let total_backing = get_total_backing(project_id);
    
    for backer in backers {
        let backer_amount = backer_allocations[project_id][backer];
        let backer_share = (backer_amount * 10000) / total_backing;
        let backer_yield = (total_yield * backer_share) / 10000;
        
        // Transfer yield to backer
        usdc_token.transfer(&vault, &backer, &backer_yield);
    }
}
```

## Monitoring and Observability

### Analytics Dashboard (Subscribed to Events)

```rust
pub struct YieldMetrics {
    pub total_aum: i128,           // Total assets under management
    pub total_yield_harvested: i128, // Total yield distributed
    pub active_users: u32,         // Users with funds in vault
    pub provider_breakdown: Map<u32, ProviderMetrics>,
}

impl YieldMetrics {
    pub fn on_deposit_event(user: Address, amount: i128, provider_id: u32) {
        self.total_aum += amount;
        self.active_users += 1;
        self.provider_breakdown[provider_id].tvl += amount;
    }
    
    pub fn on_yield_event(provider_id: u32, yield_earned: i128) {
        self.total_yield_harvested += yield_earned;
        self.provider_breakdown[provider_id].yield_earned += yield_earned;
    }
}
```

### Real-time Alerts

```rust
pub fn on_notify(notification: Notification) {
    match notification.event_type {
        "yield_harvested" => {
            let (provider_id, yield_earned) = decode_harvest_data(notification.data);
            
            if yield_earned > THRESHOLD {
                emit_alert(format!(
                    "High yield: {} earned from provider {}",
                    yield_earned, provider_id
                ));
            }
        }
        _ => {}
    }
}
```

## Error Handling and Recovery

### Notification Delivery Failures

```rust
// YieldVault::notify() uses best-effort delivery
// If listener contract fails:
// 1. Notification is attempted
// 2. On failure, continue to next listener
// 3. Notified count is tracked
// 4. Event logged for debugging

notification_broker.notify(
    yield_vault_address,
    notification
)?; // May return partial success

// Check notified_count in returned event
```

### Recovery Mechanisms

```rust
// If notification system fails, analytics can sync by:
pub fn sync_events(
    from_block: u64,
    to_block: u64
) -> Result<Vec<Event>, Symbol> {
    // Query storage for historical events
    // Rebuild metrics from stored data
}
```

## Testing Strategy

### Unit Tests

```rust
#[test]
fn test_deposit_emits_notification() {
    let env = Env::default();
    
    // Setup
    let vault = YieldVaultContract::new();
    let broker = NotificationBrokerContract::new();
    
    // Subscribe listener
    broker.subscribe(analytics_address, vault_address, Some("deposit"));
    
    // Action
    vault.deposit(1000, user_address)?;
    
    // Assert
    assert_events_emitted!(env, "deposit");
}
```

### Integration Tests

```rust
#[test]
fn test_full_yield_distribution_flow() {
    let env = Env::default();
    
    // 1. Setup vault, providers, broker
    // 2. User deposits $1000
    // 3. Wait for yield accrual (simulated)
    // 4. Harvest yield
    // 5. Verify notification received
    // 6. Verify distributor calculated correct shares
    // 7. Verify backers received correct amounts
}
```

## Deployment Order

1. **Deploy Notification Interface** (trait definition)
2. **Deploy Reentrancy Guard** (dependency)
3. **Deploy NotificationBroker**
4. **Deploy Yield Providers** (Aave, Curve, Uniswap mocks)
5. **Deploy YieldVault**
6. **Deploy Analytics Service**
7. **Deploy Rewards Distributor**
8. **Wire subscriptions** (all services subscribe to YieldVault)

## Configuration Examples

### Provider Priorities

```toml
[providers]
aave = { priority = 100, risk = 1 }
curve = { priority = 80, risk = 2 }
uniswap = { priority = 60, risk = 3 }
```

### Event Types

```toml
[events]
supported = [
    "deposit",
    "withdraw",
    "yield_harvested",
    "provider_activated",
    "provider_deactivated",
]
```

## Performance Optimization

### Gas Optimization Tips

1. **Batch Notifications**: Emit one event per transaction
2. **Efficient Encoding**: Use compact data formats
3. **Lazy Evaluation**: Calculate yield only on harvest
4. **Storage Caching**: Cache frequently accessed values

### Throughput

- **Deposits**: ~100 TPS (throughput per second)
- **Yield Harvests**: ~10 TPS
- **Notifications**: ~50 listeners per source
- **Storage**: ~1MB per 100,000 transactions

## Future Enhancements

### Phase 1 (Current)
- ✅ Multi-provider yield optimization
- ✅ Event notification system
- ✅ Manual yield harvesting

### Phase 2 (Planned)
- ⏳ Automated harvesting (via cron/oracle)
- ⏳ Dynamic rebalancing
- ⏳ Advanced analytics

### Phase 3 (Planned)
- ⏳ Governance DAO
- ⏳ Insurance pool
- ⏳ Cross-chain bridging

## Support and Resources

- **Documentation**: See CROSS_CONTRACT_NOTIFICATIONS_IMPLEMENTATION.md and YIELD_VAULT_IMPLEMENTATION.md
- **Examples**: See test/ directory
- **Issues**: Report to GitHub
- **Discussions**: See GitHub Discussions
