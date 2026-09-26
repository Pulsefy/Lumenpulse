# ADR-0008 — Canonical Event Versioning Standard

**Status**: Accepted
**Date**: 2026-09-25
**Issue**: #1057

---

## Context

Backend and data-processing consumers decode `#[contractevent]` events by
shape: field order, field types, and the topic list. Nothing in that
pipeline signals when a contract upgrade changes an event's shape — a field
added, removed, reordered, renamed, or reinterpreted (e.g. a timestamp unit
change) looks, on the wire, exactly like a consumer decoding an event
correctly. The failure mode is silent: a stale decoder either misreads new
fields into the wrong slots or panics, and there is no way for a consumer to
know in advance that it needs to update.

`version-interface` (issue #1046) already solves the analogous problem one
level up: a contract can report its own deployed `ContractVersion` on-chain,
so operators and clients can check interface compatibility before relying on
a deployment. It does not, and structurally cannot, say anything about
whether an *individual event's* schema has changed between two versions of
the same contract, since a contract's semantic version can (and often does)
stay the same across a change that only touches one event's data shape.

## Decision

### 1. A version topic, not a version field

Every `#[contractevent]` struct that is part of a contract's public event
surface gets a `#[topic] pub version: u32` field, placed first (immediately
after the event-name topic the `#[contractevent]` macro derives from the
struct name).

Putting it in the *topic* list rather than only the data payload is the
central choice: Soroban event topics are what off-chain consumers filter and
subscribe on without decoding the data payload first. A version topic lets a
consumer:

- Detect a schema it doesn't understand yet, and skip or quarantine that
  event, before attempting to decode data that may no longer match its
  expected shape.
- Subscribe to a specific `(event_name, version)` pair using the same
  topic-filtering RPC surface it already uses to filter by event name —
  no new subscription mechanism needed.

A version living only inside the data struct would require decoding first
to find out decoding might not be safe — self-defeating for the "detect
before you decode" property this ADR is trying to provide.

### 2. A tiny shared crate, not a per-contract convention

`contracts/event-versioning` defines:

```rust
pub trait VersionedEvent {
    const EVENT_VERSION: u32;
}

#[macro_export]
macro_rules! versioned_event {
    ($ty:ty, $version:expr) => {
        impl $crate::VersionedEvent for $ty {
            const EVENT_VERSION: u32 = $version;
        }
    };
}
```

This mirrors `version-interface`'s shape (a small, dependency-free,
`#![no_std]` interface crate any contract can path-depend on) rather than
inventing a new convention style. The crate intentionally has zero
dependencies — not even `soroban-sdk` — since the trait only needs to name
a `u32` constant; contracts wire the constant into their own
`#[contractevent]` structs and publish helpers.

Publish helpers set `version: <Type>::EVENT_VERSION` rather than a literal,
so the constant and the emitted topic cannot drift apart — the value used
on the wire is always read from the same place documentation and tooling
would read it from.

### 3. Bump rule

Bump `EVENT_VERSION` when a change is not transparently decodable by an
existing consumer: a field is added, removed, reordered, renamed, or its
type/unit changes. Don't bump it for changes that don't affect the emitted
schema (a local variable rename, a doc comment).

When a schema does change, the recommended path is to keep the old struct
(renamed with a `V1` suffix, still implementing `VersionedEvent` at its
original version number) alongside a new struct at the bumped version,
rather than mutating the existing struct in place — consistent with how
`treasury` already keeps deprecated storage shapes (`StreamData` vs
`StreamV2`) alongside current ones instead of migrating in place.

### 4. Two contracts adopt the pattern now

`treasury::events` (12 events) and `lumenpulse-curation::events` (5 events)
— both contracts that already isolate their event definitions in a
dedicated `events.rs` module — are fully migrated to the pattern in this
change, and serve as the copy-from reference for new events elsewhere in
the workspace. See `CONTRIBUTING.md`'s "Event Versioning Standard" section
for the pattern contributors should follow when adding new events, in these
two contracts or any other.

---

## Alternatives considered

| Alternative | Reason rejected |
|-------------|----------------|
| Encode the version in the event name itself (e.g. `stream_created_v1` as the auto-derived topic) | Requires renaming the Rust struct (and therefore every call site) on every schema bump, and produces a proliferation of near-duplicate event names in generated bindings; a dedicated topic field keeps the event's *identity* (its name) stable while its *schema* version varies independently. |
| Put `version` only in the data payload, not as a topic | Defeats "detect before you decode" — see Decision §1. |
| A per-contract `EVENT_SCHEMA_VERSION` constant covering all of that contract's events at once | Too coarse: most schema changes touch one event, not a contract's entire event surface; a single shared constant would force unrelated events to bump together or the constant to become meaningless. |
| Reuse `version-interface`'s `ContractVersion` (major/minor/patch) per event | Three-part SemVer is designed for compatibility negotiation between a client and a deployed contract's *interface*; a single monotonically increasing `u32` is simpler and sufficient for "is this the schema I expect," which is the only question an event consumer needs answered. |
| Retrofit every existing event across all contracts in this change | Out of scope for what issue #1057 asks for (an adopted, documented standard demonstrated on at least two contracts) and would turn a standard-setting change into a workspace-wide, high-blast-radius topic-shape migration; existing events in other contracts adopt the pattern incrementally as documented in `CONTRIBUTING.md`. |

## Consequences

- New public dependency: `event-versioning`, path-dependable by any
  contract crate (`event-versioning = { path = "../event-versioning" }`),
  added to the workspace `members` list.
- `treasury` and `lumenpulse-curation` events now carry one additional topic
  (`version: u32`) that they didn't before. This is a topic-shape change
  for their existing events: off-chain indexers for these two contracts
  should expect the extra topic once this change deploys. Existing
  first-topic (event name) based filtering, and the tests in this
  workspace that assert on it, are unaffected — the version topic is
  additional, not a replacement.
- No changes to any publish helper's public signature; callers in
  `treasury::lib`, `treasury::multisig`, and `lumenpulse-curation::lib`
  needed no changes.
