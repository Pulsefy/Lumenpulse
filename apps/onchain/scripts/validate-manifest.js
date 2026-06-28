const fs = require('fs');
const path = require('path');

const manifestPath = path.join(__dirname, '../testnet-manifest.json');

try {
  const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
  console.log('🔍 Auditing all 7 deployed ecosystem contract manifest references...');

  const sorobanIdRegex = /^C[A-Z0-9]{55}$/;
  let hasErrors = false;

  for (const [contractName, contractData] of Object.entries(manifest.contracts)) {
    if (!contractData.id) {
      console.error(`❌ Error: "${contractName}" is completely missing its deployed ID entry.`);
      hasErrors = true;
      continue;
    }

    if (!sorobanIdRegex.test(contractData.id)) {
      console.error(`❌ Error: "${contractName}" ID [${contractData.id}] fails regex format matching rules.`);
      hasErrors = true;
    } else {
      console.log(`✅ ${contractName.padEnd(22)} -> Verified valid address footprint.`);
    }
  }

  if (hasErrors) {
    console.error('\n🚨 Verification failed. Fix manifest fields before continuing build sequences.');
    process.exit(1);
  } else {
    console.log('\n🎉 System validation successful! Unified manifest is clean.');
    process.exit(0);
  }
} catch (error) {
  console.error('❌ Run aborted due to error:', error.message);
  process.exit(1);
}