/**
 * Admin rotation rehearsal helper (issue #1626).
 *
 * Offline mode (CI-safe, no network):
 *   node apps/onchain/scripts/admin-rotation-rehearsal.js --check
 *   - validates testnet-manifest.json (incl. admin_address rules),
 *   - asserts the upgradable-contract exposes the rotation interface
 *     (propose/accept/cancel + get_proposed_admin + timelock SetAdmin),
 *   - prints the live testnet procedure from docs/ADMIN_KEY_ROTATION_RUNBOOK.md.
 *
 * Live mode (requires testnet keys, never prints secrets):
 *   node apps/onchain/scripts/admin-rotation-rehearsal.js --print-live --contract-id C... --old-admin G... --new-admin G...
 *   - prints the exact soroban CLI sequence plus manifest + backend checks.
 */
const fs = require('fs');
const path = require('path');

const MANIFEST_PATH = path.join(__dirname, '..', 'testnet-manifest.json');
const LIB_RS = path.join(__dirname, '..', 'contracts', 'upgradable-contract', 'src', 'lib.rs');

const isStellarAccount = (v) => typeof v === 'string' && /^G[0-9A-Z]{55}$/.test(v);
const isSorobanAddress = (v) => typeof v === 'string' && /^C[0-9A-Z]{55}$/.test(v);

function fail(msg) {
  console.error(`❌ ${msg}`);
  process.exit(1);
}

function checkManifest() {
  if (!fs.existsSync(MANIFEST_PATH)) fail(`manifest not found at ${MANIFEST_PATH}`);
  const manifest = JSON.parse(fs.readFileSync(MANIFEST_PATH, 'utf8'));
  const topAdmin = manifest.admin_address ?? manifest.adminAddress;
  if (!isStellarAccount(topAdmin)) {
    fail(`top-level admin_address invalid or missing: ${topAdmin}`);
  }
  console.log(`✅ manifest admin_address: ${topAdmin}`);
  const deployed = Object.entries(manifest.contracts || {}).filter(([, v]) => !v.reason);
  console.log(`✅ deployed contracts: ${deployed.map(([k]) => k).join(', ')}`);
  for (const [name, entry] of deployed) {
    if (!isSorobanAddress(entry.id ?? entry.contract_id)) {
      fail(`contract ${name} has invalid id`);
    }
    const perAdmin = entry.admin_address ?? entry.adminAddress;
    if (perAdmin !== undefined && perAdmin !== null && !isStellarAccount(perAdmin)) {
      fail(`contract ${name} has invalid admin_address: ${perAdmin}`);
    }
  }
  console.log('✅ manifest contract IDs + per-contract admin entries valid');
  return { manifest, topAdmin };
}

function checkContractInterface() {
  if (!fs.existsSync(LIB_RS)) fail(`contract source not found at ${LIB_RS}`);
  const src = fs.readFileSync(LIB_RS, 'utf8');
  const required = [
    'propose_admin_rotation',
    'accept_admin_rotation',
    'cancel_admin_rotation',
    'get_proposed_admin',
    'get_admin',
    'queue_operation',
    'execute_operation',
    'cancel_operation',
    'TimelockAction::SetAdmin',
  ];
  const missing = required.filter((fn) => !src.includes(fn));
  if (missing.length > 0) fail(`upgradable-contract missing: ${missing.join(', ')}`);
  console.log('✅ upgradable-contract exposes timelock + two-step rotation + get_proposed_admin');
}

function printLive({ contractId, oldAdmin, newAdmin }) {
  const id = contractId || '<rehearsal-contract-id>';
  const oldA = oldAdmin || '<OLD_ADMIN>';
  const newA = newAdmin || '<NEW_ADMIN>';
  console.log(`
--- Live testnet rotation (see docs/ADMIN_KEY_ROTATION_RUNBOOK.md §3-§6) ---
# 0. Baseline
soroban contract invoke --id ${id} --source testnet-admin --network testnet -- get_admin
# expect ${oldA}

# 1. Queue timelock rotation
soroban contract invoke --id ${id} --source testnet-admin --network testnet -- queue_operation --proposer ${oldA} --action '{"SetAdmin":"'${newA}'"}'
# record operation id, tx hash, execute_after, expires_at

# 2-4. Pending -> early-reject -> Ready (24h delay)
soroban contract invoke --id ${id} --source testnet-admin --network testnet -- get_operation_status --operation_id <id>
soroban contract invoke --id ${id} --source testnet-admin --network testnet -- execute_operation --executor ${oldA} --operation_id <id>
# expect OperationNotReady, then Ready after delay

# 5. Execute + verify
soroban contract invoke --id ${id} --source testnet-admin --network testnet -- execute_operation --executor ${oldA} --operation_id <id>
soroban contract invoke --id ${id} --source rotation-target --network testnet -- get_admin
# expect ${newA}

# 6. Old admin revoked (all must fail with Unauthorized)
soroban contract invoke --id ${id} --source testnet-admin --network testnet -- queue_operation --proposer ${oldA} --action '{"SetAdmin":"'${oldA}'"}'
soroban contract invoke --id ${id} --source testnet-admin --network testnet -- propose_admin_rotation --proposer ${oldA} --new_admin ${oldA}

# 7. Manifest + backend (no restart)
# edit apps/onchain/testnet-manifest.json admin_address -> ${newA}
node apps/onchain/scripts/validate-manifest.js
curl -X POST https://<backend>/v1/contracts/manifests/refresh -H "Authorization: Bearer $ADMIN_JWT"
curl https://<backend>/v1/config/stellar | jq .adminAddress
npm run smoke --prefix scripts

# 8. Cancelled rotation leaves admin intact
soroban contract invoke --id ${id} --source rotation-target --network testnet -- propose_admin_rotation --proposer ${newA} --new_admin <CANDIDATE>
soroban contract invoke --id ${id} --source rotation-target --network testnet -- get_proposed_admin
soroban contract invoke --id ${id} --source rotation-target --network testnet -- cancel_admin_rotation --canceller ${newA}
soroban contract invoke --id ${id} --source rotation-target --network testnet -- get_admin
# expect ${newA} unchanged; get_proposed_admin None
`);
}

function parseArg(flag) {
  const idx = process.argv.indexOf(flag);
  if (idx === -1) return null;
  return process.argv[idx + 1] && !process.argv[idx + 1].startsWith('--')
    ? process.argv[idx + 1]
    : true;
}

const isCheck = process.argv.includes('--check');
const isPrintLive = process.argv.includes('--print-live');

if (!isCheck && !isPrintLive) {
  console.log('Usage: node admin-rotation-rehearsal.js --check [--print-live --contract-id C... --old-admin G... --new-admin G...]');
  process.exit(1);
}

const { topAdmin } = checkManifest();
checkContractInterface();

if (isPrintLive || isCheck) {
  printLive({
    contractId: parseArg('--contract-id') === true ? null : parseArg('--contract-id'),
    oldAdmin: parseArg('--old-admin') === true ? topAdmin : parseArg('--old-admin') || topAdmin,
    newAdmin: parseArg('--new-admin') === true ? null : parseArg('--new-admin'),
  });
}

console.log('\nDone. Full procedure: docs/ADMIN_KEY_ROTATION_RUNBOOK.md');
