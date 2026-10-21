#!/usr/bin/env node
// Generates the changelog for a release from merged pull requests (issue #1725).
//
//   node scripts/release/changelog.mjs --version v1.2.0 [--previous v1.1.0] [--out CHANGELOG.md]
//
// With no --previous, the latest stable tag is used. Pull requests are found
// from merge commits ("Merge pull request #N" or squash "title (#N)") between
// the previous tag and HEAD, and grouped by the apps their files touch.

import fs from 'node:fs';
import { execFileSync } from 'node:child_process';
import { latestTag, groupByApp, parseMerge, renderChangelog } from './lib.mjs';

const git = (...args) => execFileSync('git', args, { encoding: 'utf8' });

function arg(name) {
  const i = process.argv.indexOf(name);
  return i !== -1 ? process.argv[i + 1] : undefined;
}

const version = arg('--version');
if (!version) {
  console.error('Usage: changelog.mjs --version vX.Y.Z [--previous vA.B.C] [--out file]');
  process.exit(2);
}
const previous = arg('--previous') ?? latestTag(git('tag', '--list', 'v*').split('\n').filter(Boolean));
const range = previous ? `${previous}..HEAD` : 'HEAD';

// \x1f separates fields, \x1e separates commits.
const log = git('log', range, '--first-parent', '--format=%H%x1f%s%x1f%b%x1e').split('\x1e').map((s) => s.trim()).filter(Boolean);

const changes = [];
for (const entry of log) {
  const [sha, subject, body] = entry.split('\x1f');
  const pr = parseMerge(subject, body);
  if (!pr) continue;
  // Files changed by this merge relative to its first parent.
  const files = git('diff', '--name-only', `${sha}^1`, sha).split('\n').filter(Boolean);
  changes.push({ ...pr, files });
}

const markdown = renderChangelog({
  version,
  date: new Date().toISOString().slice(0, 10),
  previous,
  groups: groupByApp(changes),
  repo: process.env.GITHUB_REPOSITORY || 'Pulsefy/Lumenpulse',
});

const out = arg('--out');
if (out) fs.writeFileSync(out, markdown);
else process.stdout.write(markdown);
