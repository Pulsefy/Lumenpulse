const fs = require('fs');
const path = require('path');

const manifestPath = path.join(__dirname, '../testnet-manifest.json');
const requiredContracts = [
  'contributor_registry',
  'project_registry',
  'crowdfund_vault',
  'matching_pool',
  'treasury',
  'lumen_token',
  'pricing_adapter',
  'feature_flags',
  'idempotency_guard',
  'liquidity_pool',
  'lumenpulse_curation',
  'notification_broker',
  'notification_interface',
  'protocol_registry',
  'reentrancy_guard',
  'stable_swap_pool',
  'upgradable_contract',
  'vesting_wallet',
  'yield_vault',
];

const isSorobanAddress = (value) => typeof value === 'string' && /^C[0-9A-Z]{55}$/.test(value);
const isWasmHash = (value) => typeof value === 'string' && /^[A-Fa-f0-9]{64}$/.test(value);

function fail(message) {
  console.error(`❌ ${message}`);
  process.exit(1);
}

try {
  const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));

  if (!manifest || typeof manifest !== 'object' || Array.isArray(manifest)) {
    fail('Manifest root must be a JSON object.');
  }

  if (!manifest.contracts || typeof manifest.contracts !== 'object' || Array.isArray(manifest.contracts)) {
    fail('Manifest must contain a top-level "contracts" object.');
  }

  const contractNames = Object.keys(manifest.contracts);
  const missingContracts = requiredContracts.filter((name) => !contractNames.includes(name));
  if (missingContracts.length > 0) {
    fail(`Manifest is missing contract entries: ${missingContracts.join(', ')}`);
  }

  const unexpectedContracts = contractNames.filter((name) => !requiredContracts.includes(name));
  if (unexpectedContracts.length > 0) {
    fail(`Manifest contains unexpected entries: ${unexpectedContracts.join(', ')}`);
  }

  for (const [contractName, contractData] of Object.entries(manifest.contracts)) {
    if (!contractData || typeof contractData !== 'object' || Array.isArray(contractData)) {
      fail(`Contract "${contractName}" must be an object.`);
    }

    if (Object.prototype.hasOwnProperty.call(contractData, 'reason')) {
      if (typeof contractData.reason !== 'string' || contractData.reason.trim().length === 0) {
        fail(`Contract "${contractName}" has an invalid reason field.`);
      }
      if (Object.prototype.hasOwnProperty.call(contractData, 'id') || Object.prototype.hasOwnProperty.call(contractData, 'wasm_hash')) {
        fail(`Contract "${contractName}" cannot include both a reason and deployment metadata.`);
      }
      continue;
    }

    const id = contractData.id ?? contractData.contract_id;
    const wasmHash = contractData.wasm_hash ?? contractData.wasmHash;

    if (!id) {
      fail(`Contract "${contractName}" is missing its deployment ID.`);
    }
    if (!isSorobanAddress(id)) {
      fail(`Contract "${contractName}" has an invalid Soroban address: ${id}`);
    }
    if (!wasmHash) {
      fail(`Contract "${contractName}" is missing its wasm_hash.`);
    }
    if (!isWasmHash(wasmHash)) {
      fail(`Contract "${contractName}" has an invalid wasm_hash: ${wasmHash}`);
    }
  }

  console.log(`✅ Manifest validation succeeded for ${contractNames.length} contracts.`);
} catch (error) {
  fail(error.message);
}
