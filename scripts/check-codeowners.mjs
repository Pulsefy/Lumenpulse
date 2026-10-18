#!/usr/bin/env node
// Reports pull-request paths that are matched only by the CODEOWNERS catch-all
// rule, i.e. paths nobody has explicitly claimed.
//
// Issue #1715 asks for "a pull request touching an unowned path is
// detectable". Without this, a CODEOWNERS file silently rots: a new top-level
// directory lands, matches `*`, and nobody is ever asked to look at it, because
// GitHub reports the catch-all owner as happily as it reports a real one.
//
// Usage:
//   node scripts/check-codeowners.mjs                    # diff against upstream/main
//   node scripts/check-codeowners.mjs --base origin/main
//   node scripts/check-codeowners.mjs path/to/file ...   # check explicit paths
//   node scripts/check-codeowners.mjs --strict           # non-zero exit on any hit
//
// Exit codes: 0 clean, 1 catch-all-only paths found (or --strict with errors),
// 2 the CODEOWNERS file itself is malformed.

import { readFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const codeownersPath = join(repoRoot, '.github', 'CODEOWNERS');

const args = process.argv.slice(2);
const flag = (name) => args.includes(name);
const option = (name, fallback) => {
  const i = args.indexOf(name);
  return i !== -1 && args[i + 1] ? args[i + 1] : fallback;
};
const positional = args.filter((a, i) => !a.startsWith('-') && !args[i - 1]?.startsWith('--'));

// The catch-all rule. CODEOWNERS has no dedicated syntax for "no explicit
// owner"; a bare `*` at the top of the file is the convention, and this is that
// pattern.
const CATCH_ALL = '*';

// ---------------------------------------------------------------------------
// Parsing
// ---------------------------------------------------------------------------

function parseCodeowners(contents) {
  const rules = [];

  for (const rawLine of contents.split('\n')) {
    const line = rawLine.trim();
    if (!line || line.startsWith('#')) continue;

    const parts = line.split(/\s+/);
    const pattern = parts[0];
    const owners = parts.slice(1);

    if (!owners.length) {
      throw new Error(`CODEOWNERS rule '${pattern}' has no owners`);
    }
    for (const owner of owners) {
      if (!/^@[A-Za-z0-9][A-Za-z0-9-]*(\/[A-Za-z0-9._-]+)?$/.test(owner)) {
        throw new Error(`CODEOWNERS rule '${pattern}' has a malformed owner: ${owner}`);
      }
    }

    rules.push({ pattern, owners, line: rawLine });
  }

  if (!rules.length) {
    throw new Error('CODEOWNERS contains no rules');
  }
  // GitHub applies the LAST matching pattern, so a catch-all placed at the
  // bottom would beat every specific rule below it... i.e. above it, and the
  // whole file would be inert. It has to come first.
  if (rules[0].pattern !== CATCH_ALL) {
    throw new Error(
      'CODEOWNERS must start with a `* <owners>` catch-all rule. GitHub applies the last ' +
        'matching pattern, so a trailing catch-all would win against every specific rule.',
    );
  }
  if (rules.filter((r) => r.pattern === CATCH_ALL).length > 1) {
    throw new Error('CODEOWNERS declares more than one catch-all `*` rule');
  }

  return rules;
}

/**
 * Converts a CODEOWNERS pattern to a regular expression.
 *
 * Supported: `*` (within a segment), `**` (across segments), `?`, `{a,b}`
 * alternation, and a trailing `/` meaning "this directory and everything below
 * it". Character classes are not supported by CODEOWNERS itself, so they are
 * rejected rather than silently treated as literal.
 */
function patternToRegExp(pattern) {
  let source = pattern;

  if (source.includes('[') || source.includes(']')) {
    throw new Error(`CODEOWNERS pattern '${pattern}' uses character classes, which are not supported`);
  }

  const isDirectory = source.endsWith('/');
  if (isDirectory) source = source.slice(0, -1);

  let out = '';
  for (let i = 0; i < source.length; i += 1) {
    const ch = source[i];

    if (ch === '*') {
      if (source[i + 1] === '*') {
        // `**` crosses directory separators. `/**/` must also match zero segments.
        out += '(?:.*/)?';
        i += 1;
        if (source[i + 1] === '/') i += 1;
      } else {
        out += '[^/]*';
      }
      continue;
    }

    if (ch === '?') {
      out += '[^/]';
      continue;
    }

    if (ch === '{') {
      const close = source.indexOf('}', i);
      if (close === -1) throw new Error(`CODEOWNERS pattern '${pattern}' has an unclosed '{'`);
      const alternatives = source
        .slice(i + 1, close)
        .split(',')
        .map((alt) => patternToRegExp(alt).source.replace(/^\^|\$$/g, ''));
      out += `(?:${alternatives.join('|')})`;
      i = close;
      continue;
    }

    out += ch.replace(/[.+^${}()|[\]\\]/g, '\\$&');
  }

  // A directory rule covers the directory itself and everything beneath it; a
  // file rule covers only itself.
  const suffix = isDirectory ? '(?:/.*)?$' : '$';
  return new RegExp(`^${out}${suffix}`);
}

function ownersForPath(rules, path) {
  // CODEOWNERS semantics: the last matching rule wins. The catch-all is first,
  // so reaching it means nothing more specific claimed this path.
  for (let i = rules.length - 1; i >= 0; i -= 1) {
    if (patternToRegExp(rules[i].pattern).test(path)) {
      return { rule: rules[i], catchAll: rules[i].pattern === CATCH_ALL };
    }
  }
  return null;
}

// ---------------------------------------------------------------------------
// Changed paths
// ---------------------------------------------------------------------------

function changedPaths(base) {
  const range = `${base}...HEAD`;
  try {
    const out = execFileSync('git', ['diff', '--name-only', range], {
      cwd: repoRoot,
      encoding: 'utf8',
    });
    return out.split('\n').map((l) => l.trim()).filter(Boolean);
  } catch {
    console.error(
      `Could not diff against '${range}'. Fetch the base branch first, or pass explicit paths.`,
    );
    process.exit(2);
  }
}

// ---------------------------------------------------------------------------

function main() {
  let rules;
  try {
    rules = parseCodeowners(readFileSync(codeownersPath, 'utf8'));
  } catch (err) {
    console.error(`.github/CODEOWNERS: ${err.message}`);
    process.exit(2);
  }

  const paths = positional.length ? positional : changedPaths(option('--base', 'upstream/main'));

  if (!paths.length) {
    console.log('No changed paths to check.');
    return;
  }

  const catchAllOnly = [];

  for (const path of paths) {
    const match = ownersForPath(rules, path);
    if (!match || match.catchAll) {
      catchAllOnly.push(path);
    }
  }

  const owned = paths.length - catchAllOnly.length;

  console.log(`CODEOWNERS: ${owned}/${paths.length} changed paths have an explicit owner.`);

  if (catchAllOnly.length) {
    console.log('\nMatched only by the catch-all `*` rule — nobody has claimed these:');
    for (const path of catchAllOnly) {
      console.log(`  ${path}`);
    }
    console.log(
      '\nEither add a rule for these paths to .github/CODEOWNERS, or record why in the PR ' +
        'body why no owner is needed.',
    );
    process.exit(1);
  }

  if (flag('--strict')) {
    console.log('\nNo unowned paths.');
  }
}

main();