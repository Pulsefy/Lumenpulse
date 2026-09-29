#!/usr/bin/env node
/**
 * verify-hashes.js
 *
 * Compares the SHA-256 hash of every built WASM file against the
 * wasm_hash recorded in testnet-manifest.json for that contract.
 *
 * Usage
 * -----
 *   # Check built artefacts against the manifest (CI mode – exits non-zero on mismatch):
 *   node scripts/verify-hashes.js
 *
 *   # Update the manifest with hashes computed from the built artefacts:
 *   node scripts/verify-hashes.js --update
 *
 * The script must be run from the apps/onchain directory (or any working
 * directory where target/wasm32-unknown-unknown/release/ contains the
 * compiled WASM files and testnet-manifest.json is at the workspace root).
 *
 * Exit codes
 * ----------
 *   0  – all deployed contracts match (or --update succeeded)
 *   1  – one or more hashes differ / WASM file missing for a deployed contract
 */

'use strict';

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

// ── Paths ──────────────────────────────────────────────────────────────────
const ONCHAIN_DIR = path.resolve(__dirname, '..');
const MANIFEST_PATH = path.join(ONCHAIN_DIR, 'testnet-manifest.json');
const WASM_DIR = path.join(
  ONCHAIN_DIR,
  'target',
  'wasm32-unknown-unknown',
  'release',
);

// ── Helpers ────────────────────────────────────────────────────────────────

/**
 * Compute the SHA-256 hex digest of a file.
 * @param {string} filePath
 * @returns {string} lowercase hex string (64 chars)
 */
function sha256File(filePath) {
  const data = fs.readFileSync(filePath);
  return crypto.createHash('sha256').update(data).digest('hex');
}

/**
 * Return true when a contract entry in the manifest is deployed
 * (i.e. it has `id` and `wasm_hash` fields rather than a `reason` field).
 * @param {unknown} entry
 * @returns {boolean}
 */
function isDeployed(entry) {
  return (
    entry !== null &&
    typeof entry === 'object' &&
    !Array.isArray(entry) &&
    !Object.prototype.hasOwnProperty.call(entry, 'reason') &&
    (Object.prototype.hasOwnProperty.call(entry, 'id') ||
      Object.prototype.hasOwnProperty.call(entry, 'contract_id'))
  );
}

// ── Main ───────────────────────────────────────────────────────────────────

const UPDATE_MODE = process.argv.includes('--update');

// Load manifest
if (!fs.existsSync(MANIFEST_PATH)) {
  console.error(`❌  Manifest not found: ${MANIFEST_PATH}`);
  process.exit(1);
}

let manifest;
try {
  manifest = JSON.parse(fs.readFileSync(MANIFEST_PATH, 'utf8'));
} catch (err) {
  console.error(`❌  Failed to parse manifest: ${err.message}`);
  process.exit(1);
}

if (!manifest.contracts || typeof manifest.contracts !== 'object') {
  console.error('❌  Manifest must contain a top-level "contracts" object.');
  process.exit(1);
}

// Collect deployed contracts
const deployedContracts = Object.entries(manifest.contracts).filter(
  ([, entry]) => isDeployed(entry),
);

if (deployedContracts.length === 0) {
  console.error('❌  No deployed contracts found in manifest.');
  process.exit(1);
}

console.log(
  `\n=== LumenPulse WASM hash ${UPDATE_MODE ? 'updater' : 'verifier'} ===`,
);
console.log(`Manifest  : ${MANIFEST_PATH}`);
console.log(`WASM dir  : ${WASM_DIR}`);
console.log(`Contracts : ${deployedContracts.length} deployed\n`);

// Check that the WASM build directory exists
if (!fs.existsSync(WASM_DIR)) {
  console.error(
    `❌  WASM output directory not found: ${WASM_DIR}\n` +
      '    Run the build first:\n' +
      '      cargo build --target wasm32-unknown-unknown --release --locked',
  );
  process.exit(1);
}

let allPassed = true;

for (const [contractName, contractEntry] of deployedContracts) {
  // The compiled WASM filename matches the crate name, which uses underscores.
  // Contract directory names may use hyphens; normalise both to underscores.
  const wasmName = contractName.replace(/-/g, '_');
  const wasmPath = path.join(WASM_DIR, `${wasmName}.wasm`);

  if (!fs.existsSync(wasmPath)) {
    console.error(`❌  [${contractName}]  WASM file not found: ${wasmPath}`);
    allPassed = false;
    continue;
  }

  const actualHash = sha256File(wasmPath);
  const manifestHash = contractEntry.wasm_hash ?? contractEntry.wasmHash ?? '';

  if (UPDATE_MODE) {
    // Write the freshly-computed hash back into the manifest entry.
    if (contractEntry.wasm_hash !== undefined) {
      contractEntry.wasm_hash = actualHash;
    } else {
      contractEntry.wasmHash = actualHash;
    }
    console.log(`✅  [${contractName}]  updated → ${actualHash}`);
  } else {
    if (actualHash === manifestHash) {
      console.log(`✅  [${contractName}]  ${actualHash}`);
    } else {
      console.error(`❌  [${contractName}]  HASH MISMATCH`);
      console.error(`       manifest : ${manifestHash}`);
      console.error(`       built    : ${actualHash}`);
      allPassed = false;
    }
  }
}

// Persist changes when running in --update mode
if (UPDATE_MODE) {
  fs.writeFileSync(MANIFEST_PATH, JSON.stringify(manifest, null, 2) + '\n', 'utf8');
  console.log(`\n✅  testnet-manifest.json updated with ${deployedContracts.length} hash(es).`);
  process.exit(0);
}

// Verification mode summary
console.log('');
if (allPassed) {
  console.log(
    `✅  All ${deployedContracts.length} deployed contract hash(es) match the manifest.`,
  );
  process.exit(0);
} else {
  console.error(
    `❌  One or more contract hashes do not match the manifest.\n` +
      '    To regenerate the manifest from the current build, run:\n' +
      '      node scripts/verify-hashes.js --update\n' +
      '    Then commit the updated testnet-manifest.json.',
  );
  process.exit(1);
}
