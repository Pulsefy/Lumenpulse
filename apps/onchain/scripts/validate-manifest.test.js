'use strict';

const assert = require('node:assert/strict');
const { after, describe, it } = require('node:test');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const {
  validateManifestFile,
} = require('./validate-manifest');

const onchainRoot = path.resolve(__dirname, '..');
const tempDirs = [];

after(() => {
  for (const dir of tempDirs) {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

const VALID_ID = 'CCOVDGHF3XQ5RAFY6DJ36G6CHQJF54QCOBZXCC3LBMKNEWQJLDGXQJSB';
const OTHER_ID = 'CBYFZU7C5TV2J56PEOXI5Q53HNFYFOW4USEBG4M6BCV7RUIMJI7JISLC';
const VALID_HASH = '4a25619b8fea02f3447e7b700e2f2b0ed575f62679006ddc981009b26d9d5e71';

/**
 * Builds a throwaway onchain workspace so the validator can be exercised
 * against crate layouts that the repository does not have.
 */
function createWorkspace({ crates, excluded = [] }) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'manifest-'));
  tempDirs.push(root);

  const contractsRoot = path.join(root, 'contracts');
  fs.mkdirSync(contractsRoot, { recursive: true });

  for (const crate of [...crates, ...excluded]) {
    const crateDir = path.join(contractsRoot, crate);
    fs.mkdirSync(crateDir, { recursive: true });
    fs.writeFileSync(path.join(crateDir, 'Cargo.toml'), `[package]\nname = "${crate}"\n`);
  }

  const workspaceManifestPath = path.join(root, 'Cargo.toml');
  fs.writeFileSync(
    workspaceManifestPath,
    [
      '[workspace]',
      'members = [',
      ...crates.map((crate) => `  "contracts/${crate}",`),
      ']',
      'exclude = [',
      ...excluded.map((crate) => `  "contracts/${crate}",`),
      ']',
      '',
    ].join('\n'),
  );

  const manifestPath = path.join(root, 'testnet-manifest.json');
  const writeManifest = (manifest) => {
    fs.writeFileSync(manifestPath, JSON.stringify(manifest, null, 2));
    return manifestPath;
  };

  return { manifestPath, contractsRoot, workspaceManifestPath, writeManifest };
}

const baseManifest = () => ({
  network: 'testnet',
  rpc_url: 'https://soroban-testnet.stellar.org:443',
  admin_address: 'GDPBZZDKZJTPFERPP65ATQWH2T6OIXQESPKXSTO6YY33TA2HTUTAPJI6',
  crate_coverage: { total_crates: 2, deployed: 1, not_deployed: 1 },
  contracts: {
    treasury: { id: VALID_ID, wasm_hash: VALID_HASH },
  },
  not_deployed: {
    yield_vault: {
      crate_path: 'contracts/yield_vault',
      reason: 'Not deployed on testnet: the yield vault is reserved for a future treasury expansion.',
    },
  },
});

describe('validate-manifest', () => {
  it('accepts the repository manifest and reports its coverage', () => {
    const result = validateManifestFile();

    assert.deepEqual(result.errors, []);
    assert.equal(result.ok, true);
    assert.equal(result.totalCrates, 23);
    assert.equal(result.deployed.length, 7);
    assert.equal(result.notDeployed.length, 16);
    assert.equal(
      result.deployed.includes('pricing_adapter') &&
        result.notDeployed.includes('version_interface'),
      true,
    );
  });

  it('fails when a crate is neither deployed nor excluded', () => {
    const workspace = createWorkspace({ crates: ['treasury', 'yield_vault', 'liquidity_pool'] });
    const manifest = baseManifest();
    manifest.crate_coverage = { total_crates: 3, deployed: 1, not_deployed: 1 };
    workspace.writeManifest(manifest);

    const result = validateManifestFile(workspace);

    assert.equal(result.ok, false);
    assert.ok(
      result.errors.some((error) =>
        error.includes('liquidity_pool') && error.includes('neither deployed nor explicitly excluded'),
      ),
      `expected an uncovered-crate error, got ${JSON.stringify(result.errors)}`,
    );
  });

  it('fails when a crate is listed as both deployed and not deployed', () => {
    const workspace = createWorkspace({ crates: ['treasury', 'yield_vault'] });
    const manifest = baseManifest();
    manifest.not_deployed.treasury = {
      reason: 'Not deployed on testnet: this crate is intentionally kept internal for now.',
    };
    workspace.writeManifest(manifest);

    const result = validateManifestFile(workspace);

    assert.equal(result.ok, false);
    assert.ok(
      result.errors.some((error) => error.includes('listed as both deployed and not deployed')),
    );
  });

  it('fails when an entry does not map to a crate directory', () => {
    const workspace = createWorkspace({ crates: ['treasury', 'yield_vault'] });
    const manifest = baseManifest();
    manifest.contracts.retired_pool = { id: OTHER_ID, wasm_hash: VALID_HASH };
    manifest.crate_coverage = { total_crates: 3, deployed: 2, not_deployed: 1 };
    workspace.writeManifest(manifest);

    const result = validateManifestFile(workspace);

    assert.equal(result.ok, false);
    assert.ok(
      result.errors.some(
        (error) => error.includes('retired_pool') && error.includes('does not match any crate'),
      ),
    );
  });

  it('fails on malformed contract IDs, WASM hashes and addresses', () => {
    const workspace = createWorkspace({ crates: ['treasury', 'yield_vault'] });
    const manifest = baseManifest();
    manifest.contracts.treasury = {
      id: 'CTREASURY',
      wasm_hash: 'not-a-hash',
      admin_address: 'not-an-address',
      init_params: { token: 'nope' },
    };
    workspace.writeManifest(manifest);

    const result = validateManifestFile(workspace);

    assert.equal(result.ok, false);
    assert.ok(result.errors.some((error) => error.includes('invalid Soroban contract ID: CTREASURY')));
    assert.ok(result.errors.some((error) => error.includes('invalid WASM hash: not-a-hash')));
    assert.ok(result.errors.some((error) => error.includes('invalid admin_address')));
    assert.ok(result.errors.some((error) => error.includes('invalid init_params.token address')));
  });

  it('fails when two deployed contracts share a contract ID', () => {
    const workspace = createWorkspace({ crates: ['treasury', 'crowdfund_vault', 'yield_vault'] });
    const manifest = baseManifest();
    manifest.contracts.crowdfund_vault = { id: VALID_ID, wasm_hash: VALID_HASH };
    manifest.crate_coverage = { total_crates: 3, deployed: 2, not_deployed: 1 };
    workspace.writeManifest(manifest);

    const result = validateManifestFile(workspace);

    assert.equal(result.ok, false);
    assert.ok(result.errors.some((error) => error.includes('reuses the contract ID')));
  });

  it('fails when an excluded crate has no usable reason or keeps deployment metadata', () => {
    const workspace = createWorkspace({ crates: ['treasury', 'yield_vault', 'liquidity_pool'] });
    const manifest = baseManifest();
    manifest.crate_coverage = { total_crates: 3, deployed: 1, not_deployed: 2 };
    manifest.not_deployed.liquidity_pool = { reason: 'todo', id: OTHER_ID };
    workspace.writeManifest(manifest);

    const result = validateManifestFile(workspace);

    assert.equal(result.ok, false);
    assert.ok(result.errors.some((error) => error.includes('"reason" shorter than 20 characters')));
    assert.ok(
      result.errors.some(
        (error) => error.includes('liquidity_pool') && error.includes('must not include "id"'),
      ),
    );
  });

  it('fails when the header counts disagree with the recorded sections', () => {
    const workspace = createWorkspace({ crates: ['treasury', 'yield_vault'] });
    const manifest = baseManifest();
    manifest.crate_coverage = { total_crates: 3, deployed: 2, not_deployed: 1 };
    workspace.writeManifest(manifest);

    const result = validateManifestFile(workspace);

    assert.equal(result.ok, false);
    assert.ok(
      result.errors.some(
        (error) => error.includes('crate_coverage.deployed') && error.includes('says 2'),
      ),
    );
    assert.ok(
      result.errors.some(
        (error) => error.includes('crate_coverage.total_crates') && error.includes('says 3'),
      ),
    );
  });

  it('fails when the not_deployed section is missing entirely', () => {
    const workspace = createWorkspace({ crates: ['treasury', 'yield_vault'] });
    const manifest = baseManifest();
    delete manifest.not_deployed;
    workspace.writeManifest(manifest);

    const result = validateManifestFile(workspace);

    assert.equal(result.ok, false);
    assert.ok(
      result.errors.some((error) => error.includes('must contain a top-level "not_deployed"')),
    );
  });

  it('ignores crates excluded from the cargo workspace', () => {
    const workspace = createWorkspace({
      crates: ['treasury', 'yield_vault'],
      excluded: ['tests'],
    });
    workspace.writeManifest(baseManifest());

    const result = validateManifestFile(workspace);

    assert.deepEqual(result.errors, []);
    assert.equal(result.ok, true);
  });

  it('accepts a fixture that satisfies every rule', () => {
    const workspace = createWorkspace({ crates: ['treasury', 'yield_vault'] });
    workspace.writeManifest(baseManifest());

    const result = validateManifestFile(workspace);

    assert.deepEqual(result.errors, []);
    assert.equal(result.ok, true);
    assert.equal(result.totalCrates, 2);
  });

  it('reports a missing manifest instead of throwing', () => {
    const result = validateManifestFile({
      manifestPath: path.join(onchainRoot, 'does-not-exist.json'),
    });

    assert.equal(result.ok, false);
    assert.ok(result.errors[0].includes('Manifest not found'));
  });
});
