#!/usr/bin/env node
// Writes the SHA-256 of every contract WASM in a directory (issue #1725), so a
// release records exactly which bytes it contains.
//
//   node scripts/release/wasm-hashes.mjs <dir> [--out wasm-hashes.json] [--version vX.Y.Z]

import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

export function hashDirectory(dir) {
  const result = {};
  for (const name of fs.readdirSync(dir).filter((n) => n.endsWith('.wasm')).sort()) {
    const bytes = fs.readFileSync(path.join(dir, name));
    result[name] = { sha256: crypto.createHash('sha256').update(bytes).digest('hex'), bytes: bytes.length };
  }
  return result;
}

function main() {
  const [dir] = process.argv.slice(2).filter((a) => !a.startsWith('--') && !process.argv[process.argv.indexOf(a) - 1]?.startsWith('--'));
  const flag = (n) => { const i = process.argv.indexOf(n); return i !== -1 ? process.argv[i + 1] : undefined; };
  if (!dir || !fs.existsSync(dir)) {
    console.error('Usage: wasm-hashes.mjs <dir> [--out file] [--version vX.Y.Z]');
    process.exit(2);
  }
  const hashes = hashDirectory(dir);
  if (Object.keys(hashes).length === 0) {
    console.error(`No .wasm files in ${dir}`);
    process.exit(1);
  }
  const doc = { version: flag('--version') ?? null, generatedAt: new Date().toISOString(), contracts: hashes };
  const out = flag('--out');
  if (out) fs.writeFileSync(out, JSON.stringify(doc, null, 2) + '\n');
  else process.stdout.write(JSON.stringify(doc, null, 2) + '\n');
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) main();
