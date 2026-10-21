#!/usr/bin/env node
// Fails when a workflow or composite action references a third-party action by
// anything other than a full 40-character commit SHA (issue #1722).
//
// A tag or branch can be repointed by whoever owns the action, so
// `actions/checkout@v4` is a mutable reference. A pinned SHA is not. Local
// actions (`./...`) and `docker://` image references with a digest are exempt.
//
//   node scripts/check-action-pins.mjs [dir ...]      (default: .github)

import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

const SHA = /^[0-9a-f]{40}$/;
const USES = /^\s*(?:-\s+)?uses:\s*(\S+)/;

export function findUnpinned(source) {
  const problems = [];
  source.split('\n').forEach((line, index) => {
    const m = USES.exec(line);
    if (!m) return;
    const ref = m[1].replace(/^['"]|['"]$/g, '');
    if (ref.startsWith('./')) return;
    if (ref.startsWith('docker://')) {
      if (!/@sha256:[0-9a-f]{64}$/.test(ref)) problems.push({ line: index + 1, ref, reason: 'docker image is not pinned to a digest' });
      return;
    }
    const at = ref.lastIndexOf('@');
    const version = at === -1 ? '' : ref.slice(at + 1);
    if (!SHA.test(version)) problems.push({ line: index + 1, ref, reason: 'not pinned to a full commit SHA' });
    else if (!/#\s*\S+/.test(line.slice(line.indexOf(ref) + ref.length))) {
      problems.push({ line: index + 1, ref, reason: 'missing the "# <version>" comment' });
    }
  });
  return problems;
}

function* walk(dir) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) yield* walk(full);
    else if (/\.ya?ml$/.test(entry.name)) yield full;
  }
}

function main() {
  const roots = process.argv.slice(2);
  const dirs = roots.length ? roots : ['.github'];
  let failed = 0;
  for (const dir of dirs) {
    for (const file of walk(dir)) {
      for (const p of findUnpinned(fs.readFileSync(file, 'utf8'))) {
        failed += 1;
        console.log(`::error file=${file},line=${p.line}::${p.ref} - ${p.reason}. Pin it: uses: owner/repo@<40-char sha> # vX.Y.Z (see docs/threat-model.md).`);
      }
    }
  }
  if (failed) {
    console.error(`${failed} unpinned action reference(s).`);
    process.exit(1);
  }
  console.log('All action references are pinned to commit SHAs.');
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) main();
