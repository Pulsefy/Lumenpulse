# NotificationBroker Events and Backend Mapping

This document describes the events emitted by the `notification_broker` contract and their expected mapping in the backend's `soroban-event-mapper.ts`.

## Emitted Events

### 1. InitializedEvent

**Emitted by:** `initialize(env, admin)` function

**Event Structure:**

```rust
pub struct InitializedEvent {
    pub admin: Address,
}
```

**Soroban SDK Name:** `InitializedEvent`

**Purpose:** Signals that the notification broker has been initialized with an admin account.

**Backend Mapping Expectation:**

- **Event Type:** Should map to a canonical event type (suggested: `ADMIN_ASSIGNED`, `BROKER_INITIALIZED`, or `NOTIF_BROKER_INIT`)
- **Category:** System initialization event
- **Topics (indexed):** None (no `#[topic]` attributes)
- **Fields (unindexed):** `admin` (Address)

**Example Mapping Entry:**

```typescript
'InitializedEvent': {
  canonicalType: 'BROKER_INITIALIZED',
  category: 'SYSTEM_ADMIN'
}
```

---

### 2. SubscriptionEvent

**Emitted by:** `subscribe()` and `unsubscribe()` functions

**Event Structure:**

```rust
pub struct SubscriptionEvent {
    #[topic]
    pub listener: Address,
    #[topic]
    pub source: Address,
    pub event_type: Option<Symbol>,
    pub action: Symbol,  // "subscribe" or "unsubscribe"
}
```

**Soroban SDK Name:** `SubscriptionEvent`

**Purpose:** Signals a subscription state change in the notification broker.

**Topics (indexed, used for efficient querying):**

- `listener` (Address) - The contract that will/did listen for events
- `source` (Address) - The contract whose events are being subscribed to

**Fields (unindexed):**

- `event_type` (Option<Symbol>) - Specific event type subscribed to, or None for all events from source
- `action` (Symbol) - Either "subscribe" or "unsubscribe" indicating the operation

**Backend Mapping Expectation:**

- **Event Type:** Should map to subscription-related canonical types (suggested: `SUBSCRIPTION_CREATED`, `SUBSCRIPTION_REMOVED`, or `NOTIF_SUBSCRIPTION_CHANGED`)
- **Category:** Configuration or admin event
- **Indexed Fields:** listener, source (enable efficient blockchain queries by these addresses)
- **Unindexed Fields:** event_type, action

**Examples:**

- Subscribing to "deposit" events from YieldVault: `action="subscribe"`, `event_type="deposit"`, `source=<yield_vault_addr>`, `listener=<analytics_addr>`
- Wildcard subscription: `action="subscribe"`, `event_type=None`, `source=<contract_addr>`, `listener=<listener_addr>`
- Unsubscribe: `action="unsubscribe"`, same structure as subscribe

**Example Mapping Entry:**

```typescript
'SubscriptionEvent': {
  canonicalType: 'SUBSCRIPTION_CHANGED',
  category: 'CONFIG_CHANGE'
}
```

**Important Note:** The backend may want to differentiate between subscribe/unsubscribe actions by examining the `action` field. Consider having separate canonical types or a flag in the mapped event.

---

### 3. NotificationEmittedEvent

**Emitted by:** `notify(env, source, notification)` function

**Event Structure:**

```rust
pub struct NotificationEmittedEvent {
    #[topic]
    pub source: Address,
    pub event_type: Symbol,
    pub notified_count: u32,
}
```

**Soroban SDK Name:** `NotificationEmittedEvent`

**Purpose:** Signals that notifications have been dispatched to subscribers.

**Topics (indexed, used for efficient querying):**

- `source` (Address) - The contract that emitted the notification

**Fields (unindexed):**

- `event_type` (Symbol) - The type of notification (e.g., "deposit", "withdraw", "harvest")
- `notified_count` (u32) - Number of subscribers that were notified

**Backend Mapping Expectation:**

- **Event Type:** Should map to notification-related canonical types (suggested: `NOTIFICATION_SENT`, `EVENT_DISPATCHED`, or `NOTIF_EMITTED`)
- **Category:** Activity or audit event
- **Indexed Fields:** source (enables efficient querying by source contract)
- **Unindexed Fields:** event_type, notified_count

**Use Cases in Backend:**

- Audit trail: Track which contracts are emitting cross-contract notifications
- Analytics: Monitor notification dispatch patterns and subscriber counts
- Debugging: Verify that notifications are reaching expected subscriber counts

**Example Scenarios:**

- YieldVault emits "deposit" event, 3 listeners notified: `source=<yield_vault_addr>`, `event_type="deposit"`, `notified_count=3`
- Source with no active subscribers: `notified_count=0`
- Source with failed delivery (best-effort): Still counts in `notified_count` if subscription existed and was attempted

**Example Mapping Entry:**

```typescript
'NotificationEmittedEvent': {
  canonicalType: 'NOTIFICATION_SENT',
  category: 'ACTIVITY'
}
```

---

## Backend Integration: soroban-event-mapper.ts

### Required Additions to RAW_EVENT_MAP

The backend's `RAW_EVENT_MAP` in `soroban-event-mapper.ts` should include entries for these three events:

```typescript
// In soroban-event-mapper.ts

export const RAW_EVENT_MAP: Record<string, CanonicalMapping> = {
  // ... existing entries ...

  // NotificationBroker events
  InitializedEvent: {
    canonicalType: "BROKER_INITIALIZED",
    category: "SYSTEM_ADMIN",
  },
  SubscriptionEvent: {
    canonicalType: "SUBSCRIPTION_CHANGED",
    category: "CONFIG_CHANGE",
  },
  NotificationEmittedEvent: {
    canonicalType: "NOTIFICATION_SENT",
    category: "ACTIVITY",
  },

  // ... more entries ...
};
```

### Event Payload Extraction

When the backend processes these events, it should extract:

**InitializedEvent payload:**

```typescript
{
  admin: string(Address);
}
```

**SubscriptionEvent payload:**

```typescript
{
  listener: string (Address),
  source: string (Address),
  event_type: string | null (Symbol or None),
  action: string (Symbol, "subscribe" or "unsubscribe")
}
```

**NotificationEmittedEvent payload:**

```typescript
{
  source: string (Address),
  event_type: string (Symbol),
  notified_count: number (u32)
}
```

### Testing the Mapping

The backend test suite (`soroban-event-mapper.spec.ts`) should include test cases for:

1. **InitializedEvent mapping:**
   - Verify `InitializedEvent` string maps to `BROKER_INITIALIZED`
   - Verify category is `SYSTEM_ADMIN`

2. **SubscriptionEvent mapping:**
   - Verify `SubscriptionEvent` string maps to `SUBSCRIPTION_CHANGED`
   - Verify category is `CONFIG_CHANGE`
   - Parse and validate indexed fields (listener, source)
   - Parse and validate unindexed fields (event_type, action)

3. **NotificationEmittedEvent mapping:**
   - Verify `NotificationEmittedEvent` string maps to `NOTIFICATION_SENT`
   - Verify category is `ACTIVITY`
   - Parse and validate indexed field (source)
   - Parse and validate unindexed fields (event_type, notified_count)

---

## Acceptance Criteria Verification

This document supports the following acceptance criteria from the task:

✅ **"The emitted events match what `soroban-event-mapper.ts` expects, and the mapping is noted in the PR."**

- [x] All three events are properly documented
- [x] Event structures are clearly defined with Rust signatures
- [x] Backend mapping requirements are specified
- [x] Field types and indexed/unindexed status are noted
- [x] Example mapping entries provided
- [x] Test cases for the mapping are suggested

---

## Cross-Contract Notification Flow with Events

Here's how events flow through the system:

```
1. Contract A calls notify()
   ↓
2. NotificationBroker emits NotificationEmittedEvent
   - source = Contract A
   - event_type = "deposit" (or other)
   - notified_count = number of listeners
   ↓
3. For each listener subscription:
   - When subscribed: SubscriptionEvent emitted
     - listener = ListenerContract
     - source = ContractA
     - action = "subscribe"
   - When listener.on_notify() is called (inside notify())
   ↓
4. Backend soroban-event-mapper processes events
   - Maps event names to canonical types
   - Stores indexed fields for efficient querying
   - Records activity trail
   ↓
5. Backend indexer records:
   - Subscription changes for tracking listener registration
   - Notification dispatch patterns and metrics
```

---

## Notes for PR Review

When reviewing the PR:

1. **Event Emission:** Verify in contract tests that events are emitted at the correct times
2. **Event Payload:** Confirm that NotificationEmittedEvent accurately reflects the number of listeners notified
3. **Indexed Fields:** Confirm that topics are correctly used for efficient querying
4. **Best-Effort Delivery:** Verify that NotificationEmittedEvent.notified_count includes all subscription attempts, even failed deliveries
5. **Backend Integration:** Ensure soroban-event-mapper.ts will add the mapping entries and tests

---

## Related Documentation

- [CROSS_CONTRACT_NOTIFICATIONS_IMPLEMENTATION.md](../CROSS_CONTRACT_NOTIFICATIONS_IMPLEMENTATION.md) - Overall architecture
- [INTEGRATION_GUIDE_NOTIFICATIONS_YIELD.md](../INTEGRATION_GUIDE_NOTIFICATIONS_YIELD.md) - Real-world integration example
- [notification_broker contract source](./src/lib.rs)
- [Backend event mapper](../../apps/backend/src/soroban-events/soroban-event-mapper.ts)
