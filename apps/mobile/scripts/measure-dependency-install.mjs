#!/usr/bin/env node
// Run after npm ci. Counts logical file bytes, without following workspace links.
import { readdir, readFile, stat } from 'node:fs/promises';
import path from 'node:path';

const app = path.resolve(process.argv[2] ?? '.');
const manifest = JSON.parse(await readFile(path.join(app, 'package.json'), 'utf8'));
const lock = JSON.parse(await readFile(path.join(app, 'package-lock.json'), 'utf8'));
const installed = { bytes: 0, files: 0, skippedLinks: 0 };

async function walk(directory) {
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const target = path.join(directory, entry.name);
    if (entry.isSymbolicLink()) {
      installed.skippedLinks += 1;
    } else if (entry.isDirectory()) {
      await walk(target);
    } else if (entry.isFile()) {
      installed.bytes += (await stat(target)).size;
      installed.files += 1;
    }
  }
}

await walk(path.join(app, 'node_modules'));
console.log(
  JSON.stringify(
    {
      node: process.version,
      platform: `${process.platform}-${process.arch}`,
      directRuntime: Object.keys(manifest.dependencies ?? {}).length,
      directDevelopment: Object.keys(manifest.devDependencies ?? {}).length,
      resolvedPackages: Object.entries(lock.packages).filter(
        ([name, value]) => name.includes('node_modules/') && !value.link,
      ).length,
      installed,
    },
    null,
    2,
  ),
);
