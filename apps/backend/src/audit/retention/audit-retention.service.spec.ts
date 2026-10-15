import { DataSource, FindOperator } from 'typeorm';
import { AuditRetentionService } from './audit-retention.service';
import {
  AUDIT_EXPORT_ACTION,
  AUDIT_RETENTION_RUN_ACTION,
  AuditRecordType,
  RetentionPolicy,
  retentionCutoff,
} from './audit-retention.policy';
import { AuditLog } from '../entities/audit-log.entity';
import { AuditLogArchive } from '../entities/audit-log-archive.entity';
import { AdminBlockchainAuditLog } from '../../admin-audit/entities/admin-blockchain-audit-log.entity';
import { AuditService } from '../audit.service';

type Row = Record<string, unknown> & { id: string; createdAt: Date };

/** Evaluates the subset of TypeORM find operators the service uses. */
function matches(value: unknown, condition: unknown): boolean {
  if (!(condition instanceof FindOperator)) return value === condition;
  const operand: unknown = condition.value;
  switch (condition.type) {
    case 'lessThan':
      return (value as Date).getTime() < (operand as Date).getTime();
    case 'like': {
      const pattern = String(operand).replace(/%/g, '.*');
      return new RegExp(`^${pattern}$`).test(String(value));
    }
    case 'not':
      // `.value` unwraps a nested operator; `.child` keeps it (NOT LIKE).
      return !matches(value, condition.child ?? operand);
    default:
      throw new Error(`Unsupported operator ${condition.type}`);
  }
}

/** In-memory stand-in for the tables and the transaction manager. */
function createFakeDb() {
  const tables = new Map<unknown, Row[]>([
    [AuditLog, []],
    [AdminBlockchainAuditLog, []],
    [AuditLogArchive, []],
  ]);
  const repo = (entity: unknown) => ({
    find: jest.fn(
      (opts: {
        where: Record<string, unknown>;
        take: number;
      }): Promise<Row[]> =>
        Promise.resolve(
          tables
            .get(entity)!
            .filter((row) =>
              Object.entries(opts.where).every(([key, cond]) =>
                matches(row[key], cond),
              ),
            )
            .sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime())
            .slice(0, opts.take),
        ),
    ),
    create: jest.fn((rows: Row[]) => rows),
    save: jest.fn((rows: Row[]) => {
      tables.get(entity)!.push(...rows);
      return Promise.resolve(rows);
    }),
    delete: jest.fn((ids: string[]) => {
      tables.set(
        entity,
        tables.get(entity)!.filter((row) => !ids.includes(row.id)),
      );
      return Promise.resolve();
    }),
  });
  const manager = { getRepository: jest.fn(repo) };
  const dataSource = {
    transaction: jest.fn((fn: (m: typeof manager) => Promise<unknown>) =>
      fn(manager),
    ),
  };
  return { tables, dataSource };
}

const NOW = new Date('2026-09-23T03:00:00.000Z');
const DAY_MS = 24 * 60 * 60 * 1000;

function auditLog(id: string, createdAt: Date, action = 'login'): Row {
  return {
    id,
    action,
    userId: null,
    ipAddress: null,
    metadata: null,
    createdAt,
  };
}

function policy(
  recordType: AuditRecordType,
  mode: RetentionPolicy['mode'],
  retentionDays = 30,
): RetentionPolicy {
  return { recordType, mode, retentionDays };
}

describe('AuditRetentionService', () => {
  let db: ReturnType<typeof createFakeDb>;
  let auditService: { log: jest.Mock };
  let service: AuditRetentionService;

  beforeEach(() => {
    process.env['AUDIT_RETENTION_BATCH_SIZE'] = '2';
    db = createFakeDb();
    auditService = { log: jest.fn().mockResolvedValue({}) };
    service = new AuditRetentionService(
      db.dataSource as unknown as DataSource,
      auditService as unknown as AuditService,
    );
  });

  afterEach(() => {
    delete process.env['AUDIT_RETENTION_BATCH_SIZE'];
  });

  describe('retention boundary', () => {
    const cutoff = retentionCutoff(NOW, 30);

    beforeEach(() => {
      db.tables.set(AuditLog, [
        auditLog('before-edge', new Date(cutoff.getTime() - 1)),
        auditLog('at-edge', new Date(cutoff.getTime())),
        auditLog('after-edge', new Date(cutoff.getTime() + 1)),
      ]);
    });

    it('archives a record 1ms past the window and keeps the one exactly on the edge', async () => {
      const result = await service.applyPolicy(
        policy(AuditRecordType.USER_ACTIVITY, 'archive'),
        NOW,
      );

      expect(result.archived).toBe(1);
      expect(result.cutoff).toBe(
        new Date(NOW.getTime() - 30 * DAY_MS).toISOString(),
      );
      expect(db.tables.get(AuditLog)!.map((r) => r.id)).toEqual([
        'at-edge',
        'after-edge',
      ]);
      expect(db.tables.get(AuditLogArchive)!.map((r) => r.sourceId)).toEqual([
        'before-edge',
      ]);
    });

    it('purges a record 1ms past the window and keeps the one exactly on the edge', async () => {
      const result = await service.applyPolicy(
        policy(AuditRecordType.USER_ACTIVITY, 'purge'),
        NOW,
      );

      expect(result).toMatchObject({ purged: 1, archived: 0 });
      expect(db.tables.get(AuditLog)!.map((r) => r.id)).toEqual([
        'at-edge',
        'after-edge',
      ]);
      expect(db.tables.get(AuditLogArchive)).toHaveLength(0);
    });
  });

  it('archives the full original row with its source and type', async () => {
    const createdAt = new Date(NOW.getTime() - 400 * DAY_MS);
    db.tables.set(AdminBlockchainAuditLog, [
      {
        id: 'chain-1',
        actorId: 'admin-1',
        endpoint: 'POST /grants/rounds',
        txHash: '0xabc',
        createdAt,
      },
    ]);

    await service.applyPolicy(
      policy(AuditRecordType.ADMIN_BLOCKCHAIN_ACTION, 'archive', 365),
      NOW,
    );

    expect(db.tables.get(AdminBlockchainAuditLog)).toHaveLength(0);
    expect(db.tables.get(AuditLogArchive)).toEqual([
      {
        recordType: AuditRecordType.ADMIN_BLOCKCHAIN_ACTION,
        sourceTable: 'admin_blockchain_audit_logs',
        sourceId: 'chain-1',
        payload: {
          id: 'chain-1',
          actorId: 'admin-1',
          endpoint: 'POST /grants/rounds',
          txHash: '0xabc',
          createdAt: createdAt.toISOString(),
        },
        originalCreatedAt: createdAt,
      },
    ]);
  });

  it('applies user-activity and audit-operation windows to their own rows only', async () => {
    const old = new Date(NOW.getTime() - 100 * DAY_MS);
    db.tables.set(AuditLog, [
      auditLog('login-old', old, 'login'),
      auditLog('export-old', old, AUDIT_EXPORT_ACTION),
    ]);

    await service.applyPolicy(
      policy(AuditRecordType.USER_ACTIVITY, 'purge', 30),
      NOW,
    );
    expect(db.tables.get(AuditLog)!.map((r) => r.id)).toEqual(['export-old']);

    await service.applyPolicy(
      policy(AuditRecordType.AUDIT_OPERATION, 'purge', 365),
      NOW,
    );
    expect(db.tables.get(AuditLog)!.map((r) => r.id)).toEqual(['export-old']);

    await service.applyPolicy(
      policy(AuditRecordType.AUDIT_OPERATION, 'purge', 30),
      NOW,
    );
    expect(db.tables.get(AuditLog)).toHaveLength(0);
  });

  it('processes expired records in batches until none remain', async () => {
    const old = new Date(NOW.getTime() - 100 * DAY_MS);
    db.tables.set(
      AuditLog,
      ['a', 'b', 'c', 'd', 'e'].map((id) => auditLog(id, old)),
    );

    const result = await service.applyPolicy(
      policy(AuditRecordType.USER_ACTIVITY, 'archive'),
      NOW,
    );

    expect(result.archived).toBe(5);
    // 2 + 2 + 1: the short final batch ends the loop.
    expect(db.dataSource.transaction).toHaveBeenCalledTimes(3);
    expect(db.tables.get(AuditLog)).toHaveLength(0);
    expect(db.tables.get(AuditLogArchive)).toHaveLength(5);
  });

  it('does nothing when no record is past the window', async () => {
    db.tables.set(AuditLog, [auditLog('fresh', NOW)]);

    const result = await service.applyPolicy(
      policy(AuditRecordType.USER_ACTIVITY, 'purge'),
      NOW,
    );

    expect(result.purged).toBe(0);
    expect(db.tables.get(AuditLog)).toHaveLength(1);
  });

  it('propagates a failed delete so the transaction rolls back', async () => {
    db.tables.set(AuditLog, [
      auditLog('old', new Date(NOW.getTime() - 100 * DAY_MS)),
    ]);
    db.dataSource.transaction.mockRejectedValueOnce(new Error('db down'));

    await expect(
      service.applyPolicy(
        policy(AuditRecordType.USER_ACTIVITY, 'archive'),
        NOW,
      ),
    ).rejects.toThrow('db down');
  });

  it('runs every configured policy and records the run in the audit trail', async () => {
    const results = await service.run(NOW);

    expect(results.map((r) => r.recordType)).toEqual(
      Object.values(AuditRecordType),
    );
    expect(auditService.log).toHaveBeenCalledWith(
      AUDIT_RETENTION_RUN_ACTION,
      null,
      null,
      { ranAt: NOW.toISOString(), results },
    );
  });
});
