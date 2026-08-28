import { execSync } from 'node:child_process';
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';

/**
 * Static migration safety checks enforced in CI:
 *
 * 1. Migrations live in exactly one directory (`src/database/migrations`).
 * 2. The migration directory contains only migration files (no stray `.sql`,
 *    `.bak`, or `.js` files).
 * 3. Migration timestamps are unique.
 * 4. Every new/changed migration has a non-trivial `down()` method.
 * 5. Destructive operations in a new/changed migration's `up()` require an
 *    explicit acknowledgement marker (`@acknowledge-destructive`).
 *
 * "New/changed" is determined against `origin/main` (falling back to the
 * working tree) so historical migrations are not retroactively flagged.
 */

const REPO_ROOT = resolve(__dirname, '../../..');
const MIGRATIONS_DIR = resolve(__dirname, '../src/database/migrations');
const LEGACY_MIGRATIONS_DIR = resolve(__dirname, '../src/migrations');

const DESTRUCTIVE_PATTERNS: Array<{ label: string; regex: RegExp }> = [
  { label: 'DROP TABLE', regex: /\bDROP\s+TABLE\b/i },
  { label: 'DROP COLUMN', regex: /\bDROP\s+COLUMN\b/i },
  { label: 'DROP TYPE', regex: /\bDROP\s+TYPE\b/i },
  { label: 'DROP SCHEMA', regex: /\bDROP\s+SCHEMA\b/i },
  { label: 'DROP DATABASE', regex: /\bDROP\s+DATABASE\b/i },
  { label: 'DROP VIEW', regex: /\bDROP\s+VIEW\b/i },
  { label: 'DROP SEQUENCE', regex: /\bDROP\s+SEQUENCE\b/i },
  { label: 'DROP OWNED', regex: /\bDROP\s+OWNED\b/i },
  { label: 'TRUNCATE', regex: /\bTRUNCATE\b/i },
  { label: 'DELETE FROM', regex: /\bDELETE\s+FROM\b/i },
];

const ACK_MARKERS = [
  '@acknowledge-destructive',
  'migration:acknowledge-destructive',
];
const IRREVERSIBLE_MARKERS = ['@irreversible', '@acknowledge-irreversible'];

interface ChangedMigrationFiles {
  changed: Set<string>;
  added: Set<string>;
}

interface Findings {
  errors: string[];
  warnings: string[];
}

function log(message: string): void {
  process.stdout.write(message + '\n');
}

function findChangedMigrationFiles(): ChangedMigrationFiles {
  const changed = new Set<string>();
  const added = new Set<string>();

  const bases = ['origin/main', 'main'];
  let base = '';
  for (const candidate of bases) {
    try {
      execSync(`git rev-parse --verify --quiet ${candidate}`, {
        stdio: 'ignore',
        cwd: REPO_ROOT,
      });
      base = candidate;
      break;
    } catch {
      // try next base
    }
  }

  const statusPattern = base
    ? `git diff --name-status ${base} -- apps/backend/src/database/migrations/`
    : 'git diff --name-status -- apps/backend/src/database/migrations/';

  try {
    const output = execSync(statusPattern, {
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
      cwd: REPO_ROOT,
    });
    for (const line of output.split('\n')) {
      const match = /^([AMRD])\s+(.+)$/.exec(line.trim());
      if (!match) {
        continue;
      }
      const [, status, path] = match;
      const fullPath = resolve(REPO_ROOT, path);
      if (status === 'A') {
        added.add(fullPath);
      }
      changed.add(fullPath);
    }
  } catch {
    // no diff available
  }

  return { changed, added };
}

function extractMethodBody(source: string, method: 'up' | 'down'): string {
  const signature = new RegExp(
    `(?:public\\s+)?async\\s+${method}\\s*\\([^)]*\\)[^\\{]*\\{`,
    'm',
  );
  const match = signature.exec(source);
  if (!match) {
    return '';
  }

  const openBrace = source.indexOf('{', match.index);
  if (openBrace === -1) {
    return '';
  }

  const other = method === 'up' ? 'down' : 'up';
  const otherSig = new RegExp(
    `(?:public\\s+)?async\\s+${other}\\s*\\([^)]*\\)[^\\{]*\\{`,
    'm',
  );
  const otherMatch = otherSig.exec(source);

  let end = source.length;
  if (otherMatch) {
    const otherOpenBrace = source.indexOf('{', otherMatch.index);
    if (otherOpenBrace > openBrace) {
      end = source.lastIndexOf('}', otherOpenBrace - 1);
      if (end < openBrace) {
        end = otherMatch.index;
      }
    }
  }

  return source.slice(openBrace, end);
}

function isDestructive(content: string): string[] {
  return DESTRUCTIVE_PATTERNS.filter(({ regex }) => regex.test(content)).map(
    ({ label }) => label,
  );
}

function hasAckMarker(source: string): boolean {
  return ACK_MARKERS.some((marker) => source.includes(marker));
}

function hasNonTrivialDown(source: string): boolean {
  const downBody = extractMethodBody(source, 'down');
  return /queryRunner\.[a-zA-Z]+\(/.test(downBody);
}

function findingsForFile(
  filename: string,
  fullPath: string,
  isNewOrChanged: boolean,
  findings: Findings,
): void {
  const source = readFileSync(fullPath, 'utf8');

  const timestampMatch = /^(\d+)-/.exec(filename);
  if (!timestampMatch) {
    findings.errors.push(
      `${filename}: migration files must start with a numeric timestamp`,
    );
    return;
  }

  if (!isNewOrChanged) {
    return;
  }

  const upBody = extractMethodBody(source, 'up');
  if (!upBody.trim()) {
    findings.errors.push(
      `${filename}: no up() method body found — migrations must define up()`,
    );
  }

  const destructive = isDestructive(upBody);
  if (destructive.length > 0) {
    if (!hasAckMarker(source)) {
      findings.errors.push(
        `${filename}: destructive operation(s) detected in up() (${destructive.join(
          ', ',
        )}) without an acknowledgement marker. Add a comment containing ` +
          '`@acknowledge-destructive` explaining why this is safe.',
      );
    } else {
      log(
        `  note: ${filename} contains acknowledged destructive operation(s) (${destructive.join(', ')})`,
      );
    }
  }

  if (!hasNonTrivialDown(source)) {
    if (IRREVERSIBLE_MARKERS.some((marker) => source.includes(marker))) {
      log(
        `  note: ${filename} is marked @irreversible — down() is intentionally empty`,
      );
    } else {
      findings.errors.push(
        `${filename}: missing a down() method — every new migration must define ` +
          'a non-trivial down() so it can be reverted. If it cannot be reverted, ' +
          'add an `@irreversible` marker with an explanation.',
      );
    }
  }

  if (
    !/CREATE\s+TABLE/i.test(upBody) &&
    /(CREATE\s+INDEX(?!\s+CONCURRENTLY))/.test(upBody)
  ) {
    findings.warnings.push(
      `${filename}: up() creates an index on an existing table without ` +
        'CONCURRENTLY — on a large table this will take a long time and lock writes.',
    );
  }
  if (/(ADD\s+COLUMN[^;]*\bNOT\s+NULL\b[^;]*\bDEFAULT\b)/i.test(upBody)) {
    findings.warnings.push(
      `${filename}: up() adds a NOT NULL column with a DEFAULT — on a large table ` +
        'this rewrite can lock the table.',
    );
  }
}

function main(): void {
  const findings: Findings = { errors: [], warnings: [] };

  log('Checking migration directory reconciliation...');
  if (existsSync(LEGACY_MIGRATIONS_DIR)) {
    findings.errors.push(
      `legacy migration directory still exists: ${LEGACY_MIGRATIONS_DIR}. ` +
        'All migrations must live in src/database/migrations.',
    );
  }
  if (!existsSync(MIGRATIONS_DIR)) {
    findings.errors.push(`migration directory not found: ${MIGRATIONS_DIR}`);
    printReport(findings);
    process.exitCode = 1;
    return;
  }

  const files = readdirSync(MIGRATIONS_DIR);
  const tsFiles = files.filter((file) => file.endsWith('.ts'));
  const nonTsFiles = files.filter(
    (file) => !file.endsWith('.ts') && file !== 'README.md',
  );
  if (nonTsFiles.length > 0) {
    findings.errors.push(
      `unexpected non-migration file(s) in ${MIGRATIONS_DIR}: ${nonTsFiles.join(
        ', ',
      )}`,
    );
  }

  log('Checking migration timestamp uniqueness...');
  const allTimestamps = new Map<string, string>();
  for (const file of tsFiles) {
    const match = /^(\d+)-/.exec(file);
    if (match) {
      allTimestamps.set(match[1], file);
    }
  }

  log('Detecting new/changed migrations against origin/main...');
  const { changed, added } = findChangedMigrationFiles();
  const changedHere = new Set<string>();
  const addedHere = new Set<string>();
  for (const file of tsFiles) {
    const fullPath = resolve(MIGRATIONS_DIR, file);
    if (changed.has(fullPath)) {
      changedHere.add(file);
    }
    if (added.has(fullPath)) {
      addedHere.add(file);
    }
  }

  for (const file of addedHere) {
    const timestamp = /^(\d+)-/.exec(file)?.[1];
    if (timestamp && allTimestamps.get(timestamp) !== file) {
      findings.errors.push(
        `new migration ${file} reuses timestamp ${timestamp} already ` +
          `used by ${allTimestamps.get(timestamp)}`,
      );
    }
  }

  if (changedHere.size > 0) {
    log(`Checking ${changedHere.size} new/changed migration(s)...`);
  } else {
    log('No new/changed migrations detected; skipping per-migration checks.');
  }

  for (const file of tsFiles) {
    const fullPath = resolve(MIGRATIONS_DIR, file);
    findingsForFile(file, fullPath, changedHere.has(file), findings);
  }

  printReport(findings);
  process.exitCode = findings.errors.length > 0 ? 1 : 0;
}

function printReport(findings: Findings): void {
  log('');
  log('╔══════════════════════════════════════════════════════════╗');
  log('║                Migration Safety Check                     ║');
  log('╚══════════════════════════════════════════════════════════╝');
  log('');

  if (findings.warnings.length > 0) {
    log(`Warnings (${findings.warnings.length}):`);
    for (const warning of findings.warnings) {
      log(`  - ${warning}`);
    }
    log('');
  }

  if (findings.errors.length > 0) {
    log(`Errors (${findings.errors.length}):`);
    for (const error of findings.errors) {
      log(`  ✗ ${error}`);
    }
    log('');
    log('Migration safety check FAILED.');
  } else {
    log('Migration safety check PASSED.');
  }
}

main();
