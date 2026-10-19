//! Golden-payload fixtures for event-versioned contract events (issue #1623).
//!
//! An on-chain event is a contract between the contracts and every off-chain
//! consumer (the backend indexer, analytics, the event mapper). A field
//! reorder or type change passes `cargo test` unless something pins the exact
//! serialised bytes the contract produces. This crate pins them.
//!
//! Each contract whose events follow the [`event_versioning`] convention adds
//! a `#[cfg(test)] mod golden;` that publishes every event through a tiny
//! harness contract and hands the resulting topics/data to
//! [`assert_golden`]. The first run of `UPDATE_GOLDEN=1 cargo test` writes a
//! fixture per event; subsequent runs compare against it and fail on any
//! change.
//!
//! The fixture is the exact same shape the backend indexer persists:
//! base64-encoded ScVal XDR for the topic list and the data payload, plus a
//! decoded projection so the backend mapper's own tests can consume it
//! without an XDR dependency.
//!
//! # Regenerating / changing an event
//!
//! 1. Change the event struct in `events.rs`.
//! 2. Decide whether the change is schema-breaking (see the event-versioning
//!    rules). If it is, bump `EVENT_VERSION` via `versioned_event!` and, per
//!    the rules, keep the old shape under a `V<N>`-suffixed struct.
//! 3. `UPDATE_GOLDEN=1 cargo test -p <contract>` to write the fixture for the
//!    new version.
//! 4. `cargo test` to confirm the golden comparison passes.
//!
//! Regenerating over an *existing* fixture at the *same* version is refused:
//! to change a payload you must bump the version and emit a new fixture file.
//! That is the mechanism that enforces "updating a fixture requires a version
//! bump" in the acceptance criteria.

use std::path::{Path, PathBuf};

use base64::Engine as _;
use serde::{Deserialize, Serialize};
use serde_json::{Map, Value};
use soroban_sdk::{
    xdr::{ScVal, ToXdr},
    Address, Env, Symbol, TryFromVal, Val,
};

/// The environment variable that switches [`assert_golden`] from
/// compare-mode to write-mode.
pub const UPDATE_ENV: &str = "UPDATE_GOLDEN";

/// A committed golden payload fixture for a single event version.
///
/// The JSON on disk is the source of truth. `topics_xdr`/`data_xdr` are the
/// byte-exact serialised payload; `topics`/`fields` are a decoded projection
/// for readability and for the backend mapper tests.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct GoldenFixture {
    /// Contract label (directory name), e.g. `"treasury"`.
    pub contract: String,
    /// The `#[contractevent]` derived snake_case topic, e.g.
    /// `"stream_created_event"`.
    pub event: String,
    /// The event schema version carried in topic 1.
    pub version: u32,
    /// Base64-encoded ScVal XDR, one per topic, in emission order. Matches
    /// `ContractEvent.topic[i].toXDR('base64')` as stored by the indexer.
    pub topics_xdr: Vec<String>,
    /// Base64-encoded ScVal XDR of the data payload. Matches
    /// `ContractEvent.value.toXDR('base64')` as stored by the indexer.
    pub data_xdr: String,
    /// Decoded topic values (topic 0 is the event name, topic 1 the version).
    pub topics: Vec<Value>,
    /// Decoded data map, keyed by field name.
    pub fields: Map<String, Value>,
}

/// Root directory holding all fixtures, resolved relative to this crate so it
/// is independent of the process working directory.
pub fn fixtures_root() -> PathBuf {
    Path::new(env!("CARGO_MANIFEST_DIR")).join("fixtures")
}

/// The path of the fixture for `(contract, event, version)`.
pub fn fixture_path(contract: &str, event: &str, version: u32) -> PathBuf {
    fixtures_root()
        .join(contract)
        .join(format!("{event}.v{version}.json"))
}

/// Serialise the emitted `topics`/`data` for `contract::event` and either
/// write the fixture (when `UPDATE_GOLDEN=1`) or assert it matches.
///
/// Panics with an actionable message on any mismatch, on a missing fixture,
/// and on an attempt to rewrite an existing fixture at the same version.
pub fn assert_golden(
    env: &Env,
    contract: &str,
    event: &str,
    expected_version: u32,
    topics: &soroban_sdk::Vec<Val>,
    data: &Val,
) {
    let fixture = build_fixture(env, contract, event, expected_version, topics, data);
    let path = fixture_path(contract, event, expected_version);
    let actual = serde_json::to_value(&fixture).expect("fixture serialises to JSON");

    if std::env::var(UPDATE_ENV).is_ok() {
        write_fixture(contract, event, expected_version, &path, &actual);
        return;
    }

    let raw = std::fs::read_to_string(&path).unwrap_or_else(|_| {
        panic!(
            "missing golden fixture `{}` for `{contract}::{event}` v{expected_version}.\n\
             Create it with:\n    {UPDATE_ENV}=1 cargo test -p <contract>",
            path.display()
        )
    });
    let expected: Value = serde_json::from_str(&raw)
        .unwrap_or_else(|e| panic!("invalid fixture {}: {e}", path.display()));

    assert_eq!(
        actual, expected,
        "golden payload for `{contract}::{event}` v{expected_version} changed.\n\
         If this change is intentional, follow the event-versioning rules: bump\n\
         `EVENT_VERSION` (and keep the old event shape under a V<N> struct), then\n\
         regenerate the fixture with `UPDATE_GOLDEN=1 cargo test -p <contract>`.\n\
         See contracts/event-golden/README.md."
    );
}

fn write_fixture(contract: &str, event: &str, version: u32, path: &Path, actual: &Value) {
    if path.exists() {
        let raw = std::fs::read_to_string(path).expect("existing fixture readable");
        let existing: Value = serde_json::from_str(&raw).expect("existing fixture is valid JSON");
        if &existing != actual {
            panic!(
                "refusing to overwrite `{}` for `{contract}::{event}` v{version}.\n\
                 A payload changed without a version bump. Per the event-versioning\n\
                 rules you must bump `EVENT_VERSION` via `versioned_event!`, keep the\n\
                 old struct under a `V{version}` name, then regenerate. A new version\n\
                 writes a new `<event>.v<N>.json` file instead of mutating this one.",
                path.display()
            );
        }
        return;
    }

    if let Some(parent) = path.parent() {
        std::fs::create_dir_all(parent).expect("fixture directory created");
    }
    let mut json = serde_json::to_string_pretty(actual).expect("pretty fixture");
    json.push('\n');
    std::fs::write(path, json).expect("fixture written");
}

fn build_fixture(
    env: &Env,
    contract: &str,
    event: &str,
    expected_version: u32,
    topics: &soroban_sdk::Vec<Val>,
    data: &Val,
) -> GoldenFixture {
    let name = topics
        .get(0)
        .and_then(|t| Symbol::try_from_val(env, &t).ok())
        .map(|s| s.to_string())
        .unwrap_or_else(|| panic!("`{contract}::{event}` has no symbol name topic"));
    assert_eq!(
        name, event,
        "event name topic `{name}` does not match the declared event `{event}`"
    );

    let version: u32 = topics
        .get(1)
        .and_then(|t| u32::try_from_val(env, &t).ok())
        .unwrap_or_else(|| panic!("`{contract}::{event}` has no u32 version topic"));
    assert_eq!(
        version, expected_version,
        "`{contract}::{event}` publishes v{version} but the test expects v{expected_version}; \
         update the test's version constant to match EVENT_VERSION"
    );

    let mut topics_xdr = Vec::new();
    let mut topics_json = Vec::new();
    for topic in topics.iter() {
        topics_xdr.push(encode(topic.to_xdr(env)));
        topics_json.push(val_to_json(env, &topic));
    }

    let data_scval = ScVal::try_from_val(env, data)
        .unwrap_or_else(|_| panic!("`{contract}::{event}` data is not convertible to ScVal"));
    let fields = match data_scval {
        ScVal::Map(Some(map)) => {
            let mut fields = Map::new();
            for entry in map.iter() {
                let key = val_from_scval(env, &entry.key);
                let value = val_from_scval(env, &entry.val);
                let key = match val_to_json(env, &key) {
                    Value::String(s) => s,
                    other => other.to_string(),
                };
                fields.insert(key, val_to_json(env, &value));
            }
            fields
        }
        other => panic!("`{contract}::{event}` data is not a map payload: {other:?}"),
    };

    GoldenFixture {
        contract: contract.to_string(),
        event: event.to_string(),
        version,
        topics_xdr,
        data_xdr: encode(data.to_xdr(env)),
        topics: topics_json,
        fields,
    }
}

fn val_from_scval(env: &Env, scval: &ScVal) -> Val {
    Val::try_from_val(env, scval).expect("ScVal converts back to Val")
}

fn encode(bytes: soroban_sdk::Bytes) -> String {
    base64::engine::general_purpose::STANDARD.encode(bytes.to_alloc_vec())
}

/// Decode a `Val` into a JSON projection. We only support the scalar and
/// container variants the versioned events actually use; anything else panics
/// so a new event shape forces a conscious update here (and therefore a new
/// fixture) instead of silently pinning `null`.
fn val_to_json(env: &Env, val: &Val) -> Value {
    let scval = ScVal::try_from_val(env, val).expect("Val converts to ScVal");
    match scval {
        ScVal::Bool(b) => Value::Bool(b),
        ScVal::Void => Value::Null,
        ScVal::U32(n) => Value::from(n),
        ScVal::I32(n) => Value::from(n),
        ScVal::U64(n) => Value::from(n.to_string()),
        ScVal::I64(n) => Value::from(n.to_string()),
        ScVal::U128(p) => Value::from(u128::from(&p).to_string()),
        ScVal::I128(p) => Value::from(i128::from(&p).to_string()),
        ScVal::Symbol(_) => {
            let s = Symbol::try_from_val(env, val).expect("symbol");
            Value::from(s.to_string())
        }
        ScVal::String(_) => {
            let s = soroban_sdk::String::try_from_val(env, val).expect("string");
            Value::from(s.to_string())
        }
        ScVal::Address(_) => {
            let a = Address::try_from_val(env, val).expect("address");
            Value::from(a.to_string().to_string())
        }
        ScVal::Vec(Some(items)) => Value::Array(
            items
                .iter()
                .map(|item| val_to_json(env, &val_from_scval(env, item)))
                .collect(),
        ),
        ScVal::Map(Some(map)) => {
            let mut obj = Map::new();
            for entry in map.iter() {
                let key = val_to_json(env, &val_from_scval(env, &entry.key));
                let key = match key {
                    Value::String(s) => s,
                    other => other.to_string(),
                };
                obj.insert(key, val_to_json(env, &val_from_scval(env, &entry.val)));
            }
            Value::Object(obj)
        }
        other => panic!("event-golden: no JSON projection for ScVal variant {other:?}"),
    }
}
