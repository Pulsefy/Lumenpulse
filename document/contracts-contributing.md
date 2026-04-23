# Contracts Contribution Guide

This guide covers app-specific standards for `apps/onchain`.

## Setup

```bash
cd apps/onchain
```

Required toolchain:

- Rust stable
- `wasm32-unknown-unknown` target
- Soroban CLI (as needed for deployment/testing workflows)

## Daily Commands

```bash
# Format
cargo fmt --all

# Lint (deny warnings)
cargo clippy --all-targets --all-features -- -D warnings

# Test workspace
cargo test --workspace
```

## Standards

- Preserve deterministic contract behavior and storage compatibility.
- Keep events and errors explicit for on-chain observability.
- Add/update tests for each behavior change, including edge cases.
- Document any contract interface or upgrade-impacting change.

## Done for Contracts Changes

- `cargo fmt --all` applied.
- `cargo clippy --all-targets --all-features -- -D warnings` passes.
- `cargo test --workspace` passes.
- Interface-impacting changes are documented.
