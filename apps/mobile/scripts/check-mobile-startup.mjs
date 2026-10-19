#!/usr/bin/env node
/**
 * Mobile cold-start budget (issue #1576).
 *
 * Reads `mobile-startup-measurements.json` from the Playwright startup spec and
 * compares against `mobile-startup-budgets.json` / `mobile-startup-baseline.json`.
 *
 * Usage:
 *   node scripts/check-mobile-startup.mjs [options]
 *
 * Options:
 *   --measurements <file>   Measurement output (default: ./mobile-startup-measurements.json)
 *   --baseline <file>       Recorded baseline (default: ./mobile-startup-baseline.json)
 *   --budgets <file>        Budgets (default: ./mobile-startup-budgets.json)
 *   --report <file>         Also write markdown report to this path
 *   --write-baseline        Copy current measurements into the baseline file
 *   --json                  Print JSON instead of markdown
 *
 * Exit codes: 0 within budget (warnings allowed), 1 over maxMs.
 */

import { readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const APP_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const args = process.argv.slice(2);
const flag = (name, fallback) => {
  const index = args.indexOf(name);
  return index === -1 ? fallback : args[index + 1];
};
const has = (name) => args.includes(name);

const measurementsFile = path.resolve(APP_ROOT, flag('--measurements', 'mobile-startup-measurements.json'));
const baselineFile = path.resolve(APP_ROOT, flag('--baseline', 'mobile-startup-baseline.json'));
const budgetsFile = path.resolve(APP_ROOT, flag('--budgets', 'mobile-startup-budgets.json'));
const reportFile = flag('--report', null);

async function readJson(file) {
  return JSON.parse(await readFile(file, 'utf8'));
}

function statusFor(value, warningMs, maxMs) {
  if (value > maxMs) return 'FAIL';
  if (value > warningMs) return 'WARN';
  return 'OK';
}

async function writeReport(target, body) {
  await writeFile(target, body, 'utf8');
}

async function main() {
  if (has('--write-baseline')) {
    const measurements = await readJson(measurementsFile);
    const baseline = {
      version: 1,
      profile: measurements.profile ?? 'low-end-web',
      recordedAt: measurements.recordedAt ?? new Date().toISOString(),
      source: 'e2e/startup-budget.spec.ts',
      metrics: measurements.metrics,
    };
    await writeFile(baselineFile, `${JSON.stringify(baseline, null, 2)}\n`, 'utf8');
    console.log(`Wrote baseline to ${baselineFile}`);
    return;
  }

  const [measurements, baseline, budgets] = await Promise.all([
    readJson(measurementsFile),
    readJson(baselineFile),
    readJson(budgetsFile),
  ]);

  const rows = [];
  let failed = false;
  let warned = false;

  for (const [metric, limits] of Object.entries(budgets.metrics)) {
    const value = measurements.metrics[metric];
    if (typeof value !== 'number') {
      console.error(`Missing metric ${metric} in ${measurementsFile}`);
      process.exit(1);
    }
    const base = baseline.metrics[metric] ?? limits.baselineMs;
    const difference = value - base;
    const rowStatus = statusFor(value, limits.warningMs, limits.maxMs);
    if (rowStatus === 'FAIL') failed = true;
    if (rowStatus === 'WARN') warned = true;
    rows.push({
      metric,
      value,
      baseline: base,
      warningMs: limits.warningMs,
      maxMs: limits.maxMs,
      difference,
      status: rowStatus,
    });
  }

  const payload = {
    profile: measurements.profile,
    recordedAt: measurements.recordedAt,
    rows,
    failed,
    warned,
  };

  if (has('--json')) {
    console.log(JSON.stringify(payload, null, 2));
  } else {
    const lines = [
      '## Mobile startup budget',
      '',
      `Profile: **${measurements.profile}** · measured ${measurements.recordedAt}`,
      '',
      '| Metric | Measured | Baseline | Warning at | Max | Delta | Status |',
      '| --- | ---: | ---: | ---: | ---: | ---: | --- |',
    ];
    for (const row of rows) {
      lines.push(
        `| ${row.metric} | ${row.value} ms | ${row.baseline} ms | ${row.warningMs} ms | ${row.maxMs} ms | ${row.difference > 0 ? '+' : ''}${row.difference} ms | ${row.status} |`,
      );
    }
    lines.push('');
    lines.push(`Budgets from \`${path.basename(budgetsFile)}\``);
    const output = lines.join('\n');
    console.log(output);
    if (reportFile) await writeReport(reportFile, output);
  }

  for (const row of rows) {
    if (row.status === 'FAIL') {
      console.log(
        `::error::Mobile startup budget exceeded: ${row.metric} is ${row.value} ms, over ${row.maxMs} ms max.`,
      );
    } else if (row.status === 'WARN') {
      console.log(
        `::warning::Mobile startup warning: ${row.metric} is ${row.value} ms, past ${row.warningMs} ms warning threshold.`,
      );
    }
  }

  if (failed) process.exit(1);
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
});
