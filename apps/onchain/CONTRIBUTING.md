# Contributing to On-Chain Contracts

Welcome to the on-chain contracts workspace! This document outlines the development standards, testing conventions, and contribution workflow for Soroban smart contracts on Stellar.

## 📋 Development Standards

### Code Style
- **Rustfmt**: All code must be formatted with `cargo fmt`
- **Clippy**: No warnings allowed (`cargo clippy -- -D warnings`)
- **Naming Conventions**:
  - Structs: `PascalCase` (e.g., `HelloContract`)
  - Functions: `snake_case` (e.g., `ping`, `enable_privacy`)
  - Constants: `SCREAMING_SNAKE_CASE` (e.g., `MAX_PRIVACY_LEVEL`)
  - Variables: `snake_case` (e.g., `account_address`)

### Import Order
```rust
// 1. External crates
use soroban_sdk::{contract, contractimpl, Env};

// 2. Internal modules (if any)
// use crate::types::*;

// 3. Module declarations
mod test;
```

## Storage TTL & Bump Policy (issue #1226)

Soroban ledger entries are not kept alive forever: every entry has a `live_until_ledger`, and once the current ledger passes it the entry is archived (and reads/writes against it fail) unless the TTL was explicitly extended beforehand. This section is the durability-class policy every contract in this workspace must follow, and the checklist a review should hold new storage code to.

### Durability classes

Soroban gives every entry one of three tiers, chosen with `env.storage().instance()` / `.persistent()` / `.temporary()`. Pick the tier by asking what the data is *for*, not by convenience:

| Tier | Use for | TTL granularity | Notes |
|------|---------|------------------|-------|
| **`instance`** | Contract-global singleton config: `Admin`, `Paused`, counters, addresses of collaborating contracts, anything read on nearly every call. | **One TTL for the whole instance.** Extending it anywhere extends every instance-tier key at once. | Because it's shared, instance TTL is the highest-consequence tier to get wrong: letting it lapse doesn't just drop one record, it can brick every entrypoint that needs `Admin` or other instance config. |
| **`persistent`** | Per-user or per-record data that must survive indefinitely while it's still relevant: balances, project/round/proposal records, registry entries, vote records. | **One TTL per key.** Each key must be extended individually. | This is the default choice for anything keyed by an id/address/tuple that the contract must not silently lose. |
| **`temporary`** | Data that is *supposed* to lapse on its own: SEP-41 token allowances (bounded by their own `expiration_ledger`), anti-replay/idempotency receipts with a deliberately bounded dedup window, single-round vote-cast flags. | Entries vanish once their TTL runs out — there's no way to restore a temporary entry. | Choosing `temporary` is itself a policy decision (see below) — document *why* the data is allowed to expire in a comment next to the key definition, the way `lumenpulse-curation`'s `VotedFlag` and `lumen_token`'s `Allowance` already do. |

**Never move an existing key between tiers** as part of a TTL fix — that changes the storage layout of an already-deployed contract. Tier is an early design decision; only bump *discipline* is what this policy corrects.

### Bump policy: where `extend_ttl` calls go

The workspace standard constants (used by `crowdfund_vault`, `lumen_token`, `vesting-wallet`, `contributor_registry`, `upgradable-contract`, `pricing_adapter`, and all crates fixed under issue #1226) are:

```rust
pub const LEDGER_THRESHOLD: u32 = 100_000; // ~5.8 days at 5s/ledger
pub const LEDGER_BUMP: u32 = 518_400;      // ~30 days at 5s/ledger
```

`extend_ttl(threshold, bump)` is a no-op unless the entry's remaining TTL has dropped below `threshold`, in which case it's extended to `bump` ledgers from now. A few crates (`treasury`, `idempotency-guard`, `cross-contract-view`) instead use a shorter, deliberately-documented `120_960` / `241_920` (~7 / ~14 days) pair for data with a naturally shorter relevant window — that's a legitimate per-crate choice, not a bug; new code should default to the `100_000` / `518_400` pair unless there's a specific, commented reason to pick a shorter window.

Rules, by tier:

1. **Instance**: call `env.storage().instance().extend_ttl(LEDGER_THRESHOLD, LEDGER_BUMP)` from whatever internal helper every mutating entrypoint already funnels through (a `require_admin`-style auth check is the natural place — it's called everywhere a bump is needed anyway). If a contract has read-only entrypoints that are likely to be called far more often than any admin write (a price oracle's `get_price`, a registry's `resolve`), bump instance TTL there too — relying solely on infrequent admin writes to keep shared, contract-wide config alive is the single most common gap this audit found.
2. **Persistent**: call `.persistent().extend_ttl(&key, LEDGER_THRESHOLD, LEDGER_BUMP)` immediately after every `.set()`, and after every successful `.get()` of a key the contract needs to keep working (i.e. most reads). Bumping on read as well as write is intentionally generous — the fee cost of an early, unnecessary bump is accepted in this codebase as the cheaper failure mode versus a record silently expiring while a user still expects it to exist.
3. **Temporary**: do **not** add `extend_ttl` calls unless the data's own semantics require outliving a single short window (e.g. an approved-but-unspent SEP-41 allowance must have its physical TTL extended out to match its own `expiration_ledger` — see `lumen_token`'s `write_allowance` — otherwise the entry can be archived, and silently read back as a zero allowance, before the caller's chosen expiration is reached). Anti-replay/vote-once flags are the common case that should stay un-bumped by design.
4. A single write or read path frequently touches several persistent keys that logically expire together (e.g. a price record's amount/decimals/timestamp/invalidated-flag keys in `pricing_adapter`). Bump them as a unit through one small helper rather than duplicating the same `extend_ttl` call at every site — keeps the policy auditable instead of scattered.

### Per-crate inventory

| Crate | Instance keys | Persistent keys | Temporary keys | TTL constants |
|-------|----------------|------------------|-----------------|----------------|
| `contributor_registry` | Admin, MultisigConfig, NextProposalId, Proposal³, ScopePaused(*) | Contributor, GitHubIndex, RegistrationNonce, Badges, ReputationPenalty | — | 100_000 / 518_400 |
| `cross-contract-view` | *(shared helper lib — bumps whatever instance/persistent key the calling contract passes in via `safe_view`/`admin_helpers`)* | *(same, via `read_persistent`)* | — | 120_960 / 241_920 |
| `crowdfund_vault` | Admin, Paused, NextProjectId, StorageVersion, FeeBps, Treasury | Project, ProjectBalance, ProjectStatus, MilestoneApproved, Contribution, ContributorCount, Contributor, MatchingPool, RegisteredContributor, Reputation, EmergencyMigrationPlan, RefundReceipt, and others | — | 100_000 / 518_400 |
| `feature_flags` | Admin, Paused, FlagList | Flag(Symbol) | — | 100_000 / 518_400 |
| `idempotency-guard` | — | ExecutionReceipt | — | 120_960 / 241_920 (write-only bump by design — see the doc comment on `claim_request`: a bounded dedup window, not indefinite retention) |
| `liquidity_pool` | Admin, Token0, Token1 | Reserve0, Reserve1, LPSupply, UserLPBalance, AccruedFees0, AccruedFees1, LastFeeAccrual | — | 100_000 / 518_400 |
| `lumenpulse-curation` | Admin, DepositToken, ContributorRegistry, NextProjectId | Proposal, VoteRecord | VotedFlag *(intentionally un-bumped — see comment at the key's definition)* | 100_000 / 518_400 |
| `lumen_token` | Admin, Decimals, Name, Symbol, TSUPPLY | Balance, State | Allowance *(bumped to match its own `expiration_ledger` — see `write_allowance`)* | 100_000 / 518_400 |
| `matching_pool` | Admin, Paused, ScopePaused(*), NextRoundId | Round, RoundPool, EligibleProject(*), ProjectContributions, ProjectContributor(*), ContributorAmount, MatchDistributed, RoundStatus, FinalizedAt, RoundCap, ContributorRoundTotal | — | 100_000 / 518_400 |
| `notification_broker`¹ | Admin | Subscription, ListenersForSource | — | 100_000 / 518_400 (SDK 21 `.bump()` API) |
| `notification_interface` | *(interface-only crate — no deployed storage of its own)* | | | |
| `pricing_adapter` | Admin, MaxPriceAge | AssetPrice, AssetDecimals, AssetPriceTimestamp, AssetPriceInvalidated | — | 100_000 / 518_400 |
| `project_registry` | Admin, Paused, Config | Project, VoteCast, VoterWeight | — | 100_000 / 518_400 |
| `protocol_registry` | Admin, Paused | Module(Symbol) | — | 100_000 / 518_400 |
| `reentrancy-guard` | *(one shared boolean flag, piggybacks on the host contract's own instance TTL by design — not independently applicable)* | | | |
| `stable_swap_pool`¹ | Admin, TokenA, TokenB | ReserveA, ReserveB, LPSupply, UserLPBalance | — | 100_000 / 518_400 (SDK 21 `.bump()` API) |
| `treasury` | Admin, Token, MultisigConfig, Proposal³, NextProposalId, TotalObligations | StreamData, StreamV2 | — | 120_960 / 241_920 |
| `upgradable-contract` | Admin, Counter, ProposedAdmin, NextOperationId | QueuedOperation | — | 100_000 / 518_400 |
| `vesting-wallet` | Admin, Token | Vesting, Delegates | — | 100_000 / 518_400 |
| `version-interface` | *(interface-only crate — no deployed storage of its own)* | | | |
| `yield_vault` | Admin, Asset, ProviderCount, TotalAUM, TotalYieldHarvested, Paused | Provider, UserBalance, UserProviderAllocation | — | 100_000 / 518_400 |

¹ `notification_broker` and `stable_swap_pool` pin `soroban-sdk = "=21.5.1"` and are intentionally excluded from the workspace `members` list (see `apps/onchain/Cargo.toml`) pending a migration to the v23 SDK the rest of the workspace is on. **Neither currently builds at all**, independent of this policy: `soroban-sdk` 21.5.1's transitive `stellar-xdr` 21.2.0 fails to compile against current crates.io `arbitrary` (a pre-existing version-drift issue, with no lockfile pinning the older transitive deps this pinned SDK needs); `notification_broker` additionally path-depends on `notification_interface`, a workspace member built against SDK v23 — mixing the two major SDK versions in one build graph is a second, independent reason it can't compile even once the first issue is fixed. The TTL fixes applied to both crates under this issue follow the same policy (`LEDGER_THRESHOLD`/`LEDGER_BUMP` constants, bump-on-write-and-read) using this SDK's `.bump()` API, and were reviewed line-by-line by hand, but are **not compiler- or test-verified** — track that separately from a TTL-specific fix. Resolving the underlying SDK/dependency mismatch (a real migration, not a TTL change) is a prerequisite for `cargo test --manifest-path apps/onchain/contracts/<crate>/Cargo.toml` to ever succeed here.

³ `Proposal(u64)` living in **instance** tier (rather than `persistent`, as `crowdfund_vault`'s `Project(u64)` or `matching_pool`'s `Round(u64)` do) shows up independently in both `treasury` and `contributor_registry`'s multisig modules — the same kind of pre-existing per-id-growing-map-in-instance-tier design choice as `protocol_registry`'s `Module` above. Left in place, not migrated, but now covered by the same instance-TTL bump discipline as every other instance key in each contract.

### Testing requirement

Any contract with `instance` or `persistent` storage must have at least one test that advances the ledger **past `LEDGER_THRESHOLD` more than once**, performing a read or write between each advance, and asserts the contract still functions correctly after every advance. A single advance isn't enough to prove anything — the entry could simply have started with a generous default TTL. Advancing twice only passes if a bump actually happened in between. See `upgradable-contract`'s `test_ttl_extended_after_read_write` / `test_instance_storage_accessible_after_ledger_advance`, or `pricing_adapter`'s `test_ttl_extended_across_read_and_write`, as the reference shape for this test.

## Event Versioning Standard (issue #1057)

Contracts emit events with `#[contractevent]` so the backend and other
off-chain consumers can react to on-chain state changes without polling.
Those consumers decode events by shape — by field order, type, and topic
list — so a change to an event's shape that isn't otherwise signaled is
indistinguishable, on the wire, from a consumer bug: the old decoder either
misreads the new fields or panics. `version-interface` already solves this
problem at the *contract* level (`contract_version()`); this section is the
matching rule for individual **event schemas**, backed by the
`event-versioning` crate.

### The pattern

Every `#[contractevent]` struct that is part of a contract's public event
surface must:

1. Declare a `#[topic] pub version: u32` field as its **first** field (i.e.
   the first topic after the event-name topic `#[contractevent]` derives
   automatically from the struct name).
2. Implement `event_versioning::VersionedEvent` for that version number,
   via the `versioned_event!` macro rather than a hand-written `impl`.
3. Set `version: <Type>::EVENT_VERSION` in the function that constructs and
   publishes the event — never a literal, so the topic and the declared
   constant cannot drift apart.

```rust
use event_versioning::{versioned_event, VersionedEvent};
use soroban_sdk::{contractevent, Address, Env};

#[contractevent]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct WidgetCreatedEvent {
    #[topic]
    pub version: u32,
    #[topic]
    pub owner: Address,
    pub amount: i128,
}
versioned_event!(WidgetCreatedEvent, 1);

pub fn publish_widget_created(env: &Env, owner: Address, amount: i128) {
    WidgetCreatedEvent {
        version: WidgetCreatedEvent::EVENT_VERSION,
        owner,
        amount,
    }
    .publish(env);
}
```

`treasury` and `lumenpulse-curation` (both under `contracts/*/src/events.rs`)
are the canonical, fully-adopted references for this pattern — copy their
shape for new events rather than re-deriving it.

### Why the version is a topic, not just a data field

Soroban event topics are what consumers filter and subscribe on without
first decoding the data payload. Putting `version` in the topic list (as
opposed to only in the data struct) means:

- A consumer can detect a schema it doesn't understand yet — and skip or
  quarantine it — from the topic list alone, before attempting to decode
  data that may no longer match its expected shape.
- A consumer can subscribe to a specific `(event_name, version)` pair using
  the same topic-filtering RPC calls it already uses to filter by event
  name, rather than needing a new mechanism.

### When to bump `EVENT_VERSION`

Bump the version when a change is not transparently decodable by an
existing consumer: a field is added, removed, reordered, renamed, or its
type or unit changes (e.g. a timestamp moving from seconds to
milliseconds). Don't bump it for changes that don't affect the emitted
schema, such as renaming a local variable or a doc comment.

When a schema does change, prefer keeping the old struct (renamed with a
`V1` suffix, still implementing `VersionedEvent` at its original version)
in place and adding a new struct at the bumped version, rather than
mutating the existing struct — this keeps historical events decodable by
consumers that haven't upgraded yet, matching how `treasury::events`
already keeps deprecated shapes (e.g. `StreamData` vs `StreamV2`) alongside
current ones instead of migrating in place.

### Adopting the pattern in a new or existing contract

- New contract, new events module: write every event to the pattern from
  the start; add `event-versioning = { path = "../event-versioning" }` to
  `Cargo.toml`.
- Existing contract, adding a new event to an existing module: write the
  new event to the pattern even if sibling events in the same file
  predate it; there's no requirement to retrofit the whole file in the
  same change, but do add the crate dependency and follow the pattern for
  anything new.
- Retrofitting an existing event's *topics* changes what's on-chain for
  future emissions of that event (the event name topic is unaffected,
  but the topic list gains one more entry) — flag this in the PR
  description so backend indexers know to expect the extra topic once
  the change deploys, the same way any other topic-shape change would be
  called out.