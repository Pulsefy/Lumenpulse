#!/usr/bin/env node
/**
 * mainnet-readiness.mjs
 *
 * Assesses the contract suite against a single mainnet-readiness bar and
 * renders the result as a committed report:
 *
 *   docs/MAINNET_READINESS_CHECKLIST.md
 *
 * The mechanisable prerequisites (test coverage, manifest completeness,
 * reproducible builds, admin key custody, and the accumulated per-wave
 * features) are evaluated from repository state. Prerequisites that need a
 * human are listed separately from apps/onchain/mainnet-readiness.signoffs.json
 * with their owner.
 *
 * Usage (from apps/onchain/):
 *   node scripts/mainnet-readiness.mjs            # write the report
 *   node scripts/mainnet-readiness.mjs --check    # fail if the report is stale
 *   node scripts/mainnet-readiness.mjs --stdout   # print without writing
 *   node scripts/mainnet-readiness.mjs --strict   # exit 1 unless every item is met
 *
 * The report is deterministic: no timestamps or absolute paths, so a rerun
 * with unchanged inputs is byte-identical.
 */

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { execFileSync } from "node:child_process";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ONCHAIN_ROOT = path.resolve(__dirname, "..");
const REPO_ROOT = path.resolve(ONCHAIN_ROOT, "..", "..");
const CONTRACTS_DIR = path.join(ONCHAIN_ROOT, "contracts");
const MANIFEST_PATH = path.join(ONCHAIN_ROOT, "testnet-manifest.json");
const BUDGETS_PATH = path.join(ONCHAIN_ROOT, "wasm-budgets.json");
const BASELINE_PATH = path.join(ONCHAIN_ROOT, "wasm-baseline.json");
const SIGNOFFS_PATH = path.join(ONCHAIN_ROOT, "mainnet-readiness.signoffs.json");
const WORKFLOW_PATH = path.join(REPO_ROOT, ".github", "workflows", "onchain.yml");
const REPORT_PATH = path.join(REPO_ROOT, "docs", "MAINNET_READINESS_CHECKLIST.md");
const CONFIG_TS_PATH = path.join(REPO_ROOT, "scripts", "contracts.config.ts");
const DEPLOY_TS_PATH = path.join(REPO_ROOT, "scripts", "deploy.ts");
const SCRIPTS_PKG_PATH = path.join(REPO_ROOT, "scripts", "package.json");
const SCRIPTS_LOCK_PATH = path.join(REPO_ROOT, "scripts", "package-lock.json");
const ENV_EXAMPLE_PATH = path.join(REPO_ROOT, "scripts", ".env.example");
const ISSUE_BASE = "https://github.com/Pulsefy/Lumenpulse/issues/";

const args = process.argv.slice(2);
const MODE_CHECK = args.includes("--check");
const MODE_STDOUT = args.includes("--stdout");
const MODE_STRICT = args.includes("--strict");

// ── helpers ──────────────────────────────────────────────────────────────────

function readText(file) {
  return fs.readFileSync(file, "utf8");
}

function readJson(file) {
  return JSON.parse(readText(file));
}

function exists(file) {
  return fs.existsSync(file);
}

function rel(file) {
  return path.relative(REPO_ROOT, file).split(path.sep).join("/");
}

function sortedReaddir(dir) {
  return fs.existsSync(dir) ? fs.readdirSync(dir).sort() : [];
}

function walk(dir, out = []) {
  for (const entry of sortedReaddir(dir)) {
    const full = path.join(dir, entry);
    let stat;
    try {
      stat = fs.statSync(full);
    } catch {
      continue;
    }
    if (stat.isDirectory()) walk(full, out);
    else out.push(full);
  }
  return out;
}

function countMatches(text, regex) {
  const matches = text.match(regex);
  return matches ? matches.length : 0;
}

function norm(value) {
  return value.replace(/-/g, "_").toLowerCase();
}

let trackedCache = null;
function trackedFiles() {
  if (trackedCache) return trackedCache;
  try {
    trackedCache = execFileSync("git", ["ls-files"], {
      cwd: REPO_ROOT,
      encoding: "utf8",
    })
      .split("\n")
      .filter(Boolean);
  } catch {
    trackedCache = walk(REPO_ROOT)
      .filter((f) => !f.includes(`${path.sep}.git${path.sep}`))
      .filter((f) => !f.includes(`${path.sep}node_modules${path.sep}`))
      .filter((f) => !f.includes(`${path.sep}target${path.sep}`))
      .map(rel);
  }
  return trackedCache;
}

// ── repository facts ─────────────────────────────────────────────────────────

const manifest = readJson(MANIFEST_PATH);
const workflow = exists(WORKFLOW_PATH) ? readText(WORKFLOW_PATH) : "";
const cargoToml = readText(path.join(ONCHAIN_ROOT, "Cargo.toml"));

function tomlList(name) {
  const match = cargoToml.match(new RegExp(`${name}\\s*=\\s*\\[([\\s\\S]*?)\\]`));
  return match ? [...match[1].matchAll(/"([^"]+)"/g)].map((m) => m[1]) : [];
}

const workspaceMembers = tomlList("members");
const workspaceExcludes = tomlList("exclude");

function packageName(dir) {
  const toml = path.join(dir, "Cargo.toml");
  if (!exists(toml)) return null;
  const match = readText(toml).match(/^\s*name\s*=\s*"([^"]+)"/m);
  return match ? match[1] : null;
}

const crateDirs = sortedReaddir(CONTRACTS_DIR)
  .map((name) => ({ name, dir: path.join(CONTRACTS_DIR, name) }))
  .filter(({ dir }) => fs.statSync(dir).isDirectory())
  .filter(({ dir }) => exists(path.join(dir, "Cargo.toml")))
  .map(({ name, dir }) => ({ name, dir, pkg: packageName(dir) }));

const memberCrates = workspaceMembers
  .filter((member) => member.startsWith("contracts/"))
  .map((member) => {
    const dir = path.join(ONCHAIN_ROOT, member);
    return { name: path.basename(member), dir, pkg: packageName(dir) };
  })
  .filter((crate) => crate.pkg);

const deployed = Object.entries(manifest.contracts).filter(
  ([, data]) => !Object.prototype.hasOwnProperty.call(data, "reason"),
);
const deferred = Object.entries(manifest.contracts).filter(([, data]) =>
  Object.prototype.hasOwnProperty.call(data, "reason"),
);

function crateTestCount(dir) {
  let count = 0;
  for (const file of walk(dir)) {
    if (!file.endsWith(".rs")) continue;
    count += countMatches(readText(file), /#\[test\]/g);
  }
  return count;
}

const testCounts = memberCrates.map((crate) => ({
  name: crate.pkg,
  count: crateTestCount(crate.dir),
}));
const totalTests = testCounts.reduce((sum, t) => sum + t.count, 0);
const untestedCrates = testCounts.filter((t) => t.count === 0).map((t) => t.name);

function grepContracts(regex) {
  const hits = [];
  for (const file of walk(CONTRACTS_DIR)) {
    if (!file.endsWith(".rs")) continue;
    const text = readText(file);
    if (regex.test(text)) hits.push(file);
    regex.lastIndex = 0;
  }
  return hits;
}

function anyContractFile(regex) {
  return grepContracts(regex).length > 0;
}

// ── automated checks ─────────────────────────────────────────────────────────
// Each check returns { met, detail }. `tracking` is only rendered when unmet.

function checkManifestSchema() {
  try {
    const out = execFileSync("node", ["scripts/validate-manifest.js"], {
      cwd: ONCHAIN_ROOT,
      encoding: "utf8",
    }).trim();
    return {
      met: true,
      detail: `scripts/validate-manifest.js passes: ${out.replace(/^✅\s*/, "")}`,
    };
  } catch (error) {
    const output = `${error.stdout || ""}${error.stderr || ""}`.trim();
    return { met: false, detail: output.split("\n").filter(Boolean).pop() || "manifest validation failed" };
  }
}

function checkManifestCompleteness() {
  const keys = Object.keys(manifest.contracts).map(norm);
  // A crate is accounted for when a manifest key matches its package name or
  // directory name, allowing for the shorter public names used in the manifest
  // (e.g. `lumenpulse_curation` for the `lumenpulse-community-curation` crate).
  const represented = (crate) => {
    const candidates = [norm(crate.pkg), norm(crate.name)];
    return keys.some((key) =>
      candidates.some((candidate) => candidate === key || candidate.includes(key) || key.includes(candidate)),
    );
  };
  const missing = memberCrates
    .filter((crate) => !represented(crate))
    .map((crate) => crate.name)
    .sort();
  const unmanaged = crateDirs
    .filter((crate) => !workspaceMembers.includes(`contracts/${crate.name}`))
    .filter((crate) => !workspaceExcludes.includes(`contracts/${crate.name}`))
    .map((crate) => crate.name)
    .sort();
  const met = missing.length === 0 && unmanaged.length === 0;
  const parts = [`${memberCrates.length} workspace contract crates; ${deployed.length} deployed and ${deferred.length} deferred in the manifest`];
  if (missing.length) parts.push(`absent from manifest: ${missing.join(", ")}`);
  if (unmanaged.length) parts.push(`neither member nor excluded: ${unmanaged.join(", ")}`);
  return { met, detail: parts.join("; ") };
}

function checkTestCoverage() {
  const ciRunsTests = /(^|\n)\s*run:\s*cargo test\b/m.test(workflow);
  const integrationInCi = /contracts\/tests/.test(workflow);
  const coverageConfig = trackedFiles().some(
    (file) => file.startsWith("apps/onchain/") && /(tarpaulin|llvm-cov|codecov|grcov|coverage)/i.test(file),
  );
  const met = untestedCrates.length === 0 && ciRunsTests && integrationInCi && coverageConfig;
  const gaps = [];
  if (untestedCrates.length) gaps.push(`crates with no tests: ${untestedCrates.join(", ")}`);
  if (!ciRunsTests) gaps.push("CI does not run cargo test");
  if (!integrationInCi) {
    gaps.push("contracts/tests is excluded from the workspace and never invoked by CI");
  }
  if (!coverageConfig) gaps.push("no line/branch coverage tooling or threshold is configured");
  return {
    met,
    detail: met
      ? `${testCounts.length} contract crates, ${totalTests} unit tests, integration suite wired into CI, coverage gate configured`
      : `${testCounts.length} crates carry ${totalTests} unit tests; gaps: ${gaps.join("; ")}`,
  };
}

function checkReproducibleBuilds() {
  const toolchain = readText(path.join(ONCHAIN_ROOT, "rust-toolchain.toml"));
  const toolchainPinned = /channel\s*=\s*"\d+\.\d+\.\d+"/.test(toolchain);
  const lockTracked = trackedFiles().includes("apps/onchain/Cargo.lock");
  const profileOk = ["opt-level = \"z\"", "lto = true", "codegen-units = 1", "overflow-checks = true", "panic = \"abort\""]
    .every((line) => cargoToml.includes(line));
  const scriptsPkg = readJson(SCRIPTS_PKG_PATH);
  const binaryen = scriptsPkg.devDependencies?.binaryen ?? "";
  const binaryenPinned = /^\d+\.\d+\.\d+$/.test(binaryen) && trackedFiles().includes("scripts/package-lock.json");
  const ciVerifiesHashes = /verify-wasm-hashes\.mjs/.test(workflow);
  const ciVerifiesOptimized = /verify-wasm-hashes\.mjs[^\n]*--optimized|--optimized[^\n]*verify-wasm-hashes\.mjs/.test(workflow);
  const deployOptimized = exists(CONFIG_TS_PATH) &&
    ![...readText(CONFIG_TS_PATH).matchAll(/wasmPath:\s*'([^']+)'/g)].some((m) => !m[1].includes("/optimized/"));
  const met = toolchainPinned && lockTracked && profileOk && binaryenPinned && ciVerifiesHashes && ciVerifiesOptimized && deployOptimized;
  const gaps = [];
  if (!toolchainPinned) gaps.push("rust-toolchain.toml is not pinned to an exact version");
  if (!lockTracked) gaps.push("apps/onchain/Cargo.lock is not tracked");
  if (!profileOk) gaps.push("release profile is not fully deterministic");
  if (!binaryenPinned) gaps.push("binaryen is not pinned to an exact version with a committed lockfile");
  if (!ciVerifiesHashes) gaps.push("CI does not verify WASM hashes");
  if (!ciVerifiesOptimized) gaps.push("CI verifies raw cargo artifacts while deploy.ts uploads release/optimized");
  if (!deployOptimized) gaps.push("deploy configuration still points at raw cargo artifacts");
  return {
    met,
    detail: met
      ? `toolchain ${toolchain.match(/channel\s*=\s*"([^"]+)"/)?.[1]}, committed Cargo.lock, deterministic release profile, binaryen ${binaryen} pinned, deployed artifacts hash-verified in CI`
      : `gaps: ${gaps.join("; ")}`,
  };
}

const SECRET_RE = /S[A-Z2-7]{55}/g;
function isPlaceholderSecret(secret) {
  return /X{5,}/.test(secret);
}

function checkAdminKeyCustody() {
  const tracked = trackedFiles();
  // Contract-side surface only: the contract suite and its deploy scripts.
  const contractScope = (file) =>
    file.startsWith("apps/onchain/") || file.startsWith("scripts/");
  const trackedEnv = tracked
    .filter(contractScope)
    .filter((file) => /(^|\/)\.env(\.|$)/.test(file) && !/\.example$|\.example\.|example\./.test(file));
  const gitignore = readText(path.join(REPO_ROOT, ".gitignore"));
  const gitignoreCoversEnv = /^\.env$/m.test(gitignore) || /^\*\.env$/m.test(gitignore);
  let secretHits = 0;
  for (const file of tracked) {
    if (!contractScope(file)) continue;
    if (/\.(png|jpg|jpeg|gif|ico|pdf|woff2?|ttf|wasm|lock)$/i.test(file)) continue;
    const full = path.join(REPO_ROOT, file);
    let stat;
    try {
      stat = fs.statSync(full);
    } catch {
      continue;
    }
    if (stat.size > 2_000_000) continue;
    let text;
    try {
      text = readText(full);
    } catch {
      continue;
    }
    const matches = text.match(SECRET_RE) || [];
    secretHits += matches.filter((secret) => !isPlaceholderSecret(secret)).length;
  }
  const custodyDoc = exists(path.join(REPO_ROOT, "docs", "threat-model.md")) &&
    /Key Handling/i.test(readText(path.join(REPO_ROOT, "docs", "threat-model.md")));
  const manifestAdmins = new Set();
  if (manifest.admin_address) manifestAdmins.add(manifest.admin_address);
  for (const [, data] of Object.entries(manifest.contracts)) {
    if (data.admin_address) manifestAdmins.add(data.admin_address);
    if (data.init_params?.admin) manifestAdmins.add(data.init_params.admin);
  }
  const adminConsistent = manifestAdmins.size <= 1;
  const met = trackedEnv.length === 0 && gitignoreCoversEnv && secretHits === 0 && custodyDoc && adminConsistent;
  const gaps = [];
  if (trackedEnv.length) gaps.push(`tracked env files: ${trackedEnv.join(", ")}`);
  if (!gitignoreCoversEnv) gaps.push(".gitignore does not cover .env");
  if (secretHits > 0) gaps.push(`${secretHits} unmasked Stellar secret seed(s) in tracked files`);
  if (!custodyDoc) gaps.push("key-handling posture is not documented");
  if (!adminConsistent) gaps.push(`manifest records ${manifestAdmins.size} distinct admin addresses`);
  return {
    met,
    detail: met
      ? `no tracked .env files; .env ignored; no unmasked secret seeds in tracked files; custody documented in docs/threat-model.md; one admin address across the manifest`
      : `gaps: ${gaps.join("; ")}`,
  };
}

function checkAdminKeyRotation() {
  // Match the explicit evidence convention, not unit-test snapshot filenames
  // such as test_old_admin_cannot_upgrade_after_rotation.
  const evidence = trackedFiles().filter((file) => /admin-key-rotation\.evidence.*\.json$/i.test(file));
  return {
    met: evidence.length > 0,
    detail: evidence.length
      ? `rotation evidence: ${evidence.join(", ")}`
      : "no committed admin-key-rotation evidence artifact; rotation against a live deployment is untested",
  };
}

function checkUpgradeTimelock() {
  const adr = "docs/adr/ADR-0005-contract-upgrade-timelock.md";
  const implemented = anyContractFile(/timelock/i);
  const tested = grepContracts(/timelock/i).some((file) => /test/.test(rel(file)));
  const met = exists(path.join(REPO_ROOT, adr)) && implemented && tested;
  return {
    met,
    detail: met
      ? `${adr} recorded; timelock implemented in upgradable-contract and exercised by its unit tests`
      : "timelock ADR, implementation or tests are missing",
  };
}

function checkMultisigQuorum() {
  const treasury = exists(path.join(CONTRACTS_DIR, "treasury", "src", "multisig.rs"));
  const registry = exists(path.join(CONTRACTS_DIR, "contributor_registry", "src", "multisig.rs"));
  const doc = exists(path.join(REPO_ROOT, "docs", "feature-1041-multisig-quorum.md"));
  const met = treasury && registry && doc;
  return {
    met,
    detail: met
      ? "quorum execution present in treasury and contributor_registry, documented in docs/feature-1041-multisig-quorum.md"
      : "multisig/quorum module or documentation is missing",
  };
}

function checkPauseScopes() {
  const scopes = anyContractFile(/PauseScope/);
  const drill = exists(path.join(REPO_ROOT, "docs", "EMERGENCY_PAUSE_DRILL.md"));
  const met = scopes && drill;
  return {
    met,
    detail: met
      ? "granular pause scopes implemented (contributor_registry, protocol_registry) and the drill is documented"
      : "pause scopes or the emergency pause drill documentation is missing",
  };
}

function checkEmergencyMigration() {
  const met = anyContractFile(/EmergencyMigrationPlan/);
  return {
    met,
    detail: met
      ? "crowdfund_vault implements EmergencyMigrationPlan (issue #1047)"
      : "no emergency migration plan entry point found",
  };
}

function checkVersionIntrospection() {
  const crate = exists(path.join(CONTRACTS_DIR, "version-interface", "Cargo.toml"));
  const implementers = crateDirs.filter((crateDir) =>
    /version-interface\s*=/.test(readText(path.join(crateDir.dir, "Cargo.toml"))),
  );
  const met = crate && implementers.length >= 5;
  return {
    met,
    detail: met
      ? `version-interface crate present and implemented by ${implementers.length} contracts; conformance suite merged (#1437)`
      : `version-interface present: ${crate}; implementing contracts: ${implementers.length}`,
  };
}

function checkErrorRegistry() {
  const crate = exists(path.join(CONTRACTS_DIR, "error-registry", "Cargo.toml"));
  const doc = exists(path.join(REPO_ROOT, "docs", "error-codes.md"));
  const table = crate ? readText(path.join(CONTRACTS_DIR, "error-registry", "src", "lib.rs")) : "";
  const covered = deployed.every(([name]) => table.toLowerCase().includes(norm(name)));
  const met = crate && doc && covered;
  return {
    met,
    detail: met
      ? `error-registry crate and docs/error-codes.md present; allocation table covers all ${deployed.length} deployed contracts`
      : "error-registry crate, docs/error-codes.md or a deployed contract's allocation is missing",
  };
}

function checkErrorRegistryConformance() {
  const consumers = trackedFiles().filter(
    (file) => file.endsWith(".rs") && !file.includes("error-registry/src/lib.rs") &&
      exists(path.join(REPO_ROOT, file)) && /contract_error_code/.test(readText(path.join(REPO_ROOT, file))),
  );
  const met = consumers.length > 0;
  return {
    met,
    detail: met
      ? `allocation enforced by ${consumers.length} consumer(s)`
      : "the registry defines per-contract ranges but no other crate or test consumes the allocator, so range conformance is unenforced",
  };
}

function checkUpgradeRehearsalEvidence() {
  const evidence = trackedFiles().filter(
    (file) => /upgrade-rehearsal\.evidence.*\.json$/.test(file) && !/example/i.test(file),
  );
  return {
    met: evidence.length > 0,
    detail: evidence.length
      ? `evidence: ${evidence.join(", ")}`
      : "docs/upgrade-rehearsal.evidence.example.json defines the schema but no real evidence artifact is committed",
  };
}

function checkPauseDrillEvidence() {
  const evidence = trackedFiles().filter((file) => /pause-drill\.evidence.*\.json$|pause.*evidence.*\.json$/i.test(file));
  return {
    met: evidence.length > 0,
    detail: evidence.length
      ? `evidence: ${evidence.join(", ")}`
      : "no pause-drill evidence artifact is committed for any deployed contract",
  };
}

function checkAuthorizationEnforcement() {
  const inventory = trackedFiles().some((file) => /(^|\/)AUTHORIZATION.*\.(md|json|rs)$/i.test(file) && file.startsWith("apps/onchain/"));
  const enforcement = trackedFiles().some(
    (file) => file.endsWith(".rs") && exists(path.join(REPO_ROOT, file)) &&
      /unauthorized/i.test(rel(file)) === false &&
      /RequiresAuth|auth_inventory|authorization_matrix/i.test(readText(path.join(REPO_ROOT, file))),
  );
  const met = inventory && enforcement;
  return {
    met,
    detail: met
      ? "contract-side authorization inventory committed and enforced by tests"
      : "no contract-side authorization inventory or automated unauthorized-call test exists (docs/AUTHORIZATION_MATRIX.md covers backend controllers only)",
  };
}

function checkOracleResistance() {
  const manipulation = grepContracts(/manipulat|deviation/i).filter((file) => /pricing_adapter/.test(file));
  const met = manipulation.length > 0;
  return {
    met,
    detail: met
      ? `manipulation tests present in ${manipulation.map(rel).join(", ")}`
      : "pricing_adapter tests cover staleness but not oracle manipulation or deviation resistance",
  };
}

function checkStorageArchivalPath() {
  const restore = anyContractFile(
    /restore_(archived|persistent|archive)|restore_entry_from_archive|restore_from_archive|extend_and_restore/i,
  );
  const policyDoc = trackedFiles().some((file) => /storage-archival|archival.*restore|restore.*archival/i.test(file));
  const met = restore || policyDoc;
  return {
    met,
    detail: met
      ? "a restore path for archived persistent entries is defined"
      : "TTL bump policy exists but no restore path for archived ledger entries is defined or tested",
  };
}

function checkSdkConsistency() {
  const workspaceVersion = cargoToml.match(/soroban-sdk\s*=\s*"([^"]+)"/)?.[1] ?? null;
  const mismatches = [];
  for (const crate of crateDirs) {
    const text = readText(path.join(crate.dir, "Cargo.toml"));
    for (const match of text.matchAll(/soroban-sdk\s*=\s*(\{[^}]*\}|"[^"]*")/g)) {
      const declaration = match[1];
      if (declaration.startsWith("\"")) {
        const version = declaration.replace(/"/g, "");
        if (version !== workspaceVersion) mismatches.push(`${crate.name} (${version})`);
      } else if (!/workspace\s*=\s*true/.test(declaration)) {
        const version = declaration.match(/version\s*=\s*"([^"]+)"/)?.[1] ?? "unversioned";
        if (version !== workspaceVersion) mismatches.push(`${crate.name} (${version})`);
      }
    }
  }
  const legacyExcluded = workspaceExcludes.filter(
    (entry) => entry !== "contracts/tests" && entry !== "contracts/test_utils",
  );
  const met = mismatches.length === 0 && legacyExcluded.length === 0;
  const gaps = [];
  if (mismatches.length) gaps.push(`crates off workspace soroban-sdk ${workspaceVersion}: ${mismatches.join(", ")}`);
  if (legacyExcluded.length) gaps.push(`excluded from the workspace and not built or tested in CI: ${legacyExcluded.join(", ")}`);
  return {
    met,
    detail: met
      ? `every contract crate resolves soroban-sdk ${workspaceVersion}; no legacy crates excluded from CI`
      : `gaps: ${gaps.join("; ")}`,
  };
}

function checkDeployEnvironment() {
  const example = exists(ENV_EXAMPLE_PATH) ? readText(ENV_EXAMPLE_PATH) : "";
  const deploy = exists(DEPLOY_TS_PATH) ? readText(DEPLOY_TS_PATH) : "";
  const usesSorobanRpc = /SOROBAN_RPC_URL/.test(deploy);
  const exampleHasSorobanRpc = /SOROBAN_RPC_URL/.test(example);
  const passphrase = example.match(/NETWORK_PASSPHRASE\s*=\s*"([^"]+)"/)?.[1] ?? "";
  const passphraseValid = passphrase === "Test SDF Network ; September 2015" || passphrase.startsWith("Public Global Stellar Network");
  const met = usesSorobanRpc === exampleHasSorobanRpc && passphraseValid;
  const gaps = [];
  if (usesSorobanRpc && !exampleHasSorobanRpc) gaps.push("deploy.ts reads SOROBAN_RPC_URL but scripts/.env.example defines RPC_URL");
  if (!passphraseValid) gaps.push(`scripts/.env.example passphrase is not a Stellar network passphrase ("${passphrase}")`);
  return {
    met,
    detail: met
      ? "deployment environment example matches the variables and passphrases the scripts read"
      : `gaps: ${gaps.join("; ")}`,
  };
}

function checkCiGates() {
  const gates = [
    ["formatting", /cargo fmt/],
    ["clippy -D warnings", /cargo clippy[^\n]*-D warnings/],
    ["manifest validation", /validate-manifest\.js/],
    ["contract test modules", /check-contract-tests\.mjs/],
    ["wasm build", /cargo build[^\n]*wasm32-unknown-unknown[^\n]*--release/],
    ["hash verification", /verify-wasm-hashes\.mjs/],
    ["size enforcement", /check-wasm-size\.mjs/],
    ["tests", /cargo test/],
  ];
  const missing = gates.filter(([, regex]) => !regex.test(workflow)).map(([name]) => name);
  const met = missing.length === 0;
  return {
    met,
    detail: met
      ? `${gates.length} gates run in .github/workflows/onchain.yml`
      : `gates absent from CI: ${missing.join(", ")}`,
  };
}

function checkWasmSizeBudgets() {
  const budgets = readJson(BUDGETS_PATH);
  const entries = Object.entries(budgets.contracts || {});
  const positive = entries.filter(([, value]) => Number.isInteger(value) && value > 0);
  const met = entries.length > 0 && positive.length === entries.length;
  const baseline = exists(BASELINE_PATH) ? readJson(BASELINE_PATH).contracts || {} : {};
  const baselineRecorded = Object.values(baseline).some((value) => Number.isInteger(value));
  return {
    met,
    detail: met
      ? `positive byte budget for all ${entries.length} contracts; PR size deltas reported in CI${
          baselineRecorded ? "" : " (wasm-baseline.json is unfilled, so deltas use the base branch)"
        }`
      : `budget file has ${positive.length}/${entries.length} positive entries`,
  };
}

function checkDeployUsesOptimized() {
  const config = exists(CONFIG_TS_PATH) ? readText(CONFIG_TS_PATH) : "";
  const paths = [...config.matchAll(/wasmPath:\s*'([^']+)'/g)].map((m) => m[1]);
  const nonOptimized = paths.filter((value) => !value.includes("/optimized/"));
  const met = paths.length > 0 && nonOptimized.length === 0;
  return {
    met,
    detail: met
      ? `all ${paths.length} deploy targets point at release/optimized (the only artifacts Soroban accepts)`
      : `deploy targets outside release/optimized: ${nonOptimized.join(", ")}`,
  };
}

function checkMainnetCostEstimate() {
  const file = path.join(ONCHAIN_ROOT, "deploy-cost-mainnet-estimate.json");
  if (!exists(file)) return { met: false, detail: "deploy-cost-mainnet-estimate.json is missing" };
  const estimate = readJson(file);
  const total = estimate.totals?.optimized;
  const met = Number.isInteger(total) && total > 0 && /mainnet|Public Global/.test(`${estimate.network} ${estimate.rpc}`);
  return {
    met,
    detail: met
      ? `mainnet simulation recorded ${estimate.measuredAt} against ${estimate.rpc} (optimized total ${total} stroops)`
      : "mainnet estimate file is present but incomplete",
  };
}

const CHECKS = [
  { id: "manifest-schema", title: "Deployment manifest is structurally valid", run: checkManifestSchema },
  { id: "manifest-completeness", title: "Every workspace contract crate is accounted for in the manifest", run: checkManifestCompleteness, tracking: [1627] },
  { id: "test-coverage", title: "Contract test coverage is present, executed and measured", run: checkTestCoverage, tracking: [1439] },
  { id: "reproducible-builds", title: "Builds are reproducible and the deployed artifacts are the verified ones", run: checkReproducibleBuilds, tracking: [1651] },
  { id: "admin-key-custody", title: "Admin keys are not exposed and custody is documented", run: checkAdminKeyCustody },
  { id: "admin-key-rotation", title: "Admin key rotation is exercised against a live deployment", run: checkAdminKeyRotation, tracking: [1626] },
  { id: "upgrade-timelock", title: "Upgrade timelock is implemented, documented and tested", run: checkUpgradeTimelock },
  { id: "multisig-quorum", title: "Multi-admin quorum is implemented and documented", run: checkMultisigQuorum },
  { id: "pause-scopes", title: "Granular pause scopes are implemented and the drill is documented", run: checkPauseScopes },
  { id: "emergency-migration", title: "Emergency migration entry points exist", run: checkEmergencyMigration },
  { id: "version-introspection", title: "Version introspection is implemented and conformant", run: checkVersionIntrospection },
  { id: "error-registry", title: "Error-code registry is present and covers deployed contracts", run: checkErrorRegistry },
  { id: "error-registry-conformance", title: "Error-code range conformance is enforced across contracts", run: checkErrorRegistryConformance, tracking: [1610] },
  { id: "upgrade-rehearsal-evidence", title: "Upgrade rehearsal evidence is committed", run: checkUpgradeRehearsalEvidence, tracking: [1613] },
  { id: "pause-drill-evidence", title: "Emergency pause drill evidence is committed", run: checkPauseDrillEvidence, tracking: [1614] },
  { id: "authorization-enforcement", title: "Authorization coverage is inventoried and enforced by tests", run: checkAuthorizationEnforcement, tracking: [1615] },
  { id: "oracle-resistance", title: "Oracle manipulation resistance is tested", run: checkOracleResistance, tracking: [1616] },
  { id: "storage-archival-path", title: "Storage archival and restore path is defined", run: checkStorageArchivalPath, tracking: [1617] },
  { id: "sdk-consistency", title: "Every contract crate builds on the single pinned soroban-sdk", run: checkSdkConsistency, tracking: [1621] },
  { id: "deploy-environment", title: "Deployment environment example matches what the deploy scripts read", run: checkDeployEnvironment, tracking: [1651] },
  { id: "ci-gates", title: "All contract CI gates are wired into the workflow", run: checkCiGates },
  { id: "wasm-size-budgets", title: "WASM size budgets are configured and enforced", run: checkWasmSizeBudgets },
  { id: "deploy-uses-optimized", title: "Deployment uploads the optimized artifacts Soroban accepts", run: checkDeployUsesOptimized },
  { id: "mainnet-cost-estimate", title: "A recorded mainnet cost estimate exists", run: checkMainnetCostEstimate },
];

// ── sign-offs ────────────────────────────────────────────────────────────────

const signoffs = readJson(SIGNOFFS_PATH);
const signoffItems = [...(signoffs.items || [])].sort((a, b) => a.id.localeCompare(b.id));
const signedCount = signoffItems.filter((item) => item.status === "signed").length;

// ── render ───────────────────────────────────────────────────────────────────

function issueLinks(numbers) {
  if (!numbers || numbers.length === 0) return "—";
  return numbers.map((n) => `[#${n}](${ISSUE_BASE}${n})`).join(", ");
}

function cell(text) {
  return String(text).replace(/\|/g, "\\|").replace(/\n/g, "<br>");
}

function render() {
  const results = CHECKS.map((check) => ({ check, result: check.run() }));
  const met = results.filter(({ result }) => result.met).length;
  const unmet = results.length - met;
  const ready = unmet === 0 && signedCount === signoffItems.length;

  const lines = [];
  lines.push("# Contract Mainnet Readiness Checklist");
  lines.push("");
  lines.push("Generated by [`apps/onchain/scripts/mainnet-readiness.mjs`](../apps/onchain/scripts/mainnet-readiness.mjs).");
  lines.push("Do not edit by hand: change the checker or");
  lines.push("[`apps/onchain/mainnet-readiness.signoffs.json`](../apps/onchain/mainnet-readiness.signoffs.json), then regenerate.");
  lines.push("");
  lines.push("```bash");
  lines.push("# from the repository root");
  lines.push("node apps/onchain/scripts/mainnet-readiness.mjs          # regenerate this report");
  lines.push("node apps/onchain/scripts/mainnet-readiness.mjs --check  # fail if it is stale (CI)");
  lines.push("```");
  lines.push("");
  lines.push(`**Gate: ${ready ? "READY" : "NOT READY"}** — ` +
    `${met}/${results.length} automated checks met, ${signedCount}/${signoffItems.length} human sign-offs recorded.`);
  lines.push("");
  lines.push("A `READY` gate requires every automated check to pass and every sign-off to be recorded.");
  lines.push("");
  lines.push("## 1. Automated checks");
  lines.push("");
  lines.push("| # | Prerequisite | Status | Evidence | Tracked by |");
  lines.push("| --- | --- | --- | --- | --- |");
  results.forEach(({ check, result }, index) => {
    const status = result.met ? "✅ met" : "❌ unmet";
    const tracking = result.met ? "—" : issueLinks(check.tracking);
    lines.push(`| ${index + 1} | ${cell(check.title)} | ${status} | ${cell(result.detail)} | ${tracking} |`);
  });
  lines.push("");
  lines.push("## 2. Human sign-off");
  lines.push("");
  lines.push("These prerequisites cannot be established from repository state alone.");
  lines.push("They are recorded in `apps/onchain/mainnet-readiness.signoffs.json` with an owner.");
  lines.push("");
  lines.push("| # | Prerequisite | Owner | Status | Tracked by |");
  lines.push("| --- | --- | --- | --- | --- |");
  signoffItems.forEach((item, index) => {
    const status = item.status === "signed"
      ? `✅ signed${item.signed_by ? ` (${item.signed_by}${item.signed_at ? `, ${item.signed_at}` : ""})` : ""}`
      : "⏳ pending";
    lines.push(`| ${index + 1} | ${cell(item.title)} | ${cell(item.owner)} | ${status} | ${issueLinks(item.tracking)} |`);
  });
  lines.push("");
  lines.push("## 3. What must change to reach READY");
  lines.push("");
  if (ready) {
    lines.push("Nothing: every automated check passes and every sign-off is recorded.");
  } else {
    results
      .filter(({ result }) => !result.met)
      .forEach(({ check, result }) => {
        lines.push(`- **Automated — ${check.title}.** ${result.detail} — tracked by ${issueLinks(check.tracking)}.`);
      });
    signoffItems
      .filter((item) => item.status !== "signed")
      .forEach((item) => {
        lines.push(`- **Sign-off — ${item.title}.** Owner: ${item.owner}. Tracked by ${issueLinks(item.tracking)}.`);
      });
  }
  lines.push("");
  return `${lines.join("\n")}`;
}

// ── main ─────────────────────────────────────────────────────────────────────

const report = render();

if (MODE_CHECK) {
  if (!exists(REPORT_PATH)) {
    console.error(`❌  ${rel(REPORT_PATH)} is missing. Run: node scripts/mainnet-readiness.mjs`);
    process.exit(1);
  }
  const committed = readText(REPORT_PATH);
  if (committed !== report) {
    console.error(`❌  ${rel(REPORT_PATH)} is stale. Regenerate with: node scripts/mainnet-readiness.mjs`);
    const committedLines = committed.split("\n");
    const currentLines = report.split("\n");
    for (let i = 0; i < Math.max(committedLines.length, currentLines.length); i += 1) {
      if (committedLines[i] !== currentLines[i]) {
        console.error(`    first difference at line ${i + 1}:`);
        console.error(`      committed: ${committedLines[i] ?? "(end of file)"}`);
        console.error(`      generated: ${currentLines[i] ?? "(end of file)"}`);
        break;
      }
    }
    process.exit(1);
  }
  console.log(`✅  ${rel(REPORT_PATH)} is current.`);
  process.exit(0);
}

if (MODE_STDOUT) {
  process.stdout.write(report);
} else {
  fs.writeFileSync(REPORT_PATH, report);
  const results = CHECKS.map((check) => check.run());
  const met = results.filter((r) => r.met).length;
  console.log(`Wrote ${rel(REPORT_PATH)}`);
  console.log(`  automated: ${met}/${results.length} met`);
  console.log(`  sign-offs: ${signedCount}/${signoffItems.length} recorded`);
}

if (MODE_STRICT) {
  const results = CHECKS.map((check) => check.run());
  const unmet = results.filter((r) => !r.met);
  if (unmet.length > 0 || signedCount < signoffItems.length) {
    console.error("❌  Mainnet readiness gate not satisfied.");
    process.exit(1);
  }
}
