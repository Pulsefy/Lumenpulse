import { BadRequestException, Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { isUUID } from 'class-validator';
import { Between, FindOptionsWhere, Like, Not, Repository } from 'typeorm';
import { AuditLog } from '../entities/audit-log.entity';
import { AdminBlockchainAuditLog } from '../../admin-audit/entities/admin-blockchain-audit-log.entity';
import { AuditService } from '../audit.service';
import {
  AUDIT_EXPORT_ACTION,
  AUDIT_OPERATION_ACTION_PREFIX,
  AuditRecordType,
} from '../retention/audit-retention.policy';
import {
  AuditExportFormat,
  AuditExportRecordDto,
  AuditExportResponseDto,
} from '../dto/audit-export.dto';

export interface AuditExportRequest {
  from: Date;
  to: Date;
  actorId?: string;
  recordType?: AuditRecordType;
  format: AuditExportFormat;
  /** Admin running the export, recorded in the audit trail. */
  requestedBy: string | null;
  ipAddress: string | null;
}

const CSV_COLUMNS: (keyof AuditExportRecordDto)[] = [
  'recordType',
  'id',
  'actorId',
  'action',
  'ipAddress',
  'createdAt',
  'details',
];

@Injectable()
export class AuditExportService {
  private readonly maxRows = Number(
    process.env['AUDIT_EXPORT_MAX_ROWS'] ?? 10000,
  );

  constructor(
    @InjectRepository(AuditLog)
    private readonly auditLogRepo: Repository<AuditLog>,
    @InjectRepository(AdminBlockchainAuditLog)
    private readonly adminAuditRepo: Repository<AdminBlockchainAuditLog>,
    private readonly auditService: AuditService,
  ) {}

  /**
   * Builds a filtered extract and records the export in the audit trail.
   * The export is only returned once its own audit record is persisted.
   */
  async export(req: AuditExportRequest): Promise<AuditExportResponseDto> {
    if (req.from.getTime() > req.to.getTime()) {
      throw new BadRequestException('"from" must not be after "to"');
    }

    const recordTypes = req.recordType
      ? [req.recordType]
      : Object.values(AuditRecordType);

    // Fetch one past the limit per source so truncation is detectable.
    const take = this.maxRows + 1;
    const batches = await Promise.all(
      recordTypes.map((type) => this.fetch(type, req, take)),
    );
    const matched = batches
      .flat()
      .sort((a, b) => a.createdAt.localeCompare(b.createdAt));
    const truncated = matched.length > this.maxRows;
    const records = matched.slice(0, this.maxRows);

    const result: AuditExportResponseDto = {
      filters: {
        from: req.from.toISOString(),
        to: req.to.toISOString(),
        actorId: req.actorId ?? null,
        recordTypes,
      },
      generatedAt: new Date().toISOString(),
      count: records.length,
      truncated,
      records,
    };

    await this.auditService.log(
      AUDIT_EXPORT_ACTION,
      req.requestedBy,
      req.ipAddress,
      {
        filters: result.filters,
        format: req.format,
        count: result.count,
        truncated,
      },
    );

    return result;
  }

  toCsv(result: AuditExportResponseDto): string {
    const lines = [CSV_COLUMNS.join(',')];
    for (const record of result.records) {
      lines.push(
        CSV_COLUMNS.map((column) => {
          const value = record[column];
          return escapeCsv(
            value !== null && typeof value === 'object'
              ? JSON.stringify(value)
              : (value ?? ''),
          );
        }).join(','),
      );
    }
    return lines.join('\n') + '\n';
  }

  private async fetch(
    type: AuditRecordType,
    req: AuditExportRequest,
    take: number,
  ): Promise<AuditExportRecordDto[]> {
    const createdAt = Between(req.from, req.to);

    if (type === AuditRecordType.ADMIN_BLOCKCHAIN_ACTION) {
      const where: FindOptionsWhere<AdminBlockchainAuditLog> = { createdAt };
      if (req.actorId) where.actorId = req.actorId;
      const rows = await this.adminAuditRepo.find({
        where,
        order: { createdAt: 'ASC' },
        take,
      });
      return rows.map((row) => ({
        recordType: type,
        id: row.id,
        actorId: row.actorId,
        action: row.endpoint,
        ipAddress: null,
        details: {
          actorEmail: row.actorEmail,
          targetContract: row.targetContract,
          paramsSummary: row.paramsSummary,
          txHash: row.txHash,
          responseStatus: row.responseStatus,
        },
        createdAt: row.createdAt.toISOString(),
      }));
    }

    // audit_logs.userId is a uuid column; a non-uuid actor can't match it.
    if (req.actorId && !isUUID(req.actorId)) return [];

    const operationActions = Like(`${AUDIT_OPERATION_ACTION_PREFIX}%`);
    const where: FindOptionsWhere<AuditLog> = {
      createdAt,
      action:
        type === AuditRecordType.AUDIT_OPERATION
          ? operationActions
          : Not(operationActions),
    };
    if (req.actorId) where.userId = req.actorId;

    const rows = await this.auditLogRepo.find({
      where,
      order: { createdAt: 'ASC' },
      take,
    });
    return rows.map((row) => ({
      recordType: type,
      id: row.id,
      actorId: row.userId,
      action: row.action,
      ipAddress: row.ipAddress,
      details: row.metadata,
      createdAt: row.createdAt.toISOString(),
    }));
  }
}

/** Quotes a CSV cell and neutralises spreadsheet formula injection. */
function escapeCsv(value: string | number | boolean): string {
  let text = String(value);
  if (/^[=+\-@\t\r]/.test(text)) text = `'${text}`;
  return /[",\n\r]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}
