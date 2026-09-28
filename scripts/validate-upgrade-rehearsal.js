const fs = require('fs');
const path = require('path');

const requestedEvidencePath = process.argv[2];

if (!requestedEvidencePath) {
  console.error('Usage: node scripts/validate-upgrade-rehearsal.js <evidence.json>');
  process.exit(1);
}

const evidencePath = path.isAbsolute(requestedEvidencePath)
  ? requestedEvidencePath
  : [
      path.resolve(process.cwd(), requestedEvidencePath),
      path.resolve(process.cwd(), '..', requestedEvidencePath),
      path.resolve(__dirname, '..', requestedEvidencePath),
    ].find((candidate) => fs.existsSync(candidate));

if (!evidencePath) {
  throw new Error(`Evidence file not found: ${requestedEvidencePath}`);
}

const evidence = JSON.parse(fs.readFileSync(evidencePath, 'utf8'));
const requiredSteps = [
  'baseline',
  'queued',
  'early_execution_rejected',
  'ready',
  'executed',
  'post_upgrade_verification',
  'manifest_updated',
  'backend_verification',
  'rollback_queued',
  'rollback_executed',
  'post_rollback_verification',
];

if (evidence.network !== 'testnet') {
  throw new Error('Evidence must identify the Stellar testnet.');
}

if (!evidence.contract_id || !evidence.original_wasm_hash || !evidence.upgraded_wasm_hash) {
  throw new Error('Evidence must include the contract ID and original/upgraded WASM hashes.');
}

if (evidence.original_wasm_hash === evidence.upgraded_wasm_hash) {
  throw new Error('The upgrade artifact must differ from the original artifact.');
}

if (!Number.isInteger(evidence.timelock_delay_seconds) || evidence.timelock_delay_seconds <= 0) {
  throw new Error('Evidence must include a positive timelock delay.');
}

if (!Array.isArray(evidence.steps)) {
  throw new Error('Evidence must contain a steps array.');
}

const recordedSteps = new Set(evidence.steps.map((step) => step.name));
const missingSteps = requiredSteps.filter((step) => !recordedSteps.has(step));
if (missingSteps.length > 0) {
  throw new Error(`Evidence is missing steps: ${missingSteps.join(', ')}`);
}

for (const step of evidence.steps) {
  if (!step.output || typeof step.output !== 'string' || step.output.trim().length === 0) {
    throw new Error(`Step "${step.name}" must include captured command output.`);
  }
}

if (!Array.isArray(evidence.follow_up_issues)) {
  throw new Error('Evidence must include follow_up_issues, even when it is empty.');
}

console.log(`Upgrade rehearsal evidence is complete: ${evidence.steps.length} recorded steps.`);
