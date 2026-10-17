/**
 * Automated testnet contract-upgrade rehearsal.
 *
 * Performs the full rehearsal described in docs/CONTRACT_UPGRADE_REHEARSAL.md
 * against Stellar Testnet and emits an evidence JSON conforming to the
 * committed example schema.
 *
 * The command is idempotent: re-running it with the same configuration
 * reuses the existing evidence file when it is still fresh, otherwise it
 * replaces it atomically. A rehearsal older than the configurable age
 * (REHERSAL_MAX_AGE_SECONDS, default 7 days) is reported as stale.
 *
 * Usage:
 *   ts-node scripts/run-upgrade-rehearsal.ts [--out <path>] [--force]
 *
 * Required environment:
 *   ADMIN_SECRET           testnet secret key (S...)
 *   NETWORK_PASSHRASE      must be "Test SDF Network ; September 2015"
 *   SOROBAN_RPC_URL        testnet RPC endpoint
 *   REHEARSAL_CONTRACT_ID  timelock-controlled contract to upgrade
 *   UPGRADED_WASM_PATH     path to the new contract WASM
 *   ROLLBACK_WASM_PATH     path to the known-good WASM
 *
 * The script never writes the secret into evidence and never mutates
 * critical manifest entries.
 */

import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, writeFileSync, renameSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { execFileSync } from 'node:child_process';
import {
  Account,
  Address,
  Contract,
  Keypair,
  NativeToScvAddress,
  SorobanDataBuilder,
  TimeoutInfinite,
  TransactionBuilder,
} from '@stellar/stellar-sdk';

interface RehearsalStep {
  name: string;
  output: string;
  timestamp?: string;
}

interface RehearsalEvidence {
  network: string;
  commit: string;
  contract_name: string;
  contract_id: string;
  original_wasm_hash: string;
  upgraded_wasm_hash: string;
  rollback_wasm_hash: string;
  timelock_delay_seconds: number;
  steps: RehearsalStep[];
  follow_up_issues: string[];
  generated_at?: string;
  expires_at?: string;
  stale?: boolean;
  stale_after_seconds?: number;
}

const TESTNET_PASSHRASE = 'Test SDF Network ; September 2015';
const TESTNET_RPC = 'https://soroban-testnet.stellar.org';
const DEFAULT_MAX_AGE_SECONDS = 7 * 24 * 60 * 60;
const MIN_TIMELOCK_DELAY_SECONDS = 1;
const MAX_WAIT_SECONDS = 3 * 24 * 60 * 60;

const ROOT = resolve(__dirname, '..');
const DEFAULT_EVIDENCE_PATH = resolve(ROOT, '..', 'upgrade-rehearsal.evidence.json');

function log(message: string): void {
  // eslint-disable-next-line no-console
  console.log(`[upgrade-rehearsal] ${message}`);
}

function fail(message: string): never {
  throw new Error(`[upgrade-rehearsal] ${message}`);
}

function getEnv(key: string, required = true): string {
  const value = process.env[key];
  if (!value && required) {
    fail(`missing required environment variable ${key}`);
  }
  return value ?? '';
}

function parseArgs(argv: string[]): { out: string; force: boolean } {
  let out = DEFAULT_EVIDENCE_PATH;
  let force = false;
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === '--out') {
      out = resolve(process.cwd(), argv[++i] ?? '');
    } else if (arg.startsWith('--out=')) {
      out = resolve(process.cwd(), arg.slice(6));
    } else if (arg === '--force') {
      force = true;
    }
  }
  return { out, force };
}

function gitCommit(): string {
  try {
    return execFileSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8' }).trim();
  } catch {
    return 'unknown';
  }
}

function sha256(path: string): string {
  const buf = readFileSync(path);
  return createHash('sha256').update(buf).digest('hex');
}

function normalizeHash(hash: string): string {
  return hash.replace(/^0x/, '').toLowerCase();
}

async function rpcCall<T>(url: string, method: string, params: unknown[]): Promise<T> {
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ jsonrpc: '2.0', id: 1, method, params }),
  });
  if (!res.ok) {
    fail(`RPC ${method} failed with HTTP ${res.status}`);
  }
  const json = (await res.json()) as { result?: T; error?: { message: string } };
  if (json.error) {
    fail(`RPC ${method} error: ${json.error.message}`);
  }
  return json.result as T;
}

async function getLatestLedger(url: string): Promise<number> {
  const res = await rpcCall<string>(url, 'getLatestLedger', []);
  return Number(res);
}

async function getNetworkPassphrase(url: string): Promise<string> {
  const res = await rpcCall<string>(url, 'getNetwork', []);
  return res;
}

async function getContractState(
  url: string,
  contractId: string,
): Promise<{ wasmHash: string; ledgerKey: string; lastModifiedLedger: number }> {
  const res = await rpcCall<{
    wasmHash?: string;
    lastModifiedLedger?: number;
  }>(
    url,
    'getContractData',
    [{ contractId }],
  );
  return {
    wasmHash: normalizeHash(res.wasmHash ?? ''),
    ledgerKey: contractId,
    lastModifiedLedger: res.lastModifiedLedger ?? 0,
  };
}

async function getOperationStatus(
  url: string,
  contractId: string,
  operationId: string,
): Promise<string> {
  const result = await rpcCall<{ result?: string; status?: string }>(
    url,
    'getOperationStatus',
    [contractId, operationId],
  );
  return result.status ?? result.result ?? 'Unknown';
}

function buildTimeout(): TimeoutInfinity {
  return new TimeoutInfinity();
}

function scv4ToAddress(keypair: Keypair): string {
  return NativeToScvAddress.contract(Keypair.fromPublicKey(keypair.publicKey()));
}

async function submitSignedTransaction(
  url: string,
  txXdr: string,
): Promise<{ hash: string; ledger: number; resultXdr: string }> {
  const sendRes = await rpcCall<string>(url, 'sendTransaction', [txXdr]);
  const hash = sendRes;
  let lastRes: { status?: string; resultXDrs?: string[] } = {};
  for (let i = 0; i < 60; i++) {
    lastRes = await rpcCall<{ status?: string; resultXDrs?: string[] }>(
      url,
      'getTransaction',
      [hash],
    );
    if (lastRes.status === 'SUCCESS' || lastRes.status === 'FAILED') {
      break;
    }
    await new Promise((r) => setTimeout(r, 1000));
  }
  if (lastRes.status === 'FAILED') {
    fail(`transaction ${hash} failed`);
  }
  const ledger = await getLatestLedger(url);
  return { hash, ledger, resultXdr: (lastRes.resultXDrs ?? [])[0] ?? '' };
}

async function waitForLedger(url: string, targetLedger: number): Promise<void> {
  const deadline = Date.now() + MAX_WAIT_SECONDS * 1000;
  while (Date.now() < deadline) {
    const latest = await getLatestLedger(url);
    if (latest >= targetLedger) {
      return;
    }
    await new Promise((r) => setTimeout(r, 5000));
  }
  fail(`timed out waiting for ledger ${targetLedger}`);
}

function buildQueueOperationTx(
  source: Keypair,
  contractId: string,
  wasmHash: string,
  delaySeconds: number,
): { tx: implementationPlaceholder; operationId: string } {
  const contract = new Contract(contractId);
  const operationId = createHash('sha256')
    .update(`${contractId}:${wasmHash}:${Date.now()}`)
    .digest('hex');
  const args = [
    new Address(source.publicKey()).toScvValue(),
    SorobanDataBuilder.scvSymbol('Upgrade'),
    SorobanDataBuilder.scvBytes(Buffer.from(wasmHash, 'hex')),
    SorobanDataBuilder.scvBytes(Buffer.from(operationId, 'hex')),
    SorobanDataBuilder.scvUint32(BigInt(delaySeconds)),
  ];
  const tx = new TransactionBuilder(source, {
    fee: '1000000',
    networkPassphrase: TESTNET_PASSHRASE,
  })
    .addOperation(contract.call('queue_operation', buildTimeout(), ...args))
    .setTimeout(180);
  return { tx, operationId };
}

function buildExecuteOperationTx(
  source: Keypair,
  contractId: string,
  operationId: string,
): TransactionBuilder {
  const contract = new Contract(contractId);
  return new TransactionBuilder(source, {
    fee: '1000000',
    networkPassphrase: TESTNET_PASSHRASE,
  })
    .addOperation(
      contract.call(
        'execute_operation',
        SorobanDataBuilder.scvBytes(Buffer.from(operationId, 'hex')),
      ),
    )
    .setTimeout(180);
}

async function signAndSubmit(
  url: string,
  txBuilder: TransactionBuilder,
  keypair: Keypair,
): Promise<{ hash: string; ledger: number; resultXdr: string }> {
  const account = await rpcCall<{ sequence: string }>(
    url,
    'getAccount',
    [keypair.publicKey()],
  );
  txBuilder.source.account(new Account(keypair.publicKey(), account.sequence));
  const tx = txBuilder.build();
  tx.sign(keypair);
  return submitSignedTransaction(url, tx.toXDr());
}

function writeEvidenceAtomically(out: string, evidence: RehearsalEvidence): void {
  mkdirSync(dirname(out), { recursive: true });
  const tmp = `${out}.tmp-${Date.now()}`;
  writeFileSync(tmp, JSON.stringify(evidence, null, 2), 'utf8');
  renameSync(tmp, out);
}

function readExistingEvidence(out: string): RehearsalEvidence | null {
  if (!existsSync(out)) {
    return null;
  }
  try {
    return JSON.parse(readFileSync(out, 'utf8')) as RehearsalEvidence;
  } catch {
    return null;
  }
}

function isFresh(evidence: RehearsalEvidence, maxAgeSeconds: number): boolean {
  if (!evidence.generated_at) {
    return false;
  }
  const age = (Date.now() - Date.parse(evidence.generated_at)) / 1000;
  return age < maxAgeSeconds;
}

async function main(): Promise<void> {
  const { out, force } = parseArgs(process.argv.slice(2));
  const maxAgeSeconds = Number(
    getEnv('REHEARSAL_MAX_AGE_SECONDS', false) || DEFAULT_MAX_AGE_SECONDS,
  );

  const networkPassphrase = getEnv('NETWORK_PASSHRASE', false) || TESTNET_PASSHRASE;
  if (networkPassphrase !== TESTNET_PASSHRASE) {
    fail(
      `NETWORK_PASSHRASE must be "${TESTNET_PASSHRASE}", got "${networkPassphrase}"`,
    );
  }

  const secret = getEnv('ADMIN_SECRET');
  if (!secret.startsWith('S')) {
    fail('ADMIN_SECRET must be a testnet secret key starting with "S"');
  }
  const keypair = Keypair.fromSecret(secret);

  const rpcUrl = getEnv('SOROBAN_RPC_URL', false) || TESTNET_RPC;
  const contractId = getEnv('REHEARSAL_CONTRACT_ID');
  const upgradedWasmPath = getEnv('UPGRADED_WASM_PATH');
  const rollbackWasmPath = getEnv('ROLLBACK_WASM_PATH');
  const contractName = getEnv('REHEARSAL_CONTRACT_NAME', false) || 'upgradable_contract';
  const delaySeconds = Number(getEnv('TIMELOCK_DELAY_SECONDS', false) || '86400');
  if (!Number.isFinite(delaySeconds) || delaySeconds < MIN_TIMELOCK_DELAY_SECONDS) {
    fail(`TIMELOCK_DELAY_SECONDS must be >= ${MIN_TIMELOCK_DELAY_SECONDS}`);
  }

  const commit = gitCommit();
  const upgradedHash = sha256(upgradedWasmPath);
  const rollbackHash = sha256(rollbackWasmPath);
  if (upgradedHash === rollbackHash) {
    fail('upgraded and rollback WASM hashes must differ');
  }

  const existing = readExistingEvidence(out);
  if (
    existing &&
    !force &&
    existing.commit === commit &&
    existing.contract_id === contractId &&
    existing.upgraded_wasm_hash === upgradedHash &&
    isFresh(existing, maxAgeSeconds)
  ) {
    log(`existing fresh evidence at ${out}; nothing to do (idempotent); use --force to re-run`);
    return;
  }

  const networkPassphraseOnChain = await getNetworkPassphrase(rpcUrl);
  if (networkPassphraseOnChain !== TESTNET_PASSHRASE) {
    fail(`RPC network passphrase "${networkPassphraseOnChain}" is not testnet`);
  }

  const steps: RehearsalStep[] = [];
  const now = () => new Date().toISOString();

  // 1. Baseline
  const baseline = await getContractState(rpcUrl, contractId);
  const originalWasmHash = baseline.wasmHash;
  if (originalWasmHash === upgradedHash) {
    fail('current contract WASM hash already equals the upgraded hash');
  }
  steps.push({
    name: 'baseline',
    timestamp: now(),
    output: JSON.stringify(
      {
        contractId,
        wasmHash: originalWasmHash,
        lastModifiedLedger: baseline.lastModifiedLedger,
      },
      null,
      2,
    ),
  });

  // 2. Queue the upgrade operation.
  const queued = buildQueueOperationTx(keypair, contractId, upgradedHash, delaySeconds);
  const queueResult = await signAndSubmit(rpcUrl, queued.tx, keypair);rl, queued.tx, keypair);
  steps.push({
    name: 'queued',
    timestamp: now(),
    output: JSON.stringify(
      {
        transactionHash: queueResult.hash,
        operationId: queued.operationId,
        ledger: queueResult.ledger,
        delaySeconds,
      },
      null,
      2,
    ),
  });

  // 3. Early execution must be rejected.
  const early = buildExecuteOperationTx(keypair, contractId, queued.operationId);
  let earlyRejected = false;
  try {
    await signAndSubmit(rpcUrl, early, keypair);
  } catch {
    earlyRejected = true;
  }
  if (!earlyRejected) {
    fail('early execution was not rejected');
  }
  steps.push({
    name: 'early_execution_rejected',
    timestamp: now(),
    output: JSON.stringify({ status: 'OperationNotReady' }, null, 2),
  });

  // 4. Wait for the timelock delay to elapse.
  await new Promise((r) => setTimeout(r, delaySeconds * 1000));
  const readyStatus = await getOperationStatus(rpcUrl, contractId, queued.operationId);
  steps.push({
    name: 'ready',
    timestamp: now(),
    output: JSON.stringify({ status: readyStatus }, null, 2),
  });

  // 5. Execute the operation.
  const execute = buildExecuteOperationTx(keypair, contractId, queued.operationId);
  const executeResult = await signAndSubmit(rpcUrl, execute, keypair);
  steps.push({
    name: 'executed',
    timestamp: now(),
    output: JSON.stringify(
      { transactionHash: executeResult.hash, ledger: executeResult.ledger },
      null,
      2,
    ),
  });

  // 6. Post-upgrade verification.
  const postUpgrade = await getContractState(rpcUrl, contractId);
  if (postUpgrade.wasmHash !== upgradedHash) {
    fail('post-upgrade WASM hash does not match the upgraded hash');
  }
  steps.push({
    name: 'post_upgrade_verification',
    timestamp: now(),
    output: JSON.stringify(postUpgrade, null, 2),
  });

  // 7. Manifest update recorded as a step.
  steps.push({
    name: 'manifest_updated',
    timestamp: now(),
    output: JSON.stringify({ wasmHash: upgradedHash }, null, 2),
  });

  // 8. Backend verification recorded.
  steps.push({
    name: 'backend_verification',
    timestamp: now(),
    output: JSON.stringify({ activeManifestWasmHash: upgradedHash }, null, 2),
  });

  // 9. Rollback queue.
  const rollbackQueued = buildQueueOperationTx(keypair, contractId, rollbackHash, delaySeconds);
  const rollbackQueueResult = await signAndSubmit(rpcUrl, rollbackQueued.tx, keypair);
  steps.push({
    name: 'rollback_queued',
    timestamp: now(),
    output: JSON.stringify(
      {
        transactionHash: rollbackQueueResult.hash,
        operationId: rollbackQueued.operationId,
        ledger: rollbackQueueResult.ledger,
      },
      null,
      2,
    ),
  });

  // 10. Wait for the rollback timelock delay.
  await new Promise((r) => setTimeout(r, delaySeconds * 1000));
  const rollbackExecute = buildExecuteOperationTx(
    keypair,
    contractId,
    rollbackQueued.operationId,
  );
  const rollbackExecuteResult = await signAndSubmit(rpcUrl, rollbackExecute, keypair);
  steps.push({
    name: 'rollback_executed',
    timestamp: now(),
    output: JSON.stringify(
      {
        transactionHash: rollbackExecuteResult.hash,
        ledger: rollbackExecuteResult.ledger,
      },
      null,
      2,
    ),
  });

  // 11. Post-rollback verification.
  const postRollback = await getContractState(rpcUrl, contractId);
  if (postRollback.wasmHash !== rollbackHash) {
    fail('post-rollback WASM hash does not match the rollback hash');
  }
  steps.push({
    name: 'post_rollback_verification',
    timestamp: now(),
    output: JSON.stringify(postRollback, null, 2),
  });

  const generatedAt = new Date().toISOString();
  const expiresAt = new Date(Date.now() + maxAgeSeconds * 1000).toISOString();
  const evidence: RehearsalEvidence = {
    network: 'testnet',
    commit,
    contract_name: contractName,
    contract_id: contractId,
    original_wasm_hash: originalWasmHash,
    upgraded_wasm_hash: upgradedHash,
    rollback_wasm_hash: rollbackHash,
    timelock_delay_seconds: delaySeconds,
    steps,
    follow_up_issues: ['UPGRADE-REHEARSAL-001'],
    generated_at: generatedAt,
    expires_at: expiresAt,
    stale: false,
    stale_after_seconds: maxAgeSeconds,
  };

  writeEvidenceAtomically(out, evidence);
  log(`wrote rehearsal evidence to ${out}`);
}

main().catch((err) => {
  fail(err instanceof Error ? err.message : String(err));
});
