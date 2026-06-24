const fs = require('fs');
const path = require('path');

const manifestPath = path.join(__dirname, '../testnet-manifest.json');

try {
  const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
  const entries = Object.entries(manifest.contracts || {});
  console.log(`Auditing ${entries.length} deployed ecosystem contract manifest references...`);

  const sorobanIdRegex = /^C[A-Z0-9]{55}$/;
  const wasmHashRegex = /^[a-fA-F0-9]{64}$/;
  let hasErrors = false;

  if (manifest.network !== 'testnet') {
    console.error(`Error: expected manifest.network to be "testnet", got "${manifest.network}".`);
    hasErrors = true;
  }

  for (const [contractName, contractData] of entries) {
    if (!contractData.id) {
      console.error(`Error: "${contractName}" is missing its deployed ID entry.`);
      hasErrors = true;
      continue;
    }

    if (!sorobanIdRegex.test(contractData.id)) {
      console.error(`Error: "${contractName}" ID [${contractData.id}] fails regex format matching rules.`);
      hasErrors = true;
    }

    if (!wasmHashRegex.test(contractData.wasm_hash || '')) {
      console.error(`Error: "${contractName}" is missing a valid 32-byte wasm_hash.`);
      hasErrors = true;
    }

    if (!contractData.version || typeof contractData.version !== 'string') {
      console.error(`Error: "${contractName}" is missing string version metadata.`);
      hasErrors = true;
    }

    if (contractData.environment !== manifest.network) {
      console.error(`Error: "${contractName}" environment must match manifest network "${manifest.network}".`);
      hasErrors = true;
    }

    if (!hasErrors) {
      console.log(`${contractName.padEnd(26)} -> verified address and metadata.`);
    }
  }

  if (hasErrors) {
    console.error('\nVerification failed. Fix manifest fields before continuing build sequences.');
    process.exit(1);
  }

  console.log('\nSystem validation successful. Unified manifest is clean.');
  process.exit(0);
} catch (error) {
  console.error('Run aborted due to error:', error.message);
  process.exit(1);
}
