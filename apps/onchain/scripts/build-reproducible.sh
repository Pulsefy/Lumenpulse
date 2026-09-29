#!/usr/bin/env bash
# build-reproducible.sh
#
# Produce deterministic WASM artefacts for every Soroban contract in the
# workspace using the pinned toolchain declared in rust-toolchain.toml.
#
# The build flags intentionally mirror the [profile.release] settings in
# Cargo.toml so that anyone running this script gets byte-identical output:
#
#   opt-level = "z"   – minimise size
#   lto       = true  – link-time optimisation (also aids reproducibility)
#   codegen-units = 1 – single codegen unit for deterministic output
#   debug     = 0     – strip debug info
#   strip     = "symbols"
#
# Usage
# -----
#   cd apps/onchain
#   ./scripts/build-reproducible.sh
#
# After a successful run the WASM files land in:
#   target/wasm32-unknown-unknown/release/<contract_name>.wasm
#
# To update the hashes in testnet-manifest.json run:
#   node scripts/verify-hashes.js --update
#
# Requirements
# ------------
#   - rustup  (the pinned toolchain will be auto-installed on first run)
#   - wasm32-unknown-unknown target (installed via rust-toolchain.toml)

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ONCHAIN_DIR="$(dirname "$SCRIPT_DIR")"

echo "=== LumenPulse reproducible WASM build ==="
echo "Working directory : $ONCHAIN_DIR"
echo "Toolchain         : $(rustup show active-toolchain 2>/dev/null || echo 'see rust-toolchain.toml')"
echo ""

cd "$ONCHAIN_DIR"

# Ensure the WASM target is available for the pinned toolchain.
rustup target add wasm32-unknown-unknown 2>/dev/null || true

echo "Building all workspace contracts in release mode…"
cargo build \
  --target wasm32-unknown-unknown \
  --release \
  --locked

echo ""
echo "Build complete. WASM artefacts:"
find target/wasm32-unknown-unknown/release -maxdepth 1 -name "*.wasm" \
  | sort \
  | while read -r wasm; do
      size=$(wc -c < "$wasm")
      printf "  %-60s  %s bytes\n" "$wasm" "$size"
    done

echo ""
echo "Run 'node scripts/verify-hashes.js' to compare hashes against testnet-manifest.json."
