const fs = require('fs');
const path = require('path');

const requestedEvidencePath = process.argv[2];

if (!requestedEvidencePath) {
  console.error('Usage: node scripts/validate-emergency-pause-drill.js <evidence.json>');
  process.exit(1);
}

const evidencePath = path.isAbsolute(requestedEvidencePath)
  ? requestedEvidencePath
  : [
      path.resolve(process.cwd(), requestedEvidencePath),
      path.resolve(process.cwd(), 'drill-evidence', requestedEvidencePath),
      path.resolve(__dirname, '..', requestedEvidencePath),
      path.resolve(__dirname, '..', 'drill-evidence', requestedEvidencePath),
    ].find((candidate) => fs.existsSync(candidate));

if (!evidencePath) {
  throw new Error(`Evidence file not found: ${requestedEvidencePath}`);
}

const evidence = JSON.parse(fs.readFileSync(evidencePath, 'utf8'));

function fail(message) {
  console.error(`❌ ${message}`);
  process.exit(1);
}

if (evidence.drill !== 'emergency-pause') {
  fail('Evidence must identify the emergency-pause drill.');
}

if (evidence.network !== 'testnet') {
  fail('Evidence must identify the Stellar testnet.');
}

if (!evidence.contract_id || !/^C[0-9A-Z]{55}$/.test(evidence.contract_id)) {
  fail('Evidence must include a valid matching-pool contract ID.');
}

if (!evidence.admin_key || !evidence.admin_address) {
  fail('Evidence must include the admin key and address.');
}

if (!evidence.started_at || !evidence.ended_at) {
  fail('Evidence must include dated UTC start/end times.');
}

if (!Array.isArray(evidence.scopes) || evidence.scopes.length === 0) {
  fail('Evidence must contain a non-empty scopes array.');
}

const requiredScopes = ['Contribution', 'Payout', 'Governance'];
const recordedScopes = evidence.scopes.map((s) => s.scope);
const missingScopes = requiredScopes.filter((s) => !recordedScopes.includes(s));
if (missingScopes.length > 0) {
  fail(`Evidence is missing scopes: ${missingScopes.join(', ')}`);
}

const expectedErrorCodes = {
  Contribution: 19,
  Payout: 20,
  Governance: 21,
};

for (const step of evidence.scopes) {
  if (!step.scope || !requiredScopes.includes(step.scope)) {
    fail(`Each scope must be one of ${requiredScopes.join(', ')}.`);
  }
  if (typeof step.expected_error_code !== 'number' || step.expected_error_code !== expectedErrorCodes[step.scope]) {
    fail(`Scope "${step.scope}" must include expected_error_code ${expectedErrorCodes[step.scope]}.`);
  }
  if (!step.pause_tx || typeof step.pause_tx !== 'string') {
    fail(`Scope "${step.scope}" must include the pause transaction hash.`);
  }
  if (!step.unpause_tx || typeof step.unpause_tx !== 'string') {
    fail(`Scope "${step.scope}" must include the unpause transaction hash.`);
  }
  if (!Array.isArray(step.checks) || step.checks.length === 0) {
    fail(`Scope "${step.scope}" must include a non-empty checks array.`);
  }
  for (const check of step.checks) {
    if (typeof check.name !== 'string' || check.name.trim().length === 0) {
      fail(`Scope "${step.scope}" check must include a name.`);
    }
    if (typeof check.ok !== 'boolean') {
      fail(`Scope "${step.scope}" check "${check.name}" must include a boolean ok.`);
    }
    if (typeof check.output !== 'string' || check.output.trim().length === 0) {
      fail(`Scope "${step.scope}" check "${check.name}" must include captured command output.`);
    }
  }
  if (typeof step.post_unpause_blocked_ok !== 'boolean') {
    fail(`Scope "${step.scope}" must include post_unpause_blocked_ok.`);
  }
  if (typeof step.ok !== 'boolean') {
    fail(`Scope "${step.scope}" must include a boolean ok.`);
  }
}

if (typeof evidence.overall_ok !== 'boolean') {
  fail('Evidence must include a boolean overall_ok.');
}

if (evidence.overall_ok !== evidence.scopes.every((s) => s.ok === true)) {
  fail('overall_ok must equal true only when every scope ok is true.');
}

const failedScopes = evidence.scopes.filter((s) => s.ok !== true);
if (failedScopes.length > 0) {
  fail(`Drill evidence records failures: ${failedScopes.map((s) => s.scope).join(', ')}`);
}

console.log(`Emergency pause drill evidence is complete: ${evidence.scopes.length} scopes recorded, overall_ok=${evidence.overall_ok}.`);
