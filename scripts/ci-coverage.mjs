#!/usr/bin/env node
// CI coverage gate (issue #1723).
//
// A pull request whose files match no workflow's path filter runs no checks and
// merges silently. This script maps a PR's changed files to the workflows that
// should run for them (using .github/ci-paths.json, which the workflow `paths:`
// blocks must mirror) and reports any code file that no workflow covers.
//
//   node scripts/ci-coverage.mjs --base <ref> [--head HEAD]     (git diff)
//   node scripts/ci-coverage.mjs --files a.js,b.yml             (explicit list)
//
// Exit codes: 0 covered (warnings allowed), 1 uncovered code files, 2 usage.

import fs from 'node:fs';
import { execFileSync } from 'node:child_process';
import { pathToFileURL } from 'node:url';
import { matchesAny } from './lib/glob.mjs';

export function loadConfig(file = '.github/ci-paths.json') {
  return JSON.parse(fs.readFileSync(file, 'utf8'));
}

/** Workflows whose path filters match at least one changed file. */
export function expectedWorkflows(files, config) {
  const result = [];
  for (const [workflow, globs] of Object.entries(config.workflows)) {
    if (files.some((f) => matchesAny(f, globs))) result.push(workflow);
  }
  return result;
}

/**
 * Splits changed files into: covered by a workflow, exempt (docs and other
 * non-code), and uncovered. Uncovered files under a code root are blocking;
 * other uncovered files are reported but do not fail the gate.
 */
export function classify(files, config) {
  const all = Object.values(config.workflows).flat();
  const covered = [];
  const exempt = [];
  const uncoveredCode = [];
  const uncoveredOther = [];
  for (const file of files) {
    if (matchesAny(file, all)) covered.push(file);
    else if (matchesAny(file, config.noCiRequired)) exempt.push(file);
    else if (config.codeRoots.some((root) => file.startsWith(root))) uncoveredCode.push(file);
    else uncoveredOther.push(file);
  }
  return { covered, exempt, uncoveredCode, uncoveredOther };
}

function changedFiles(base, head) {
  const out = execFileSync('git', ['diff', '--name-only', `${base}...${head}`], { encoding: 'utf8' });
  return out.split('\n').map((l) => l.trim()).filter(Boolean);
}

function main() {
  const args = process.argv.slice(2);
  const arg = (name) => {
    const i = args.indexOf(name);
    return i !== -1 ? args[i + 1] : undefined;
  };
  const config = loadConfig();
  let files;
  if (arg('--files')) files = arg('--files').split(',').filter(Boolean);
  else if (arg('--base')) files = changedFiles(arg('--base'), arg('--head') || 'HEAD');
  else {
    console.error('Usage: ci-coverage.mjs --base <ref> [--head <ref>] | --files a,b');
    process.exit(2);
  }

  const workflows = expectedWorkflows(files, config);
  const { uncoveredCode, uncoveredOther, exempt } = classify(files, config);

  const summary = [];
  summary.push('### CI coverage');
  summary.push('');
  summary.push(`Changed files: ${files.length}`);
  summary.push(`Workflows expected to run: ${workflows.length ? workflows.map((w) => `\`${w}\``).join(', ') : 'none'}`);
  if (exempt.length) summary.push(`Exempt (docs and other non-code): ${exempt.length}`);
  if (uncoveredOther.length) {
    summary.push('');
    summary.push('Not covered by any workflow (informational):');
    for (const f of uncoveredOther) summary.push(`- \`${f}\``);
  }
  if (uncoveredCode.length) {
    summary.push('');
    summary.push('**No workflow covers these code files:**');
    for (const f of uncoveredCode) summary.push(`- \`${f}\``);
  }
  const text = summary.join('\n') + '\n';
  process.stdout.write(text);
  if (process.env.GITHUB_STEP_SUMMARY) fs.appendFileSync(process.env.GITHUB_STEP_SUMMARY, text);

  for (const f of uncoveredOther) {
    console.log(`::notice file=${f}::No workflow path filter covers this file.`);
  }
  if (uncoveredCode.length) {
    for (const f of uncoveredCode) {
      console.log(`::error file=${f}::No workflow runs for this file. Add its path to .github/ci-paths.json and the matching workflow's paths filter, or list it under noCiRequired.`);
    }
    process.exit(1);
  }
  if (workflows.length === 0 && files.length > 0 && exempt.length < files.length) {
    console.log('::warning::This pull request triggers no path-filtered workflow; only the CI gate ran.');
  }
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) main();
