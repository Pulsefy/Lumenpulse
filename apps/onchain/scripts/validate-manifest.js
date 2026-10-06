'use strict';

/**
 * Validates apps/onchain/testnet-manifest.json.
 *
 * The manifest is the canonical contract metadata source consumed by the
 * backend (apps/backend/src/contracts/deployment-manifest.service.ts), so it
 * has to account for every crate in apps/onchain/contracts. A crate is either
 * deployed (recorded in "contracts" with a contract ID and WASM hash) or
 * explicitly excluded (recorded in "not_deployed" with a reason).
 *
 * Usage: node scripts/validate-manifest.js [options]
 *   --manifest <path>    Override the manifest location.
 *   --contracts <dir>    Override the contracts crate directory.
 *   --workspace <file>   Override the workspace Cargo.toml location.
 */

const fs = require('fs');
const path = require('path');

const CONTRACT_ID_PATTERN = /^C[0-9A-Z]{55}$/;
const STELLAR_ADDRESS_PATTERN = /^[CG][0-9A-Z]{55}$/;
const WASM_HASH_PATTERN = /^[A-Fa-f0-9]{64}$/;
const MIN_REASON_LENGTH = 20;

const ADDRESS_FIELD_SUFFIX = '_address';
const ADDRESS_PARAM_KEYS = new Set(['admin', 'token', 'asset', 'oracle', 'payer', 'recipient']);

const onchainRoot = path.resolve(__dirname, '..');

const isPlainObject = (value) =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

const normalizeCrateName = (directoryName) => directoryName.replace(/-/g, '_');

const isAddressParam = (param) =>
  param.endsWith(ADDRESS_FIELD_SUFFIX) || ADDRESS_PARAM_KEYS.has(param);

function parseTomlStringArray(contents, key) {
  const section = contents.match(new RegExp(`^\\s*${key}\\s*=\\s*\\[([^\\]]*)\\]`, 'm'));
  if (!section) {
    return [];
  }
  return [...section[1].matchAll(/"([^"]+)"/g)].map((match) => match[1]);
}

function readWorkspaceConfig(workspaceManifestPath) {
  const contents = fs.readFileSync(workspaceManifestPath, 'utf8');
  return {
    members: parseTomlStringArray(contents, 'members'),
    exclude: parseTomlStringArray(contents, 'exclude'),
  };
}

/**
 * Discovers the crates that the manifest must account for by walking the
 * contracts directory. Crates excluded by the workspace (contracts/tests) are
 * not part of the deployment surface and therefore do not need an entry.
 */
function discoverCrates(contractsRoot, workspaceConfig, workspaceRoot = onchainRoot) {
  const errors = [];
  const crateNames = new Set();
  const excludedDirs = new Set();

  for (const entry of workspaceConfig.exclude) {
    excludedDirs.add(normalizeCrateName(path.basename(entry)));
  }

  for (const directoryName of fs.readdirSync(contractsRoot).sort()) {
    const directoryPath = path.join(contractsRoot, directoryName);
    if (!fs.statSync(directoryPath).isDirectory()) {
      continue;
    }
    if (!fs.existsSync(path.join(directoryPath, 'Cargo.toml'))) {
      continue;
    }
    crateNames.add(normalizeCrateName(directoryName));
  }

  for (const member of workspaceConfig.members) {
    if (excludedDirs.has(normalizeCrateName(path.basename(member)))) {
      continue;
    }
    const memberDirectory = path.join(workspaceRoot, member);
    if (!fs.existsSync(path.join(memberDirectory, 'Cargo.toml'))) {
      errors.push(
        `Workspace member "${member}" is listed in Cargo.toml but has no crate at ${memberDirectory}.`,
      );
    }
  }

  const required = [...crateNames].filter((name) => !excludedDirs.has(name)).sort();

  return { crateNames, required, errors };
}

function validateManifest(manifest, crates) {
  const errors = [...crates.errors];
  const crateNames = crates.crateNames;
  const required = crates.required;

  if (!isPlainObject(manifest)) {
    return { errors: [...errors, 'Manifest root must be a JSON object.'], deployed: [], notDeployed: [] };
  }

  for (const field of ['network', 'rpc_url']) {
    if (typeof manifest[field] !== 'string' || manifest[field].trim() === '') {
      errors.push(`Manifest must define a non-empty "${field}" string.`);
    }
  }

  if (
    typeof manifest.admin_address !== 'string' ||
    !STELLAR_ADDRESS_PATTERN.test(manifest.admin_address)
  ) {
    errors.push(
      `Manifest has an invalid admin_address: ${JSON.stringify(manifest.admin_address ?? null)}`,
    );
  }

  const deployed = isPlainObject(manifest.contracts) ? manifest.contracts : null;
  const notDeployed = isPlainObject(manifest.not_deployed) ? manifest.not_deployed : null;

  if (!deployed) {
    errors.push('Manifest must contain a top-level "contracts" object.');
  }
  if (!notDeployed) {
    errors.push(
      'Manifest must contain a top-level "not_deployed" object listing every crate that is not deployed with a reason.',
    );
  }

  const deployedNames = deployed ? Object.keys(deployed) : [];
  const notDeployedNames = notDeployed ? Object.keys(notDeployed) : [];
  const covered = new Set([...deployedNames, ...notDeployedNames]);

  for (const name of deployedNames) {
    if (!crateNames.has(name)) {
      errors.push(
        `Deployed contract "${name}" does not match any crate in contracts/ (expected contracts/${name.replace(/_/g, '-')} or an underscore-named crate).`,
      );
    }
  }

  for (const name of notDeployedNames) {
    if (!crateNames.has(name)) {
      errors.push(
        `Excluded crate "${name}" does not match any crate in contracts/ (expected contracts/${name.replace(/_/g, '-')} or an underscore-named crate).`,
      );
    }
  }

  for (const name of deployedNames) {
    if (notDeployedNames.includes(name)) {
      errors.push(`Crate "${name}" is listed as both deployed and not deployed.`);
    }
  }

  const uncovered = required.filter((name) => !covered.has(name));
  if (uncovered.length > 0) {
    errors.push(
      `Crates are neither deployed nor explicitly excluded: ${uncovered.join(', ')}. Add them to "contracts" or to "not_deployed" with a reason.`,
    );
  }

  if (deployed) {
    const seenIds = new Map();
    for (const [name, entry] of Object.entries(deployed)) {
      errors.push(...validateDeployedEntry(name, entry, seenIds));
    }
  }

  if (notDeployed) {
    for (const [name, entry] of Object.entries(notDeployed)) {
      errors.push(...validateNotDeployedEntry(name, entry, crateNames));
    }
  }

  errors.push(...validateCoverageHeader(manifest, deployedNames.length, notDeployedNames.length));

  return { errors, deployed: deployedNames, notDeployed: notDeployedNames };
}

function validateDeployedEntry(name, entry, seenIds) {
  const errors = [];

  if (!isPlainObject(entry)) {
    return [`Deployed contract "${name}" must be an object.`];
  }

  if (entry.reason !== undefined) {
    errors.push(
      `Deployed contract "${name}" must not carry a "reason"; move it to the "not_deployed" section.`,
    );
  }

  const id = entry.id ?? entry.contract_id;
  if (typeof id !== 'string' || id.trim() === '') {
    errors.push(`Deployed contract "${name}" is missing its contract ID.`);
  } else if (!CONTRACT_ID_PATTERN.test(id)) {
    errors.push(`Deployed contract "${name}" has an invalid Soroban contract ID: ${id}`);
  } else if (seenIds.has(id)) {
    errors.push(
      `Deployed contract "${name}" reuses the contract ID already recorded for "${seenIds.get(id)}": ${id}`,
    );
  } else {
    seenIds.set(id, name);
  }

  const wasmHash = entry.wasm_hash ?? entry.wasmHash;
  if (typeof wasmHash !== 'string' || wasmHash.trim() === '') {
    errors.push(`Deployed contract "${name}" is missing its WASM hash.`);
  } else if (!WASM_HASH_PATTERN.test(wasmHash)) {
    errors.push(`Deployed contract "${name}" has an invalid WASM hash: ${wasmHash}`);
  }

  for (const field of ['admin_address', 'token_address']) {
    const value = entry[field];
    if (value !== undefined && !STELLAR_ADDRESS_PATTERN.test(String(value))) {
      errors.push(`Deployed contract "${name}" has an invalid ${field}: ${JSON.stringify(value)}`);
    }
  }

  if (entry.init_params !== undefined && !isPlainObject(entry.init_params)) {
    errors.push(`Deployed contract "${name}" has a non-object "init_params" value.`);
  } else if (isPlainObject(entry.init_params)) {
    for (const [param, value] of Object.entries(entry.init_params)) {
      if (!isAddressParam(param)) {
        continue;
      }
      if (!STELLAR_ADDRESS_PATTERN.test(String(value))) {
        errors.push(
          `Deployed contract "${name}" has an invalid init_params.${param} address: ${JSON.stringify(value)}`,
        );
      }
    }
  }

  return errors;
}

function validateNotDeployedEntry(name, entry, crateNames) {
  const errors = [];

  if (!isPlainObject(entry)) {
    return [`Excluded crate "${name}" must be an object with a "reason".`];
  }

  const reason = entry.reason;
  if (typeof reason !== 'string' || reason.trim() === '') {
    errors.push(`Excluded crate "${name}" must state a non-empty "reason".`);
  } else if (reason.trim().length < MIN_REASON_LENGTH) {
    errors.push(
      `Excluded crate "${name}" has a "reason" shorter than ${MIN_REASON_LENGTH} characters; state why the crate is not deployed on testnet.`,
    );
  }

  for (const field of ['id', 'contract_id', 'wasm_hash', 'wasmHash']) {
    if (entry[field] !== undefined) {
      errors.push(
        `Excluded crate "${name}" must not include "${field}"; deployment metadata belongs in the "contracts" section.`,
      );
    }
  }

  if (entry.crate_path !== undefined) {
    const cratePath = entry.crate_path;
    if (typeof cratePath !== 'string' || cratePath.trim() === '') {
      errors.push(`Excluded crate "${name}" has an empty "crate_path".`);
    } else if (!crateNames.has(normalizeCrateName(path.basename(cratePath)))) {
      errors.push(`Excluded crate "${name}" points at a missing crate: ${cratePath}`);
    } else if (normalizeCrateName(path.basename(cratePath)) !== name) {
      errors.push(
        `Excluded crate "${name}" points at ${cratePath}, which belongs to crate "${normalizeCrateName(path.basename(cratePath))}".`,
      );
    }
  }

  return errors;
}

function validateCoverageHeader(manifest, deployedCount, notDeployedCount) {
  const coverage = manifest.crate_coverage;

  if (!isPlainObject(coverage)) {
    return [
      'Manifest must declare a "crate_coverage" header with the deployed and excluded crate counts.',
    ];
  }

  const errors = [];
  const expected = {
    deployed: deployedCount,
    not_deployed: notDeployedCount,
    total_crates: deployedCount + notDeployedCount,
  };

  for (const [field, value] of Object.entries(expected)) {
    const declared = coverage[field];
    if (!Number.isInteger(declared) || declared < 0) {
      errors.push(`Manifest header "crate_coverage.${field}" must be a non-negative integer.`);
    } else if (declared !== value) {
      errors.push(
        `Manifest header "crate_coverage.${field}" says ${declared} but the manifest records ${value}.`,
      );
    }
  }

  return errors;
}

function validateManifestFile(options = {}) {
  const manifestPath = options.manifestPath ?? path.join(onchainRoot, 'testnet-manifest.json');
  const contractsRoot = options.contractsRoot ?? path.join(onchainRoot, 'contracts');
  const workspaceManifestPath = options.workspaceManifestPath ?? path.join(onchainRoot, 'Cargo.toml');

  if (!fs.existsSync(manifestPath)) {
    return { ok: false, errors: [`Manifest not found: ${manifestPath}`], deployed: [], notDeployed: [] };
  }
  if (!fs.existsSync(contractsRoot)) {
    return { ok: false, errors: [`Contracts directory not found: ${contractsRoot}`], deployed: [], notDeployed: [] };
  }
  if (!fs.existsSync(workspaceManifestPath)) {
    return {
      ok: false,
      errors: [`Workspace manifest not found: ${workspaceManifestPath}`],
      deployed: [],
      notDeployed: [],
    };
  }

  const workspaceConfig = readWorkspaceConfig(workspaceManifestPath);
  const crates = discoverCrates(contractsRoot, workspaceConfig, path.dirname(workspaceManifestPath));

  let manifest;
  try {
    manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
  } catch (error) {
    return {
      ok: false,
      errors: [`Manifest is not valid JSON: ${error.message}`],
      deployed: [],
      notDeployed: [],
    };
  }

  const result = validateManifest(manifest, crates);
  return {
    ok: result.errors.length === 0,
    errors: result.errors,
    deployed: result.deployed,
    notDeployed: result.notDeployed,
    totalCrates: result.deployed.length + result.notDeployed.length,
    requiredCrates: crates.required,
  };
}

function parseArgs(argv) {
  const options = {};
  const flags = {
    '--manifest': 'manifestPath',
    '--contracts': 'contractsRoot',
    '--workspace': 'workspaceManifestPath',
  };

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === '--help' || arg === '-h') {
      return { help: true };
    }
    if (!flags[arg]) {
      throw new Error(`Unknown argument: ${arg}`);
    }
    const value = argv[index + 1];
    if (!value) {
      throw new Error(`${arg} requires a value`);
    }
    options[flags[arg]] = path.resolve(value);
    index += 1;
  }

  return options;
}

function main(argv) {
  let options;
  try {
    options = parseArgs(argv);
  } catch (error) {
    console.error(`❌ ${error.message}`);
    console.error('Run with --help for usage.');
    return 1;
  }

  if (options.help) {
    console.log('Usage: node scripts/validate-manifest.js [options]');
    console.log('');
    console.log('  --manifest <path>   Override the manifest location.');
    console.log('  --contracts <dir>   Override the contracts crate directory.');
    console.log('  --workspace <file>  Override the workspace Cargo.toml location.');
    console.log('  --help              Show this help text.');
    return 0;
  }

  const result = validateManifestFile(options);

  if (!result.ok) {
    for (const error of result.errors) {
      console.error(`❌ ${error}`);
    }
    console.error(
      `❌ Manifest validation failed with ${result.errors.length} error(s); see docs in apps/onchain/README.md.`,
    );
    return 1;
  }

  console.log(
    `✅ Manifest covers ${result.totalCrates} crates: ${result.deployed.length} deployed, ${result.notDeployed.length} not deployed.`,
  );
  return 0;
}

module.exports = {
  CONTRACT_ID_PATTERN,
  STELLAR_ADDRESS_PATTERN,
  WASM_HASH_PATTERN,
  discoverCrates,
  normalizeCrateName,
  validateManifest,
  validateManifestFile,
};

if (require.main === module) {
  process.exit(main(process.argv.slice(2)));
}
