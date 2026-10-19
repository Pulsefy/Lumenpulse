import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { appForFile, appsForFiles, groupByApp, latestTag, nextVersion, parseMerge, parseTag, renderChangelog } from './release/lib.mjs';
import { hashDirectory } from './release/wasm-hashes.mjs';

test('versions: bump rules and first release', () => {
  assert.equal(nextVersion(null, 'patch'), 'v0.1.0');
  assert.equal(nextVersion('v1.2.3', 'patch'), 'v1.2.4');
  assert.equal(nextVersion('v1.2.3', 'minor'), 'v1.3.0');
  assert.equal(nextVersion('v1.2.3', 'major'), 'v2.0.0');
  assert.throws(() => nextVersion('v1.2.3', 'huge'), /Unknown bump/);
  assert.throws(() => nextVersion('release-1', 'patch'), /Not a release tag/);
});

test('tags: parsing and latest stable selection', () => {
  assert.deepEqual(parseTag('v1.2.3'), { major: 1, minor: 2, patch: 3, rc: null });
  assert.equal(parseTag('1.2.3'), null);
  assert.equal(latestTag(['v0.9.0', 'v1.10.0', 'v1.2.0', 'v2.0.0-rc.1', 'junk']), 'v1.10.0');
  assert.equal(latestTag([]), null);
});

test('merges: classic merge commits and squash merges', () => {
  assert.deepEqual(parseMerge('Merge pull request #1763 from datagerl/feat/x', '\nfeat(webapp): add workspace\n'), { number: 1763, title: 'feat(webapp): add workspace' });
  assert.deepEqual(parseMerge('fix(ci): tolerate missing worktree (#1731)'), { number: 1731, title: 'fix(ci): tolerate missing worktree' });
  assert.equal(parseMerge('wip stuff'), null);
});

test('apps: files map to apps and docs-only is its own group', () => {
  assert.equal(appForFile('apps/backend/src/a.ts'), 'Backend');
  assert.equal(appForFile('apps/onchain/contracts/x/lib.rs'), 'Contracts');
  assert.equal(appForFile('.github/workflows/x.yml'), 'CI and tooling');
  assert.deepEqual(appsForFiles(['docs/a.md']), ['Documentation']);
  assert.deepEqual(appsForFiles(['apps/webapp/a.tsx', 'docs/a.md']), ['Webapp']);
  assert.deepEqual(appsForFiles(['apps/webapp/a.tsx', 'apps/backend/b.ts']).sort(), ['Backend', 'Webapp']);
});

test('changelog: grouped by app, ordered, links to PRs', () => {
  const groups = groupByApp([
    { number: 2, title: 'second', files: ['apps/backend/a.ts'] },
    { number: 1, title: 'first', files: ['apps/backend/b.ts'] },
    { number: 3, title: 'ui', files: ['apps/webapp/c.tsx'] },
  ]);
  const md = renderChangelog({ version: 'v1.0.0', date: '2026-01-01', previous: 'v0.9.0', groups });
  assert.ok(md.startsWith('## v1.0.0 - 2026-01-01'));
  assert.ok(md.indexOf('### Backend') < md.indexOf('### Webapp'));
  assert.ok(md.indexOf('first') < md.indexOf('second'));
  assert.ok(md.includes('https://github.com/Pulsefy/Lumenpulse/pull/3'));
  assert.ok(md.includes('compare/v0.9.0...v1.0.0'));
});

test('changelog: empty releases say so', () => {
  assert.ok(renderChangelog({ version: 'v1.0.1', date: '2026-01-02', previous: 'v1.0.0', groups: {} }).includes('No merged pull requests'));
});

test('wasm hashes: sha-256 and size per .wasm file, sorted', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'wasm-'));
  fs.writeFileSync(path.join(dir, 'b.wasm'), 'bb');
  fs.writeFileSync(path.join(dir, 'a.wasm'), 'a');
  fs.writeFileSync(path.join(dir, 'ignore.txt'), 'x');
  const hashes = hashDirectory(dir);
  assert.deepEqual(Object.keys(hashes), ['a.wasm', 'b.wasm']);
  assert.equal(hashes['a.wasm'].sha256, 'ca978112ca1bbdcafac231b39a23dc4da786eff8147c4e72b9807785afee48bb');
  assert.equal(hashes['b.wasm'].bytes, 2);
});

import { buildManifest } from './release/manifest.mjs';

test('release manifest: records commit, images, contract hashes and the SBOM', () => {
  const manifest = buildManifest({
    version: 'v1.2.0',
    sha: 'abc123',
    repo: 'Pulsefy/Lumenpulse',
    images: [
      { app: 'backend', image: 'ghcr.io/pulsefy/lumenpulse-backend', tag: 'v1.2.0', digest: 'sha256:aa' },
      { app: 'webapp', image: 'ghcr.io/pulsefy/lumenpulse-webapp', tag: 'v1.2.0', digest: 'sha256:bb' },
    ],
    wasm: { contracts: { 'treasury.wasm': { sha256: 'ff', bytes: 10 } } },
    sbom: 'sbom.cdx.json',
    createdAt: '2026-01-01T00:00:00.000Z',
  });
  assert.equal(manifest.version, 'v1.2.0');
  assert.equal(manifest.commit, 'abc123');
  assert.equal(manifest.images.backend.digest, 'sha256:aa');
  assert.equal(manifest.contracts['treasury.wasm'].sha256, 'ff');
  assert.equal(manifest.sbom, 'sbom.cdx.json');
  assert.equal(manifest.release, 'https://github.com/Pulsefy/Lumenpulse/releases/tag/v1.2.0');
});
