import { createHash } from 'node:crypto';

/**
 * Disposition of a store when the account holder exercises their right to
 * erasure. `delete` removes the rows outright; `anonymise` keeps the row but
 * irreversibly strips or replaces the personal data it carries, which is the
 * only option for records that must survive for audit, moderation or legal
 * reasons (see `DATA_RETENTION.md`).
 */
export enum UserDataDisposition {
  DELETE = 'delete',
  ANONYMISE = 'anonymise',
}

/**
 * One table that holds data belonging to a user, together with the retention
 * period that applies to it and what happens on an erasure request.
 */
export interface UserDataStore {
  /** Physical table name. */
  table: string;
  /** What the store holds, in one line. */
  description: string;
  /** Columns carrying the owning user's id. */
  userColumns: string[];
  /** What happens when the user asks to be erased. */
  disposition: UserDataDisposition;
  /**
   * Retention window while the account is active, in days. `null` means the
   * data is kept for the lifetime of the account and is only removed by the
   * erasure flow (or the store's own cleanup job, where one exists).
   */
  retentionDays: number | null;
  /** Human-readable retention period shown in the inventory table. */
  retention: string;
  /** Why the row is deleted or anonymised. Required for every entry. */
  rationale: string;
}

/** Marks a value that has been irreversibly replaced. */
export const ANONYMISED_PLACEHOLDER = '[redacted]';

/** Audit action written (with a one-way subject hash) when an erasure runs. */
export const USER_DATA_DELETION_ACTION = 'user.data.deletion';

/** Prefix used for the one-way subject identifier kept in audit records. */
export const ANONYMISED_SUBJECT_PREFIX = 'anon:';

/** Default preferences JSON written back onto an anonymised user row. */
export const DEFAULT_PREFERENCES = {
  notifications: {
    priceAlerts: true,
    newsAlerts: true,
    securityAlerts: true,
  },
  preferredCurrency: 'USD',
} as const;

/**
 * One-way, irreversible identifier for an erased subject. It lets the audit
 * trail correlate a single deletion without retaining the user's id, and the
 * 32-hex truncation of SHA-256 over a random UUID is not reversible.
 */
export function anonymisedSubjectId(userId: string): string {
  return `${ANONYMISED_SUBJECT_PREFIX}${createHash('sha256')
    .update(userId)
    .digest('hex')
    .slice(0, 32)}`;
}

/**
 * Object keys whose values are personal data and must be replaced before an
 * audit payload can be retained. Matched case-insensitively so both camelCase
 * and snake_case payloads are covered.
 */
export const PERSONAL_DATA_KEYS: ReadonlySet<string> = new Set([
  'email',
  'firstname',
  'lastname',
  'displayname',
  'bio',
  'avatarurl',
  'stellarpublickey',
  'publickey',
  'password',
  'passwordhash',
  'newpassword',
  'token',
  'refreshtoken',
  'accesstoken',
  'signedchallenge',
  'twofactorsecret',
  'ipaddress',
  'deviceid',
  'deviceinfo',
  'phonenumber',
  'userid',
  'stellaraccount',
]);

/**
 * Replaces the values of {@link PERSONAL_DATA_KEYS} anywhere in a JSON value,
 * recursively. Non-personal fields (actions, timestamps, counts) survive so a
 * retained audit record is still readable.
 */
export function redactPersonalData(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map((entry) => redactPersonalData(entry));
  }
  if (value !== null && typeof value === 'object') {
    const redacted: Record<string, unknown> = {};
    for (const [key, entry] of Object.entries(value as Record<string, unknown>)) {
      redacted[key] = PERSONAL_DATA_KEYS.has(key.toLowerCase())
        ? ANONYMISED_PLACEHOLDER
        : redactPersonalData(entry);
    }
    return redacted;
  }
  return value;
}

/**
 * Inventory of every backend store that holds user-identifiable data, its
 * retention period and what an erasure request does to it. The deletion
 * service is driven by this list, so a new user-keyed table is only covered
 * once it is added here.
 */
export const USER_DATA_INVENTORY: readonly UserDataStore[] = [
  {
    table: 'users',
    description: 'Account row (email, names, bio, avatar, wallet, 2FA)',
    userColumns: ['id'],
    disposition: UserDataDisposition.ANONYMISE,
    retentionDays: null,
    retention: 'Account lifetime; tombstoned on erasure',
    rationale:
      'The account row is the identity itself, so it cannot be kept as-is. It is emptied of every personal column and left as a non-identifiable tombstone so retained audit and moderation rows keep a valid foreign key.',
  },
  {
    table: 'stellar_accounts',
    description: 'Linked Stellar wallets (public key and label)',
    userColumns: ['userId'],
    disposition: UserDataDisposition.DELETE,
    retentionDays: null,
    retention: 'Account lifetime (erased on request)',
    rationale: 'Wallet links are user-owned; the erasure flow unlinks them all.',
  },
  {
    table: 'refresh_tokens',
    description: 'Refresh tokens and session metadata (device, IP)',
    userColumns: ['userId'],
    disposition: UserDataDisposition.DELETE,
    retentionDays: 30,
    retention: '30 days after expiry (own cleanup job)',
    rationale:
      'Sessions must not outlive the account; the erasure flow revokes them immediately.',
  },
  {
    table: 'password_reset_tokens',
    description: 'Password reset tokens',
    userColumns: ['userId'],
    disposition: UserDataDisposition.DELETE,
    retentionDays: 1,
    retention: 'Until expiry / use (max 24h)',
    rationale: 'Reset tokens are credentials and cannot be retained.',
  },
  {
    table: 'notification_preferences',
    description: 'Notification channel and category preferences',
    userColumns: ['userId'],
    disposition: UserDataDisposition.DELETE,
    retentionDays: null,
    retention: 'Account lifetime (erased on request)',
    rationale: 'Preferences describe the user and have no audit value.',
  },
  {
    table: 'push_tokens',
    description: 'Device push tokens and device identifiers',
    userColumns: ['userId'],
    disposition: UserDataDisposition.DELETE,
    retentionDays: 90,
    retention: '90 days since last registration',
    rationale:
      'A push token addresses the user\'s device; it is removed on erasure.',
  },
  {
    table: 'notifications',
    description: 'In-app notifications addressed to the user',
    userColumns: ['userId'],
    disposition: UserDataDisposition.DELETE,
    retentionDays: 90,
    retention: '90 days',
    rationale: 'Notification bodies are user-specific and not audit records.',
  },
  {
    table: 'notification_delivery_logs',
    description: 'Per-channel notification delivery attempts',
    userColumns: ['userId'],
    disposition: UserDataDisposition.DELETE,
    retentionDays: 90,
    retention: '90 days',
    rationale: 'Delivery logs carry the recipient id and provider metadata.',
  },
  {
    table: 'notification_suppression_logs',
    description: 'Notifications suppressed by preferences or quiet hours',
    userColumns: ['userId'],
    disposition: UserDataDisposition.DELETE,
    retentionDays: 90,
    retention: '90 days',
    rationale: 'Suppression reasons are behavioural data about the user.',
  },
  {
    table: 'watchlist_items',
    description: 'Watchlisted assets and projects (symbol, notes, image)',
    userColumns: ['userId'],
    disposition: UserDataDisposition.DELETE,
    retentionDays: null,
    retention: 'Account lifetime (erased on request)',
    rationale: 'Watchlists are user-owned content with no audit requirement.',
  },
  {
    table: 'portfolio_snapshots',
    description: 'Point-in-time portfolio balances',
    userColumns: ['userId'],
    disposition: UserDataDisposition.DELETE,
    retentionDays: 365,
    retention: '365 days',
    rationale: 'Balances are financial personal data; erasure removes them.',
  },
  {
    table: 'portfolio_materialized_snapshots',
    description: 'Latest portfolio read model (one row per user)',
    userColumns: ['userId'],
    disposition: UserDataDisposition.DELETE,
    retentionDays: null,
    retention: 'Account lifetime (mirror of the latest snapshot)',
    rationale: 'It is a derived copy of the deleted snapshots.',
  },
  {
    table: 'portfolio_assets',
    description: 'Tracked portfolio asset balances',
    userColumns: ['userId'],
    disposition: UserDataDisposition.DELETE,
    retentionDays: null,
    retention: 'Account lifetime (erased on request)',
    rationale: 'Asset balances are financial personal data.',
  },
  {
    table: 'portfolio_anomalies',
    description: 'Portfolio anomaly detections and reviewer notes',
    userColumns: ['userId'],
    disposition: UserDataDisposition.DELETE,
    retentionDays: 365,
    retention: '365 days',
    rationale:
      'Anomalies are user-scoped; the review trail lives in the audit tables.',
  },
  {
    table: 'price_alert_rules',
    description: 'Price alert rules (symbol, target price)',
    userColumns: ['userId'],
    disposition: UserDataDisposition.DELETE,
    retentionDays: null,
    retention: 'Account lifetime (erased on request)',
    rationale: 'Alert rules describe the user\'s positions and interests.',
  },
  {
    table: 'price_alert_evaluation_logs',
    description: 'Price alert evaluation history',
    userColumns: ['userId'],
    disposition: UserDataDisposition.DELETE,
    retentionDays: 90,
    retention: '90 days',
    rationale: 'Evaluation history is behavioural data tied to the account.',
  },
  {
    table: 'export_jobs',
    description: 'Generated data exports, including inline CSV payloads',
    userColumns: ['userId'],
    disposition: UserDataDisposition.DELETE,
    retentionDays: 30,
    retention: '30 days',
    rationale:
      'Exports can contain the full portfolio and tax history, so both the job and its payload are removed.',
  },
  {
    table: 'audit_logs',
    description: 'User-activity audit trail (login, profile changes, ...)',
    userColumns: ['userId'],
    disposition: UserDataDisposition.ANONYMISE,
    retentionDays: 365,
    retention: '365 days (see AUDIT_RETENTION.md)',
    rationale:
      'Security and audit records must survive a deletion (they prove it happened and support incident review). The subject link, IP address and PII inside metadata are irreversibly removed instead of deleting the row.',
  },
  {
    table: 'audit_log_archive',
    description: 'Archived audit rows copied out of audit_logs',
    userColumns: ['payload.userId'],
    disposition: UserDataDisposition.ANONYMISE,
    retentionDays: 2555,
    retention: '2555 days (7 years)',
    rationale:
      'An archived audit row is a verbatim copy of an audit_logs row, so it must be anonymised in place to close the same gap.',
  },
  {
    table: 'admin_blockchain_audit_logs',
    description: 'On-chain admin actions (actor id, actor email, params)',
    userColumns: ['actorId'],
    disposition: UserDataDisposition.ANONYMISE,
    retentionDays: 2555,
    retention: '2555 days (7 years)',
    rationale:
      'Admin actions on contracts are retained for accountability; the actor is replaced by a one-way hash and the email and request summary are cleared.',
  },
  {
    table: 'content_reports',
    description: 'Content reports filed or reviewed by the user',
    userColumns: ['reporter_id', 'reviewer_id'],
    disposition: UserDataDisposition.ANONYMISE,
    retentionDays: 2555,
    retention: '2555 days (7 years)',
    rationale:
      'Moderation history is an audit record. The reporter/reviewer foreign keys stay valid (pointing at the anonymised tombstone user) while the free-text description and review notes are redacted.',
  },
  {
    table: 'review_comments',
    description: 'Moderation review comments authored by the user',
    userColumns: ['author_id'],
    disposition: UserDataDisposition.ANONYMISE,
    retentionDays: 2555,
    retention: '2555 days (7 years)',
    rationale:
      'The decision trail is retained, but the comment body can embed PII, so it is redacted in place.',
  },
  {
    table: 'review_decision_history',
    description: 'Moderation decisions taken by the user',
    userColumns: ['reviewer_id'],
    disposition: UserDataDisposition.ANONYMISE,
    retentionDays: 2555,
    retention: '2555 days (7 years)',
    rationale:
      'The decision (type, target, timestamp) is retained for accountability; the rationale and metadata can embed PII and are cleared.',
  },
  {
    table: 'verification_requests',
    description: 'Identity/project verification requests and evidence',
    userColumns: ['requesterId', 'reviewerId'],
    disposition: UserDataDisposition.ANONYMISE,
    retentionDays: 2555,
    retention: '2555 days (7 years)',
    rationale:
      'The request lifecycle is retained for audit; evidence, requester note and review note are redacted, and the reviewer reference is cleared.',
  },
  {
    table: 'outbox_events',
    description: 'Transactional outbox events (payloads may embed user data)',
    userColumns: ['payload.userId'],
    disposition: UserDataDisposition.ANONYMISE,
    retentionDays: 30,
    retention: 'Processed within minutes; dead letters kept 30 days',
    rationale:
      'Outbox payloads can embed a user id and email. Redacting the payload in place keeps the delivery stream consistent while removing the personal data.',
  },
];

/** Convenience: the inventory entry for a table, if it is covered. */
export function userDataStoreFor(table: string): UserDataStore | undefined {
  return USER_DATA_INVENTORY.find((store) => store.table === table);
}
