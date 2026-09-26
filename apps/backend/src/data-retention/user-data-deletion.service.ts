import { Injectable, Logger, NotFoundException } from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';
import { DataSource, EntityManager } from 'typeorm';
import { AuditService } from '../audit/audit.service';
import {
  ANONYMISED_PLACEHOLDER,
  DEFAULT_PREFERENCES,
  USER_DATA_DELETION_ACTION,
  USER_DATA_INVENTORY,
  UserDataDisposition,
  UserDataStore,
  anonymisedSubjectId,
  redactPersonalData,
} from './user-data-inventory';

/** Rows touched per table after an erasure run. */
export type ErasureCounts = Record<string, number>;

export interface UserDataDeletionResult {
  /** One-way identifier kept in the audit trail instead of the user id. */
  subject: string;
  /** True when the account had already been erased (no writes happened). */
  alreadyDeleted: boolean;
  /** Rows removed, keyed by table. */
  deleted: ErasureCounts;
  /** Rows retained but anonymised, keyed by table. */
  anonymised: ErasureCounts;
  /** True when this run wrote its own audit record. */
  audited: boolean;
}

interface UserLockRow {
  deletedAt: Date | null;
}

interface IdRow {
  id: string;
}

interface AuditLogRow {
  id: string;
  metadata: Record<string, unknown> | null;
}

interface ArchiveRow {
  id: string;
  payload: Record<string, unknown> | null;
}

/**
 * Removes or irreversibly anonymises every trace of a user, driven by
 * {@link USER_DATA_INVENTORY}. The whole operation runs in one transaction so
 * a crash leaves the account untouched rather than half-erased; the audit
 * entry for the run is written only after the transaction commits.
 */
@Injectable()
export class UserDataDeletionService {
  private readonly logger = new Logger(UserDataDeletionService.name);

  constructor(
    @InjectDataSource() private readonly dataSource: DataSource,
    private readonly auditService: AuditService,
  ) {}

  /** Number of stores the erasure flow covers. */
  get inventorySize(): number {
    return USER_DATA_INVENTORY.length;
  }

  async deleteUserData(userId: string): Promise<UserDataDeletionResult> {
    const subject = anonymisedSubjectId(userId);
    const deleted: ErasureCounts = {};
    const anonymised: ErasureCounts = {};

    const alreadyDeleted = await this.dataSource.transaction(
      async (manager): Promise<boolean> => {
        const locked = await manager.query<UserLockRow[]>(
          'SELECT "deletedAt" FROM users WHERE id = $1 FOR UPDATE',
          [userId],
        );
        if (locked.length === 0) {
          throw new NotFoundException(`User ${userId} not found`);
        }
        if (locked[0].deletedAt !== null) {
          return true;
        }

        for (const store of USER_DATA_INVENTORY) {
          if (store.disposition === UserDataDisposition.DELETE) {
            deleted[store.table] = await this.deleteStore(
              manager,
              store,
              userId,
            );
          } else {
            anonymised[store.table] = await this.anonymiseStore(
              manager,
              store,
              userId,
              subject,
            );
          }
        }

        return false;
      },
    );

    if (alreadyDeleted) {
      return {
        subject,
        alreadyDeleted: true,
        deleted: {},
        anonymised: {},
        audited: false,
      };
    }

    await this.auditService.log(USER_DATA_DELETION_ACTION, null, null, {
      subject,
      deleted,
      anonymised,
    });

    this.logger.log(
      `Erased user data for subject ${subject} across ` +
        `${Object.keys(deleted).length + Object.keys(anonymised).length} store(s)`,
    );

    return {
      subject,
      alreadyDeleted: false,
      deleted,
      anonymised,
      audited: true,
    };
  }

  /** Removes the user's rows from a store whose inventory action is `delete`. */
  private async deleteStore(
    manager: EntityManager,
    store: UserDataStore,
    userId: string,
  ): Promise<number> {
    let affected = 0;
    for (const column of store.userColumns) {
      const rows = await manager.query<IdRow[]>(
        `DELETE FROM "${store.table}" WHERE "${column}" = $1 RETURNING id`,
        [userId],
      );
      affected += rows.length;
    }
    return affected;
  }

  /**
   * Retains the store's rows but strips the personal data from each. A generic
   * fallback nulls the user columns; stores whose retained columns are NOT NULL
   * foreign keys get a store-specific handler below.
   */
  private async anonymiseStore(
    manager: EntityManager,
    store: UserDataStore,
    userId: string,
    subject: string,
  ): Promise<number> {
    switch (store.table) {
      case 'users':
        return this.anonymiseUserRow(manager, userId);
      case 'audit_logs':
        return this.anonymiseAuditLogs(manager, userId);
      case 'audit_log_archive':
        return this.anonymiseAuditArchive(manager, userId);
      case 'admin_blockchain_audit_logs':
        return this.anonymiseAdminAuditLogs(manager, userId, subject);
      case 'content_reports':
        return this.anonymiseContentReports(manager, userId);
      case 'review_comments':
        return this.anonymiseReviewComments(manager, userId);
      case 'review_decision_history':
        return this.anonymiseReviewDecisions(manager, userId);
      case 'verification_requests':
        return this.anonymiseVerificationRequests(manager, userId);
      case 'outbox_events':
        return this.redactOutboxEvents(manager, userId);
      default: {
        let affected = 0;
        for (const column of store.userColumns) {
          const rows = await manager.query<IdRow[]>(
            `UPDATE "${store.table}" SET "${column}" = $2 WHERE "${column}" = $1 RETURNING id`,
            [userId, ANONYMISED_PLACEHOLDER],
          );
          affected += rows.length;
        }
        return affected;
      }
    }
  }

  private async anonymiseAuditLogs(
    manager: EntityManager,
    userId: string,
  ): Promise<number> {
    const rows = await manager.query<AuditLogRow[]>(
      'SELECT id, metadata FROM audit_logs WHERE "userId" = $1',
      [userId],
    );
    for (const row of rows) {
      await manager.query(
        'UPDATE audit_logs SET "userId" = NULL, "ipAddress" = NULL, metadata = $2::jsonb WHERE id = $1',
        [row.id, this.serialiseMetadata(row.metadata)],
      );
    }
    return rows.length;
  }

  private async anonymiseAuditArchive(
    manager: EntityManager,
    userId: string,
  ): Promise<number> {
    const rows = await manager.query<ArchiveRow[]>(
      "SELECT id, payload FROM audit_log_archive WHERE payload->>'userId' = $1",
      [userId],
    );
    for (const row of rows) {
      const redacted = redactPersonalData(row.payload ?? {});
      await manager.query(
        'UPDATE audit_log_archive SET payload = $2::jsonb WHERE id = $1',
        [row.id, JSON.stringify(redacted)],
      );
    }
    return rows.length;
  }

  private async anonymiseAdminAuditLogs(
    manager: EntityManager,
    userId: string,
    subject: string,
  ): Promise<number> {
    const rows = await manager.query<IdRow[]>(
      'UPDATE admin_blockchain_audit_logs SET "actorId" = $2, "actorEmail" = NULL, "paramsSummary" = NULL WHERE "actorId" = $1 RETURNING id',
      [userId, subject],
    );
    return rows.length;
  }

  private async anonymiseContentReports(
    manager: EntityManager,
    userId: string,
  ): Promise<number> {
    let affected = 0;
    const reviewed = await manager.query<IdRow[]>(
      'UPDATE content_reports SET "reviewer_id" = NULL WHERE "reviewer_id" = $1 RETURNING id',
      [userId],
    );
    affected += reviewed.length;

    const reported = await manager.query<IdRow[]>(
      'UPDATE content_reports SET description = CASE WHEN description IS NULL THEN NULL ELSE $2 END, "review_notes" = CASE WHEN "review_notes" IS NULL THEN NULL ELSE $2 END WHERE "reporter_id" = $1 RETURNING id',
      [userId, ANONYMISED_PLACEHOLDER],
    );
    affected += reported.length;
    return affected;
  }

  private async anonymiseReviewComments(
    manager: EntityManager,
    userId: string,
  ): Promise<number> {
    const rows = await manager.query<IdRow[]>(
      'UPDATE review_comments SET content = $2 WHERE "author_id" = $1 RETURNING id',
      [userId, ANONYMISED_PLACEHOLDER],
    );
    return rows.length;
  }

  private async anonymiseReviewDecisions(
    manager: EntityManager,
    userId: string,
  ): Promise<number> {
    const rows = await manager.query<IdRow[]>(
      'UPDATE review_decision_history SET rationale = NULL, metadata = NULL WHERE "reviewer_id" = $1 RETURNING id',
      [userId],
    );
    return rows.length;
  }

  private async anonymiseVerificationRequests(
    manager: EntityManager,
    userId: string,
  ): Promise<number> {
    let affected = 0;
    const reviewed = await manager.query<IdRow[]>(
      'UPDATE verification_requests SET "reviewerId" = NULL, "reviewNote" = NULL WHERE "reviewerId" = $1 RETURNING id',
      [userId],
    );
    affected += reviewed.length;

    const requested = await manager.query<IdRow[]>(
      'UPDATE verification_requests SET evidence = $2, "requesterNote" = NULL WHERE "requesterId" = $1 RETURNING id',
      [userId, ANONYMISED_PLACEHOLDER],
    );
    affected += requested.length;
    return affected;
  }

  private async redactOutboxEvents(
    manager: EntityManager,
    userId: string,
  ): Promise<number> {
    const rows = await manager.query<IdRow[]>(
      `UPDATE outbox_events SET payload = '{"redacted": true}'::jsonb WHERE payload->>'userId' = $1 OR payload->>'id' = $1 RETURNING id`,
      [userId],
    );
    return rows.length;
  }

  /** Strips the identifying fields from the account row itself. */
  private async anonymiseUserRow(
    manager: EntityManager,
    userId: string,
  ): Promise<number> {
    await manager.query(
      `UPDATE users SET
         email = NULL,
         "passwordHash" = NULL,
         "firstName" = NULL,
         "lastName" = NULL,
         "displayName" = NULL,
         bio = NULL,
         "avatarUrl" = NULL,
         "stellarPublicKey" = NULL,
         "twoFactorSecret" = NULL,
         "twoFactorEnabled" = false,
         preferences = $2::jsonb,
         role = 'user',
         "deletedAt" = now(),
         "updatedAt" = now()
       WHERE id = $1`,
      [userId, JSON.stringify(DEFAULT_PREFERENCES)],
    );
    return 1;
  }

  private serialiseMetadata(
    metadata: Record<string, unknown> | null,
  ): string | null {
    if (metadata === null) {
      return null;
    }
    return JSON.stringify(redactPersonalData(metadata));
  }
}
