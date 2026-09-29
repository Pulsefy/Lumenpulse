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

    #[derive(Debug, Eq, PartialEq)]
    struct MockEvent {
        version: u32,
    }

    versioned_event!(MockEvent, 1);

    #[test]
    fn event_version_constant_is_reachable() {
        assert_eq!(MockEvent::EVENT_VERSION, 1);
    }

    #[test]
    fn version_field_matches_declared_constant() {
        let event = MockEvent {
            version: MockEvent::EVENT_VERSION,
        };
        assert_eq!(event.version, 1);
    }
}
