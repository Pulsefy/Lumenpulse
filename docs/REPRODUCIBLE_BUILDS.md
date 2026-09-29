# Reproducible WASM Build Verification

This document explains how to independently verify that the Soroban contract
WASM files listed in `testnet-manifest.json` were produced from the committed
source code, and how to reproduce those builds locally.

---

## Background

Every deployed Soroban contract is identified on-chain by the SHA-256 hash of
its WASM bytecode.  `testnet-manifest.json` records that hash alongside the
deployed contract ID for each contract so that anyone can audit the deployed
bytecode against the source.

Without a reproducible, pinned build this hash is merely an assertion.  This
document explains the measures taken to make the assertion independently
verifiable.

---

## What makes the build deterministic?

Three things are pinned or configured to eliminate non-determinism:

| Factor | How it is pinned |
|--------|-----------------|
| **Rust compiler** | `apps/onchain/rust-toolchain.toml` — channel `1.85.0` |
| **Build profile** | `apps/onchain/Cargo.toml` `[profile.release]` — `codegen-units=1`, `lto=true`, `opt-level="z"`, `debug=0`, `strip="symbols"` |
| **Dependency versions** | `apps/onchain/Cargo.lock` checked into the repository; `--locked` flag passed to `cargo build` |

> **Known-bad Rust versions**: 1.81–1.83 and 1.91 produce broken or
> non-deterministic WebAssembly output.  Do not use these versions.  The
> toolchain is pinned to 1.85.0 specifically to avoid them.

---

## Quick-start: verify hashes locally

### Prerequisites

- [rustup](https://rustup.rs/) (the pinned toolchain is installed automatically)
- Node.js ≥ 18

### Steps

```bash
# 1. Clone the repository (or use an existing checkout)
git clone https://github.com/Pulsefy/Lumenpulse.git
cd Lumenpulse/apps/onchain

# 2. Build – rustup will auto-install the pinned 1.85.0 toolchain on first run
./scripts/build-reproducible.sh

# 3. Compare the build output against the manifest hashes
node scripts/verify-hashes.js
```

A successful run prints a `✅` line for each deployed contract and exits `0`.
Any mismatch prints a `❌` line with both hashes and exits `1`.

---

## Verify a single contract manually

```bash
cd apps/onchain

# Build (uses the pinned toolchain automatically via rust-toolchain.toml)
cargo build --target wasm32-unknown-unknown --release --locked

# Compute the SHA-256 of one contract's WASM
sha256sum target/wasm32-unknown-unknown/release/contributor_registry.wasm
```

Compare the output against the `wasm_hash` recorded for `contributor_registry`
in `testnet-manifest.json`.

---

## Prove the build is reproducible (two independent builds)

```bash
cd apps/onchain

# First build
cargo build --target wasm32-unknown-unknown --release --locked
cp target/wasm32-unknown-unknown/release/contributor_registry.wasm /tmp/build1.wasm

# Clean the incremental cache and rebuild from scratch
cargo clean
cargo build --target wasm32-unknown-unknown --release --locked

# Compare — the hashes must be identical
sha256sum target/wasm32-unknown-unknown/release/contributor_registry.wasm /tmp/build1.wasm
```

The CI (`onchain.yml`) performs this two-build check automatically on every
push and pull request.

---

## CI enforcement

The GitHub Actions workflow `.github/workflows/onchain.yml` runs three
hash-related checks on every `push` and `pull_request` that touches
`apps/onchain/**`:

1. **Pinned toolchain install** — reads `channel` from `rust-toolchain.toml`
   and passes it to `dtolnay/rust-toolchain@master`, ensuring CI always uses
   the same compiler version as a local reproducible build.

2. **Two-build reproducibility gate** — builds the workspace twice and
   `sha256sum`s each WASM file from both builds.  A mismatch fails the job.

3. **Manifest hash gate** — runs `node scripts/verify-hashes.js`, which
   computes the SHA-256 of every built WASM and compares it against
   `testnet-manifest.json`.  Any mismatch fails the job.

---

## Updating hashes after a source change

When contract source code changes, the WASM hash will change.  Update the
manifest after rebuilding:

```bash
cd apps/onchain

# Rebuild with the pinned toolchain
./scripts/build-reproducible.sh

# Update testnet-manifest.json with the new hashes
node scripts/verify-hashes.js --update

# Commit both the source changes and the updated manifest together
git add testnet-manifest.json
git commit -m "contracts: update WASM hashes after <describe change>"
```

Never update `testnet-manifest.json` manually.  Always use `--update` after a
fresh build to guarantee the recorded hashes match the compiled output.

---

## File reference

| File | Purpose |
|------|---------|
| `apps/onchain/rust-toolchain.toml` | Pins the Rust compiler to a specific stable release |
| `apps/onchain/Cargo.toml` `[profile.release]` | Deterministic compile flags |
| `apps/onchain/Cargo.lock` | Locks all transitive dependency versions |
| `apps/onchain/testnet-manifest.json` | Records deployed contract IDs and their WASM hashes |
| `apps/onchain/scripts/build-reproducible.sh` | Convenience wrapper for a clean reproducible build |
| `apps/onchain/scripts/verify-hashes.js` | Compares built WASM hashes against the manifest; `--update` flag rewrites hashes |
| `.github/workflows/onchain.yml` | CI: pinned toolchain install, two-build reproducibility check, manifest hash gate |
