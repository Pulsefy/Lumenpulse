#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';

const root = path.resolve(process.argv[2] ?? 'contracts');
const output = process.argv[process.argv.indexOf('--output') + 1] ?? 'cost-inventory.json';
const manifest = fs.readFileSync(path.join(root, '..', 'Cargo.toml'), 'utf8');
const excluded = new Set([...manifest.matchAll(/"contracts\/([^"/]+)(?:\/[^\"]*)?"/g)]
  .map((match) => match[1])
  .filter((name) => new RegExp(`exclude\\s*=\\s*\\[[^\\]]*contracts/${name}`).test(manifest)));

function rustFiles(dir) {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const full = path.join(dir, entry.name);
    return entry.isDirectory() ? rustFiles(full) : entry.isFile() && entry.name.endsWith('.rs') ? [full] : [];
  });
}

function matchingBrace(source, open) {
  let depth = 0;
  for (let i = open; i < source.length; i += 1) {
    if (source[i] === '{') depth += 1;
    if (source[i] === '}' && --depth === 0) return i;
  }
  return -1;
}

function withoutInlineTestModules(source, file) {
  // Repository inline unit-test modules are terminal file sections. Removing
  // from their declaration is robust to braces in comments/test fixtures.
  const match = /#\[cfg\(test\)\]\s*(?:pub(?:\([^)]*\))?\s+)?mod\s+[A-Za-z_][A-Za-z0-9_]*\s*\{/.exec(source);
  return match ? source.slice(0, match.index) : source;
}

const methods = new Set();
for (const file of rustFiles(root)) {
  if (excluded.has(path.relative(root, file).split(path.sep)[0])) continue;
  // Test-only benchmark modules may define helper contracts with their own
  // #[contractimpl] blocks; those are fixtures, not deployed workspace APIs.
  if (path.basename(file) === 'cost_benchmarks.rs'
    || /^tests?(?:_|\.)/.test(path.basename(file))
    || path.relative(root, file).split(path.sep).includes('tests')) continue;
  const source = withoutInlineTestModules(fs.readFileSync(file, 'utf8'), file);
  const marker = /#\[contractimpl(?:\([^\]]*\))?\]\s*impl\b/g;
  for (const match of source.matchAll(marker)) {
    const open = source.indexOf('{', match.index + match[0].length);
    if (open < 0) continue;
    const close = matchingBrace(source, open);
    if (close < 0) throw new Error(`Unclosed contractimpl in ${file}`);
    const crate = path.relative(root, file).split(path.sep)[0];
    const implHeader = source.slice(match.index + match[0].length, open);
    const methodPattern = /\bfor\b/.test(implHeader)
      ? /\bfn\s+([A-Za-z_][A-Za-z0-9_]*)\s*\(/g
      : /\bpub\s+(?:async\s+)?fn\s+([A-Za-z_][A-Za-z0-9_]*)\s*\(/g;
    const body = source.slice(open + 1, close);
    // Trait implementations expose their methods without `pub`; inherent
    // contract implementations expose only public methods, not private helpers.
    for (const method of body.matchAll(methodPattern)) {
      methods.add(`${crate}.${method[1]}`);
    }
  }
}

const inventory = {
  schemaVersion: 1,
  discovery: 'Rust #[contractimpl] public methods under workspace contract source trees',
  entrypoints: [...methods].sort().map((key) => {
    const [contract, entrypoint] = key.split('.');
    return { contract, entrypoint };
  }),
};
fs.writeFileSync(output, `${JSON.stringify(inventory, null, 2)}\n`);
console.log(`Discovered ${inventory.entrypoints.length} exported contract entrypoints in ${root}`);
