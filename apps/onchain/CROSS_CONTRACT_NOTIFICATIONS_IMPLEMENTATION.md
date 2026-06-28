# #587 Cross-Contract Event Notification System

## Overview

This document describes the implementation of a **Cross-Contract Event Notification System** for Soroban smart contracts. The system enables contracts to signal state changes to each other efficiently without tight coupling, following a publish-subscribe pattern.

## Architecture

### Core Components

#### 1. **NotificationBroker Contract**
- **Location**: `contracts/notification_broker/src/lib.rs`
- **Purpose**: Central hub for managing subscriptions and routing notifications
- **Key Features**:
  - Reentrancy-safe operations using guard mechanism
  - Subscribe/unsubscribe management
  - Notification routing with best-effort delivery
  - Query subscription status

#### 2. **NotificationInterface Contract**
- **Location**: `contracts/notification_interface/src/lib.rs`
- **Purpose**: Defines the standard interface for notification receivers
- **Components**:
  ```rust
  pub struct Notification {
      pub source: Address,      // Contract that emitted the event
      pub event_type: Symbol,   // Type of event (e.g., "vault_deposit", "yield_accrued")
      pub data: Bytes,          // Encoded event data
  }
  
  pub trait NotificationReceiverTrait {
      fn on_notify(env: Env, notification: Notification);
  }
  ```

### Data Models

#### Subscription Storage
```rust
pub struct ListenerSubscription {
    pub listener: Address,              // Contract to notify
    pub source: Address,                // Contract to listen to
    pub event_type: Option<Symbol>,     // Specific event or None for all
    pub timestamp: u64,                 // When subscribed
}
```

#### Storage Keys
- `Admin`: Contract administrator
- `Subscription(listener, source, event_type)`: Individual subscription
- `ListenersForSource(source)`: All listeners for a source (for efficient routing)

### Usage Pattern

#### Step 1: Initialize Broker
```
NotificationBroker.initialize(env, admin_address)
```

#### Step 2: Subscribe
```
NotificationBroker.subscribe(
    listener: ContractB,
    source: ContractA,
    event_type: Some("state_change")  // or None for all events
)
```

#### Step 3: Emit Notification
```
NotificationBroker.notify(
    source: ContractA,
    notification: Notification {
        source: ContractA,
        event_type: "state_change",
        data: encoded_data
    }
)
```

#### Step 4: Receive Notification
ContractB must implement:
```rust
pub fn on_notify(notification: Notification) {
    // Handle notification based on event_type
}
```

## Key Features

### 1. Flexible Subscription Model
- **Specific Events**: Subscribe to particular event types
- **Wildcard Events**: Subscribe to all events from a source (`event_type = None`)
- **Multiple Sources**: A listener can subscribe to multiple sources

### 2. Reentrancy Protection
- Uses `reentrancy-guard` contract to prevent reentrancy attacks
- All state-modifying operations are guarded
- Safe for nested contract calls

### 3. Best-Effort Delivery
- Notifies all eligible listeners
- If one listener fails, continues notifying others
- Tracks notification count for monitoring

### 4. Efficient Routing
- Maintains `ListenersForSource` cache for fast lookup
- Avoids scanning all subscriptions on each notification
- Linear time complexity: O(n) where n = listeners for source

### 5. Event Queries
- Check if listener is subscribed: `is_subscribed(listener, source, event_type)`
- Get all listeners for source: `get_listeners_for_source(source)`

## Integration with Yield Vault

The NotificationBroker can integrate with YieldVault to emit events like:

```
Event: "deposit" → when user deposits
Event: "withdrawal" → when user withdraws
Event: "yield_harvested" → when yield is harvested from provider
```

Example integration in YieldVault:

```rust
// In deposit() method
NotificationBroker.notify(
    env,
    yield_vault_address,
    Notification {
        source: yield_vault_address,
        event_type: Symbol::new(&env, "deposit"),
        data: encode_deposit_event(user, amount, provider_id)
    }
)
```

## Events

### InitializedEvent
```rust
pub fn emit_initialized(admin: Address)
```

### SubscriptionEvent
```rust
pub fn emit_subscription(
    listener: Address,
    source: Address,
    event_type: Option<Symbol>,
    action: Symbol  // "subscribe" or "unsubscribe"
)
```

### NotificationEmittedEvent
```rust
pub fn emit_notification_emitted(
    source: Address,
    event_type: Symbol,
    notified_count: u32
)
```

## Error Handling

```rust
pub enum NotificationBrokerError {
    NotInitialized,           // Broker not initialized
    AlreadyInitialized,       // Already initialized (prevents re-init)
    SubscriptionNotFound,     // Subscription doesn't exist for unsubscribe
}
```

## Storage Layout

### Instance Storage (Fast Access)
- `Admin`: Single admin address

### Persistent Storage (For Subscriptions)
- `Subscription(...)`: Individual subscription records
- `ListenersForSource(source)`: Vector of listeners for efficient routing

### Cleanup Strategy
- Subscriptions are bumped with 100/1,000,000 TTL
- Active subscriptions are maintained; unsubscribed ones are removed

## Performance Characteristics

| Operation | Time Complexity | Space | Notes |
|-----------|-----------------|-------|-------|
| Subscribe | O(n) | O(1) | n = current listeners |
| Unsubscribe | O(1) | O(1) | Direct removal |
| Notify | O(m) | O(1) | m = eligible listeners |
| Query subscription | O(1) | O(1) | Direct lookup |

## Security Considerations

1. **Reentrancy**: Protected via reentrancy guard
2. **Authorization**: Source must call `require_auth()` to emit
3. **Best-Effort**: Failures in receivers don't prevent other notifications
4. **No Forced Participation**: Contracts can opt-out by unsubscribing

## Testing Strategy

1. **Unit Tests**: Test individual functions (subscribe, unsubscribe, notify)
2. **Integration Tests**: Test multi-contract communication
3. **Reentrancy Tests**: Verify guard works correctly
4. **Event Tests**: Verify events are emitted correctly

## Future Enhancements

1. **Priority-based Notifications**: Route high-priority events first
2. **Batched Notifications**: Group multiple events for efficiency
3. **Event History**: Store recent events for querying
4. **Subscription Filters**: More complex event filtering criteria
5. **Gas Optimization**: Batch listener notifications in single tx

## Deployment Checklist

- [x] NotificationBroker contract implemented
- [x] NotificationInterface contract implemented
- [x] Error handling defined
- [x] Events defined
- [x] Storage layout optimized
- [ ] Integration tests written
- [ ] Documentation examples created
- [ ] Audit completed
