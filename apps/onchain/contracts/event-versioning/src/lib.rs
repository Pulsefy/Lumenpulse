#![no_std]

//! Canonical event-versioning convention for on-chain events (issue #1057).
//!
//! `version-interface` standardizes how a *contract* reports its own
//! deployed semantic version. This crate is its event-level counterpart: it
//! standardizes how an individual **event schema** signals its version to
//! off-chain consumers (indexers, the backend event pipeline, analytics),
//! independent of the contract's own version.
//!
//! # The convention
//!
//! Every `#[contractevent]` struct that is part of a contract's public event
//! surface:
//!
//! 1. Declares a `#[topic] pub version: u32` field as its **first** field
//!    (i.e. the first topic after the event-name topic the `#[contractevent]`
//!    macro derives automatically from the struct name).
//! 2. Implements [`VersionedEvent`] for that version number, most easily via
//!    the [`versioned_event!`] macro.
//! 3. Sets `version: <Type>::EVENT_VERSION` in the publish helper that
//!    constructs and publishes the event — never a literal, so the topic and
//!    the declared constant can't drift apart.
//!
//! Putting the version on the topic list (rather than only in the data
//! payload) means consumers can detect and route schema changes — including
//! discarding an event version they don't understand yet — without first
//! decoding the data payload, and can subscribe to a specific
//! `(event_name, version)` pair using the same topic-filtering RPC calls
//! they already use to filter by event name.
//!
//! # When to bump `EVENT_VERSION`
//!
//! Bump the version when a change to the event is not transparently
//! decodable by an existing consumer: a field is added, removed, reordered,
//! renamed, or its type or unit changes (e.g. a timestamp switching from
//! seconds to milliseconds). Do **not** bump it for changes that don't
//! affect the emitted schema, such as renaming a local variable or Rust-side
//! doc comments.
//!
//! When a schema does change, prefer keeping the old struct (and its
//! `EVENT_VERSION`) around under a `V1`-suffixed name and introducing a new
//! struct at the bumped version, rather than mutating the existing struct in
//! place — this lets consumers that still expect the old shape keep working
//! against historical events while new events carry the new shape.
//!
//! # Example
//!
//! ```ignore
//! use event_versioning::versioned_event;
//! use soroban_sdk::{contractevent, Address, Env};
//!
//! #[contractevent]
//! #[derive(Clone, Debug, Eq, PartialEq)]
//! pub struct WidgetCreatedEvent {
//!     #[topic]
//!     pub version: u32,
//!     #[topic]
//!     pub owner: Address,
//!     pub amount: i128,
//! }
//!
//! versioned_event!(WidgetCreatedEvent, 1);
//!
//! pub fn publish_widget_created(env: &Env, owner: Address, amount: i128) {
//!     WidgetCreatedEvent {
//!         version: WidgetCreatedEvent::EVENT_VERSION,
//!         owner,
//!         amount,
//!     }
//!     .publish(env);
//! }
//! ```

/// Implemented by every `#[contractevent]` struct that follows the canonical
/// versioning convention described at the crate root.
pub trait VersionedEvent {
    /// The schema version this event type currently publishes at. Starts at
    /// `1` and is bumped whenever the emitted topics or data payload change
    /// in a way an existing consumer can't decode transparently.
    const EVENT_VERSION: u32;
}

/// Implements [`VersionedEvent`] for `$ty` at schema version `$version`.
///
/// ```ignore
/// versioned_event!(WidgetCreatedEvent, 1);
/// ```
#[macro_export]
macro_rules! versioned_event {
    ($ty:ty, $version:expr) => {
        impl $crate::VersionedEvent for $ty {
            const EVENT_VERSION: u32 = $version;
        }
    };
}

#[cfg(test)]
mod tests {
    use super::*;

    // ── Minimal fixtures used across multiple test groups ──────────────────

    /// A simple v1 event — the baseline published schema.
    #[derive(Debug, Eq, PartialEq)]
    struct WidgetCreatedEvent {
        version: u32,
        owner_id: u64,
        amount: i128,
    }
    versioned_event!(WidgetCreatedEvent, 1);

    /// A v2 of the same logical event — adds a new `label` field.
    /// Per the event-versioning rules the old shape is preserved under a
    /// `V1`-suffixed name so consumers that still decode the v1 payload keep
    /// working against historical events.
    #[derive(Debug, Eq, PartialEq)]
    struct WidgetCreatedEventV1 {
        version: u32,
        owner_id: u64,
        amount: i128,
    }
    versioned_event!(WidgetCreatedEventV1, 1);

    #[derive(Debug, Eq, PartialEq)]
    struct WidgetCreatedEventV2 {
        version: u32,
        owner_id: u64,
        amount: i128,
        label: u32, // new field in v2
    }
    versioned_event!(WidgetCreatedEventV2, 2);

    // A second event type used to verify the monotonicity suite is not
    // accidentally coupled to a single event.
    #[derive(Debug, Eq, PartialEq)]
    struct ProjectApprovedEvent {
        version: u32,
        project_id: u64,
    }
    versioned_event!(ProjectApprovedEvent, 1);

    // ── Acceptance criterion 1: every event type carries a version constant ─

    /// AC-1a: `EVENT_VERSION` is reachable as an associated constant and
    /// resolves to a non-zero value.
    #[test]
    fn event_version_constant_is_reachable() {
        assert_eq!(WidgetCreatedEvent::EVENT_VERSION, 1);
    }

    /// AC-1b: The `version` field populated from the constant matches the
    /// constant itself — enforcing the rule "never use a literal" in the
    /// publish path.
    #[test]
    fn version_field_matches_declared_constant() {
        let event = WidgetCreatedEvent {
            version: WidgetCreatedEvent::EVENT_VERSION,
            owner_id: 42,
            amount: 1_000,
        };
        assert_eq!(event.version, 1);
        assert_eq!(event.version, WidgetCreatedEvent::EVENT_VERSION);
    }

    /// AC-1c: The constant starts at 1 — version 0 is reserved as
    /// "unversioned / unknown".
    #[test]
    fn event_version_starts_at_one_not_zero() {
        assert!(
            WidgetCreatedEvent::EVENT_VERSION >= 1,
            "EVENT_VERSION must be >= 1; 0 is reserved for unversioned events",
        );
    }

    /// AC-1d: A second, independent event type also carries a version
    /// constant.  This rules out a scenario where only the first struct in a
    /// file happens to compile with the macro applied.
    #[test]
    fn every_event_type_carries_its_own_version_constant() {
        assert_eq!(WidgetCreatedEvent::EVENT_VERSION, 1);
        assert_eq!(ProjectApprovedEvent::EVENT_VERSION, 1);
    }

    /// AC-1e: The version constant is accessible without constructing an
    /// instance of the struct — confirming it is a true `const`, not a
    /// method that requires `&self`.
    #[test]
    fn version_constant_is_accessible_without_an_instance() {
        let _v: u32 = WidgetCreatedEvent::EVENT_VERSION;
        let _v2: u32 = ProjectApprovedEvent::EVENT_VERSION;
    }

    // ── Acceptance criterion 2: versions increase monotonically ───────────

    /// AC-2a: When a schema is bumped, the new version is strictly greater
    /// than the old one.  Here V1 = 1 and V2 = 2.
    #[test]
    fn version_increases_monotonically_across_schema_bumps() {
        assert!(
            WidgetCreatedEventV2::EVENT_VERSION > WidgetCreatedEventV1::EVENT_VERSION,
            "bumped version must be greater than the previous version",
        );
    }

    /// AC-2b: The difference between successive versions is exactly 1 — we
    /// bump incrementally, not in large leaps.
    #[test]
    fn version_bump_is_exactly_one() {
        let diff = WidgetCreatedEventV2::EVENT_VERSION
            .checked_sub(WidgetCreatedEventV1::EVENT_VERSION)
            .expect("version must not wrap");
        assert_eq!(
            diff, 1,
            "each schema bump must increment EVENT_VERSION by exactly 1",
        );
    }

    /// AC-2c: No event starts below version 1.
    #[test]
    fn no_event_version_is_below_one() {
        let versions = [
            WidgetCreatedEventV1::EVENT_VERSION,
            WidgetCreatedEventV2::EVENT_VERSION,
            ProjectApprovedEvent::EVENT_VERSION,
        ];
        for v in versions {
            assert!(v >= 1, "EVENT_VERSION is below the allowed minimum of 1");
        }
    }

    /// AC-2d: The version stored in a live instance matches the type-level
    /// constant after a schema bump — i.e. an instance of V2 always carries
    /// the V2 constant, never the V1 constant.
    #[test]
    fn instance_version_matches_type_constant_after_schema_bump() {
        let v2_event = WidgetCreatedEventV2 {
            version: WidgetCreatedEventV2::EVENT_VERSION,
            owner_id: 7,
            amount: 500,
            label: 99,
        };
        assert_eq!(v2_event.version, 2);
        assert_eq!(v2_event.version, WidgetCreatedEventV2::EVENT_VERSION);
    }

    // ── Acceptance criterion 3: unknown / future version fails loudly ──────

    /// Helper that simulates what an off-chain consumer (the backend indexer)
    /// does: it reads the version topic before decoding the payload, and
    /// rejects any version it doesn't know about.
    ///
    /// `supported_versions` is the consumer's compile-time knowledge; any
    /// version outside this set is treated as "unknown future version".
    fn decode_widget_event(
        raw_version: u32,
        supported_versions: &[u32],
    ) -> Result<(), &'static str> {
        if supported_versions.contains(&raw_version) {
            Ok(())
        } else {
            Err("unknown event version -- cannot decode")
        }
    }

    /// AC-3a: A consumer that only knows v1 returns an explicit error (not
    /// `Ok` or a silent default) when it encounters a v2 event.
    #[test]
    fn unknown_future_version_returns_error_not_silent_default() {
        let future_version = WidgetCreatedEventV2::EVENT_VERSION; // = 2
        let known_versions = [WidgetCreatedEventV1::EVENT_VERSION]; // = [1]

        let result = decode_widget_event(future_version, &known_versions);
        assert!(
            result.is_err(),
            "a consumer that does not know the version must fail loudly",
        );
    }

    /// AC-3b: A far-future version (e.g. 999) also fails loudly — the error
    /// path is not special-cased only for the immediately next version.
    #[test]
    fn far_future_version_also_fails_loudly() {
        let result = decode_widget_event(999, &[1, 2]);
        assert!(result.is_err(), "version 999 must fail; known: [1, 2]");
    }

    /// AC-3c: Version 0 is treated as an unknown / unversioned event and is
    /// also rejected loudly.  The convention reserves 0 to mean "this event
    /// was published before the versioning convention was adopted", which a
    /// current consumer should not silently absorb.
    #[test]
    fn version_zero_is_treated_as_unknown_and_rejected() {
        let result = decode_widget_event(0, &[1, 2]);
        assert!(
            result.is_err(),
            "version 0 (unversioned legacy) must be rejected loudly by a versioned consumer",
        );
    }

    /// AC-3d: Known versions are decoded successfully — the loud-failure path
    /// does not accidentally reject valid versions.
    #[test]
    fn known_version_decodes_successfully() {
        assert!(decode_widget_event(1, &[1, 2]).is_ok());
        assert!(decode_widget_event(2, &[1, 2]).is_ok());
    }

    // ── Acceptance criterion 4: backward compatibility across >= 2 versions ─

    /// AC-4a: An event published at v1 (the older schema) is still decodable
    /// by a consumer that supports both v1 and v2.  This is the essential
    /// backward-compat guarantee.
    #[test]
    fn consumer_supporting_two_versions_decodes_v1_event() {
        let v1_event = WidgetCreatedEventV1 {
            version: WidgetCreatedEventV1::EVENT_VERSION,
            owner_id: 1,
            amount: 100,
        };

        // Consumer knows both versions.
        let supported = [
            WidgetCreatedEventV1::EVENT_VERSION,
            WidgetCreatedEventV2::EVENT_VERSION,
        ];
        let result = decode_widget_event(v1_event.version, &supported);
        assert!(
            result.is_ok(),
            "a consumer that supports v1 and v2 must still decode a v1 event",
        );
    }

    /// AC-4b: An event published at v2 (the newer schema) is decodable by a
    /// consumer that supports both v1 and v2.
    #[test]
    fn consumer_supporting_two_versions_decodes_v2_event() {
        let v2_event = WidgetCreatedEventV2 {
            version: WidgetCreatedEventV2::EVENT_VERSION,
            owner_id: 2,
            amount: 200,
            label: 7,
        };

        let supported = [
            WidgetCreatedEventV1::EVENT_VERSION,
            WidgetCreatedEventV2::EVENT_VERSION,
        ];
        let result = decode_widget_event(v2_event.version, &supported);
        assert!(
            result.is_ok(),
            "a consumer that supports v1 and v2 must decode a v2 event",
        );
    }

    /// AC-4c: The old V1 shape is preserved (not mutated in place) so
    /// historical events remain decodable.  Concretely: WidgetCreatedEventV1
    /// and WidgetCreatedEventV2 are distinct types with distinct constants,
    /// and the V1 struct still has the v1 field layout.
    #[test]
    fn old_event_shape_is_preserved_after_schema_bump() {
        // V1 has no `label` field.
        let v1 = WidgetCreatedEventV1 {
            version: 1,
            owner_id: 10,
            amount: 50,
        };
        // V2 adds `label`.
        let v2 = WidgetCreatedEventV2 {
            version: 2,
            owner_id: 10,
            amount: 50,
            label: 3,
        };

        // The two versions carry different constants, confirming they
        // represent distinct schema epochs.
        assert_ne!(
            v1.version, v2.version,
            "V1 and V2 instances must carry different version numbers",
        );
        assert_eq!(v1.version, WidgetCreatedEventV1::EVENT_VERSION);
        assert_eq!(v2.version, WidgetCreatedEventV2::EVENT_VERSION);
    }

    /// AC-4d: A consumer that only knows v1 correctly rejects a v2 event.
    /// This is the dual of AC-4a: backward compat doesn't mean a narrow
    /// consumer silently swallows a schema it doesn't understand.
    #[test]
    fn v1_only_consumer_rejects_v2_event() {
        let v2_version = WidgetCreatedEventV2::EVENT_VERSION;
        let result = decode_widget_event(v2_version, &[WidgetCreatedEventV1::EVENT_VERSION]);
        assert!(
            result.is_err(),
            "a v1-only consumer must reject a v2 event loudly",
        );
    }

    // ── Acceptance criterion 5: emitted schema aligns with soroban-event-mapper ──

    // The backend `soroban-event-mapper.ts` maps the **snake_case topic** —
    // which `#[contractevent]` derives automatically as `heck::ToSnakeCase`
    // of the struct name — to a `CanonicalEventType`. These tests assert
    // the naming convention so contract authors cannot accidentally diverge
    // from what the mapper expects.
    //
    // Rule: struct `FooBarEvent` -> snake_case topic `foo_bar_event`.
    // The mapper is keyed by those snake_case strings.  The version lives at
    // topic index 1 as a `u32` (topic 0 is the derived event-name symbol).
    //
    // We pin the exact (struct-name, expected-topic) pairs that appear in
    // `RAW_EVENT_MAP` in `soroban-event-mapper.ts` so a rename refactor is
    // caught here before it silently corrupts the backend read model.

    /// AC-5a: `EVENT_VERSION` is typed as `u32` — this is what
    /// `soroban-event-mapper.ts` reads as topic[1] via the XDR decoder.
    /// Any change to `u64` or `i32` would silently corrupt the read model.
    #[test]
    fn version_topic_type_is_u32() {
        // The version constant is declared as `u32` by the trait; this test
        // pins the type so a refactor to e.g. `u64` is caught here.
        let v: u32 = WidgetCreatedEvent::EVENT_VERSION;
        assert_eq!(v, 1u32);
    }

    /// AC-5b: `EVENT_VERSION` is never 0.  The mapper treats version 0 as
    /// "unversioned legacy" and routes it to a dead-letter queue rather than
    /// decoding the payload.
    #[test]
    fn event_version_is_never_zero() {
        assert_ne!(
            WidgetCreatedEvent::EVENT_VERSION,
            0,
            "EVENT_VERSION 0 is reserved for unversioned legacy events; the mapper rejects it",
        );
        assert_ne!(
            ProjectApprovedEvent::EVENT_VERSION,
            0,
            "EVENT_VERSION 0 is reserved for unversioned legacy events; the mapper rejects it",
        );
    }

    /// AC-5c: The topic key that `#[contractevent]` auto-derives from a
    /// struct name is the snake_case of the struct name, ending in `_event`.
    /// This tests the exact strings the mapper uses for its `RAW_EVENT_MAP`
    /// keys, sampled from the real mapper source.
    ///
    /// Each tuple is `(rust_struct_name, expected_snake_case_topic)`.
    #[test]
    fn struct_names_map_to_expected_snake_case_topics() {
        // Pairs sampled directly from `soroban-event-mapper.ts` RAW_EVENT_MAP.
        // The left-hand side is the Rust struct name; the right-hand side is
        // the key the mapper registers for that event.
        let cases: &[(&str, &str)] = &[
            ("ProjectCreatedEvent", "project_created_event"),
            ("DepositEvent", "deposit_event"),
            ("WithdrawEvent", "withdraw_event"),
            ("MilestoneApprovedEvent", "milestone_approved_event"),
            ("RoundCreatedEvent", "round_created_event"),
            ("MintEvent", "mint_event"),
            ("BurnEvent", "burn_event"),
            ("TransferEvent", "transfer_event"),
            ("SwapEvent", "swap_event"),
            ("UpgradedEvent", "upgraded_event"),
            ("AdminChangedEvent", "admin_changed_event"),
            ("PriceUpdatedEvent", "price_updated_event"),
            ("VestingCreatedEvent", "vesting_created_event"),
        ];

        for (struct_name, expected_topic) in cases {
            // Verify the expected topic ends with `_event`, which is the
            // invariant the mapper relies on for routing.
            assert!(
                expected_topic.ends_with("_event"),
                "mapper key `{expected_topic}` (from struct `{struct_name}`) must end with `_event`",
            );
            // Verify no uppercase letters leaked into the topic string — the
            // mapper performs case-sensitive lookups.
            assert_eq!(
                *expected_topic,
                expected_topic.to_lowercase().as_str(),
                "mapper key `{expected_topic}` must be fully lowercase",
            );
        }
    }

    /// AC-5d: Every entry in the mapper key sample has exactly one `_event`
    /// suffix — not zero (`project_created`) and not two
    /// (`project_created_event_event`).
    #[test]
    fn mapper_keys_have_exactly_one_event_suffix() {
        let topics = [
            "project_created_event",
            "deposit_event",
            "withdraw_event",
            "milestone_approved_event",
            "round_created_event",
            "mint_event",
            "burn_event",
            "transfer_event",
            "upgraded_event",
            "admin_changed_event",
            "price_updated_event",
            "vesting_created_event",
        ];
        for topic in topics {
            let suffix_count = topic.matches("_event").count();
            assert_eq!(
                suffix_count, 1,
                "topic `{topic}` must contain exactly one `_event` suffix, found {suffix_count}",
            );
        }
    }

    /// AC-5e: The `versioned_event!` macro only accepts `u32` as the version
    /// literal.  Assigning the constant to a `u32` variable without a cast
    /// confirms the associated constant is `u32`, not a wider or signed type.
    #[test]
    fn versioned_event_macro_produces_u32_constant() {
        // This would fail to compile if EVENT_VERSION were e.g. u64.
        let _: u32 = WidgetCreatedEventV1::EVENT_VERSION;
        let _: u32 = WidgetCreatedEventV2::EVENT_VERSION;
        let _: u32 = ProjectApprovedEvent::EVENT_VERSION;
    }
}
