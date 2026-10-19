import test from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { activeDeployment, buildDeploymentManifest, buildRecord, previousDeployment, verifyHashes } from './deploy/lib.mjs';

test('manifest: contract ids and release hashes in the shape smoke.ts reads', () => {
  const manifest = buildDeploymentManifest({
    contractIds: { network: 'Test SDF Network ; September 2015', admin: 'GADMIN', treasury: 'CTREASURY', lumen_token: 'CTOKEN' },
    wasmHashes: { contracts: { 'treasury.wasm': { sha256: 'aa' } } },
    rpcUrl: 'https://rpc.example',
  });
  assert.equal(manifest.network, 'testnet');
  assert.equal(manifest.admin_address, 'GADMIN');
  assert.deepEqual(manifest.contracts.treasury, { id: 'CTREASURY', wasm_hash: 'aa' });
  assert.deepEqual(manifest.contracts.lumen_token, { id: 'CTOKEN' });
});

test('hashes: matching files pass, tampered and missing files are reported', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'dep-'));
  fs.writeFileSync(path.join(dir, 'a.wasm'), 'a');
  fs.writeFileSync(path.join(dir, 'b.wasm'), 'tampered');
  const sha = (s) => crypto.createHash('sha256').update(s).digest('hex');
  const expected = { contracts: { 'a.wasm': { sha256: sha('a') }, 'b.wasm': { sha256: sha('b') }, 'c.wasm': { sha256: sha('c') } } };
  const problems = verifyHashes(expected, dir);
  assert.equal(problems.length, 2);
  assert.ok(problems.some((p) => p.startsWith('b.wasm: expected')));
  assert.ok(problems.some((p) => p === 'c.wasm: missing'));
});

test('record: carries actor, version, environment and commit', () => {
  const r = buildRecord({ action: 'deploy', environment: 'testnet', version: 'v1.0.0', sha: 'abc', actor: 'alice', runUrl: 'u', manifest: {}, at: '2026-01-01T00:00:00Z' });
  assert.deepEqual([r.actor, r.version, r.environment, r.commit], ['alice', 'v1.0.0', 'testnet', 'abc']);
});

test('rollback: picks the newest deployment of a different version', () => {
  const records = [
    { version: 'v1.0.0', deployedAt: '2026-01-01T00:00:00Z' },
    { version: 'v1.1.0', deployedAt: '2026-01-02T00:00:00Z' },
    { version: 'v1.2.0', deployedAt: '2026-01-03T00:00:00Z' },
  ];
  assert.equal(activeDeployment(records).version, 'v1.2.0');
  assert.equal(previousDeployment(records, 'v1.2.0').version, 'v1.1.0');
  // After rolling back to v1.1.0 (recorded as a newer deployment) the next rollback skips it.
  const after = [...records, { version: 'v1.1.0', deployedAt: '2026-01-04T00:00:00Z' }];
  assert.equal(activeDeployment(after).version, 'v1.1.0');
  assert.equal(previousDeployment(after, 'v1.1.0').version, 'v1.2.0');
});

test('rollback: nothing to roll back to when only one version was ever deployed', () => {
  assert.equal(previousDeployment([{ version: 'v1.0.0', deployedAt: '2026-01-01T00:00:00Z' }], 'v1.0.0'), null);
  assert.equal(activeDeployment([]), null);
});
