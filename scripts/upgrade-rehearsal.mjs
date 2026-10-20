#!/usr/bin/env node
/**
 * upgrade-rehearsal.mjs — runs the testnet contract-upgrade rehearsal from
 * docs/CONTRACT_UPGRADE_REHEARSAL.md end to end and emits the evidence JSON
 * (issue #1613).
 *
 * The rehearsal deploys (or reuses) a dedicated, non-critical
 * `upgradable_contract` instance, upgrades it through the 24 h timelock,
 * verifies storage survived, then rolls it back through the timelock and
 * verifies again. It never edits apps/onchain/testnet-manifest.json; the
 * manifest steps write a rehearsal copy next to the state file.
 *
 * Because each timelock delay is 24 h, the command is resumable: progress is
 * kept in <state-dir>/state.json and a re-run continues from the last
 * completed step. Without --wait it exits with code 75 while a timelock is
 * pending — schedule it (cron, CI) and it finishes on its own.
 *
 * Usage (from repo root):
 *   cargo build --manifest-path apps/onchain/Cargo.toml --target wasm32-unknown-unknown --release -p upgradable-contract
 *   npm run --prefix scripts wasm:optimize
 *   ADMIN_SECRET=S... npm run --prefix scripts rehearse:upgrade            # advance as far as possible
 *   ADMIN_SECRET=S... npm run --prefix scripts rehearse:upgrade -- --wait  # block through both delays
 *
 * Flags:
 *   --wait                Sleep through timelock delays instead of exiting 75.
 *   --new                 Start a new rehearsal after a completed one (e.g. when stale).
 *   --contract-id <C...>  Rehearse against an existing initialized instance whose admin is ADMIN_SECRET.
 *   --wasm <path>         Baseline WASM (default: optimized upgradable_contract.wasm).
 *   --state-dir <path>    Where state, rehearsal manifests and evidence live (default: .upgrade-rehearsal/).
 *   --out <path>          Evidence output path (default: <state-dir>/upgrade-rehearsal.evidence.json).
 *   --max-age-days <n>    Evidence older than this is reported stale (default 30).
 *   --follow-up <id>      Record a follow-up issue in the evidence (repeatable).
 *
 * Environment:
 *   ADMIN_SECRET (required, testnet only), SOROBAN_RPC_URL, NETWORK_PASSPHRASE,
 *   BACKEND_URL (optional; enables the active-manifest check),
 *   UPGRADE_REHEARSAL_MAX_AGE_DAYS.
 *
 * Exit codes: 0 complete and fresh · 75 waiting on a timelock (re-run later)
 *             2 last rehearsal is stale · 1 error.
 */

import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { parseArgs } from 'node:util';
import {
  DEFAULT_MAX_AGE_DAYS,
  REPO_ROOT,
  TESTNET_PASSPHRASE,
  acquireLock,
  createFileStore,
  loadExample,
  writeJsonAtomic,
} from './upgrade-rehearsal/lib.mjs';
import { runRehearsal } from './upgrade-rehearsal/rehearsal.mjs';

const EXIT = { complete: 0, stale: 2, waiting: 75 };
const DEFAULT_WASM = path.join(REPO_ROOT, 'apps/onchain/target/wasm32-unknown-unknown/release/optimized/upgradable_contract.wasm');

async function main() {
  try {
    (await import('dotenv')).config();
  } catch {
    // dotenv is optional; plain environment variables work without it.
  }

  const { values } = parseArgs({
    options: {
      wait: { type: 'boolean', default: false },
      new: { type: 'boolean', default: false },
      'contract-id': { type: 'string' },
      wasm: { type: 'string', default: DEFAULT_WASM },
      'state-dir': { type: 'string', default: path.join(REPO_ROOT, '.upgrade-rehearsal') },
      out: { type: 'string' },
      'max-age-days': { type: 'string', default: process.env.UPGRADE_REHEARSAL_MAX_AGE_DAYS ?? String(DEFAULT_MAX_AGE_DAYS) },
      'follow-up': { type: 'string', multiple: true, default: [] },
    },
  });

  const stateDir = path.resolve(values['state-dir']);
  const outPath = path.resolve(values.out ?? path.join(stateDir, 'upgrade-rehearsal.evidence.json'));
  const maxAgeDays = Number(values['max-age-days']);
  if (!(maxAgeDays > 0)) throw new Error('--max-age-days must be a positive number');

  const wasmPath = path.resolve(values.wasm);
  if (!fs.existsSync(wasmPath)) {
    throw new Error(`WASM not found at ${wasmPath}. Build upgradable-contract and run \`npm run --prefix scripts wasm:optimize\` first.`);
  }

  const release = acquireLock(path.join(stateDir, 'rehearsal.lock'));
  try {
    const { createChain } = await import('./upgrade-rehearsal/chain.mjs');
    const chain = await createChain({
      rpcUrl: process.env.SOROBAN_RPC_URL || 'https://soroban-testnet.stellar.org',
      passphrase: process.env.NETWORK_PASSPHRASE || TESTNET_PASSPHRASE,
      adminSecret: process.env.ADMIN_SECRET,
    });

    const result = await runRehearsal({
      chain,
      store: createFileStore(path.join(stateDir, 'state.json')),
      example: loadExample(),
      options: {
        wasm: fs.readFileSync(wasmPath),
        contractId: values['contract-id'],
        commit: execFileSync('git', ['rev-parse', 'HEAD'], { cwd: REPO_ROOT, encoding: 'utf8' }).trim(),
        wait: values.wait,
        fresh: values.new,
        maxAgeDays,
        manifest: JSON.parse(fs.readFileSync(path.join(REPO_ROOT, 'apps/onchain/testnet-manifest.json'), 'utf8')),
        writeManifest: (manifest) => {
          const file = path.join(stateDir, 'testnet-manifest.rehearsal.json');
          writeJsonAtomic(file, manifest);
          return path.relative(REPO_ROOT, file);
        },
        backendUrl: process.env.BACKEND_URL,
        followUps: values['follow-up'],
      },
      sleep: (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
      log: (line) => console.log(line),
    });

    if (result.evidence && result.status !== 'waiting') {
      writeJsonAtomic(outPath, result.evidence);
      console.log(`Evidence: ${path.relative(process.cwd(), outPath)}`);
    }
    console.log(result.message);
    process.exitCode = EXIT[result.status];
  } finally {
    release();
  }
}

main().catch((error) => {
  console.error(`❌ ${error.message}`);
  process.exitCode = 1;
});
