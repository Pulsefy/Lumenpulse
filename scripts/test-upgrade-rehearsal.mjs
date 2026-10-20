import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  acquireLock,
  createFileStore,
  loadExample,
  requiredSteps,
  schemaProblems,
  validateEvidence,
  withCustomSection,
} from './upgrade-rehearsal/lib.mjs';
import { STEP_ORDER, runRehearsal } from './upgrade-rehearsal/rehearsal.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const DAY = 86_400_000;
const DELAY = 86_400;
const GRACE = 7 * 86_400;
const example = loadExample();
const sha = (buf) => crypto.createHash('sha256').update(buf).digest('hex');
const WASM = Buffer.concat([Buffer.from([0x00, 0x61, 0x73, 0x6d, 0x01, 0x00, 0x00, 0x00]), Buffer.from('contract body')]);

/** In-memory stand-in for chain.mjs with the upgradable_contract timelock semantics. */
class FakeChain {
  constructor(clock) {
    this.clock = clock;
    this.adminAddress = `G${'A'.repeat(55)}`;
    this.installed = new Set();
    this.contracts = new Map();
    this.txs = new Map();
    this.ledger = 1000;
    this.submissions = 0;
    this.crashAfterSubmit = null;
  }
  now() {
    return Math.floor(this.clock.now / 1000);
  }
  contract(id) {
    const c = this.contracts.get(id);
    if (!c) throw new Error(`no contract ${id}`);
    return c;
  }
  async submit(key, fn, onSubmitted) {
    const hash = crypto.randomBytes(32).toString('hex');
    this.submissions += 1;
    const result = fn();
    const record = { hash, ledger: ++this.ledger, ledgerTime: this.now(), returnValue: result?.ret ?? null, events: result?.events ?? [], wasmHash: result?.wasmHash };
    this.txs.set(hash, record);
    await onSubmitted?.(hash);
    if (this.crashAfterSubmit === key) {
      this.crashAfterSubmit = null;
      throw new Error('simulated crash after submission');
    }
    return record;
  }
  async awaitTransaction(hash) {
    return this.txs.get(hash);
  }
  async wasmInstalled(hash) {
    return this.installed.has(hash);
  }
  uploadWasm(wasm, cb) {
    return this.submit('upload', () => {
      this.installed.add(sha(wasm));
      return { wasmHash: sha(wasm) };
    }, cb);
  }
  contractIdFor() {
    return `C${'A'.repeat(55)}`;
  }
  async contractExists(id) {
    return this.contracts.has(id);
  }
  createContract(wasmHash, _salt, cb) {
    return this.submit('create', () => {
      assert.ok(this.installed.has(wasmHash), 'create needs installed code');
      this.contracts.set(this.contractIdFor(), { wasmHash, admin: null, count: 0, nextOp: 0, ops: new Map() });
    }, cb);
  }
  async isInitialized(id) {
    return this.contracts.has(id) && this.contract(id).admin !== null;
  }
  init(id, cb) {
    return this.submit('init', () => {
      this.contract(id).admin = this.adminAddress;
    }, cb);
  }
  increment(id, cb) {
    return this.submit('increment', () => ({ ret: ++this.contract(id).count }), cb);
  }
  async currentWasmHash(id) {
    return this.contract(id).wasmHash;
  }
  async snapshot(id) {
    const c = this.contract(id);
    return { wasm_hash: c.wasmHash, admin: c.admin, count: c.count, version: 1, contract_version: { major: 1, minor: 0, patch: 0 } };
  }
  queueUpgrade(id, wasmHash, cb) {
    return this.submit('queue', () => {
      const c = this.contract(id);
      const opId = c.nextOp++;
      const now = this.now();
      c.ops.set(opId, { wasmHash, created_at: now, execute_after: now + DELAY, expires_at: now + DELAY + GRACE });
      return { ret: opId, events: [{ topics: ['operation_queued'], data: { operation_id: opId } }] };
    }, cb);
  }
  async getOperation(id, opId) {
    const op = this.contract(id).ops.get(opId);
    return { created_at: String(op.created_at), execute_after: String(op.execute_after), expires_at: String(op.expires_at) };
  }
  status(op) {
    const now = this.now();
    return now < op.execute_after ? 'Pending' : now > op.expires_at ? 'Expired' : 'Ready';
  }
  async operationStatus(id, opId) {
    return { status: this.status(this.contract(id).ops.get(opId)), ledger: this.ledger, ledgerTime: this.now() };
  }
  async simulateExecute(id, opId) {
    const status = this.status(this.contract(id).ops.get(opId));
    const notReady = status === 'Pending';
    return { ok: status === 'Ready', notReady, error: notReady ? 'HostError: Error(Contract, #6)' : undefined, ledger: this.ledger, ledgerTime: this.now() };
  }
  execute(id, opId, cb) {
    return this.submit('execute', () => {
      const c = this.contract(id);
      const op = c.ops.get(opId);
      assert.equal(this.status(op), 'Ready', 'fake rejects early execution');
      assert.ok(this.installed.has(op.wasmHash), 'upgrade target must be installed');
      c.ops.delete(opId);
      c.wasmHash = op.wasmHash;
      return { events: [{ topics: ['upgraded'], data: op.wasmHash }, { topics: ['operation_executed'], data: opId }] };
    }, cb);
  }
}

function harness({ start = Date.parse('2026-10-01T00:00:00Z'), ...overrides } = {}) {
  const clock = { now: start };
  const chain = new FakeChain(clock);
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'rehearsal-'));
  const store = createFileStore(path.join(dir, 'state.json'));
  const manifests = [];
  const run = (opts = {}) =>
    runRehearsal({
      chain,
      store,
      example,
      now: () => new Date(clock.now),
      sleep: async (ms) => {
        clock.now += ms;
      },
      fetchImpl: async () => ({ ok: true, status: 200, text: async () => '{"environment":"testnet"}' }),
      options: {
        wasm: WASM,
        commit: 'a'.repeat(40),
        manifest: { network: 'testnet', contracts: { upgradable_contract: { reason: 'not deployed' } } },
        writeManifest: (m) => {
          manifests.push(m);
          return 'rehearsal-manifest.json';
        },
        ...overrides,
        ...opts,
      },
    });
  return { clock, chain, store, manifests, run, dir };
}

test('schema: the orchestrator emits exactly the steps the committed example defines', () => {
  assert.deepEqual(STEP_ORDER, requiredSteps(example));
  assert.deepEqual(schemaProblems(example, example), []);
});

test('schema: the placeholder example itself is not valid evidence', () => {
  const { errors } = validateEvidence(example, example);
  assert.ok(errors.some((e) => e.includes('placeholder')));
  assert.ok(errors.some((e) => e.includes('ISO-8601')));
});

test('rehearsal: advances to each timelock, exits waiting, and completes on re-runs', async () => {
  const h = harness();
  const first = await h.run();
  assert.equal(first.status, 'waiting');
  const state = h.store.load();
  assert.equal(first.resumeAfter, state.timelock.upgrade.execute_after);
  assert.deepEqual(Object.keys(state.steps), ['baseline', 'queued', 'early_execution_rejected']);

  // Re-running before the delay elapses changes nothing and submits nothing.
  const before = h.chain.submissions;
  assert.equal((await h.run()).status, 'waiting');
  assert.equal(h.chain.submissions, before);

  h.clock.now += DAY + 60_000;
  const second = await h.run();
  assert.equal(second.status, 'waiting');
  assert.equal(second.resumeAfter, h.store.load().timelock.rollback.execute_after);

  h.clock.now += DAY + 60_000;
  const done = await h.run();
  assert.equal(done.status, 'complete');

  const evidence = done.evidence;
  const report = validateEvidence(evidence, example, { now: new Date(h.clock.now) });
  assert.deepEqual(report.errors, []);
  assert.equal(report.stale, false);
  assert.equal(evidence.timelock_delay_seconds, DELAY);
  assert.equal(evidence.rollback_wasm_hash, evidence.original_wasm_hash);
  assert.equal(evidence.original_wasm_hash, sha(WASM));
  assert.notEqual(evidence.upgraded_wasm_hash, evidence.original_wasm_hash);
  assert.deepEqual(evidence.steps.map((s) => s.name), STEP_ORDER);
  assert.equal(evidence.steps.find((s) => s.name === 'backend_verification').status, 'skipped');

  const contract = h.chain.contract(evidence.contract_id);
  assert.equal(contract.wasmHash, evidence.original_wasm_hash, 'rolled back on-chain');
  assert.equal(contract.count, 1, 'storage marker survived upgrade and rollback');
  assert.deepEqual(h.manifests.map((m) => m.contracts.upgradable_contract.wasm_hash), [evidence.upgraded_wasm_hash, evidence.original_wasm_hash]);
});

test('rehearsal: --wait sleeps through both delays in one invocation', async () => {
  const h = harness({ backendUrl: 'http://backend.test' });
  const result = await h.run({ wait: true });
  assert.equal(result.status, 'complete');
  assert.equal(result.evidence.steps.find((s) => s.name === 'backend_verification').status, 'passed');
  assert.deepEqual(validateEvidence(result.evidence, example, { now: new Date(h.clock.now), strict: true }).errors, []);
  const t = result.evidence.timelock;
  for (const phase of [t.upgrade, t.rollback]) {
    assert.ok(Date.parse(phase.executed_at) >= Date.parse(phase.execute_after));
    assert.ok(Date.parse(phase.early_rejection_at) < Date.parse(phase.execute_after));
  }
});

test('rehearsal: a completed run is not repeated; it is reported stale past the max age', async () => {
  const h = harness();
  await h.run({ wait: true });
  const submissions = h.chain.submissions;

  const again = await h.run({ maxAgeDays: 30 });
  assert.equal(again.status, 'complete');
  assert.equal(h.chain.submissions, submissions, 'idempotent: no transactions on re-run');

  h.clock.now += 31 * DAY;
  const stale = await h.run({ maxAgeDays: 30 });
  assert.equal(stale.status, 'stale');
  assert.match(stale.message, /STALE/);
  assert.equal(h.chain.submissions, submissions);

  const fresh = await h.run({ wait: true, fresh: true });
  assert.equal(fresh.status, 'complete');
  assert.notEqual(fresh.evidence.run_id, stale.evidence.run_id);
  assert.equal(fresh.evidence.contract_id, stale.evidence.contract_id, 'reuses the dedicated instance');
  assert.notEqual(fresh.evidence.upgraded_wasm_hash, stale.evidence.upgraded_wasm_hash);
});

test('rehearsal: --new is refused while a rehearsal is in progress', async () => {
  const h = harness();
  await h.run();
  await assert.rejects(h.run({ fresh: true }), /still in progress/);
});

test('rehearsal: a crash after submitting resumes by polling, never resubmitting', async () => {
  const h = harness();
  h.chain.crashAfterSubmit = 'queue';
  await assert.rejects(h.run(), /simulated crash/);
  const queued = h.chain.submissions;
  assert.ok(h.store.load().transactions.upgrade_queue);

  assert.equal((await h.run()).status, 'waiting');
  assert.equal(h.chain.submissions, queued, 'queue_operation was not submitted twice');
  assert.equal(h.chain.contract(h.store.load().contract_id).ops.size, 1);
});

test('rehearsal: a missed early-execution window fails instead of recording false evidence', async () => {
  const h = harness();
  h.chain.crashAfterSubmit = 'queue';
  await assert.rejects(h.run());
  h.clock.now += DAY + 1000;
  await assert.rejects(h.run(), /early-execution window was missed/);
  assert.equal(h.store.load().steps.early_execution_rejected, undefined);
});

test('rehearsal: storage drift after the upgrade fails verification', async () => {
  const h = harness();
  await h.run();
  h.chain.contract(h.store.load().contract_id).count = 99;
  h.clock.now += DAY + 60_000;
  await assert.rejects(h.run(), /count changed/);
});

function completedEvidence() {
  const h = harness();
  return h.run({ wait: true }).then((r) => ({ evidence: r.evidence, now: new Date(h.clock.now), h }));
}

test('validator: rejects timelock, chronology and skip violations', async () => {
  const { evidence, now } = await completedEvidence();
  const check = (mutate, pattern) => {
    const copy = structuredClone(evidence);
    mutate(copy);
    const { errors } = validateEvidence(copy, example, { now });
    assert.ok(errors.some((e) => pattern.test(e)), `expected ${pattern} in ${JSON.stringify(errors)}`);
  };
  check((e) => (e.timelock.upgrade.executed_at = e.timelock.upgrade.queued_at), /executed before the timelock delay/);
  check((e) => (e.timelock.rollback.early_rejection_at = e.timelock.rollback.execute_after), /early execution was not attempted/);
  check((e) => (e.timelock_delay_seconds = 60), /must equal timelock_delay_seconds/);
  check((e) => (e.rollback_wasm_hash = e.upgraded_wasm_hash), /rollback must restore/);
  check((e) => (e.upgraded_wasm_hash = e.original_wasm_hash), /must differ/);
  check((e) => (e.network = 'mainnet'), /testnet/);
  check((e) => (e.steps = e.steps.filter((s) => s.name !== 'rollback_executed')), /missing rollback_executed/);
  check((e) => e.steps.reverse(), /order/);
  check((e) => (e.steps[3].status = 'skipped'), /cannot be skipped/);
  check((e) => (e.steps[4].output = '   '), /captured output/);
  check((e) => delete e.timelock.upgrade.ready_at, /timelock.upgrade.ready_at: missing/);

  const strict = validateEvidence(evidence, example, { now, strict: true });
  assert.ok(strict.errors.some((e) => /skipped \(not allowed with --strict\)/.test(e)));
  assert.equal(validateEvidence(evidence, example, { now }).warnings.length, 1);
});

test('validator CLI: exit 0 when fresh, 2 when stale, 1 when invalid', async () => {
  const { evidence, h } = await completedEvidence();
  // The CLI compares against the real clock, so anchor completion to now.
  const shifted = structuredClone(evidence);
  shifted.completed_at = new Date().toISOString();
  const file = path.join(h.dir, 'evidence.json');
  const cli = (...args) => spawnSync(process.execPath, [path.join(HERE, 'validate-upgrade-rehearsal.mjs'), file, ...args], { encoding: 'utf8' });

  fs.writeFileSync(file, JSON.stringify(shifted));
  const ok = cli();
  assert.equal(ok.status, 0, ok.stderr);
  assert.match(ok.stdout, /Fresh/);

  fs.writeFileSync(file, JSON.stringify(evidence)); // completed on 2026-10-03 in fake time
  const stale = cli('--max-age-days', '0.001');
  assert.equal(stale.status, 2, stale.stderr);
  assert.match(stale.stdout, /STALE/);

  fs.writeFileSync(file, JSON.stringify(example));
  assert.equal(cli().status, 1);
});

test('wasm variant: same module plus a custom section, distinct hash', () => {
  const variant = withCustomSection(WASM, 'lumenpulse_upgrade_rehearsal', 'run-1');
  assert.ok(variant.subarray(0, WASM.length).equals(WASM));
  assert.notEqual(sha(variant), sha(WASM));
  const tail = variant.subarray(WASM.length);
  assert.equal(tail[0], 0x00, 'custom section id');
  assert.equal(tail[1], tail.length - 2, 'section size covers the body');
  assert.equal(tail.subarray(3, 3 + tail[2]).toString(), 'lumenpulse_upgrade_rehearsal');
  assert.notEqual(sha(withCustomSection(WASM, 'x', 'run-2')), sha(withCustomSection(WASM, 'x', 'run-1')));
  assert.throws(() => withCustomSection(Buffer.from('not wasm'), 'x', 'y'), /bad magic/);
});

test('lock: a held lock blocks a second run; an orphaned lock is reclaimed', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'lock-'));
  const file = path.join(dir, 'rehearsal.lock');
  const release = acquireLock(file);
  fs.writeFileSync(file, String(process.ppid)); // simulate another live holder
  assert.throws(() => acquireLock(file), /another rehearsal is running/);
  fs.writeFileSync(file, '2147483646'); // a pid that is not running
  const again = acquireLock(file);
  again();
  release();
  assert.equal(fs.existsSync(file), false);
});
