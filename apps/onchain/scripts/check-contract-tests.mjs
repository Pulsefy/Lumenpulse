#!/usr/bin/env node
/**
 * check-contract-tests.mjs
 *
 * Enumerates every crate under apps/onchain/contracts and fails when a crate
 * has no test module.
 *
 * A crate has a test module when either:
 *   - it ships a `tests/` directory containing at least one `.rs` file, or
 *   - a `.rs` source declares one: a line that is (optionally indented)
 *     `#[cfg(test)]` / `#![cfg(test)]`, or a `#[test]` function.
 *
 * Mentions of those attributes inside `//` comments (for example the worked
 * example in a crate's rustdoc) do not count, so the check cannot be satisfied
 * by documenting a test module that does not exist.
 *
 * Crates that legitimately cannot carry their own tests are listed in
 * apps/onchain/contract-test-allowlist.json with a stated reason. The
 * allowlist is validated: an unknown crate, an entry without a reason, or an
 * entry for a crate that has since gained tests are all treated as failures so
 * the list cannot silently rot.
 *
 * Usage (from apps/onchain/):
 *   node scripts/check-contract-tests.mjs
 *
 * Exit code 0 = every crate has a test module or a justified allowlist entry.
 * Exit code 1 = an unaccounted crate or a malformed allowlist.
 */

import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ONCHAIN_ROOT = path.resolve(__dirname, "..");
const CONTRACTS_DIR = path.join(ONCHAIN_ROOT, "contracts");
const ALLOWLIST_PATH = path.join(ONCHAIN_ROOT, "contract-test-allowlist.json");

// A test module declaration: the attribute must be the first non-whitespace
// token on its line so that `//! ... #[cfg(test)] ...` in a doc comment does
// not match.
const CFG_TEST_RE = /^\s*#!?\[cfg\(\s*test\s*\)\]/m;
const TEST_FN_RE = /^\s*#\[test\]/m;

function readText(file) {
  return readFileSync(file, "utf8");
}

function walk(dir) {
  const out = [];
  for (const entry of readdirSync(dir).sort()) {
    const full = path.join(dir, entry);
    if (statSync(full).isDirectory()) out.push(...walk(full));
    else out.push(full);
  }
  return out;
}

function crateDirs() {
  return readdirSync(CONTRACTS_DIR, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => ({ name: entry.name, dir: path.join(CONTRACTS_DIR, entry.name) }))
    .filter(({ dir }) => existsSync(path.join(dir, "Cargo.toml")))
    .sort((a, b) => a.name.localeCompare(b.name));
}

function hasTestModule(dir) {
  const testsDir = path.join(dir, "tests");
  if (existsSync(testsDir) && walk(testsDir).some((file) => file.endsWith(".rs"))) {
    return true;
  }
  return walk(dir).some((file) => {
    if (!file.endsWith(".rs")) return false;
    const text = readText(file);
    return CFG_TEST_RE.test(text) || TEST_FN_RE.test(text);
  });
}

function loadAllowlist() {
  if (!existsSync(ALLOWLIST_PATH)) return [];
  const parsed = JSON.parse(readText(ALLOWLIST_PATH));
  return Array.isArray(parsed.crates) ? parsed.crates : [];
}

const crates = crateDirs();
const allowlist = loadAllowlist();
const allowlisted = new Set(allowlist.map((entry) => entry.name));

const problems = [];

// ── allowlist validation ────────────────────────────────────────────────────
for (const entry of allowlist) {
  const name = entry?.name;
  if (typeof name !== "string" || name.length === 0) {
    problems.push("contract-test-allowlist.json has an entry without a `name`.");
    continue;
  }
  if (typeof entry.reason !== "string" || entry.reason.trim().length === 0) {
    problems.push(`allowlist entry "${name}" has no stated reason.`);
  }
  const crate = crates.find((candidate) => candidate.name === name);
  if (!crate) {
    problems.push(`allowlist entry "${name}" does not match any crate under contracts/.`);
  } else if (hasTestModule(crate.dir)) {
    problems.push(
      `allowlist entry "${name}" is stale: the crate now has a test module. Remove the entry.`,
    );
  }
}

// ── missing test modules ────────────────────────────────────────────────────
const offenders = crates
  .filter((crate) => !allowlisted.has(crate.name))
  .filter((crate) => !hasTestModule(crate.dir))
  .map((crate) => crate.name);

if (offenders.length > 0) {
  problems.push(
    `${offenders.length} crate(s) under contracts/ have no test module: ${offenders.join(", ")}.`,
  );
}

// ── report ──────────────────────────────────────────────────────────────────
console.log("Contract test-module gate");
console.log("");
console.log(`Crates scanned: ${crates.length}`);
const listed = allowlist
  .map((entry) => entry?.name)
  .filter((name) => typeof name === "string")
  .sort();
console.log(
  `Allowlisted: ${listed.length > 0 ? listed.join(", ") : "(none)"}`,
);
console.log("");

if (problems.length > 0) {
  console.error("FAIL: contract test-module gate");
  for (const problem of problems) {
    console.error(`  - ${problem}`);
  }
  console.error("");
  console.error("To resolve, give the crate a test module — add a `tests/` directory or");
  console.error("`#[cfg(test)] mod test;` with at least one `#[test]` case — or, if the");
  console.error("crate cannot carry tests (for example a pure type, interface or test-only");
  console.error("support crate), add it to apps/onchain/contract-test-allowlist.json with a");
  console.error("stated reason. Remove allowlist entries once a crate gains its own tests.");
  process.exit(1);
}

console.log("PASS: every contract crate has a test module or a justified allowlist entry.");
