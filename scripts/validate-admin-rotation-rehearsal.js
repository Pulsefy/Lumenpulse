const fs = require('fs');
const path = require('path');

const requestedEvidencePath = process.argv[2];

if (!requestedEvidencePath) {
  console.error('Usage: node scripts/validate-admin-rotation-rehearsal.js <evidence.json>');
  process.exit(1);
}

const evidencePath = path.isAbsolute(requestedEvidencePath)
  ? requestedEvidencePath
  : [
      path.resolve(process.cwd(), requestedEvidencePath),
      path.resolve(process.cwd(), '..', requestedEvidencePath),
      path.resolve(__dirname, '..', requestedEvidencePath),
    ].find((candidate) => fs.existsSync(candidate));

if (!evidencePath || !fs.existsSync(evidencePath)) {
  console.error(`Evidence file not found: ${requestedEvidencePath}`);
  process.exit(1);
}

const evidence = JSON.parse(fs.readFileSync(evidencePath, 'utf8'));

// Acceptance criteria for issue #1626: rotation E2E, manifest + backend
// pickup without restart, previous admin revoked, cancelled rotation intact.
const requiredSteps = [
  'baseline',
  'queued',
  'pending',
  'early_execution_rejected',
  'ready',
  'executed',
  'post_rotation_verification',
  'previous_admin_revoked',
  'manifest_updated',
  'backend_verification',
  'cancelled_rotation',
];

if (evidence.network !== 'testnet') {
  console.error('Evidence must identify the Stellar testnet.');
  process.exit(1);
}

for (const field of ['contract_id', 'old_admin', 'new_admin']) {
  if (!evidence[field] || typeof evidence[field] !== 'string' || evidence[field].trim().length === 0) {
    console.error(`Evidence must include ${field}.`);
    process.exit(1);
  }
}

if (evidence.old_admin === evidence.new_admin) {
  console.error('old_admin and new_admin must differ (otherwise no rotation occurred).');
  process.exit(1);
}

if (!Number.isInteger(evidence.timelock_delay_seconds) || evidence.timelock_delay_seconds <= 0) {
  console.error('Evidence must include a positive timelock_delay_seconds.');
  process.exit(1);
}

if (!Array.isArray(evidence.steps)) {
  console.error('Evidence must contain a steps array.');
  process.exit(1);
}

const recordedSteps = new Set(evidence.steps.map((step) => step.name));
const missingSteps = requiredSteps.filter((step) => !recordedSteps.has(step));
if (missingSteps.length > 0) {
  console.error(`Evidence is missing steps: ${missingSteps.join(', ')}`);
  process.exit(1);
}

for (const step of evidence.steps) {
  if (!step.output || typeof step.output !== 'string' || step.output.trim().length === 0) {
    console.error(`Step "${step.name}" must include captured command output.`);
    process.exit(1);
  }
}

if (!Array.isArray(evidence.follow_up_issues)) {
  console.error('Evidence must include follow_up_issues, even when it is empty.');
  process.exit(1);
}

console.log(`Admin rotation rehearsal evidence is complete: ${evidence.steps.length} recorded steps.`);
