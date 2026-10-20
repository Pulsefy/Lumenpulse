// Orchestrates the testnet contract-upgrade rehearsal described in
// docs/CONTRACT_UPGRADE_REHEARSAL.md (issue #1613).
//
// The rehearsal spans two timelock delays (24 h each for upgradable_contract),
// so it is a resumable state machine rather than one long-running process:
// every completed step and every submitted transaction hash is persisted
// before moving on. Re-running the command picks up where the last run
// stopped — completed steps are never repeated and a transaction that was
// submitted but not yet confirmed is polled, never resubmitted.

import crypto from 'node:crypto';
import {
  DEFAULT_MAX_AGE_DAYS,
  SCHEMA_VERSION,
  freshnessLine,
  unixToIso,
  validateEvidence,
  withCustomSection,
} from './lib.mjs';

export const CONTRACT_NAME = 'upgradable_contract';
export const REHEARSAL_SECTION = 'lumenpulse_upgrade_rehearsal';
const REHEARSAL_SALT = crypto.createHash('sha256').update('lumenpulse-upgrade-rehearsal-v1').digest();

export const STEP_ORDER = [
  'baseline',
  'queued',
  'early_execution_rejected',
  'ready',
  'executed',
  'post_upgrade_verification',
  'manifest_updated',
  'backend_verification',
  'rollback_queued',
  'rollback_early_execution_rejected',
  'rollback_ready',
  'rollback_executed',
  'post_rollback_verification',
  'manifest_restored',
];

const PHASES = {
  upgrade: { queued: 'queued', early: 'early_execution_rejected', ready: 'ready', executed: 'executed' },
  rollback: {
    queued: 'rollback_queued',
    early: 'rollback_early_execution_rejected',
    ready: 'rollback_ready',
    executed: 'rollback_executed',
  },
};

const PRESERVED_STATE = ['admin', 'count', 'version', 'contract_version'];
const json = (value) => JSON.stringify(value, null, 2);

class Waiting {
  constructor(resumeAfter, reason) {
    this.resumeAfter = resumeAfter;
    this.reason = reason;
  }
}

/**
 * @param {object} args
 * @param {object} args.chain     chain.mjs client (or a fake with the same shape)
 * @param {object} args.store     { load(), save(state) }
 * @param {object} args.example   the committed evidence example (schema)
 * @param {object} args.options   { wasm, contractId, commit, wait, fresh, maxAgeDays,
 *                                  manifest, writeManifest, backendUrl, followUps, rpcUrl }
 * @returns {Promise<{status: 'complete'|'stale'|'waiting', evidence?, resumeAfter?, message}>}
 */
export async function runRehearsal({ chain, store, example, options, now = () => new Date(), sleep, log = () => {}, fetchImpl = globalThis.fetch }) {
  const maxAgeDays = options.maxAgeDays ?? DEFAULT_MAX_AGE_DAYS;
  const iso = () => now().toISOString();
  let state = store.load();

  if (state?.completed_at && !options.fresh) {
    const evidence = buildEvidence(state, options);
    const report = validateEvidence(evidence, example, { now: now(), maxAgeDays });
    const message = freshnessLine(report, maxAgeDays);
    return { status: report.stale ? 'stale' : 'complete', evidence, message: report.stale ? `${message} Pass --new to start one.` : message };
  }
  if (state && !state.completed_at && options.fresh) {
    throw new Error(`a rehearsal started at ${state.started_at} is still in progress; re-run without --new to resume it`);
  }
  if (!state || options.fresh) {
    state = {
      schema_version: SCHEMA_VERSION,
      run_id: crypto.randomUUID(),
      started_at: iso(),
      commit: options.commit,
      contract_name: CONTRACT_NAME,
      admin_address: chain.adminAddress,
      contract_id: null,
      transactions: {},
      setup: {},
      steps: {},
      timelock: { upgrade: {}, rollback: {} },
    };
    store.save(state);
    log(`Starting rehearsal ${state.run_id}`);
  } else {
    log(`Resuming rehearsal ${state.run_id} (started ${state.started_at})`);
  }

  const save = () => store.save(state);

  /** Submit once: a recorded hash is polled on resume, never resubmitted. */
  async function transact(key, send) {
    if (state.transactions[key]) return chain.awaitTransaction(state.transactions[key]);
    return send((hash) => {
      state.transactions[key] = hash;
      save();
    });
  }

  async function step(name, fn) {
    if (state.steps[name]) return;
    const startedAt = iso();
    log(`→ ${name}`);
    const result = await fn();
    state.steps[name] = { name, status: result.status ?? 'passed', started_at: startedAt, completed_at: iso(), output: result.output };
    save();
  }

  async function ensureWasm(key, wasm, wasmHash) {
    if (await chain.wasmInstalled(wasmHash)) return `${key}: ${wasmHash} already installed`;
    const tx = await transact(`upload_${key}`, (cb) => chain.uploadWasm(wasm, cb));
    return `${key}: uploaded ${tx.wasmHash} in ${tx.hash} (ledger ${tx.ledger})`;
  }

  /** Deploys (or finds) the dedicated rehearsal instance — never a critical contract. */
  async function ensureContract() {
    if (state.contract_id) return [];
    const notes = [];
    if (options.contractId) {
      state.contract_id = options.contractId;
      notes.push(`Using existing contract ${options.contractId}`);
    } else {
      const localHash = sha256(options.wasm);
      const contractId = chain.contractIdFor(REHEARSAL_SALT);
      if (await chain.contractExists(contractId)) {
        notes.push(`Reusing dedicated rehearsal instance ${contractId}`);
      } else {
        notes.push(await ensureWasm('original', options.wasm, localHash));
        const tx = await transact('create_contract', (cb) => chain.createContract(localHash, REHEARSAL_SALT, cb));
        notes.push(`Deployed dedicated rehearsal instance ${contractId} in ${tx.hash}`);
      }
      state.contract_id = contractId;
    }
    if (!(await chain.isInitialized(state.contract_id))) {
      if (options.contractId) throw new Error(`${options.contractId} is not initialized`);
      const tx = await transact('init', (cb) => chain.init(state.contract_id, cb));
      notes.push(`Initialized with admin ${chain.adminAddress} in ${tx.hash}`);
    }
    save();
    return notes;
  }

  function assertPreserved(label, snapshot, expectedHash) {
    const problems = [];
    if (snapshot.wasm_hash !== expectedHash) problems.push(`on-chain WASM is ${snapshot.wasm_hash}, expected ${expectedHash}`);
    for (const key of PRESERVED_STATE) {
      if (json(snapshot[key]) !== json(state.baseline[key])) {
        problems.push(`${key} changed: ${json(state.baseline[key])} → ${json(snapshot[key])}`);
      }
    }
    if (problems.length) throw new Error(`${label} failed:\n  ${problems.join('\n  ')}`);
  }

  async function timelockPhase(phase, targetHash) {
    const names = PHASES[phase];
    const t = state.timelock[phase];

    await step(names.queued, async () => {
      const notes = [];
      if (phase === 'upgrade') notes.push(await ensureWasm('upgraded', upgradedWasm(), state.upgraded_wasm_hash));
      const tx = await transact(`${phase}_queue`, (cb) => chain.queueUpgrade(state.contract_id, targetHash, cb));
      const operationId = Number(tx.returnValue);
      const op = await chain.getOperation(state.contract_id, operationId);
      const delay = Number(op.execute_after) - Number(op.created_at);
      if (state.timelock_delay_seconds && state.timelock_delay_seconds !== delay) {
        throw new Error(`timelock delay changed between phases: ${state.timelock_delay_seconds}s → ${delay}s`);
      }
      state.timelock_delay_seconds = delay;
      Object.assign(t, {
        operation_id: operationId,
        target_wasm_hash: targetHash,
        queue_tx: tx.hash,
        queued_at: unixToIso(op.created_at),
        execute_after: unixToIso(op.execute_after),
        expires_at: unixToIso(op.expires_at),
      });
      return {
        output: [
          ...notes,
          `queue_operation(Upgrade(${targetHash})) tx ${tx.hash} ledger ${tx.ledger}`,
          `operation_id=${operationId} created_at=${t.queued_at} execute_after=${t.execute_after} expires_at=${t.expires_at}`,
          `timelock delay ${delay}s`,
        ].join('\n'),
      };
    });

    await step(names.early, async () => {
      const status = await chain.operationStatus(state.contract_id, t.operation_id);
      if (status.status !== 'Pending') {
        throw new Error(`operation ${t.operation_id} is already ${status.status}; the early-execution window was missed. Delete the state file and start a new rehearsal.`);
      }
      const sim = await chain.simulateExecute(state.contract_id, t.operation_id);
      if (!sim.notReady) {
        throw new Error(`execute_operation before execute_after was not rejected with OperationNotReady: ${sim.ok ? 'it succeeded' : sim.error}`);
      }
      t.early_rejection_at = unixToIso(sim.ledgerTime);
      return {
        output: [
          `get_operation_status(${t.operation_id}) = Pending at ledger ${status.ledger} (${unixToIso(status.ledgerTime)})`,
          `execute_operation(${t.operation_id}) simulated at ledger ${sim.ledger} (${t.early_rejection_at}) → rejected`,
          sim.error,
        ].join('\n'),
      };
    });

    await step(names.ready, async () => {
      for (;;) {
        const status = await chain.operationStatus(state.contract_id, t.operation_id);
        if (status.status === 'Ready') {
          t.ready_at = unixToIso(status.ledgerTime);
          return { output: `get_operation_status(${t.operation_id}) = Ready at ledger ${status.ledger} (${t.ready_at}); execute_after ${t.execute_after}` };
        }
        if (status.status !== 'Pending') {
          throw new Error(`operation ${t.operation_id} is ${status.status} (expired at ${t.expires_at}); start a new rehearsal`);
        }
        if (!options.wait) throw new Waiting(t.execute_after, `${phase} timelock pending until ${t.execute_after}`);
        const remaining = Date.parse(t.execute_after) - now().getTime();
        log(`  ${phase} timelock pending until ${t.execute_after}; sleeping`);
        await sleep(Math.min(Math.max(remaining + 10_000, 15_000), 15 * 60_000));
      }
    });

    await step(names.executed, async () => {
      const tx = await transact(`${phase}_execute`, (cb) => chain.execute(state.contract_id, t.operation_id, cb));
      t.execute_tx = tx.hash;
      t.executed_at = unixToIso(tx.ledgerTime);
      return {
        output: [`execute_operation(${t.operation_id}) tx ${tx.hash} ledger ${tx.ledger} at ${t.executed_at}`, 'events:', json(tx.events)].join('\n'),
      };
    });
  }

  function manifestStep(wasmHash) {
    const manifest = structuredClone(options.manifest);
    manifest.contracts[CONTRACT_NAME] = { id: state.contract_id, wasm_hash: wasmHash };
    const entry = manifest.contracts[CONTRACT_NAME];
    if (!/^C[A-Z2-7]{55}$/.test(entry.id) || !/^[a-f0-9]{64}$/.test(entry.wasm_hash)) {
      throw new Error(`rehearsal manifest entry is invalid: ${json(entry)}`);
    }
    const file = options.writeManifest(manifest);
    return { output: `Wrote rehearsal manifest ${file} (the canonical testnet manifest is not modified)\n${CONTRACT_NAME}: ${json(entry)}` };
  }

  const upgradedWasm = () => withCustomSection(options.wasm, REHEARSAL_SECTION, state.run_id);

  try {
    await step('baseline', async () => {
      const notes = await ensureContract();
      const snapshot = await chain.snapshot(state.contract_id);
      state.baseline = snapshot;
      state.original_wasm_hash = snapshot.wasm_hash;
      if (snapshot.count === 0) {
        // A non-zero counter is the storage marker the upgrade must preserve.
        const tx = await transact('marker', (cb) => chain.increment(state.contract_id, cb));
        notes.push(`Wrote storage marker (increment) in ${tx.hash}`);
        state.baseline = await chain.snapshot(state.contract_id);
      }
      state.upgraded_wasm_hash = sha256(upgradedWasm());
      if (state.upgraded_wasm_hash === state.original_wasm_hash) throw new Error('upgraded WASM hash equals the baseline hash');
      return {
        output: [
          `commit ${state.commit}`,
          `contract ${state.contract_id} (admin ${chain.adminAddress})`,
          ...notes,
          'baseline state:',
          json(state.baseline),
          `upgrade target: ${state.upgraded_wasm_hash} (baseline WASM + "${REHEARSAL_SECTION}" custom section for run ${state.run_id})`,
        ].join('\n'),
      };
    });

    await timelockPhase('upgrade', state.upgraded_wasm_hash);

    await step('post_upgrade_verification', async () => {
      const snapshot = await chain.snapshot(state.contract_id);
      assertPreserved('post-upgrade verification', snapshot, state.upgraded_wasm_hash);
      return { output: `on-chain WASM ${snapshot.wasm_hash} matches the upgrade target; storage preserved:\n${json(snapshot)}` };
    });

    await step('manifest_updated', async () => manifestStep(state.upgraded_wasm_hash));

    await step('backend_verification', async () => {
      if (!options.backendUrl) {
        return { status: 'skipped', output: 'skipped: BACKEND_URL is not set, so the active-manifest endpoint was not queried' };
      }
      const url = `${options.backendUrl.replace(/\/$/, '')}/v1/contracts/manifests/active?environment=testnet`;
      const res = await fetchImpl(url);
      const body = await res.text();
      if (!res.ok) throw new Error(`GET ${url} returned ${res.status}: ${body.slice(0, 500)}`);
      return { output: `GET ${url} → ${res.status}\n${body.slice(0, 4000)}` };
    });

    await timelockPhase('rollback', state.original_wasm_hash);

    await step('post_rollback_verification', async () => {
      const snapshot = await chain.snapshot(state.contract_id);
      assertPreserved('post-rollback verification', snapshot, state.original_wasm_hash);
      return { output: `on-chain WASM ${snapshot.wasm_hash} restored to the original; storage preserved:\n${json(snapshot)}` };
    });

    await step('manifest_restored', async () => manifestStep(state.original_wasm_hash));
  } catch (error) {
    if (error instanceof Waiting) {
      return {
        status: 'waiting',
        resumeAfter: error.resumeAfter,
        message: `${error.reason}. Re-run the same command after ${error.resumeAfter} (or pass --wait) to continue.`,
      };
    }
    throw error;
  }

  state.completed_at = iso();
  const evidence = buildEvidence(state, options);
  const report = validateEvidence(evidence, example, { now: now(), maxAgeDays });
  if (report.errors.length) {
    save();
    throw new Error(`generated evidence failed validation:\n  ${report.errors.join('\n  ')}`);
  }
  save();
  return { status: 'complete', evidence, message: `Rehearsal ${state.run_id} complete. ${freshnessLine(report, maxAgeDays)}` };
}

const TIMELOCK_FIELDS = ['operation_id', 'target_wasm_hash', 'queue_tx', 'queued_at', 'execute_after', 'expires_at', 'early_rejection_at', 'ready_at', 'execute_tx', 'executed_at'];

export function buildEvidence(state, options = {}) {
  const pick = (t) => Object.fromEntries(TIMELOCK_FIELDS.map((key) => [key, t[key]]));
  return {
    schema_version: state.schema_version,
    network: 'testnet',
    commit: state.commit,
    run_id: state.run_id,
    contract_name: state.contract_name,
    contract_id: state.contract_id,
    admin_address: state.admin_address,
    original_wasm_hash: state.original_wasm_hash,
    upgraded_wasm_hash: state.upgraded_wasm_hash,
    rollback_wasm_hash: state.timelock.rollback.target_wasm_hash ?? state.original_wasm_hash,
    timelock_delay_seconds: state.timelock_delay_seconds,
    started_at: state.started_at,
    completed_at: state.completed_at,
    timelock: { upgrade: pick(state.timelock.upgrade), rollback: pick(state.timelock.rollback) },
    steps: STEP_ORDER.filter((name) => state.steps[name]).map((name) => state.steps[name]),
    follow_up_issues: options.followUps ?? [],
  };
}

function sha256(buffer) {
  return crypto.createHash('sha256').update(buffer).digest('hex');
}
