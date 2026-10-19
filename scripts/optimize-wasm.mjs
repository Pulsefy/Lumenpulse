#!/usr/bin/env node
/**
 * optimize-wasm.mjs
 *
 * Post-processes every release contract WASM with binaryen (the library behind
 * wasm-opt) and writes the result to
 *   apps/onchain/target/wasm32-unknown-unknown/release/optimized/<name>.wasm
 * which is what deploy.ts uploads.
 *
 * Why this step exists:
 *   1. Deployability. Rust >= 1.82 enables the `reference-types` WASM feature
 *      for wasm32-unknown-unknown, and the precompiled `core` is built with it
 *      too, so the raw build encodes `call_indirect` in a form the Soroban VM
 *      rejects ("reference-types not enabled: zero byte expected"). Re-emitting
 *      the module with only MVP features fixes the encoding.
 *   2. Cost. Upload fees scale with the size of the code ledger entry, and
 *      -Oz shrinks the suite by roughly a quarter. See docs/MAINNET_READINESS.md.
 *
 * binaryen is pinned to an exact version in package.json/package-lock.json, so
 * the optimized bytes (and therefore the on-chain wasm hash) are reproducible
 * on any machine with the same raw input.
 *
 * Usage (from repo root):
 *   cargo build --manifest-path apps/onchain/Cargo.toml --target wasm32-unknown-unknown --release
 *   npm run --prefix scripts wasm:optimize
 *
 * Flags:
 *   --baseline   Also write release/baseline/<name>.wasm: the raw module
 *                re-emitted with MVP features and no optimization passes. It
 *                is the smallest change that makes the raw build deployable
 *                and is what measure-deploy-cost.ts compares against.
 */

import binaryen from "binaryen";
import { mkdirSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const RELEASE_DIR = path.resolve(
  __dirname,
  "../apps/onchain/target/wasm32-unknown-unknown/release",
);
const OPTIMIZED_DIR = path.join(RELEASE_DIR, "optimized");
const BASELINE_DIR = path.join(RELEASE_DIR, "baseline");
const WRITE_BASELINE = process.argv.includes("--baseline");

// Features the Soroban VM accepts. Anything else must not appear in the output.
const SOROBAN_FEATURES =
  binaryen.Features.MVP |
  binaryen.Features.MutableGlobals |
  binaryen.Features.SignExt;

function emit(input, optimize) {
  const module = binaryen.readBinary(input);
  try {
    module.setFeatures(SOROBAN_FEATURES);
    if (optimize) {
      // Equivalent to `wasm-opt -Oz`.
      binaryen.setOptimizeLevel(2);
      binaryen.setShrinkLevel(2);
      module.optimize();
    }
    if (!module.validate()) {
      throw new Error("binaryen validation failed");
    }
    return Buffer.from(module.emitBinary());
  } finally {
    module.dispose();
  }
}

let files = [];
try {
  files = readdirSync(RELEASE_DIR).filter((name) => name.endsWith(".wasm"));
} catch {
  // handled below
}
if (files.length === 0) {
  console.error(
    `❌  No release WASM files found in ${RELEASE_DIR}.\n    Run cargo build --target wasm32-unknown-unknown --release in apps/onchain first.`,
  );
  process.exit(1);
}

mkdirSync(OPTIMIZED_DIR, { recursive: true });
if (WRITE_BASELINE) mkdirSync(BASELINE_DIR, { recursive: true });

const { version } = JSON.parse(
  readFileSync(path.join(__dirname, "node_modules/binaryen/package.json"), "utf8"),
);
console.log(`Optimizing ${files.length} contracts with binaryen ${version} (-Oz)\n`);

let rawTotal = 0;
let optimizedTotal = 0;
for (const file of files.sort()) {
  const raw = readFileSync(path.join(RELEASE_DIR, file));
  let optimized;
  try {
    optimized = emit(raw, true);
    if (WRITE_BASELINE) writeFileSync(path.join(BASELINE_DIR, file), emit(raw, false));
  } catch (err) {
    console.error(`❌  ${file}: ${err.message}`);
    process.exit(1);
  }
  writeFileSync(path.join(OPTIMIZED_DIR, file), optimized);
  rawTotal += raw.length;
  optimizedTotal += optimized.length;
  const pct = (((raw.length - optimized.length) / raw.length) * 100).toFixed(1);
  console.log(
    `  ${file.padEnd(40)} ${String(raw.length).padStart(8)} → ${String(optimized.length).padStart(8)} bytes  (-${pct}%)`,
  );
}

const totalPct = (((rawTotal - optimizedTotal) / rawTotal) * 100).toFixed(1);
console.log(
  `\n  ${"total".padEnd(40)} ${String(rawTotal).padStart(8)} → ${String(optimizedTotal).padStart(8)} bytes  (-${totalPct}%)`,
);
console.log(`\nOptimized WASM written to ${OPTIMIZED_DIR}`);
if (WRITE_BASELINE) console.log(`Baseline WASM written to ${BASELINE_DIR}`);
