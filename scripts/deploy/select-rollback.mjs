#!/usr/bin/env node
// node scripts/deploy/select-rollback.mjs <records-dir> [--to vX.Y.Z]
// Reads every deployment-record.json under the directory and prints
// version=<target> and active=<current> for $GITHUB_OUTPUT. The record of the
// target is copied to ./rollback-record.json.
import fs from 'node:fs';
import path from 'node:path';
import { activeDeployment, previousDeployment } from './lib.mjs';

const dir = process.argv[2];
const toIndex = process.argv.indexOf('--to');
const explicit = toIndex !== -1 ? process.argv[toIndex + 1] : '';

function* files(root) {
  for (const e of fs.readdirSync(root, { withFileTypes: true })) {
    const full = path.join(root, e.name);
    if (e.isDirectory()) yield* files(full);
    else if (e.name === 'deployment-record.json') yield full;
  }
}

const records = dir && fs.existsSync(dir) ? [...files(dir)].map((f) => JSON.parse(fs.readFileSync(f, 'utf8'))) : [];
const active = activeDeployment(records);
if (!active) {
  console.log('::error::No earlier successful deployment was found, so there is nothing to roll back to.');
  process.exit(1);
}
const target = explicit
  ? records.filter((r) => r.version === explicit).sort((a, b) => b.deployedAt.localeCompare(a.deployedAt))[0]
  : previousDeployment(records, active.version);
if (!target) {
  console.log(`::error::No earlier deployment of ${explicit || 'a different version'} was found (active: ${active.version}).`);
  process.exit(1);
}
fs.writeFileSync('rollback-record.json', JSON.stringify(target, null, 2) + '\n');
console.log(`version=${target.version}`);
console.log(`active=${active.version}`);
