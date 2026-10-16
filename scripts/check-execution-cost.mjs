#!/usr/bin/env node
/**
 * check-execution-cost.mjs
 *
 * Compares contract execution cost benchmark results against committed baseline
 * and evaluates configurable regression thresholds.
 *
 * Usage:
 *   node scripts/check-execution-cost.mjs
 *   node scripts/check-execution-cost.mjs --baseline apps/onchain/execution-cost-baseline.json --current apps/onchain/execution-cost-current.json
 *   node scripts/check-execution-cost.mjs --threshold-pct 15
 */

import { readFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import path from "node:path";

function findFile(filename) {
  const candidates = [
    path.resolve(process.cwd(), filename),
    path.resolve(process.cwd(), "apps/onchain", filename),
    path.resolve(process.cwd(), "..", filename),
  ];
  for (const c of candidates) {
    if (existsSync(c)) return c;
  }
  return candidates[0];
}

const args = process.argv.slice(2);
function getArg(flag) {
  const index = args.indexOf(flag);
  return index !== -1 && index + 1 < args.length ? args[index + 1] : null;
}

const baselinePath = getArg("--baseline") || findFile("execution-cost-baseline.json");
const currentPath = getArg("--current") || findFile("execution-cost-current.json");
const thresholdsPath = getArg("--thresholds") || findFile("execution-cost-thresholds.json");
const cliThresholdPct = getArg("--threshold-pct") ? parseFloat(getArg("--threshold-pct")) : null;
const isStrict = args.includes("--strict");

let baselineData;
try {
  baselineData = JSON.parse(await readFile(baselinePath, "utf8"));
} catch (err) {
  console.error(`Failed to read baseline file at ${baselinePath}: ${err.message}`);
  process.exit(1);
}

let currentData;
if (existsSync(currentPath)) {
  try {
    currentData = JSON.parse(await readFile(currentPath, "utf8"));
  } catch (err) {
    console.error(`Failed to read current benchmark file at ${currentPath}: ${err.message}`);
    process.exit(1);
  }
} else {
  // If current file does not exist (e.g. running check against baseline directly), compare baseline against itself
  currentData = baselineData;
}

let thresholds = {
  cpu_instruction_warning_threshold_pct: 10.0,
  ledger_read_warning_threshold: 1,
  ledger_write_warning_threshold: 1,
  contract_overrides: {},
};
if (existsSync(thresholdsPath)) {
  try {
    const loaded = JSON.parse(await readFile(thresholdsPath, "utf8"));
    thresholds = { ...thresholds, ...loaded };
  } catch {
    // use defaults
  }
}

if (cliThresholdPct !== null && !Number.isNaN(cliThresholdPct)) {
  thresholds.cpu_instruction_warning_threshold_pct = cliThresholdPct;
}

const baselineBenchmarks = baselineData.benchmarks || {};
const currentBenchmarks = currentData.benchmarks || {};

const allKeys = Array.from(new Set([...Object.keys(baselineBenchmarks), ...Object.keys(currentBenchmarks)])).sort();

const rows = [
  "| Contract | Entry Point | CPU Instructions | CPU Delta | Ledger Reads | Read Delta | Ledger Writes | Write Delta | Status |",
  "| :--- | :--- | ---: | ---: | ---: | ---: | ---: | ---: | :--- |",
];

const warnings = [];
const allCurrentList = [];

for (const key of allKeys) {
  const curr = currentBenchmarks[key];
  const base = baselineBenchmarks[key];

  if (!curr && base) {
    rows.push(
      `| ${base.contract} | \`${base.entry_point}\` | *removed* | - | ${base.ledger_reads} | - | ${base.ledger_writes} | - | REMOVED |`,
    );
    continue;
  }

  allCurrentList.push(curr);

  if (curr && !base) {
    rows.push(
      `| ${curr.contract} | \`${curr.entry_point}\` | ${curr.cpu_instructions.toLocaleString()} | *new* | ${curr.ledger_reads} | *new* | ${curr.ledger_writes} | *new* | NEW |`,
    );
    continue;
  }

  const cpuDelta = curr.cpu_instructions - base.cpu_instructions;
  const cpuPct = base.cpu_instructions > 0 ? (cpuDelta / base.cpu_instructions) * 100 : 0;
  const cpuPctStr = (cpuPct >= 0 ? "+" : "") + cpuPct.toFixed(1) + "%";
  const cpuDeltaStr = (cpuDelta >= 0 ? "+" : "") + cpuDelta.toLocaleString() + ` (${cpuPctStr})`;

  const readDelta = curr.ledger_reads - base.ledger_reads;
  const readDeltaStr = (readDelta >= 0 ? "+" : "") + readDelta;

  const writeDelta = curr.ledger_writes - base.ledger_writes;
  const writeDeltaStr = (writeDelta >= 0 ? "+" : "") + writeDelta;

  const contractOverride = thresholds.contract_overrides?.[curr.contract] || {};
  const cpuThreshold = contractOverride.cpu_instruction_warning_threshold_pct ?? thresholds.cpu_instruction_warning_threshold_pct;
  const readThreshold = contractOverride.ledger_read_warning_threshold ?? thresholds.ledger_read_warning_threshold;
  const writeThreshold = contractOverride.ledger_write_warning_threshold ?? thresholds.ledger_write_warning_threshold;

  const regressionReasons = [];
  if (cpuDelta > 0 && cpuPct > cpuThreshold) {
    regressionReasons.push(`CPU +${cpuPct.toFixed(1)}% > ${cpuThreshold}%`);
  }
  if (readDelta >= readThreshold) {
    regressionReasons.push(`Reads +${readDelta} >= ${readThreshold}`);
  }
  if (writeDelta >= writeThreshold) {
    regressionReasons.push(`Writes +${writeDelta} >= ${writeThreshold}`);
  }

  const isWarn = regressionReasons.length > 0;
  if (isWarn) {
    warnings.push({
      key,
      contract: curr.contract,
      entry_point: curr.entry_point,
      reasons: regressionReasons,
      cpuDeltaStr,
      readDeltaStr,
      writeDeltaStr,
    });
  }

  const status = isWarn ? `⚠️ WARN (${regressionReasons.join(", ")})` : "OK";
  rows.push(
    `| ${curr.contract} | \`${curr.entry_point}\` | ${curr.cpu_instructions.toLocaleString()} | ${cpuDeltaStr} | ${curr.ledger_reads} | ${readDeltaStr} | ${curr.ledger_writes} | ${writeDeltaStr} | ${status} |`,
  );
}

// Sort all entry points by CPU cost for Top 5
allCurrentList.sort((a, b) => b.cpu_instructions - a.cpu_instructions);
const top5 = allCurrentList.slice(0, 5);

const top5Rows = [
  "| Rank | Contract | Entry Point | CPU Instructions | Ledger Reads | Ledger Writes |",
  "| ---: | :--- | :--- | ---: | ---: | ---: |",
];
top5.forEach((item, idx) => {
  top5Rows.push(
    `| ${idx + 1} | \`${item.contract}\` | \`${item.entry_point}\` | ${item.cpu_instructions.toLocaleString()} | ${item.ledger_reads} | ${item.ledger_writes} |`,
  );
});

// Output Markdown Report
console.log("## ⏱️ Contract Execution Cost Benchmark Report\n");
console.log(
  `Evaluated **${allKeys.length}** entry points against baseline. Configured warning thresholds: CPU regression > **${thresholds.cpu_instruction_warning_threshold_pct}%**, Read delta ≥ **+${thresholds.ledger_read_warning_threshold}**, Write delta ≥ **+${thresholds.ledger_write_warning_threshold}**.\n`,
);

if (warnings.length > 0) {
  console.log(`> ⚠️ **Warning:** ${warnings.length} entry point(s) exceeded regression thresholds:\n`);
  for (const w of warnings) {
    console.log(`> - **${w.key}**: ${w.reasons.join("; ")}`);
    // Emit GitHub Actions annotation warning
    console.log(
      `::warning title=Execution Cost Regression::${w.key} exceeded regression threshold (${w.reasons.join(", ")})`,
    );
  }
  console.log("\n");
} else {
  console.log("> ✅ **All public entry points are within acceptable execution cost thresholds.**\n");
}

console.log("### 🏆 Top 5 Most Expensive Entry Points\n");
console.log(top5Rows.join("\n"));
console.log("\n### 📊 Detailed Execution Cost Comparison\n");
console.log(rows.join("\n"));

if (isStrict && warnings.length > 0) {
  process.exit(1);
}
