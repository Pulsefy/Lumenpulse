# event-golden

Golden-payload fixtures for event-versioned contract events (issue #1623).

An on-chain event is a contract between the contracts and every off-chain
consumer — the backend indexer, the canonical event mapper, analytics. A field
reorder or type change passes `cargo test` unless something pins the exact
serialised bytes the contract emits. This crate pins them: one committed JSON
fixture per event version, compared by `cargo test` on every run.

## Layout

```
contracts/event-golden/
├── src/lib.rs                  assert_golden() + fixture schema + decoder
├── fixtures/<contract>/<event>.v<N>.json
└── README.md
```

`event-golden` is a **test-only** support library and is deliberately
`exclude`d from the `apps/onchain` workspace: it uses `std`, `serde` and
`base64`, which must never end up in a deployed contract's WASM. The contract
crates that need it add it as a `[dev-dependency]`, and each carries a
`#[cfg(test)] mod golden;` that publishes its events through a tiny harness and
calls `event_golden::assert_golden(...)`.

It is used by:

- `contracts/treasury/src/golden.rs` — 13 events.
- `contracts/lumenpulse-curation/src/golden.rs` — 5 events.
- `apps/backend/src/soroban-events/event-golden-fixtures.spec.ts` — consumes
  the same fixtures to prove the backend mapper still recognises every event.

Only events that follow the [event-versioning standard](../event-versioning)
(issue #1057) have fixtures. A contract must adopt that standard before its
events can be added here.

## Fixture format

```json
{
  "contract": "treasury",
  "event": "stream_created_event",
  "version": 1,
  "topics_xdr": ["<base64 ScVal>", "..."],
  "data_xdr": "<base64 ScVal>",
  "topics": ["stream_created_event", 1, "GAAA..."],
  "fields": { "amount": "1000000", "duration": "86400", "start_time": "1700000000" }
}
```

- `topics_xdr` / `data_xdr` are the **byte-exact** payload: base64-encoded ScVal
  XDR, the same encoding the indexer stores as `ContractEvent.topic[i]` and
  `ContractEvent.value`. This is what actually fails on a schema change.
- `topics` / `fields` are a decoded projection for readability and for the
  backend mapper's tests (so those tests need no XDR dependency).
  `u64`/`i128` are rendered as strings to avoid JavaScript precision loss.
- `version` mirrors the version topic (topic 1) and the fixture filename.

## Workflow for intentionally changing an event

1. **Change the event** in the contract's `events.rs`.

2. **Decide whether the change is schema-breaking.** Per the event-versioning
   rules, that means a field added, removed, reordered, renamed, or a type/unit
   change. If it is:

   - Bump `EVENT_VERSION` via `versioned_event!(Type, N)`.
   - Keep the old shape under a `V<N>`-suffixed struct at its original version
     so historical events stay decodable.
   - Update the test's version argument in `src/golden.rs` if the current
     event type moved to the new version.

   If the change is not schema-breaking (a doc comment, a local variable
   rename), no bump is needed — the bytes are unchanged and the fixture still
   matches.

3. **Regenerate the fixture** for the new version:

   ```sh
   cd apps/onchain
   UPDATE_GOLDEN=1 cargo test -p treasury
   UPDATE_GOLDEN=1 cargo test -p lumenpulse-community-curation
   ```

   Regeneration writes a new `<event>.v<N>.json`. It **refuses** to overwrite
   an existing fixture at the same version — that is the mechanism that makes
   "updating a fixture requires a version bump" true rather than aspirational.
   If you see `refusing to overwrite ...`, you skipped a version bump.

4. **Review the fixture diff.** It is a committed artifact: a reviewer should
   see exactly which fields or types moved. Commit it alongside the code
   change.

5. **Confirm both sides**:

   ```sh
   cd apps/onchain && cargo test
   cargo clippy --all-targets --all-features -- -D warnings
   cd ../../backend && npm test -- event-golden-fixtures
   ```

   The on-chain golden test fails if the payload drifted from the fixture; the
   backend spec fails if the event name is no longer recognised by the mapper.

### Removing a version

When an old event version is retired, delete its `V<N>` struct and its
`v<N>` fixture together. Fixtures for superseded (but still decodable)
versions may be kept as historical records.
