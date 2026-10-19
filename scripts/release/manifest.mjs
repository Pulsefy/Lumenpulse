#!/usr/bin/env node
// Builds release-manifest.json: the one document that says what a release
// contains (issue #1725). Everything a deployment needs to identify itself is
// here: the commit, the container image digests, the contract WASM hashes and
// the SBOM.
//
//   node scripts/release/manifest.mjs --version v1.2.0 --sha <sha> \
//        --images image-*.json --wasm wasm-hashes.json --sbom sbom.cdx.json --out release-manifest.json

import fs from 'node:fs';
import { pathToFileURL } from 'node:url';

export function buildManifest({ version, sha, repo, images, wasm, sbom, createdAt = new Date().toISOString() }) {
  return {
    version,
    commit: sha,
    createdAt,
    repository: repo,
    release: `https://github.com/${repo}/releases/tag/${version}`,
    images: Object.fromEntries(
      images.map((i) => [i.app, { image: i.image, tag: i.tag, digest: i.digest }]),
    ),
    contracts: wasm?.contracts ?? {},
    sbom: sbom ?? null,
  };
}

function main() {
  const args = process.argv.slice(2);
  const flag = (n) => { const i = args.indexOf(n); return i !== -1 ? args[i + 1] : undefined; };
  // Values following `name` up to the next --flag.
  const list = (n) => {
    const i = args.indexOf(n);
    if (i === -1) return [];
    const rest = args.slice(i + 1);
    const end = rest.findIndex((a) => a.startsWith('--'));
    return end === -1 ? rest : rest.slice(0, end);
  };
  const imageFiles = list('--images');
  const manifest = buildManifest({
    version: flag('--version'),
    sha: flag('--sha'),
    repo: process.env.GITHUB_REPOSITORY || 'Pulsefy/Lumenpulse',
    images: imageFiles.map((f) => JSON.parse(fs.readFileSync(f, 'utf8'))),
    wasm: flag('--wasm') ? JSON.parse(fs.readFileSync(flag('--wasm'), 'utf8')) : null,
    sbom: flag('--sbom') ?? null,
  });
  fs.writeFileSync(flag('--out') ?? 'release-manifest.json', JSON.stringify(manifest, null, 2) + '\n');
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) main();
