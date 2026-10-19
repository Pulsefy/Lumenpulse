#!/usr/bin/env node
// node scripts/deploy/verify-hashes.mjs <wasm-dir> <wasm-hashes.json>
// Exits 1 when any WASM differs from what the release published.
import fs from 'node:fs';
import { verifyHashes } from './lib.mjs';

const [dir, hashesFile] = process.argv.slice(2);
if (!dir || !hashesFile) {
  console.error('Usage: verify-hashes.mjs <wasm-dir> <wasm-hashes.json>');
  process.exit(2);
}
const problems = verifyHashes(JSON.parse(fs.readFileSync(hashesFile, 'utf8')), dir);
if (problems.length) {
  for (const p of problems) console.log(`::error::WASM does not match the release: ${p}`);
  process.exit(1);
}
console.log('All contract WASM files match the release hashes.');
