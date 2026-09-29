/**
 * Retention windows for every audit record type. See AUDIT_RETENTION.md.
 *
 * A record is expired when `createdAt < now - retentionDays`. A record whose
 * `createdAt` is exactly on the cutoff is still inside the window and is kept.
 */

/** Actions written by the audit subsystem itself (exports, retention runs). */
export const AUDIT_OPERATION_ACTION_PREFIX = 'audit.';
export const AUDIT_EXPORT_ACTION = 'audit.export';
export const AUDIT_RETENTION_RUN_ACTION = 'audit.retention.run';

export enum AuditRecordType {
  /** `audit_logs` rows written by AuditLogInterceptor (logins, profile changes, ...). */
  USER_ACTIVITY = 'user_activity',
  /** `audit_logs` rows describing the audit trail itself (`audit.*` actions). */
  AUDIT_OPERATION = 'audit_operation',
  /** `admin_blockchain_audit_logs` rows written by AdminAuditInterceptor. */
  ADMIN_BLOCKCHAIN_ACTION = 'admin_blockchain_action',
}

export type RetentionMode = 'archive' | 'purge';

export interface RetentionPolicy {
  recordType: AuditRecordType;
  retentionDays: number;
  /** `archive` copies expired rows to `audit_log_archive` before deleting them. */
  mode: RetentionMode;
}

interface PolicyDefaults {
  envPrefix: string;
  retentionDays: number;
  mode: RetentionMode;
}

const DEFAULTS: Record<AuditRecordType, PolicyDefaults> = {
  [AuditRecordType.USER_ACTIVITY]: {
    envPrefix: 'AUDIT_USER_ACTIVITY',
    retentionDays: 365,
    mode: 'archive',
  },
  [AuditRecordType.AUDIT_OPERATION]: {
    envPrefix: 'AUDIT_OPERATION',
    retentionDays: 2555,
    mode: 'archive',
  },
  [AuditRecordType.ADMIN_BLOCKCHAIN_ACTION]: {
    envPrefix: 'AUDIT_ADMIN_BLOCKCHAIN',
    retentionDays: 2555,
    mode: 'archive',
  },
};

const DAY_MS = 24 * 60 * 60 * 1000;

/**
 * Resolves the effective policy for each record type, letting
 * `<PREFIX>_RETENTION_DAYS` and `<PREFIX>_RETENTION_MODE` override the
 * defaults. Invalid overrides fail fast rather than silently purging data.
 */
export function buildRetentionPolicies(
  env: NodeJS.ProcessEnv = process.env,
): RetentionPolicy[] {
  return (Object.keys(DEFAULTS) as AuditRecordType[]).map((recordType) => {
    const { envPrefix, retentionDays, mode } = DEFAULTS[recordType];
    const rawDays = env[`${envPrefix}_RETENTION_DAYS`];
    const rawMode = env[`${envPrefix}_RETENTION_MODE`];

    const days =
      rawDays === undefined || rawDays === '' ? retentionDays : Number(rawDays);
    if (!Number.isInteger(days) || days < 1) {
      throw new Error(
        `${envPrefix}_RETENTION_DAYS must be a positive integer, got "${rawDays}"`,
      );
    }

    const resolvedMode = (rawMode || mode) as RetentionMode;
    if (resolvedMode !== 'archive' && resolvedMode !== 'purge') {
      throw new Error(
        `${envPrefix}_RETENTION_MODE must be "archive" or "purge", got "${rawMode}"`,
      );
    }

    return { recordType, retentionDays: days, mode: resolvedMode };
  });
}

/** Records created strictly before this instant are outside the window. */
export function retentionCutoff(now: Date, retentionDays: number): Date {
  return new Date(now.getTime() - retentionDays * DAY_MS);
}
