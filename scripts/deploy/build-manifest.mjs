#!/usr/bin/env node
// node scripts/deploy/build-manifest.mjs --ids scripts/contract-ids.json --wasm wasm-hashes.json --rpc <url> --out deployment-manifest.json
import fs from 'node:fs';
import { buildDeploymentManifest } from './lib.mjs';

const flag = (n) => { const i = process.argv.indexOf(n); return i !== -1 ? process.argv[i + 1] : undefined; };
const manifest = buildDeploymentManifest({
  contractIds: JSON.parse(fs.readFileSync(flag('--ids'), 'utf8')),
  wasmHashes: flag('--wasm') ? JSON.parse(fs.readFileSync(flag('--wasm'), 'utf8')) : null,
  networkName: flag('--network') ?? 'testnet',
  rpcUrl: flag('--rpc'),
});
fs.writeFileSync(flag('--out') ?? 'deployment-manifest.json', JSON.stringify(manifest, null, 2) + '\n');
