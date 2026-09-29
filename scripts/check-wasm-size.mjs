import { readFile, readdir, stat } from "node:fs/promises";
import path from "node:path";

const root = path.resolve(process.cwd(), "target/wasm32-unknown-unknown/release");
const budgetFile = path.resolve(process.cwd(), "wasm-budgets.json");
const baselineFile = path.resolve(process.cwd(), "wasm-baseline.json");
const baselineRootArgument = process.argv.indexOf("--baseline-root");
const baselineRoot = baselineRootArgument === -1
  ? null
  : path.resolve(process.cwd(), process.argv[baselineRootArgument + 1]);
const files = (await readdir(root).catch(() => [])).filter((name) => name.endsWith(".wasm"));

if (files.length === 0) {
  console.error(`No release WASM files found in ${root}`);
  process.exit(1);
}

const budgets = JSON.parse(await readFile(budgetFile, "utf8"));
const baseline = JSON.parse(await readFile(baselineFile, "utf8"));
let failed = false;
const rows = [
  "| Contract | Size | Budget | Delta vs baseline | Status |",
  "| --- | ---: | ---: | ---: | --- |",
];
for (const file of files.sort()) {
  const size = (await stat(path.join(root, file))).size;
  const contract = file.replace(/\.wasm$/, "");
  const budget = budgets.contracts?.[contract];
  if (!Number.isInteger(budget) || budget <= 0) {
    console.error(`No positive byte budget configured for ${contract}`);
    failed = true;
    continue;
  }
  const baselineSize = baselineRoot
    ? (await stat(path.join(baselineRoot, file)).catch(() => null))?.size
    : baseline.contracts?.[contract];
  const delta = Number.isInteger(baselineSize) ? size - baselineSize : null;
  const status = size > budget ? "FAIL" : "OK";
  if (status === "FAIL") failed = true;
  rows.push(
    `| ${contract} | ${size.toLocaleString()} bytes | ${budget.toLocaleString()} bytes | ${delta === null ? "n/a" : `${delta >= 0 ? "+" : ""}${delta.toLocaleString()} bytes`} | ${status} |`,
  );
}
console.log(rows.join("\n"));
if (failed) process.exit(1);
