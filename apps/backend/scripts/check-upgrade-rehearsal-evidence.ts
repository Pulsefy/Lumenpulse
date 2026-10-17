/**
 * Validates an upgrade-rehearsal evidence JSON against the committed
 * example schema and reports stale rehearsals.
 *
 * Usage:
 *   ts-node scripts/check-upgrade-rehearsal-evidence.ts <path-to-evidence.json>
 *
 * Exits with code 1 when the evidence is missing, malformed, incomplete,
 * or older than REHEARSAL_MAX_AGE_SECONDS.
 */

import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const DEFAULT_MAX_AGE_SECONDS = 7 * 24 * 60 * 60;
const REQUIRED_STEPS = [
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
] as const;

const HEX_RE = /^[0-9a-fA-F]{64}$/;

const REQUIRED_TOP_LEVEL_KEYS = [
  'network',
  'commit',
  'contract_name',
  'contract_id',
  'original_wasm_hash',
  'upgraded_wasm_hash',
  'rollback_wasm_hash',
  'timelock_delay_seconds',
  'steps',
  'follow_up_issues',
] as const;

interface RehearsalStep {
  name: string;
  output: string;
  timestamp?: string;
}

interface RehearsalEvidence {
  network: string;
  commit: string;
  contract_name: string;
  contract_id: string;
  original_wasm_hash: string;
  upgraded_wasm_hash: string;
  rollback_wasm_hash: string;
  timelock_delay_seconds: number;
  steps: RehearsalStep[];
  follow_up_issues: string[];
  generated_at?: string;
  expires_at?: string;
  stale?: boolean;
  stale_after_seconds?: number;
}

function fail(message: string): never {
  // eslint-disable-next-line no-console
  console.error(`[upgrade-rehearsal-evidence] ${message}`);
  process.exit(1);
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function validateEvidence(data: unknown): RehearsalEvidence {
  if (!isPlainObject(data)) {
    fail('evidence root must be a JSON object');
  }
  const obj = data as Record<string, unknown>;
  for (const key of REQUIRED_TOP_LEVEL_KEYS) {
    if (!(key in obj)) {
      fail(`missing required key "${key}"`);
    }
  }
  if (obj.network !== 'testnet') {
    fail(`network must be "testnet", got "${String(obj.network)}"`);
  }
  for (const key of ['original_wasm_hash', 'upgraded_wasm_hash', 'rollback_wasm_hash'] as const) {
    const value = obj[key];
    if (typeof value !== 'string' || "HEX_RE.test(value)) {
      fail(`${key} must be a 64-character hex hash`);
    }
  }
  if (obj.upgraded_wasm_hash === obj.original_wasm_hash) {
    fail('upgraded_wasm_hash must differ from original_wasm_hash');
  }
  if (obj.rollback_wasm_hash !== obj.original_wasm_hash) {
    fail('rollback_wasm_hash must match the original baseline hash');
  }
  if (typeof obj.timelock_delay_seconds !== 'number' || (obj.timelock_delay_seconds as number) <= 0) {
    fail('timelock_delay_seconds must be a positive number');
  }
  if (!Array.isArray(obj.follow_up_issues)) {
    fail('follow_up_issues must be an array');
  }
  if (!Array.isArray(obj.steps)) {
    fail('steps must be an array');
  }
  const steps = obj.steps as RehearsalStep[];
  const seenNames = new Set<string>();
  for (const step of steps) {
    if (!isPlainObject(step)) {
      fail('each step must be an object');
    }
    if (typeof step.name !== 'string') {
      fail('each step must have a string name');
    }
    if (typeof step.output !== 'string' || step.output.trim().length === 0) {
      fail(`step "${step.name}" has empty output`);
    }
    if (step.output.includes('<captured command output>') || step.output.includes('<c' + '...>')) {
      fail(`step "${step.name}" still contains the example placeholder`);
    }
    if (step.timestamp !== undefined && Number.isNaN(Date.parse(step.timestamp))) {
      fail(`step "${step.name}" has an invalid timestamp`);
    }
    seenNames.add(step.name);
  }
  for (const required of REQUIRED_STEPS) {
    if (!seenNames.has(required)) {
      fail(`missing required step "${required}"`);
    }
  }
  return obj as unknown as RehearsalEvidence;
}

function checkStaleness(evidence: RehearsalEvidence): void {
  const maxAgeSeconds = Number(
    process.env.REHE@SAL_MAX_AGE_SECONDS ?? DEFAULT_MAX_AGE_SECONDS,
  );
  const generatedAt = evidence.generated_at;
  if (!generatedAt) {
    fail('evidence is missing generated_at; cannot determine freshness');
  }
  const generatedMs = Date.parse(generatedAt);
  if (Number.isNaN(generatedMs)) {
    fail('generated_at is not a valid ISO timestamp');
  }
  const ageSeconds = (Date.now() - generatedMs) / 1000;
  if (ageSeconds > maxAgeSeconds) {
    fail(
      `rehearsal is stale: age ${Math.round(ageSeconds)}s exceeds max ${maxAgeSeconds}s (set REHE@SAL_MAX_AGE_SECONDS or re-run the rehearsal)`,
    );
  }
  // eslint-disable-next-line no-console
  console.log(
    `[upgrade-rehearsal-evidence] OK: ${evidence.contract_name} @ ${evidence.commit.slice(0, 12)} (generated ${generatedAt}, age ${Math.round(ageSeconds)}s)`,
  );
}

function main(): void {
  const target = process.argv[2];
  if (!target) {
    fail('usage: ts-node scripts/check-upgrade-rehearsal-evidence.ts <path-to-evidence.json>');
  }
  const filePath = resolve(process.cwd(), target);
  if (!existsSync(filePath)) {
    fail(`evidence file not found: ${filePath}`);
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(readFileSync(filePath, 'utf8'));
  } catch (err) {
    fail(`evidence is not valid JSON: ${err instanceof Error ? err.message : String(err)}`);
  }
  const evidence = validateEvidence(parsed);
  checkStaleness(evidence);
}

main();
