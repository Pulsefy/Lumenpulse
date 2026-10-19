import test from 'node:test';
import assert from 'node:assert/strict';
import { findUnpinned } from './check-action-pins.mjs';
import fs from 'node:fs';
import path from 'node:path';

const SHA = '11d5960a326750d5838078e36cf38b85af677262';

test('accepts SHA-pinned references with a version comment', () => {
  assert.deepEqual(findUnpinned(`      - uses: actions/checkout@${SHA} # v4.4.0`), []);
  assert.deepEqual(findUnpinned(`        uses: actions/setup-node@${SHA} # v4.4.0`), []);
});

test('rejects tags, branches and short SHAs', () => {
  for (const ref of ['actions/checkout@v4', 'owner/repo@main', 'owner/repo@11d5960']) {
    const problems = findUnpinned(`      - uses: ${ref}`);
    assert.equal(problems.length, 1, ref);
  }
});

test('rejects a pinned SHA that lacks the version comment', () => {
  assert.equal(findUnpinned(`      - uses: actions/checkout@${SHA}`).length, 1);
});

test('local actions are exempt and docker images need a digest', () => {
  assert.deepEqual(findUnpinned('      - uses: ./.github/actions/setup-node-app'), []);
  assert.equal(findUnpinned('      - uses: docker://alpine:3.20').length, 1);
});

test('every workflow and action in this repository is pinned', () => {
  const files = [];
  const walk = (dir) => {
    for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, e.name);
      if (e.isDirectory()) walk(full);
      else if (/\.ya?ml$/.test(e.name)) files.push(full);
    }
  };
  walk('.github');
  for (const f of files) {
    assert.deepEqual(findUnpinned(fs.readFileSync(f, 'utf8')), [], f);
  }
});

import { findMisordered } from './check-local-action-order.mjs';

test('local action order: flags a local action used before checkout', () => {
  const bad = `jobs:\n  build:\n    steps:\n      - uses: ./.github/actions/x\n      - uses: actions/checkout@${SHA} # v4\n`;
  assert.equal(findMisordered(bad).length, 1);
  const good = `jobs:\n  build:\n    steps:\n      - uses: actions/checkout@${SHA} # v4\n      - uses: ./.github/actions/x\n`;
  assert.deepEqual(findMisordered(good), []);
});

test('local action order: every workflow in this repository is correct', () => {
  for (const name of fs.readdirSync('.github/workflows')) {
    const source = fs.readFileSync(`.github/workflows/${name}`, 'utf8');
    assert.deepEqual(findMisordered(source), [], name);
  }
});
