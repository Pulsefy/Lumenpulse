import { BadRequestException } from '@nestjs/common';
import { FindOperator, Repository } from 'typeorm';
import { AuditExportService, AuditExportRequest } from './audit-export.service';
import { AuditExportFormat } from '../dto/audit-export.dto';
import {
  AUDIT_EXPORT_ACTION,
  AuditRecordType,
} from '../retention/audit-retention.policy';
import { AuditLog } from '../entities/audit-log.entity';
import { AdminBlockchainAuditLog } from '../../admin-audit/entities/admin-blockchain-audit-log.entity';
import { AuditService } from '../audit.service';

const ADMIN_ID = '11111111-1111-4111-8111-111111111111';
const USER_ID = '22222222-2222-4222-8222-222222222222';

function request(overrides: Partial<AuditExportRequest> = {}) {
  return {
    from: new Date('2026-01-01T00:00:00.000Z'),
    to: new Date('2026-01-31T23:59:59.999Z'),
    format: AuditExportFormat.JSON,
    requestedBy: ADMIN_ID,
    ipAddress: '10.0.0.1',
    ...overrides,
  };
}

describe('AuditExportService', () => {
  let auditLogRepo: { find: jest.Mock };
  let adminAuditRepo: { find: jest.Mock };
  let auditService: { log: jest.Mock };
  let service: AuditExportService;

  beforeEach(() => {
    auditLogRepo = { find: jest.fn().mockResolvedValue([]) };
    adminAuditRepo = { find: jest.fn().mockResolvedValue([]) };
    auditService = { log: jest.fn().mockResolvedValue({}) };
    service = new AuditExportService(
      auditLogRepo as unknown as Repository<AuditLog>,
      adminAuditRepo as unknown as Repository<AdminBlockchainAuditLog>,
      auditService as unknown as AuditService,
    );
  });

  it('merges every record type in the range, oldest first', async () => {
    auditLogRepo.find.mockImplementation(
      ({ where }: { where: { action: FindOperator<string> } }) =>
        Promise.resolve(
          where.action.type === 'not'
            ? [
                {
                  id: 'login-1',
                  userId: USER_ID,
                  action: 'login',
                  ipAddress: '1.2.3.4',
                  metadata: { email: 'a@b.c' },
                  createdAt: new Date('2026-01-10T00:00:00.000Z'),
                },
              ]
            : [],
        ),
    );
    adminAuditRepo.find.mockResolvedValue([
      {
        id: 'chain-1',
        actorId: ADMIN_ID,
        actorEmail: 'admin@x.io',
        endpoint: 'POST /grants/rounds',
        targetContract: 'C123',
        paramsSummary: { amount: 5 },
        txHash: '0xabc',
        responseStatus: 201,
        createdAt: new Date('2026-01-05T00:00:00.000Z'),
      },
    ]);

    const result = await service.export(request());

    expect(result.count).toBe(2);
    expect(result.truncated).toBe(false);
    expect(result.filters.recordTypes).toEqual(Object.values(AuditRecordType));
    expect(result.records.map((r) => r.id)).toEqual(['chain-1', 'login-1']);
    expect(result.records[0]).toMatchObject({
      recordType: AuditRecordType.ADMIN_BLOCKCHAIN_ACTION,
      actorId: ADMIN_ID,
      action: 'POST /grants/rounds',
      details: { txHash: '0xabc', targetContract: 'C123' },
    });
    expect(result.records[1]).toMatchObject({
      recordType: AuditRecordType.USER_ACTIVITY,
      actorId: USER_ID,
      ipAddress: '1.2.3.4',
      details: { email: 'a@b.c' },
    });
  });

  it('filters by an inclusive date range and actor', async () => {
    await service.export(request({ actorId: USER_ID }));

    const { where } = auditLogRepo.find.mock.calls[0][0];
    expect(where.userId).toBe(USER_ID);
    expect(where.createdAt.type).toBe('between');
    expect(where.createdAt.value).toEqual([
      new Date('2026-01-01T00:00:00.000Z'),
      new Date('2026-01-31T23:59:59.999Z'),
    ]);
    expect(adminAuditRepo.find.mock.calls[0][0].where.actorId).toBe(USER_ID);
  });

  it('only queries the requested record type', async () => {
    await service.export(
      request({ recordType: AuditRecordType.ADMIN_BLOCKCHAIN_ACTION }),
    );

    expect(adminAuditRepo.find).toHaveBeenCalledTimes(1);
    expect(auditLogRepo.find).not.toHaveBeenCalled();
  });

  it('skips the uuid-keyed audit_logs table for a non-uuid actor', async () => {
    await service.export(request({ actorId: 'unknown' }));

    expect(auditLogRepo.find).not.toHaveBeenCalled();
    expect(adminAuditRepo.find.mock.calls[0][0].where.actorId).toBe('unknown');
  });

  it('flags the extract as truncated past the row limit', async () => {
    process.env['AUDIT_EXPORT_MAX_ROWS'] = '2';
    service = new AuditExportService(
      auditLogRepo as unknown as Repository<AuditLog>,
      adminAuditRepo as unknown as Repository<AdminBlockchainAuditLog>,
      auditService as unknown as AuditService,
    );
    delete process.env['AUDIT_EXPORT_MAX_ROWS'];
    adminAuditRepo.find.mockResolvedValue(
      [1, 2, 3].map((day) => ({
        id: `chain-${day}`,
        actorId: ADMIN_ID,
        endpoint: 'POST /x',
        createdAt: new Date(`2026-01-0${day}T00:00:00.000Z`),
      })),
    );

    const result = await service.export(request());

    expect(adminAuditRepo.find.mock.calls[0][0].take).toBe(3);
    expect(result.truncated).toBe(true);
    expect(result.records.map((r) => r.id)).toEqual(['chain-1', 'chain-2']);
  });

  it('records the export run in the audit trail', async () => {
    await service.export(
      request({ actorId: USER_ID, format: AuditExportFormat.CSV }),
    );

    expect(auditService.log).toHaveBeenCalledWith(
      AUDIT_EXPORT_ACTION,
      ADMIN_ID,
      '10.0.0.1',
      {
        filters: {
          from: '2026-01-01T00:00:00.000Z',
          to: '2026-01-31T23:59:59.999Z',
          actorId: USER_ID,
          recordTypes: Object.values(AuditRecordType),
        },
        format: AuditExportFormat.CSV,
        count: 0,
        truncated: false,
      },
    );
  });

  it('fails the export when its audit record cannot be written', async () => {
    auditService.log.mockRejectedValue(new Error('db down'));

    await expect(service.export(request())).rejects.toThrow('db down');
  });

  it('rejects an inverted date range without querying or auditing', async () => {
    await expect(
      service.export(
        request({
          from: new Date('2026-02-01T00:00:00.000Z'),
          to: new Date('2026-01-01T00:00:00.000Z'),
        }),
      ),
    ).rejects.toBeInstanceOf(BadRequestException);

    expect(auditLogRepo.find).not.toHaveBeenCalled();
    expect(auditService.log).not.toHaveBeenCalled();
  });

  it('renders CSV with quoting and formula-injection guards', () => {
    const csv = service.toCsv({
      filters: {
        from: '',
        to: '',
        actorId: null,
        recordTypes: [],
      },
      generatedAt: '2026-01-01T00:00:00.000Z',
      count: 1,
      truncated: false,
      records: [
        {
          recordType: AuditRecordType.USER_ACTIVITY,
          id: 'login-1',
          actorId: null,
          action: '=HYPERLINK("x")',
          ipAddress: null,
          details: { note: 'a,b' },
          createdAt: '2026-01-10T00:00:00.000Z',
        },
      ],
    });

    expect(csv).toBe(
      'recordType,id,actorId,action,ipAddress,createdAt,details\n' +
        'user_activity,login-1,,"\'=HYPERLINK(""x"")",,2026-01-10T00:00:00.000Z,"{""note"":""a,b""}"\n',
    );
  });
});
