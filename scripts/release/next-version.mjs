#!/usr/bin/env node
// Prints the next release version for the release workflow (issue #1725):
//   node scripts/release/next-version.mjs --bump patch
// Output is two lines for $GITHUB_OUTPUT: version=vX.Y.Z and previous=<tag|>.

import { execFileSync } from 'node:child_process';
import { latestTag, nextVersion } from './lib.mjs';

const i = process.argv.indexOf('--bump');
const bump = i !== -1 ? process.argv[i + 1] : 'patch';
const tags = execFileSync('git', ['tag', '--list', 'v*'], { encoding: 'utf8' }).split('\n').filter(Boolean);
const previous = latestTag(tags);
console.log(`version=${nextVersion(previous, bump)}`);
console.log(`previous=${previous ?? ''}`);
