#!/usr/bin/env node
// Validates upgrade-rehearsal evidence against the committed example schema
// (docs/upgrade-rehearsal.evidence.example.json) and reports staleness.
//
// Usage: node scripts/validate-upgrade-rehearsal.mjs <evidence.json> [--max-age-days N] [--strict]
//   --max-age-days  evidence older than this is stale (default 30, or UPGRADE_REHEARSAL_MAX_AGE_DAYS)
//   --strict        skipped optional steps (backend_verification) are errors
// Exit codes: 0 valid and fresh · 1 invalid · 2 valid but stale.

import fs from 'node:fs';
import path from 'node:path';
import { parseArgs } from 'node:util';
import { DEFAULT_MAX_AGE_DAYS, REPO_ROOT, freshnessLine, loadExample, validateEvidence } from './upgrade-rehearsal/lib.mjs';

const { values, positionals } = parseArgs({
  allowPositionals: true,
  options: {
    'max-age-days': { type: 'string', default: process.env.UPGRADE_REHEARSAL_MAX_AGE_DAYS ?? String(DEFAULT_MAX_AGE_DAYS) },
    strict: { type: 'boolean', default: false },
  },
});

const requested = positionals[0];
if (!requested) {
  console.error('Usage: node scripts/validate-upgrade-rehearsal.mjs <evidence.json> [--max-age-days N] [--strict]');
  process.exit(1);
}

// npm run --prefix scripts runs from scripts/, so also try paths relative to the repo root.
const evidencePath = [path.resolve(requested), path.resolve(REPO_ROOT, requested)].find((p) => fs.existsSync(p));
if (!evidencePath) {
  console.error(`❌ Evidence file not found: ${requested}`);
  process.exit(1);
}

const maxAgeDays = Number(values['max-age-days']);
const evidence = JSON.parse(fs.readFileSync(evidencePath, 'utf8'));
const report = validateEvidence(evidence, loadExample(), { maxAgeDays, strict: values.strict });

for (const warning of report.warnings) console.warn(`⚠️  ${warning}`);
if (report.errors.length) {
  console.error(`❌ ${path.relative(process.cwd(), evidencePath)} is not valid upgrade-rehearsal evidence:`);
  for (const error of report.errors) console.error(`  - ${error}`);
  process.exit(1);
}
console.log(`✅ Upgrade rehearsal evidence is complete: ${evidence.steps.length} recorded steps.`);
console.log(freshnessLine(report, maxAgeDays));
process.exit(report.stale ? 2 : 0);
