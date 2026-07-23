# Event Versioning Guide

Every Soroban contract that emits events **must** follow the canonical versioning
pattern described below. This allows backend and data-processing consumers to
detect schema changes and evolve safely.

## Canonical Pattern

### 1. Declare an `EVENT_VERSION` constant

```rust
/// Current schema version for every event emitted by this contract.
/// Bump this when any event's fields are added, removed, or re-ordered.
pub const EVENT_VERSION: u32 = 1;
```

### 2. Each event struct includes `version` as its first data field

```rust
#[contractevent]
pub struct SomeEvent {
    pub version: u32,   // ← always first
    // ... business fields
}
```

The `version` field comes **after** any `#[topic]` attributes (topics are
indexed separately by the Soroban host) but is the first non-topic field:

```rust
#[contractevent]
pub struct SomeEvent {
    #[topic]
    pub entity_id: u64,
    pub version: u32,       // ← first data field
    pub amount: i128,
}
```

### 3. Publish helpers fill `version` automatically

```rust
pub fn emit_some_event(env: &Env, entity_id: u64, amount: i128) {
    SomeEvent {
        version: EVENT_VERSION,
        entity_id,
        amount,
    }
    .publish(env);
}
```

Do **not** let callers choose the version — it is always hardcoded to
`EVENT_VERSION` at compile time.

### 4. Expose a `get_event_version` query

Add a read-only function to the contract impl:

```rust
pub fn get_event_version(_env: Env) -> u32 {
    events::EVENT_VERSION
}
```

Consumers call this at startup to verify their parser is up to date.

## Bumping the Version

Increment `EVENT_VERSION` when you:

- Add a new field to an existing event.
- Remove a field from an existing event.
- Rename or re-order fields of an existing event.

Do **not** bump the version when:

- Adding a **new** event type (each struct is independently identified by the
  Soroban host via its topic symbol).
- Changing only field *values* but not the schema.

## How Consumers Detect Schema Changes

1. On startup the consumer calls `contract.get_event_version()`.
2. It compares the returned version with the version its parser expects.
3. If they differ the consumer can log a warning, reject processing, or load a
   different parser — whichever is appropriate.
4. Every received event also carries `version` in its data body, so a consumer
   that processes events asynchronously (e.g. from an indexer) can validate
   each event individually.

## Adding a New Event

1. Add the new struct in `events.rs` with `pub version: u32` as the first
   non-topic field.
2. Add a `pub fn emit_*` helper that fills `version: EVENT_VERSION`.
3. Call the helper from `lib.rs` at the appropriate emission point.
4. No version bump needed — the new event is a distinct type from the
   consumer's perspective.

## Example: Before and After

### Before (no versioning)

```rust
#[contractevent]
pub struct TokensClaimedEvent {
    #[topic]
    pub beneficiary: Address,
    pub amount_claimed: i128,
    pub remaining: i128,
}
```

### After (canonical pattern)

```rust
pub const EVENT_VERSION: u32 = 1;

#[contractevent]
pub struct TokensClaimedEvent {
    pub version: u32,
    #[topic]
    pub beneficiary: Address,
    pub amount_claimed: i128,
    pub remaining: i128,
}

pub fn publish_tokens_claimed(env: &Env, beneficiary: Address, amount_claimed: i128, remaining: i128) {
    TokensClaimedEvent {
        version: EVENT_VERSION,
        beneficiary,
        amount_claimed,
        remaining,
    }
    .publish(env);
}
```
