#!/usr/bin/env node
/**
 * verify-wasm-hashes.mjs
 *
 * Rebuilds every deployed contract from source and compares the resulting
 * SHA-256 hash against the value recorded in testnet-manifest.json.
 *
 * A mismatch means either:
 *   (a) the source was changed without updating the manifest, or
 *   (b) the build is not reproducible (toolchain drift, non-deterministic
 *       codegen, etc.).
 *
 * Usage (from apps/onchain/):
 *   node scripts/verify-wasm-hashes.mjs
 *
 * Exit code 0 = all deployed contracts reproduced byte-for-byte.
 * Exit code 1 = at least one mismatch or missing WASM file.
 *
 * The script only verifies contracts that carry a "wasm_hash" entry in the
 * manifest.  Contracts that carry a "reason" field are intentionally not
 * deployed and are therefore skipped.
 *
 * Prerequisites:
 *   • Rust toolchain matching apps/onchain/rust-toolchain.toml
 *   • cargo build --target wasm32-unknown-unknown --release already run, OR
 *     pass --build to have this script run the build automatically.
 */

import { createHash } from "node:crypto";
import { readFileSync, existsSync } from "node:fs";
import { execSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ONCHAIN_ROOT = path.resolve(__dirname, "..");
const MANIFEST_PATH = path.join(ONCHAIN_ROOT, "testnet-manifest.json");
const WASM_DIR = path.join(
  ONCHAIN_ROOT,
  "target",
  "wasm32-unknown-unknown",
  "release",
);

// ── CLI flags ────────────────────────────────────────────────────────────────
const args = process.argv.slice(2);
const BUILD_FIRST = args.includes("--build");
const VERBOSE = args.includes("--verbose") || args.includes("-v");

// ── Helpers ──────────────────────────────────────────────────────────────────

function log(...parts) {
  console.log(...parts);
}

function verbose(...parts) {
  if (VERBOSE) console.log(...parts);
}

function fail(msg) {
  console.error(`\n❌  ${msg}`);
  process.exit(1);
}

/**
 * Compute the SHA-256 hex digest of a file.
 * Stellar tooling (soroban contract install) uploads the raw WASM and
 * the on-chain wasm_hash is SHA-256(raw bytes), so we hash the file
 * directly without any prefix.
 */
function sha256File(filePath) {
  const buf = readFileSync(filePath);
  return createHash("sha256").update(buf).digest("hex");
}

// ── Load manifest ─────────────────────────────────────────────────────────────

if (!existsSync(MANIFEST_PATH)) {
  fail(`testnet-manifest.json not found at ${MANIFEST_PATH}`);
}

let manifest;
try {
  manifest = JSON.parse(readFileSync(MANIFEST_PATH, "utf8"));
} catch (err) {
  fail(`Failed to parse testnet-manifest.json: ${err.message}`);
}

if (
  !manifest ||
  typeof manifest.contracts !== "object" ||
  Array.isArray(manifest.contracts)
) {
  fail('testnet-manifest.json must have a top-level "contracts" object.');
}

// ── Optionally rebuild ───────────────────────────────────────────────────────

if (BUILD_FIRST) {
  log("🔨  Building contracts (cargo build --target wasm32-unknown-unknown --release)…");
  try {
    execSync(
      "cargo build --target wasm32-unknown-unknown --release",
      { cwd: ONCHAIN_ROOT, stdio: "inherit" },
    );
  } catch {
    fail("cargo build failed — see output above.");
  }
}

// ── Verify each deployed contract ────────────────────────────────────────────

/**
 * The Rust package name is used as the WASM file stem.
 * Hyphens in package names become underscores in the output filename.
 */
function wasmPath(contractName) {
  // Package names with hyphens → underscores in the .wasm filename
  const stem = contractName.replace(/-/g, "_");
  return path.join(WASM_DIR, `${stem}.wasm`);
}

const entries = Object.entries(manifest.contracts);
const deployedEntries = entries.filter(
  ([, data]) => !Object.prototype.hasOwnProperty.call(data, "reason"),
);
const skippedEntries = entries.filter(([, data]) =>
  Object.prototype.hasOwnProperty.call(data, "reason"),
);

if (deployedEntries.length === 0) {
  fail("No deployed contracts found in manifest (all entries have a reason).");
}

log(
  `\n🔍  Verifying ${deployedEntries.length} deployed contract(s)` +
    (skippedEntries.length > 0
      ? ` (skipping ${skippedEntries.length} not-deployed)`
      : "") +
    "…\n",
);

let passed = 0;
let failed = 0;
const mismatches = [];
const missing = [];

for (const [contractName, contractData] of deployedEntries) {
  const manifestHash = contractData.wasm_hash ?? contractData.wasmHash;
  if (!manifestHash) {
    console.error(
      `  ⚠️   ${contractName}: manifest entry has no wasm_hash — skipping`,
    );
    continue;
  }

  const wasm = wasmPath(contractName);
  if (!existsSync(wasm)) {
    console.error(
      `  ❌  ${contractName}: WASM file not found at ${path.relative(ONCHAIN_ROOT, wasm)}`,
    );
    missing.push(contractName);
    failed++;
    continue;
  }

  const builtHash = sha256File(wasm);
  const match = builtHash === manifestHash.toLowerCase();

  if (match) {
    log(`  ✅  ${contractName}`);
    verbose(`       hash: ${builtHash}`);
    passed++;
  } else {
    console.error(`  ❌  ${contractName}: hash mismatch`);
    console.error(`       manifest: ${manifestHash}`);
    console.error(`       built:    ${builtHash}`);
    mismatches.push({ contractName, manifestHash, builtHash });
    failed++;
  }
}

// ── Summary ──────────────────────────────────────────────────────────────────

log(`\n${"─".repeat(60)}`);
log(`  Passed : ${passed}`);
log(`  Failed : ${failed}`);
log(`${"─".repeat(60)}\n`);

if (failed > 0) {
  if (missing.length > 0) {
    console.error(
      `Missing WASM files (${missing.length}):\n` +
        missing.map((n) => `  • ${n}`).join("\n"),
    );
    console.error(
      "\n  Run: cargo build --target wasm32-unknown-unknown --release",
    );
    console.error("  Or:  node scripts/verify-wasm-hashes.mjs --build\n");
  }

  if (mismatches.length > 0) {
    console.error(`Hash mismatches (${mismatches.length}):`);
    for (const { contractName, manifestHash, builtHash } of mismatches) {
      console.error(`\n  Contract : ${contractName}`);
      console.error(`  Manifest : ${manifestHash}`);
      console.error(`  Built    : ${builtHash}`);
    }
    console.error(
      "\n  The manifest hash no longer matches what the source produces.",
    );
    console.error(
      "  If the contract was intentionally changed, update testnet-manifest.json",
    );
    console.error(
      "  with the new hash after deploying to testnet.  If no source change was",
    );
    console.error(
      "  made, this indicates a toolchain reproducibility problem — verify that",
    );
    console.error(
      "  rust-toolchain.toml is honoured and Cargo.lock is committed.\n",
    );
  }

  process.exit(1);
}

log("✅  All deployed contract hashes match the manifest.\n");
