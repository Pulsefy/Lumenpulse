import { Injectable, Logger } from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';
import {
  DataSource,
  EntityTarget,
  FindOptionsWhere,
  LessThan,
  Like,
  Not,
} from 'typeorm';
import { AuditLog } from '../entities/audit-log.entity';
import { AuditLogArchive } from '../entities/audit-log-archive.entity';
import { AdminBlockchainAuditLog } from '../../admin-audit/entities/admin-blockchain-audit-log.entity';
import { AuditService } from '../audit.service';
import {
  AUDIT_OPERATION_ACTION_PREFIX,
  AUDIT_RETENTION_RUN_ACTION,
  AuditRecordType,
  RetentionPolicy,
  buildRetentionPolicies,
  retentionCutoff,
} from './audit-retention.policy';

interface AuditRow {
  id: string;
  createdAt: Date;
}

interface RetentionTarget {
  entity: EntityTarget<AuditRow>;
  table: string;
  /** Narrows the table to the rows belonging to this record type. */
  where: FindOptionsWhere<AuditRow>;
}

const TARGETS: Record<AuditRecordType, RetentionTarget> = {
  [AuditRecordType.USER_ACTIVITY]: {
    entity: AuditLog,
    table: 'audit_logs',
    where: {
      action: Not(Like(`${AUDIT_OPERATION_ACTION_PREFIX}%`)),
    } as FindOptionsWhere<AuditRow>,
  },
  [AuditRecordType.AUDIT_OPERATION]: {
    entity: AuditLog,
    table: 'audit_logs',
    where: {
      action: Like(`${AUDIT_OPERATION_ACTION_PREFIX}%`),
    } as FindOptionsWhere<AuditRow>,
  },
  [AuditRecordType.ADMIN_BLOCKCHAIN_ACTION]: {
    entity: AdminBlockchainAuditLog,
    table: 'admin_blockchain_audit_logs',
    where: {},
  },
};

export interface RetentionResult {
  recordType: AuditRecordType;
  mode: RetentionPolicy['mode'];
  retentionDays: number;
  cutoff: string;
  archived: number;
  purged: number;
}

@Injectable()
export class AuditRetentionService {
  private readonly logger = new Logger(AuditRetentionService.name);
  private readonly policies = buildRetentionPolicies();
  private readonly batchSize = Number(
    process.env['AUDIT_RETENTION_BATCH_SIZE'] ?? 1000,
  );
  /** Bounds a single run; the remainder is picked up the next night. */
  private readonly maxBatchesPerPolicy = Number(
    process.env['AUDIT_RETENTION_MAX_BATCHES'] ?? 100,
  );

  constructor(
    @InjectDataSource() private readonly dataSource: DataSource,
    private readonly auditService: AuditService,
  ) {}

  getPolicies(): RetentionPolicy[] {
    return this.policies;
  }

  /** Applies every policy, then records the run in the audit trail. */
  async run(now = new Date()): Promise<RetentionResult[]> {
    const results: RetentionResult[] = [];
    for (const policy of this.policies) {
      results.push(await this.applyPolicy(policy, now));
    }

    await this.auditService.log(AUDIT_RETENTION_RUN_ACTION, null, null, {
      ranAt: now.toISOString(),
      results,
    });
    return results;
  }

  /**
   * Archives or purges every record of `policy.recordType` created strictly
   * before the cutoff. Each batch is copied and deleted in one transaction,
   * so a record is never lost between the archive insert and the delete.
   */
  async applyPolicy(
    policy: RetentionPolicy,
    now = new Date(),
  ): Promise<RetentionResult> {
    const target = TARGETS[policy.recordType];
    const cutoff = retentionCutoff(now, policy.retentionDays);
    let processed = 0;

    for (let batch = 0; batch < this.maxBatchesPerPolicy; batch++) {
      const count = await this.dataSource.transaction(async (manager) => {
        const repo = manager.getRepository(target.entity);
        const rows = await repo.find({
          where: { ...target.where, createdAt: LessThan(cutoff) },
          order: { createdAt: 'ASC' },
          take: this.batchSize,
        });
        if (rows.length === 0) return 0;

        if (policy.mode === 'archive') {
          const archive = manager.getRepository(AuditLogArchive);
          await archive.save(
            archive.create(
              rows.map((row) => ({
                recordType: policy.recordType,
                sourceTable: target.table,
                sourceId: row.id,
                payload: JSON.parse(JSON.stringify(row)) as Record<
                  string,
                  unknown
                >,
                originalCreatedAt: row.createdAt,
              })),
            ),
          );
        }
        await repo.delete(rows.map((row) => row.id));
        return rows.length;
      });

      processed += count;
      if (count < this.batchSize) break;
    }

    if (processed > 0) {
      this.logger.log(
        `${policy.mode === 'archive' ? 'Archived' : 'Purged'} ${processed} ` +
          `${policy.recordType} record(s) older than ${cutoff.toISOString()}`,
      );
    }

    return {
      recordType: policy.recordType,
      mode: policy.mode,
      retentionDays: policy.retentionDays,
      cutoff: cutoff.toISOString(),
      archived: policy.mode === 'archive' ? processed : 0,
      purged: policy.mode === 'purge' ? processed : 0,
    };
  }
}
