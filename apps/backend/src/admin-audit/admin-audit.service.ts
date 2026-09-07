import { Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository, FindManyOptions, Between } from 'typeorm';
import { AdminBlockchainAuditLog } from './entities/admin-blockchain-audit-log.entity';
import { AuditLog } from '../audit/entities/audit-log.entity';
import { ExportAuditLogsDto } from './dto/export-audit-logs.dto';

/** Fields that must be redacted before persistence */
const SENSITIVE_KEYS = new Set([
  'password',
  'passwordHash',
  'secret',
  'privateKey',
  'secretKey',
  'apiKey',
  'token',
  'authorization',
  'signature',
  'seed',
  'mnemonic',
]);

/** Hard cap on rows returned by the export endpoint. */
export const MAX_EXPORT_ROWS = 10_000;

export interface CreateAuditLogDto {
  actorId: string;
  actorEmail?: string | null;
  endpoint: string;
  targetContract?: string | null;
  params?: Record<string, unknown> | null;
  txHash?: string | null;
  responseStatus?: number | null;
}

export interface QueryAuditLogsDto {
  actorId?: string;
  endpoint?: string;
  from?: Date;
  to?: Date;
  page?: number;
  limit?: number;
}

export interface ExportAuditResultDto {
  exportedAt: string;
  dateRange: { from: string; to: string };
  auditLogs: AuditLog[];
  adminBlockchainAuditLogs: AdminBlockchainAuditLog[];
  /** True when either result set was truncated at MAX_EXPORT_ROWS. */
  truncated: boolean;
}

@Injectable()
export class AdminAuditService {
  private readonly logger = new Logger(AdminAuditService.name);

  constructor(
    @InjectRepository(AdminBlockchainAuditLog)
    private readonly repo: Repository<AdminBlockchainAuditLog>,
    @InjectRepository(AuditLog)
    private readonly auditLogRepo: Repository<AuditLog>,
  ) {}

  /**
   * Recursively redact sensitive keys from an object before storage.
   */
  redact(obj: unknown): unknown {
    if (obj === null || obj === undefined) return obj;

    if (Array.isArray(obj)) {
      return obj.map((item) => this.redact(item));
    }

    if (typeof obj === 'object') {
      const result: Record<string, unknown> = {};
      for (const [key, value] of Object.entries(
        obj as Record<string, unknown>,
      )) {
        result[key] = SENSITIVE_KEYS.has(key.toLowerCase())
          ? '[REDACTED]'
          : this.redact(value);
      }
      return result;
    }

    return obj;
  }

  async create(dto: CreateAuditLogDto): Promise<void> {
    try {
      const log = this.repo.create({
        actorId: dto.actorId,
        actorEmail: dto.actorEmail ?? null,
        endpoint: dto.endpoint,
        targetContract: dto.targetContract ?? null,
        paramsSummary: dto.params
          ? (this.redact(dto.params) as Record<string, unknown>)
          : null,
        txHash: dto.txHash ?? null,
        responseStatus: dto.responseStatus ?? null,
      });
      await this.repo.save(log);
    } catch (err) {
      // Audit failures must never disrupt the main request
      this.logger.error('Failed to persist audit log', err);
    }
  }

  async query(
    dto: QueryAuditLogsDto,
  ): Promise<{ data: AdminBlockchainAuditLog[]; total: number }> {
    const page = Math.max(1, dto.page ?? 1);
    const limit = Math.min(100, Math.max(1, dto.limit ?? 20));

    const where: FindManyOptions<AdminBlockchainAuditLog>['where'] = {};

    if (dto.actorId) (where as Record<string, unknown>).actorId = dto.actorId;
    if (dto.endpoint)
      (where as Record<string, unknown>).endpoint = dto.endpoint;
    if (dto.from && dto.to) {
      (where as Record<string, unknown>).createdAt = Between(dto.from, dto.to);
    }

    const [data, total] = await this.repo.findAndCount({
      where,
      order: { createdAt: 'DESC' },
      skip: (page - 1) * limit,
      take: limit,
    });

    return { data, total };
  }

  /**
   * Export audit records from both tables for the given date range.
   *
   * Both result sets are individually capped at MAX_EXPORT_ROWS. When the cap
   * is hit the `truncated` flag is set to true so callers can surface a
   * warning to the admin.
   *
   * Optional `actorId` and `endpoint` filters apply to the
   * admin_blockchain_audit_logs table only (those fields do not exist on
   * audit_logs).
   */
  async export(dto: ExportAuditLogsDto): Promise<ExportAuditResultDto> {
    const from = new Date(dto.from);
    const to = new Date(dto.to);

    // --- audit_logs (general) ---
    const auditLogs = await this.auditLogRepo.find({
      where: { createdAt: Between(from, to) },
      order: { createdAt: 'DESC' },
      take: MAX_EXPORT_ROWS,
    });

    // --- admin_blockchain_audit_logs ---
    const adminWhere: FindManyOptions<AdminBlockchainAuditLog>['where'] = {
      createdAt: Between(from, to),
    };
    if (dto.actorId)
      (adminWhere as Record<string, unknown>).actorId = dto.actorId;
    if (dto.endpoint)
      (adminWhere as Record<string, unknown>).endpoint = dto.endpoint;

    const adminAuditLogs = await this.repo.find({
      where: adminWhere,
      order: { createdAt: 'DESC' },
      take: MAX_EXPORT_ROWS,
    });

    return {
      exportedAt: new Date().toISOString(),
      dateRange: { from: dto.from, to: dto.to },
      auditLogs,
      adminBlockchainAuditLogs: adminAuditLogs,
      truncated:
        auditLogs.length === MAX_EXPORT_ROWS ||
        adminAuditLogs.length === MAX_EXPORT_ROWS,
    };
  }
}
