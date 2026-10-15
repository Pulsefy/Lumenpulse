/**
 * Names of the runtime-rotatable secrets.
 *
 * Only shared/verification secrets whose consumers can honour an overlap
 * window belong here. Secrets that are baked into a connection pool or a
 * signing strategy at boot (database password, JWT signing secret, Stellar
 * server secret) are intentionally excluded — rotating those still requires a
 * rolling restart and is out of scope for this trigger.
 */
export const ROTATABLE_SECRET_NAMES = [
  'CONTRACT_ADMIN_API_KEY',
  'WEBHOOK_SECRET',
  'SOROBAN_INGEST_SECRET',
  'DRIFT_ALERT_INGEST_SECRET',
  'PYTHON_API_KEY',
] as const;

export type RotatableSecretName = (typeof ROTATABLE_SECRET_NAMES)[number];

/** Non-sensitive description of a secret's rotation state. Never a value. */
export interface RotatableSecretStatus {
  name: RotatableSecretName;
  configured: boolean;
  version: number;
  activeSecretId: string | null;
  activeSince: string | null;
  overlapExpiresAt: string | null;
  previousSecretIds: string[];
}

/** Result of a successful rotation. Contains identifiers, never values. */
export interface SecretRotationResult {
  name: RotatableSecretName;
  version: number;
  secretId: string;
  previousSecretIds: string[];
  overlapExpiresAt: string | null;
  rotatedAt: string;
  auditLogId: string;
}

export interface RotateSecretOptions {
  /** Identity recorded in the audit log (operator, CI job, ...). */
  actor: string;
  ipAddress?: string | null;
  reason?: string;
  /** How long the previous value is still accepted. Defaults to config. */
  overlapMs?: number;
}
