#!/usr/bin/env node
/**
 * Mobile app size budget (issue #1413).
 *
 * `apps/mobile` grew steadily through Waves 7 and 8 without anyone measuring
 * what that growth cost the install. This script measures the exported payload
 * that ships inside the app, compares it against the recorded baseline or the
 * base branch of a pull request, and enforces `mobile-budgets.json`.
 *
 * Usage:
 *   node scripts/check-mobile-size.mjs [options]
 *
 * Options:
 *   --dist <dir>              Export directory (default: ./dist)
 *   --baseline <file>         Recorded baseline (default: ./mobile-baseline.json)
 *   --budgets <file>          Budgets (default: ./mobile-budgets.json)
 *   --baseline-root <dir>     An app directory exported from the base branch;
 *                             its `dist` is measured the same way and used for
 *                             the delta instead of the recorded baseline.
 *   --report <file>           Also write the markdown report to this path.
 *   --write-baseline          Record the current measurement as the baseline
 *                             and exit (does not enforce budgets).
 *   --record-binary           Record a native binary size, then exit, e.g.
 *                             `--record-binary android=path/to/app.aab`.
 *                             Repeatable. Native artifacts are not produced by
 *                             `expo export`, so they are recorded separately.
 *   --json                    Print JSON instead of markdown.
 *
 * Exit codes: 0 within budget (warnings included), 1 over a max budget.
 */

import { mkdir, readdir, readFile, stat, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const APP_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

const args = process.argv.slice(2);
const flag = (name, fallback) => {
  const index = args.indexOf(name);
  return index === -1 ? fallback : args[index + 1];
};
const has = (name) => args.includes(name);

const PLATFORMS = ['android', 'ios', 'web'];
const BUNDLE_EXTENSIONS = new Set(['.js', '.hbc', '.mjs', '.cjs']);

const distDir = path.resolve(APP_ROOT, flag('--dist', 'dist'));
const baselineFile = path.resolve(APP_ROOT, flag('--baseline', 'mobile-baseline.json'));
const budgetsFile = path.resolve(APP_ROOT, flag('--budgets', 'mobile-budgets.json'));
const reportFile = flag('--report', null);
const baselineRoot = flag('--baseline-root', null);

const bytes = (value) => `${value.toLocaleString('en-US')} bytes`;
const mib = (value) => `${(value / (1024 * 1024)).toFixed(2)} MiB`;
const delta = (value) => `${value > 0 ? '+' : ''}${value.toLocaleString('en-US')}`;
const percent = (value) => `${value >= 0 ? '+' : ''}${value.toFixed(1)}%`;

async function readJson(file) {
  return JSON.parse(await readFile(file, 'utf8'));
}

const tryStat = (target) => stat(target).catch(() => null);

/** Total bytes (and file count) under a directory, or a single file. */
async function measure(target) {
  const info = await tryStat(target);
  if (!info) return { bytes: 0, files: 0, present: false };
  if (!info.isDirectory()) return { bytes: info.size, files: 1, present: true };

  let bytes = 0;
  let files = 0;
  const walk = async (dir) => {
    for (const entry of await readdir(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        await walk(full);
      } else {
        bytes += (await stat(full)).size;
        files += 1;
      }
    }
  };
  await walk(target);
  return { bytes, files, present: true };
}

/**
 * Measures an `expo export` directory:
 *   _expo/static/js/<platform>/entry-<hash>.{js,hbc}  -> that platform's bundle
 *   everything else                                   -> the shared payload
 */
async function measureExport(dir) {
  const info = await tryStat(dir);
  if (!info) {
    console.error(`No export found in ${dir}. Run \`npm run size:export\` (expo export) first.`);
    process.exit(1);
  }

  const bundles = {};
  for (const platform of PLATFORMS) {
    const result = await measure(path.join(dir, '_expo', 'static', 'js', platform));
    bundles[platform] = {
      bytes: result.bytes,
      files: result.files,
      present: result.present,
    };
  }

  if (Object.values(bundles).every((entry) => !entry.present)) {
    console.error(
      `No exported JS bundle found under ${path.join(dir, '_expo', 'static', 'js')}. ` +
        'Run `npm run size:export` first.',
    );
    process.exit(1);
  }

  let payloadBytes = 0;
  let payloadFiles = 0;
  const walk = async (current) => {
    for (const entry of await readdir(current, { withFileTypes: true })) {
      const full = path.join(current, entry.name);
      if (entry.isDirectory()) {
        await walk(full);
        continue;
      }
      const isBundle =
        full.includes(`${path.sep}_expo${path.sep}static${path.sep}js${path.sep}`) &&
        BUNDLE_EXTENSIONS.has(path.extname(entry.name));
      if (isBundle) continue;
      payloadBytes += (await stat(full)).size;
      payloadFiles += 1;
    }
  };
  await walk(dir);

  const bundleBytes = Object.values(bundles).reduce((sum, entry) => sum + entry.bytes, 0);
  const bundleFiles = Object.values(bundles).reduce((sum, entry) => sum + entry.files, 0);

  return {
    bundles,
    assets: { bytes: payloadBytes, files: payloadFiles },
    total: {
      bytes: bundleBytes + payloadBytes,
      files: bundleFiles + payloadFiles,
    },
  };
}

/** Flattens an export measurement into the metrics budgets are keyed by. */
function metricsOf(measurement) {
  const metrics = {};
  for (const platform of PLATFORMS) {
    if (measurement.bundles[platform]?.present) {
      metrics[`bundle.${platform}`] = measurement.bundles[platform].bytes;
    }
  }
  metrics.assets = measurement.assets.bytes;
  metrics.total = measurement.total.bytes;
  return metrics;
}

/** A recorded baseline describes the same metrics, with different field names. */
function metricsOfBaseline(baseline) {
  const metrics = {};
  for (const platform of PLATFORMS) {
    if (typeof baseline.platforms?.[platform] === 'number') {
      metrics[`bundle.${platform}`] = baseline.platforms[platform];
    }
  }
  if (typeof baseline.assets?.bytes === 'number') metrics.assets = baseline.assets.bytes;
  if (typeof baseline.total?.bytes === 'number') metrics.total = baseline.total.bytes;
  return metrics;
}

function budgetFor(budgets, metric) {
  const [group, key] = metric.split('.');
  return key ? (budgets.platforms?.[key] ?? null) : (budgets[group] ?? null);
}

/** Resolves both the current measurement and whatever it is compared against. */
async function collect() {
  const measured = await measureExport(distDir);
  const metrics = metricsOf(measured);

  if (baselineRoot) {
    const rootDist = path.resolve(baselineRoot, 'dist');
    if (!(await tryStat(rootDist))) {
      console.error(
        `--baseline-root was given but ${rootDist} has no export; run ` +
          '`npm run size:export` in the base worktree first.',
      );
      process.exit(1);
    }
    return {
      measured,
      metrics,
      reference: metricsOf(await measureExport(rootDist)),
      referenceLabel: `base branch export (\`${rootDist}\`)`,
    };
  }

  const recorded = await readJson(baselineFile).catch(() => null);
  return {
    measured,
    metrics,
    reference: recorded ? metricsOfBaseline(recorded) : {},
    referenceLabel: recorded
      ? `recorded baseline (\`${path.basename(baselineFile)}\`)`
      : 'no baseline (first run)',
  };
}

async function writeBaseline() {
  const measurement = await measureExport(distDir);
  const previous = await readJson(baselineFile).catch(() => ({}));

  const platforms = {};
  for (const platform of PLATFORMS) {
    if (measurement.bundles[platform].present) {
      platforms[platform] = measurement.bundles[platform].bytes;
    }
  }

  const next = {
    version: 1,
    unit: 'bytes',
    recordedAt: flag('--date', new Date().toISOString().slice(0, 10)),
    recordedOn: flag('--sha', process.env.GITHUB_SHA?.slice(0, 40) ?? null),
    method: 'npx expo export --platform android --platform ios --platform web --output-dir dist',
    platforms,
    assets: {
      bytes: measurement.assets.bytes,
      files: measurement.assets.files,
    },
    total: { bytes: measurement.total.bytes, files: measurement.total.files },
    // `expo export` cannot produce these: a signed .aab/.ipa needs a native
    // build, so they are recorded separately and preserved across refreshes.
    binary: previous.binary ?? { android: null, ios: null },
  };

  await writeFile(baselineFile, `${JSON.stringify(next, null, 2)}\n`);
  console.log(`Recorded size baseline in ${path.basename(baselineFile)}:`);
  for (const [metric, value] of Object.entries(metricsOf(measurement))) {
    console.log(`  ${metric}: ${bytes(value)} (${mib(value)})`);
  }
}

async function recordBinaries() {
  const specs = [];
  for (let i = 0; i < args.length; i += 1) {
    if (args[i] !== '--record-binary') continue;
    const value = args[i + 1] ?? '';
    const separator = value.indexOf('=');
    if (separator === -1) {
      throw new Error(`--record-binary expects platform=path, received "${value}"`);
    }
    specs.push({
      platform: value.slice(0, separator),
      file: value.slice(separator + 1),
    });
  }
  if (specs.length === 0) throw new Error('--record-binary expects platform=path');

  const baseline = await readJson(baselineFile);
  baseline.binary = baseline.binary ?? {};
  for (const { platform, file } of specs) {
    const result = await measure(path.resolve(APP_ROOT, file));
    if (!result.present) throw new Error(`No build artifact at ${file}`);
    baseline.binary[platform] = result.bytes;
    console.log(`Recorded ${platform} binary: ${bytes(result.bytes)} (${mib(result.bytes)})`);
  }
  baseline.binaryRecordedAt = new Date().toISOString().slice(0, 10);
  await writeFile(baselineFile, `${JSON.stringify(baseline, null, 2)}\n`);
}

/** Path shown in reports: relative when inside the app, absolute otherwise. */
function displayPath(target) {
  const relative = path.relative(APP_ROOT, target);
  return relative && !relative.startsWith('..') ? relative : target;
}

/**
 * Writes the report. A failure here must not be mistaken for a budget breach:
 * CI reads this step's exit code as "over budget or not", so an unwritable
 * report path warns and lets the budget verdict stand.
 */
async function writeReport(target, output) {
  const full = path.resolve(APP_ROOT, target);
  try {
    await mkdir(path.dirname(full), { recursive: true });
    await writeFile(full, `${output}\n`);
  } catch (error) {
    console.log(
      `::warning::Could not write the size report to ${target}: ${
        error instanceof Error ? error.message : String(error)
      }`,
    );
  }
}

async function report() {
  const budgets = await readJson(budgetsFile);
  const baseline = await readJson(baselineFile).catch(() => ({}));
  const { measured, metrics, reference, referenceLabel } = await collect();

  const rows = [];
  let failed = false;
  let warned = false;

  for (const metric of [...PLATFORMS.map((platform) => `bundle.${platform}`), 'assets', 'total']) {
    const value = metrics[metric];
    if (typeof value !== 'number') continue;

    const budget = budgetFor(budgets, metric);
    const max = budget?.maxBytes;
    const warningAt = budget?.warningBytes;
    const referenceValue = reference[metric];
    const difference = typeof referenceValue === 'number' ? value - referenceValue : null;
    const percentChange =
      typeof referenceValue === 'number' && referenceValue > 0
        ? ((value - referenceValue) / referenceValue) * 100
        : null;

    let status = 'OK';
    if (typeof max === 'number' && value > max) {
      status = 'FAIL';
      failed = true;
    } else if (typeof warningAt === 'number' && value > warningAt) {
      status = 'WARN';
      warned = true;
    } else if (typeof difference === 'number' && difference > 0) {
      // Growing but still inside the budget: reported, not blocking.
      status = 'OK';
    }

    rows.push({
      metric,
      value,
      budget: max ?? null,
      warningAt: warningAt ?? null,
      difference,
      percentChange,
      status,
    });
  }

  if (has('--json')) {
    console.log(
      JSON.stringify(
        {
          referenceLabel,
          metrics,
          rows,
          failed,
          warned,
          binary: baseline.binary ?? null,
        },
        null,
        2,
      ),
    );
  } else {
    const lines = [
      '## Mobile app size',
      '',
      `Compared against ${referenceLabel}. Measured from \`${displayPath(distDir)}\` ` +
        '(`expo export`).',
      '',
      '| Metric | Size | Budget | Warning at | Delta | Status |',
      '| --- | ---: | ---: | ---: | ---: | --- |',
    ];

    for (const row of rows) {
      lines.push(
        `| ${row.metric} | ${mib(row.value)} (${bytes(row.value)}) | ` +
          `${row.budget === null ? 'n/a' : bytes(row.budget)} | ` +
          `${row.warningAt === null ? 'n/a' : bytes(row.warningAt)} | ` +
          `${row.difference === null ? 'n/a' : `${delta(row.difference)} (${percent(row.percentChange ?? 0)})`} | ` +
          `${row.status} |`,
      );
    }

    const recordedBinaries = Object.entries(baseline.binary ?? {}).filter(
      ([, value]) => typeof value === 'number',
    );
    lines.push('');
    if (recordedBinaries.length > 0) {
      lines.push('### Native binary sizes (recorded from a real build)');
      lines.push('');
      lines.push('| Platform | Binary |');
      lines.push('| --- | ---: |');
      for (const [platform, value] of recordedBinaries) {
        lines.push(`| ${platform} | ${mib(value)} (${bytes(value)}) |`);
      }
    } else {
      lines.push(
        'Native binary sizes are not measured here: a signed `.aab`/`.ipa` needs a native build. ' +
          'Record one with `npm run size:record-binary -- android=path/to/app.aab`.',
      );
    }
    lines.push('');
    lines.push(
      `${measured.total.files} files measured · budgets from \`${path.basename(budgetsFile)}\``,
    );

    const output = lines.join('\n');
    console.log(output);
    if (reportFile) await writeReport(reportFile, output);
  }

  for (const row of rows) {
    if (row.status === 'FAIL') {
      console.log(
        `::error::Mobile size budget exceeded: ${row.metric} is ${bytes(row.value)}, over ${bytes(row.budget)}.`,
      );
    } else if (row.status === 'WARN') {
      console.log(
        `::warning::Mobile size warning: ${row.metric} is ${bytes(row.value)}, past the ${bytes(row.warningAt)} warning threshold.`,
      );
    }
  }

  if (failed) process.exit(1);
}

async function main() {
  if (has('--write-baseline')) return writeBaseline();
  if (args.includes('--record-binary')) return recordBinaries();
  return report();
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
});
