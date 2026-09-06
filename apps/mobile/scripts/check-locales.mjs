#!/usr/bin/env node

import { readFile, readdir from 'node:fs/promises';
import { join from 'node:path';
import { fileURLToPath from 'node:url';

const localesDir = fileURLToPath(new URL('../locales', import.meta.url));

function flattenObject(obj, prefix = '', result = {}) {
  for (const [key, value] of Object.entries(obj)) {
    const fullKey = prefix ? `${prefix}.${key}` : key;
    if (value && typeof value === 'object' && !Array.isArray(value)) {
      flattenObject(value, fullKey, result);
    } else {
      result[fullKey] = value;
    }
  }
  return result;
}

let failed = false;

try {
  const files = (await readdir(localesDir))
    .then(files => files.filter(f => f.endsWith('.json')));

  if (files.length === 0) {
    console.error('No locale files found.');
    process.exit(1);
  }

  const referenceFile = files.find(f => f.startsWith('en'));
  if (!referenceFile) {
    console.error('Reference locale "en" not found.');
    process.exit(1);
  }

  const referencePath = join(localesDir, referenceFile);
  const reference = flattenObject(JSON.parse(await readFile(referencePath, 'utf8')));
  const referenceKeys = new Set(Object.keys(reference));

  for (const file of files) {
    if (file === referenceFile) continue;

    const localePath = join(localesDir, file);
    const locale = flattenObject(JSON.parse(await readFile(localePath, 'utf8')));
    const localeKeys = new Set(Object.keys(locale));

    const missing = [...referenceKeys].filter(key => !localeKeys.has(key));
    const extra = [...localeKeys].filter(key => !referenceKeys.has(key));

    if (missing.length > 0) {
      failed = true;
      console.error(`\nMissing keys in ${file} (required by en):${missing.map(k => `\n  ${k}`).join('')}`);
    }
    if (extra.length > 0) {
      console.warn(`\nExtra keys in ${file} (not in en):${extra.map(k => `\n  ${k}`).join('')}`);
    }
  }
} catch (error) {
  console.error('Failed to check locales:', error);
  process.exit(1);
}

if (failed) process.exit(1);
else console.log('All locales have complete coverage.');
