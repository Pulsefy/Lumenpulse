#!/usr/bin/env node
// Fails when a job calls a local action (`uses: ./...`) before it has checked
// the repository out (the action's files do not exist on the runner yet, so the
// step dies with "Can't find 'action.yml'"). That exact mistake took Mobile,
// Data Processing and Onchain CI down on main (issue #1723 follow-up).
//
//   node scripts/check-local-action-order.mjs [dir]       (default: .github/workflows)

import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

/** Returns [{ line, job }] for each local-action step that precedes a checkout. */
export function findMisordered(source) {
  const problems = [];
  let job = null;
  let checkedOut = false;
  const lines = source.split('\n');
  lines.forEach((line, index) => {
    const jobMatch = /^  ([A-Za-z0-9_-]+):\s*$/.exec(line);
    if (jobMatch && !/^  (name|on|env|permissions|concurrency|defaults):/.test(line)) {
      job = jobMatch[1];
      checkedOut = false;
      return;
    }
    if (/^\s*(?:-\s+)?uses:\s*actions\/checkout@/.test(line)) checkedOut = true;
    if (/^\s*(?:-\s+)?uses:\s*\.\//.test(line) && !checkedOut && job) {
      problems.push({ line: index + 1, job });
    }
  });
  return problems;
}

function main() {
  const dir = process.argv[2] || '.github/workflows';
  let failed = 0;
  for (const name of fs.readdirSync(dir).filter((n) => /\.ya?ml$/.test(n))) {
    const file = path.join(dir, name);
    for (const p of findMisordered(fs.readFileSync(file, 'utf8'))) {
      failed += 1;
      console.log(`::error file=${file},line=${p.line}::Job '${p.job}' uses a local action before actions/checkout. Move the checkout step first.`);
    }
  }
  if (failed) process.exit(1);
  console.log('Every local action is used after a checkout.');
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) main();
