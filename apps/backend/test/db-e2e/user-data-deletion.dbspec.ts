import { INestApplication } from '@nestjs/common';
import { DataSource } from 'typeorm';
import { bearer, createApp, createUser, http } from './support/app';
import { UserDataDeletionService } from '../src/data-retention/user-data-deletion.service';
import {
  USER_DATA_DELETION_ACTION,
  anonymisedSubjectId,
} from '../src/data-retention/user-data-inventory';

interface CountRow {
  n: number;
}

/** User-keyed stores the erasure flow must empty completely. */
const DELETE_TARGETS: Array<{ table: string; column: string }> = [
  { table: 'stellar_accounts', column: 'userId' },
  { table: 'refresh_tokens', column: 'userId' },
  { table: 'password_reset_tokens', column: 'userId' },
  { table: 'notification_preferences', column: 'userId' },
  { table: 'push_tokens', column: 'userId' },
  { table: 'notifications', column: 'userId' },
  { table: 'notification_delivery_logs', column: 'userId' },
  { table: 'notification_suppression_logs', column: 'userId' },
  { table: 'watchlist_items', column: 'userId' },
  { table: 'portfolio_snapshots', column: 'userId' },
  { table: 'portfolio_materialized_snapshots', column: 'userId' },
  { table: 'portfolio_assets', column: 'userId' },
  { table: 'portfolio_anomalies', column: 'userId' },
  { table: 'price_alert_rules', column: 'userId' },
  { table: 'price_alert_evaluation_logs', column: 'userId' },
  { table: 'export_jobs', column: 'userId' },
];

const ACCOUNT_COLUMNS = [
  'email',
  'passwordHash',
  'firstName',
  'lastName',
  'displayName',
  'bio',
  'avatarUrl',
  'stellarPublicKey',
  'twoFactorSecret',
];

const ACCOUNT_PUBLIC_KEY = `G${'A'.repeat(55)}`;
const WALLET_PUBLIC_KEY = `G${'B'.repeat(55)}`;

describe('User data deletion (db e2e)', () => {
  let app: INestApplication;
  let ds: DataSource;
  let service: UserDataDeletionService;

  beforeAll(async () => {
    app = await createApp();
    ds = app.get(DataSource);
    service = app.get(UserDataDeletionService);
  });

  afterAll(async () => {
    await app.close();
  });

  const scalar = async (
    sql: string,
    params: unknown[] = [],
  ): Promise<number> => {
    const rows = await ds.query<CountRow[]>(sql, params);
    return rows[0].n;
  };

  const countBy = (table: string, column: string, value: string) =>
    scalar(
      `SELECT count(*)::int AS n FROM "${table}" WHERE "${column}" = $1`,
      [value],
    );

  const seedUserData = async (userId: string, email: string): Promise<void> => {
    await ds.query(
      `UPDATE users SET "firstName" = 'Ada', "lastName" = 'Lovelace', "displayName" = 'Ada Lovelace', bio = 'pioneer of computing', "avatarUrl" = 'https://example.test/avatar.png', "stellarPublicKey" = $2, "twoFactorSecret" = 'TOP-SECRET' WHERE id = $1`,
      [userId, ACCOUNT_PUBLIC_KEY],
    );

    await ds.query(
      'INSERT INTO stellar_accounts ("userId", "publicKey") VALUES ($1, $2)',
      [userId, WALLET_PUBLIC_KEY],
    );
    await ds.query(
      `INSERT INTO refresh_tokens ("tokenHash", "userId", "expiresAt") VALUES ('seeded-refresh-hash', $1, now() + interval '1 day')`,
      [userId],
    );
    await ds.query(
      `INSERT INTO password_reset_tokens ("tokenHash", "userId", "expiresAt") VALUES ('seeded-reset-hash', $1, now() + interval '1 hour')`,
      [userId],
    );
    await ds.query('INSERT INTO notification_preferences ("userId") VALUES ($1)', [
      userId,
    ]);
    await ds.query(
      `INSERT INTO push_tokens ("userId", "token", "deviceId") VALUES ($1, 'seeded-push-token', 'seeded-device')`,
      [userId],
    );
    await ds.query(
      `INSERT INTO notifications ("userId", "type", "title", "message") VALUES ($1, 'system', 'Retention test', 'hello')`,
      [userId],
    );
    await ds.query(
      `INSERT INTO notification_delivery_logs ("notificationId", "userId", "channel", "status") VALUES (gen_random_uuid(), $1, 'in_app', 'pending')`,
      [userId],
    );
    await ds.query(
      `INSERT INTO notification_suppression_logs ("userId", "eventCategory", "notificationType", "reason") VALUES ($1, 'anomaly', 'system_alert', 'quiet_hours')`,
      [userId],
    );
    await ds.query(
      `INSERT INTO watchlist_items ("userId", "symbol") VALUES ($1, 'XLM')`,
      [userId],
    );
    await ds.query(
      `INSERT INTO portfolio_snapshots ("userId", "assetBalances", "totalValueUsd") VALUES ($1, '[{"assetCode":"XLM","assetIssuer":null,"amount":"1","valueUsd":1}]', 1)`,
      [userId],
    );
    await ds.query(
      `INSERT INTO portfolio_materialized_snapshots ("userId", "totalValueUsd", "assetBalances", "source_snapshot_id") VALUES ($1, 1, '[]', gen_random_uuid())`,
      [userId],
    );
    await ds.query(
      `INSERT INTO portfolio_assets ("userId", "assetCode", "amount") VALUES ($1, 'XLM', 1)`,
      [userId],
    );
    await ds.query(
      `INSERT INTO portfolio_anomalies ("userId", "title", "anomalyType") VALUES ($1, 'Volume spike', 'volume')`,
      [userId],
    );
    await ds.query(
      `INSERT INTO price_alert_rules ("userId", "symbol", "targetPrice") VALUES ($1, 'XLM', 1)`,
      [userId],
    );
    await ds.query(
      `INSERT INTO price_alert_evaluation_logs ("ruleId", "userId", "symbol", "currentPrice", "targetPrice", "condition") VALUES (gen_random_uuid(), $1, 'XLM', 1, 1, 'above')`,
      [userId],
    );
    await ds.query(
      `INSERT INTO export_jobs ("userId", "type") VALUES ($1, 'portfolio_history')`,
      [userId],
    );
    await ds.query(
      `INSERT INTO audit_logs ("userId", "action", "ipAddress", "metadata") VALUES ($1, 'login', '203.0.113.7', jsonb_build_object('email', $2::text, 'displayName', 'Ada Lovelace'))`,
      [userId, email],
    );
    await ds.query(
      `INSERT INTO admin_blockchain_audit_logs ("actorId", "actorEmail", "endpoint", "paramsSummary") VALUES ($1, $2, 'POST /grants/rounds', jsonb_build_object('beneficiary', $2::text))`,
      [userId, email],
    );
    await ds.query(
      `INSERT INTO content_reports ("targetType", "target_id", "reason", "reporter_id", "description", "review_notes") VALUES ('user', 'project-1', 'spam', $1, 'report by ' || $2, 'reviewed by ' || $2)`,
      [userId, email],
    );
    await ds.query(
      `INSERT INTO review_comments ("target_id", "target_type", "author_id", "content") VALUES ('project-1', 'project', $1, 'comment by ' || $2)`,
      [userId, email],
    );
    await ds.query(
      `INSERT INTO review_decision_history ("target_id", "target_type", "decisionType", "reviewer_id", "rationale", "metadata") VALUES ('project-1', 'project', 'approved', $1, 'rationale for ' || $2, jsonb_build_object('note', $2::text))`,
      [userId, email],
    );
    await ds.query(
      `INSERT INTO verification_requests ("targetType", "targetId", "requesterId", "status", "evidence", "requesterNote") VALUES ('PROJECT', 'project-1', $1, 'SUBMITTED', 'https://evidence.test/' || $2, 'note ' || $2)`,
      [userId, email],
    );
    await ds.query(
      `INSERT INTO audit_log_archive ("recordType", "sourceTable", "sourceId", "payload", "originalCreatedAt") VALUES ('user_activity', 'audit_logs', gen_random_uuid(), jsonb_build_object('userId', $1::text, 'action', 'login', 'metadata', jsonb_build_object('email', $2::text)), now())`,
      [userId, email],
    );
    await ds.query(
      `INSERT INTO outbox_events ("eventType", "payload") VALUES ('user.registered', jsonb_build_object('userId', $1::text, 'email', $2::text))`,
      [userId, email],
    );
  };

  it('erases identifiable data across every store and anonymises the audit trail', async () => {
    const user = await createUser(app, 'erase');
    await seedUserData(user.id, user.email);

    const result = await service.deleteUserData(user.id);

    expect(result.alreadyDeleted).toBe(false);
    expect(result.audited).toBe(true);
    expect(
      Object.keys({ ...result.deleted, ...result.anonymised }),
    ).toHaveLength(service.inventorySize);

    // The account row survives only as a non-identifiable tombstone.
    const accounts = await ds.query<Array<Record<string, unknown>>>(
      `SELECT "email", "passwordHash", "firstName", "lastName", "displayName", "bio", "avatarUrl", "stellarPublicKey", "twoFactorSecret", "twoFactorEnabled", "deletedAt" FROM users WHERE id = $1`,
      [user.id],
    );
    expect(accounts).toHaveLength(1);
    const account = accounts[0];
    for (const column of ACCOUNT_COLUMNS) {
      expect(account[column]).toBeNull();
    }
    expect(account.twoFactorEnabled).toBe(false);
    expect(account.deletedAt).not.toBeNull();

    // The original address is not recoverable anywhere.
    expect(
      await scalar('SELECT count(*)::int AS n FROM users WHERE email = $1', [
        user.email,
      ]),
    ).toBe(0);

    // Every user-keyed store is empty.
    for (const { table, column } of DELETE_TARGETS) {
      expect(await countBy(table, column, user.id)).toBe(0);
    }

    // Audit trail is retained but de-identified.
    expect(await countBy('audit_logs', 'userId', user.id)).toBe(0);
    expect(
      await scalar(
        `SELECT count(*)::int AS n FROM audit_logs WHERE metadata::text LIKE '%' || $1 || '%'`,
        [user.email],
      ),
    ).toBe(0);
    expect(
      await scalar(
        `SELECT count(*)::int AS n FROM audit_log_archive WHERE payload->>'userId' = $1`,
        [user.id],
      ),
    ).toBe(0);
    expect(
      await scalar(
        `SELECT count(*)::int AS n FROM audit_log_archive WHERE payload::text LIKE '%' || $1 || '%'`,
        [user.email],
      ),
    ).toBe(0);
    expect(
      await scalar(
        `SELECT count(*)::int AS n FROM admin_blockchain_audit_logs WHERE "actorId" = $1 OR "actorEmail" = $2`,
        [user.id, user.email],
      ),
    ).toBe(0);
    expect(
      await scalar(
        `SELECT count(*)::int AS n FROM admin_blockchain_audit_logs WHERE "paramsSummary"::text LIKE '%' || $1 || '%'`,
        [user.email],
      ),
    ).toBe(0);

    // Moderation records survive with their free text redacted.
    const reports = await ds.query<
      Array<{ description: string | null; review_notes: string | null }>
    >(
      `SELECT "description", "review_notes" FROM content_reports WHERE "reporter_id" = $1`,
      [user.id],
    );
    expect(reports).toHaveLength(1);
    expect(reports[0].description).toBe('[redacted]');
    expect(reports[0].review_notes).toBe('[redacted]');

    expect(
      await scalar(
        `SELECT count(*)::int AS n FROM review_comments WHERE "author_id" = $1 AND content <> $2`,
        [user.id, '[redacted]'],
      ),
    ).toBe(0);

    const decisions = await ds.query<
      Array<{ rationale: string | null; metadata: unknown }>
    >(
      `SELECT "rationale", "metadata" FROM review_decision_history WHERE "reviewer_id" = $1`,
      [user.id],
    );
    expect(decisions).toHaveLength(1);
    expect(decisions[0].rationale).toBeNull();
    expect(decisions[0].metadata).toBeNull();

    const requests = await ds.query<
      Array<{ evidence: string; requesterNote: string | null }>
    >(
      `SELECT "evidence", "requesterNote" FROM verification_requests WHERE "requesterId" = $1`,
      [user.id],
    );
    expect(requests).toHaveLength(1);
    expect(requests[0].evidence).toBe('[redacted]');
    expect(requests[0].requesterNote).toBeNull();

    expect(
      await scalar(
        `SELECT count(*)::int AS n FROM outbox_events WHERE payload::text LIKE '%' || $1 || '%'`,
        [user.id],
      ),
    ).toBe(0);

    // The erasure itself is audited, keyed by a one-way subject hash.
    expect(
      await scalar(
        `SELECT count(*)::int AS n FROM audit_logs WHERE action = $1 AND metadata->>'subject' = $2`,
        [USER_DATA_DELETION_ACTION, anonymisedSubjectId(user.id)],
      ),
    ).toBe(1);
  });

  it('invalidates the erased account and is idempotent', async () => {
    const user = await createUser(app, 'erase-once');
    await seedUserData(user.id, user.email);

    await service.deleteUserData(user.id);

    // A token issued before the erasure can no longer authenticate.
    await http(app).get('/auth/profile').set(bearer(user.token)).expect(401);

    const second = await service.deleteUserData(user.id);
    expect(second.alreadyDeleted).toBe(true);
    expect(second.audited).toBe(false);

    // The second run did not append another deletion record.
    expect(
      await scalar(
        `SELECT count(*)::int AS n FROM audit_logs WHERE action = $1 AND metadata->>'subject' = $2`,
        [USER_DATA_DELETION_ACTION, anonymisedSubjectId(user.id)],
      ),
    ).toBe(1);
  });

  it('rejects an unknown user', async () => {
    await expect(
      service.deleteUserData('00000000-0000-4000-8000-000000000000'),
    ).rejects.toThrow('not found');
  });
});
