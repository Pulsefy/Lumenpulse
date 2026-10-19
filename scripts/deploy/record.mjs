#!/usr/bin/env node
// Writes deployment-record.json (who deployed what, where, when) and a job
// summary row. Environment: ACTION, ENVIRONMENT, VERSION, GITHUB_SHA,
// GITHUB_ACTOR, RUN_URL, ROLLED_BACK_FROM (optional).
import fs from 'node:fs';
import { buildRecord } from './lib.mjs';

const flag = (n) => { const i = process.argv.indexOf(n); return i !== -1 ? process.argv[i + 1] : undefined; };
const record = buildRecord({
  action: process.env.ACTION,
  environment: process.env.ENVIRONMENT,
  version: process.env.VERSION,
  sha: process.env.RELEASE_SHA || process.env.GITHUB_SHA,
  actor: process.env.GITHUB_ACTOR,
  runUrl: process.env.RUN_URL,
  rolledBackFrom: process.env.ROLLED_BACK_FROM || null,
  manifest: JSON.parse(fs.readFileSync(flag('--manifest'), 'utf8')),
});
fs.writeFileSync(flag('--out') ?? 'deployment-record.json', JSON.stringify(record, null, 2) + '\n');

const rows = [
  '### Deployment recorded',
  '',
  '| Field | Value |',
  '|---|---|',
  `| Action | ${record.action} |`,
  `| Environment | ${record.environment} |`,
  `| Version | ${record.version} |`,
  `| Commit | \`${record.commit}\` |`,
  `| Actor | ${record.actor} |`,
  `| Time | ${record.deployedAt} |`,
  ...(record.rolledBackFrom ? [`| Rolled back from | ${record.rolledBackFrom} |`] : []),
];
if (process.env.GITHUB_STEP_SUMMARY) fs.appendFileSync(process.env.GITHUB_STEP_SUMMARY, rows.join('\n') + '\n');
