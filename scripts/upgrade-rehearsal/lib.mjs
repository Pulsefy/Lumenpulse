// Pure helpers for the automated contract-upgrade rehearsal (issue #1613):
// evidence schema conformance, evidence validation and staleness, the
// rehearsal WASM variant, and the on-disk state file. No network access and no
// third-party imports, so `node --test` can exercise all of it without an
// install.

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
export const REPO_ROOT = path.resolve(HERE, '../..');
export const EXAMPLE_EVIDENCE_PATH = path.join(REPO_ROOT, 'docs/upgrade-rehearsal.evidence.example.json');

export const TESTNET_PASSPHRASE = 'Test SDF Network ; September 2015';
export const SCHEMA_VERSION = 1;
export const DEFAULT_MAX_AGE_DAYS = 30;

/** Contract error codes from apps/onchain/contracts/upgradable-contract/src/errors.rs. */
export const CONTRACT_ERRORS = { OperationNotReady: 6, OperationExpired: 7 };

/** Steps that may be recorded as skipped (with a reason) outside --strict. */
export const SKIPPABLE_STEPS = new Set(['backend_verification']);

const ISO_UTC = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d+)?Z$/;
const CONTRACT_ID = /^C[A-Z2-7]{55}$/;
const WASM_HASH = /^[a-f0-9]{64}$/;
const PLACEHOLDER = /^\s*<[^>]*>\s*$/;

export function loadExample(file = EXAMPLE_EVIDENCE_PATH) {
  return JSON.parse(fs.readFileSync(file, 'utf8'));
}

/** Evidence step names, in the order the committed example lists them. */
export function requiredSteps(example) {
  return example.steps.map((step) => step.name);
}

const jsonType = (value) => (value === null ? 'null' : Array.isArray(value) ? 'array' : typeof value);

/**
 * Structural conformance with the committed example: every key the example
 * has must be present with the same JSON type, recursively. Arrays are checked
 * against their first example element; `steps` must also contain every step
 * the example names, in the example's order. Extra keys are allowed.
 */
export function schemaProblems(evidence, example) {
  const problems = [];
  const walk = (actual, expected, where) => {
    const want = jsonType(expected);
    const got = jsonType(actual);
    if (want !== got) {
      problems.push(`${where || '<root>'}: expected ${want}, got ${got}`);
      return;
    }
    if (want === 'object') {
      for (const key of Object.keys(expected)) {
        if (!(key in actual)) problems.push(`${where ? `${where}.` : ''}${key}: missing`);
        else walk(actual[key], expected[key], where ? `${where}.${key}` : key);
      }
    } else if (want === 'array' && expected.length > 0 && jsonType(expected[0]) === 'object') {
      actual.forEach((item, i) => walk(item, expected[0], `${where}[${i}]`));
    }
  };
  walk(evidence, example, '');

  if (Array.isArray(evidence?.steps)) {
    const names = evidence.steps.map((step) => step?.name);
    const required = requiredSteps(example);
    const missing = required.filter((name) => !names.includes(name));
    if (missing.length) problems.push(`steps: missing ${missing.join(', ')}`);
    const duplicates = names.filter((name, i) => names.indexOf(name) !== i);
    if (duplicates.length) problems.push(`steps: duplicated ${[...new Set(duplicates)].join(', ')}`);
    const order = names.filter((name) => required.includes(name));
    const expectedOrder = required.filter((name) => names.includes(name));
    if (order.join() !== expectedOrder.join()) problems.push('steps: not in the order the example defines');
  }
  return problems;
}

const toMs = (iso) => Date.parse(iso);

/**
 * Full evidence check: schema conformance, value sanity, timelock arithmetic
 * and chronology, and staleness against `maxAgeDays`. Staleness is reported
 * separately from errors so callers can tell "wrong" from "too old".
 */
export function validateEvidence(evidence, example, { now = new Date(), maxAgeDays = DEFAULT_MAX_AGE_DAYS, strict = false } = {}) {
  const errors = schemaProblems(evidence, example);
  const warnings = [];
  if (errors.length) return { errors, warnings, stale: false, ageDays: null };

  const isoField = (value, where) => {
    if (typeof value !== 'string' || !ISO_UTC.test(value) || Number.isNaN(toMs(value))) {
      errors.push(`${where}: must be an ISO-8601 UTC timestamp, got ${JSON.stringify(value)}`);
      return false;
    }
    return true;
  };

  if (evidence.network !== 'testnet') errors.push('network: evidence must identify the Stellar testnet');
  if (evidence.schema_version !== SCHEMA_VERSION) errors.push(`schema_version: expected ${SCHEMA_VERSION}`);
  if (!/^[a-f0-9]{7,40}$/.test(evidence.commit)) errors.push('commit: must be a git commit SHA');
  if (!CONTRACT_ID.test(evidence.contract_id)) errors.push('contract_id: must be a Soroban contract address');
  for (const key of ['original_wasm_hash', 'upgraded_wasm_hash', 'rollback_wasm_hash']) {
    if (!WASM_HASH.test(evidence[key])) errors.push(`${key}: must be a 64-character lowercase hex hash`);
  }
  if (evidence.original_wasm_hash === evidence.upgraded_wasm_hash) {
    errors.push('upgraded_wasm_hash: the upgrade artifact must differ from the original artifact');
  }
  if (evidence.rollback_wasm_hash !== evidence.original_wasm_hash) {
    errors.push('rollback_wasm_hash: rollback must restore the original (known-good) WASM');
  }
  if (!Number.isInteger(evidence.timelock_delay_seconds) || evidence.timelock_delay_seconds <= 0) {
    errors.push('timelock_delay_seconds: must be a positive integer');
  }
  const startedOk = isoField(evidence.started_at, 'started_at');
  const completedOk = isoField(evidence.completed_at, 'completed_at');
  if (startedOk && completedOk && toMs(evidence.completed_at) < toMs(evidence.started_at)) {
    errors.push('completed_at: precedes started_at');
  }

  let previousEnd = startedOk ? toMs(evidence.started_at) : -Infinity;
  for (const step of evidence.steps) {
    const where = `steps.${step.name}`;
    if (typeof step.output !== 'string' || step.output.trim() === '' || PLACEHOLDER.test(step.output)) {
      errors.push(`${where}: must include captured output, not an empty or placeholder value`);
    }
    if (step.status === 'skipped') {
      if (!SKIPPABLE_STEPS.has(step.name)) errors.push(`${where}: this step cannot be skipped`);
      else if (strict) errors.push(`${where}: skipped (not allowed with --strict)`);
      else warnings.push(`${where}: skipped — ${step.output.split('\n')[0]}`);
    } else if (step.status !== 'passed') {
      errors.push(`${where}: status must be "passed" or "skipped"`);
    }
    const a = isoField(step.started_at, `${where}.started_at`);
    const b = isoField(step.completed_at, `${where}.completed_at`);
    if (a && b) {
      if (toMs(step.completed_at) < toMs(step.started_at)) errors.push(`${where}: completed_at precedes started_at`);
      if (toMs(step.started_at) < previousEnd) errors.push(`${where}: started before the previous step completed`);
      previousEnd = toMs(step.completed_at);
    }
  }
  if (completedOk && previousEnd > toMs(evidence.completed_at)) errors.push('completed_at: precedes the last step');

  const delayMs = evidence.timelock_delay_seconds * 1000;
  for (const phase of ['upgrade', 'rollback']) {
    const t = evidence.timelock[phase];
    const where = `timelock.${phase}`;
    const fields = ['queued_at', 'execute_after', 'expires_at', 'early_rejection_at', 'ready_at', 'executed_at'];
    if (!fields.every((field) => isoField(t[field], `${where}.${field}`))) continue;
    if (!Number.isInteger(t.operation_id) || t.operation_id < 0) errors.push(`${where}.operation_id: must be a non-negative integer`);
    if (toMs(t.execute_after) - toMs(t.queued_at) !== delayMs) {
      errors.push(`${where}: execute_after - queued_at must equal timelock_delay_seconds`);
    }
    if (!(toMs(t.early_rejection_at) < toMs(t.execute_after))) {
      errors.push(`${where}: early execution was not attempted before execute_after`);
    }
    if (toMs(t.ready_at) < toMs(t.execute_after)) errors.push(`${where}: Ready observed before execute_after`);
    if (toMs(t.executed_at) < toMs(t.execute_after)) errors.push(`${where}: executed before the timelock delay elapsed`);
    if (toMs(t.executed_at) > toMs(t.expires_at)) errors.push(`${where}: executed after the operation expired`);
  }
  const { upgrade, rollback } = evidence.timelock;
  if (ISO_UTC.test(upgrade.executed_at) && ISO_UTC.test(rollback.queued_at) && toMs(rollback.queued_at) < toMs(upgrade.executed_at)) {
    errors.push('timelock.rollback: queued before the upgrade executed');
  }
  if (upgrade.operation_id === rollback.operation_id) errors.push('timelock: upgrade and rollback reuse one operation id');

  const ageDays = completedOk ? (now.getTime() - toMs(evidence.completed_at)) / 86_400_000 : null;
  const stale = ageDays !== null && ageDays > maxAgeDays;
  return { errors, warnings, stale, ageDays };
}

/** A human-readable freshness line for a validated evidence file. */
export function freshnessLine({ stale, ageDays }, maxAgeDays) {
  const age = ageDays === null ? 'unknown age' : `${ageDays.toFixed(1)} day(s) old`;
  return stale
    ? `STALE: rehearsal is ${age}; the maximum age is ${maxAgeDays} day(s). Re-run the rehearsal.`
    : `Fresh: rehearsal is ${age} (maximum ${maxAgeDays} day(s)).`;
}

// --- WASM variant -----------------------------------------------------------

function uleb128(value) {
  const bytes = [];
  do {
    let byte = value & 0x7f;
    value >>>= 7;
    if (value !== 0) byte |= 0x80;
    bytes.push(byte);
  } while (value !== 0);
  return Buffer.from(bytes);
}

/**
 * Appends a WASM custom section. Custom sections are ignored at execution
 * time, so the result behaves identically to `wasm` but has a different hash —
 * a genuine, distinct upgrade target built from the same audited code.
 */
export function withCustomSection(wasm, name, payload) {
  if (wasm.length < 8 || wasm.readUInt32LE(0) !== 0x6d736100) throw new Error('not a WASM module (bad magic)');
  const nameBytes = Buffer.from(name, 'utf8');
  const body = Buffer.concat([uleb128(nameBytes.length), nameBytes, Buffer.from(payload, 'utf8')]);
  return Buffer.concat([wasm, Buffer.from([0x00]), uleb128(body.length), body]);
}

// --- State file -------------------------------------------------------------

/** Atomic JSON write: a crash mid-write never leaves a truncated state file. */
export function writeJsonAtomic(file, value) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const tmp = `${file}.${process.pid}.tmp`;
  fs.writeFileSync(tmp, `${JSON.stringify(value, null, 2)}\n`);
  fs.renameSync(tmp, file);
}

export function createFileStore(file) {
  return {
    file,
    load: () => (fs.existsSync(file) ? JSON.parse(fs.readFileSync(file, 'utf8')) : null),
    save: (state) => writeJsonAtomic(file, state),
  };
}

/**
 * Exclusive lock so two invocations can never drive the same rehearsal at
 * once. A lock left by a process that is no longer running is reclaimed.
 */
export function acquireLock(file) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  for (let attempt = 0; attempt < 2; attempt += 1) {
    try {
      const fd = fs.openSync(file, 'wx');
      fs.writeSync(fd, String(process.pid));
      fs.closeSync(fd);
      return () => fs.rmSync(file, { force: true });
    } catch (error) {
      if (error.code !== 'EEXIST') throw error;
      const pid = Number(fs.readFileSync(file, 'utf8'));
      let alive = false;
      try {
        process.kill(pid, 0);
        alive = true;
      } catch {
        // ESRCH: the holder exited without releasing the lock.
      }
      if (alive && pid !== process.pid) throw new Error(`another rehearsal is running (pid ${pid}, lock ${file})`);
      fs.rmSync(file, { force: true });
    }
  }
  throw new Error(`could not acquire ${file}`);
}

export const unixToIso = (seconds) => new Date(Number(seconds) * 1000).toISOString();
