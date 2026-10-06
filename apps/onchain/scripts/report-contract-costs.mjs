#!/usr/bin/env node
import fs from 'node:fs';

function arg(name, fallback) {
  const index = process.argv.indexOf(name);
  return index < 0 ? fallback : process.argv[index + 1];
}

function loadCurrent(file) {
  const rows = fs.readFileSync(file, 'utf8').split(/\r?\n/)
    .filter((line) => line.includes('SOROBAN_COST_BENCHMARK '))
    .map((line) => JSON.parse(line.slice(line.indexOf('SOROBAN_COST_BENCHMARK ') + 23)));
  if (!rows.length) throw new Error(`No benchmark rows found in ${file}`);
  const keys = new Set();
  for (const row of rows) {
    const key = `${row.contract}.${row.entrypoint}`;
    if (keys.has(key)) throw new Error(`Duplicate benchmark row: ${key}`);
    keys.add(key);
  }
  return rows;
}

function fmtDelta(current, baseline) {
  if (!baseline) return 'new';
  if (baseline === 0) return current === 0 ? '0.0%' : 'new';
  const delta = ((current - baseline) / baseline) * 100;
  return `${delta >= 0 ? '+' : ''}${delta.toFixed(1)}%`;
}

const currentFile = arg('--current', 'cost-current.log');
const baselineFile = arg('--baseline', 'cost-baseline.json');
const outputFile = arg('--output', 'cost-report.md');
const inventoryFile = arg('--inventory', 'cost-inventory.json');
const threshold = Number(arg('--threshold-percent', process.env.COST_REGRESSION_THRESHOLD_PERCENT ?? '15'));
if (!Number.isFinite(threshold) || threshold < 0) throw new Error('Threshold must be a non-negative number');
const current = loadCurrent(currentFile);
const inventory = JSON.parse(fs.readFileSync(inventoryFile, 'utf8'));
if (!Array.isArray(inventory.entrypoints)) throw new Error('Inventory is missing its entrypoints array');
const inventoryKeys = new Set(inventory.entrypoints.map((row) => `${row.contract}.${row.entrypoint}`));
if (inventoryKeys.size !== inventory.entrypoints.length) throw new Error('Inventory contains duplicate entrypoints');
const measuredKeys = new Set(current.map((row) => `${row.contract}.${row.entrypoint}`));
const unexpected = current.filter((row) => !inventoryKeys.has(`${row.contract}.${row.entrypoint}`));
if (unexpected.length > 0) {
  throw new Error(`Benchmarks include ${unexpected.length} entrypoint(s) absent from the production inventory: ${unexpected.map((row) => `${row.contract}.${row.entrypoint}`).join(', ')}`);
}
const unmeasured = inventory.entrypoints.filter((row) => !measuredKeys.has(`${row.contract}.${row.entrypoint}`));
if (process.argv.includes('--record-baseline')) {
  if (unmeasured.length > 0) {
    throw new Error(`Cannot record an incomplete baseline: ${unmeasured.length} of ${inventory.entrypoints.length} public entrypoints are unmeasured`);
  }
  const baseline = {
    schemaVersion: 1,
    sdk: 'soroban-sdk 23 (native Env testutils cost estimate)',
    sourceCommit: arg('--source-commit', process.env.GITHUB_SHA ?? 'local-unrecorded'),
    measurements: current,
  };
  fs.writeFileSync(baselineFile, `${JSON.stringify(baseline, null, 2)}\n`);
  console.log(`Wrote ${current.length} measured baseline scenarios to ${baselineFile}`);
  process.exit(0);
}
const baseline = JSON.parse(fs.readFileSync(baselineFile, 'utf8'));
if (!Array.isArray(baseline.measurements) || !baseline.sourceCommit) {
  throw new Error(`Baseline ${baselineFile} must include sourceCommit and measurements`);
}
const byKey = new Map(baseline.measurements.map((row) => [`${row.contract}.${row.entrypoint}`, row]));
const rows = current.map((row) => {
  const previous = byKey.get(`${row.contract}.${row.entrypoint}`);
  return { ...row, previous, cpuDelta: fmtDelta(row.cpu_instructions, previous?.cpu_instructions),
    readDelta: fmtDelta(row.ledger_reads, previous?.ledger_reads),
    writeDelta: fmtDelta(row.ledger_writes, previous?.ledger_writes) };
});
const regressions = rows.filter((row) => {
  if (!row.previous) return false;
  return ['cpu_instructions', 'ledger_reads', 'ledger_writes'].some((metric) =>
    row.previous[metric] > 0 && row[metric] > row.previous[metric] * (1 + threshold / 100));
});
const uncovered = baseline.measurements.filter((row) => !rows.some((currentRow) =>
  currentRow.contract === row.contract && currentRow.entrypoint === row.entrypoint));
const markdown = [
  '# Soroban contract cost report', '',
  `Baseline: \`${baseline.sourceCommit}\`. Measurements come from successful native Soroban SDK test invocations. CPU deltas above ${threshold}% are warnings, not CI failures.`,
  `Coverage: ${rows.length}/${inventory.entrypoints.length} discovered public entrypoints measured; ${uncovered.length} baseline scenario(s) missing from this run.`, '',
  '| Contract entrypoint | CPU instructions (Δ) | Ledger reads (Δ) | Ledger writes (Δ) |',
  '|---|---:|---:|---:|',
  ...rows.map((row) => `| \`${row.contract}.${row.entrypoint}\` | ${row.cpu_instructions.toLocaleString()} (${row.cpuDelta}) | ${row.ledger_reads} (${row.readDelta}) | ${row.ledger_writes} (${row.writeDelta}) |`),
  '',
  regressions.length ? `⚠️ Resource regression warning(s) above threshold: ${regressions.map((row) => `\`${row.contract}.${row.entrypoint}\` (CPU ${row.cpuDelta}, reads ${row.readDelta}, writes ${row.writeDelta})`).join('; ')}.` : 'No CPU or ledger read/write regression exceeds the configured warning threshold.',
  '',
  unmeasured.length ? `⚠️ Not benchmarked (${unmeasured.length}): ${unmeasured.map((row) => `\`${row.contract}.${row.entrypoint}\``).join(', ')}.` : 'All discovered public entrypoints have benchmark fixtures.',
  '',
  uncovered.length ? `⚠️ Baseline scenarios not exercised: ${uncovered.map((row) => `\`${row.contract}.${row.entrypoint}\``).join(', ')}.` : '',
].filter(Boolean).join('\n');
fs.writeFileSync(outputFile, `${markdown}\n`);
console.log(markdown);

if (process.argv.includes('--require-complete') && unmeasured.length > 0) {
  throw new Error(`Cost benchmark coverage incomplete: ${unmeasured.length} of ${inventory.entrypoints.length} public entrypoints are unmeasured`);
}

const top = [...baseline.measurements].sort((a, b) => b.cpu_instructions - a.cpu_instructions).slice(0, 5);
console.log('\nTop five baseline scenarios by CPU instructions:');
for (const row of top) console.log(`- ${row.contract}.${row.entrypoint}: ${row.cpu_instructions} CPU instructions; ${row.ledger_reads} reads; ${row.ledger_writes} writes`);
