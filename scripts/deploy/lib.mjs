// Pure helpers for the deployment workflow (issue #1726): manifest building,
// hash verification, deployment records and rollback selection.

import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';

/**
 * Converts scripts/deploy.ts output (contract-ids.json) plus the release's WASM
 * hashes into the manifest shape scripts/smoke.ts reads.
 */
export function buildDeploymentManifest({ contractIds, wasmHashes, networkName = 'testnet', rpcUrl }) {
  const { network: _passphrase, admin, ...ids } = contractIds;
  const contracts = {};
  for (const [name, id] of Object.entries(ids)) {
    const hash = wasmHashes?.contracts?.[`${name}.wasm`]?.sha256;
    contracts[name] = hash ? { id, wasm_hash: hash } : { id };
  }
  return { network: networkName, rpc_url: rpcUrl, admin_address: admin, contracts };
}

/** Compares the WASM files in `dir` with the hashes the release published. */
export function verifyHashes(expected, dir) {
  const problems = [];
  for (const [file, { sha256 }] of Object.entries(expected.contracts ?? {})) {
    const full = path.join(dir, file);
    if (!fs.existsSync(full)) {
      problems.push(`${file}: missing`);
      continue;
    }
    const actual = crypto.createHash('sha256').update(fs.readFileSync(full)).digest('hex');
    if (actual !== sha256) problems.push(`${file}: expected ${sha256}, got ${actual}`);
  }
  return problems;
}

/** One line per deployment: who, what, where, when. Stored as a workflow artifact. */
export function buildRecord({ action, environment, version, sha, actor, runUrl, manifest, rolledBackFrom = null, at = new Date().toISOString() }) {
  return { action, environment, version, commit: sha, actor, runUrl, deployedAt: at, rolledBackFrom, manifest };
}

/**
 * Picks the rollback target: the most recent deployment whose version differs
 * from the one currently active. `records` may be in any order.
 */
export function previousDeployment(records, activeVersion) {
  const ordered = [...records].sort((a, b) => b.deployedAt.localeCompare(a.deployedAt));
  return ordered.find((r) => r.version !== activeVersion) ?? null;
}

/** The active deployment is simply the newest record. */
export function activeDeployment(records) {
  return [...records].sort((a, b) => b.deployedAt.localeCompare(a.deployedAt))[0] ?? null;
}
