import { Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository, FindManyOptions, Between } from 'typeorm';
import { AdminBlockchainAuditLog } from './entities/admin-blockchain-audit-log.entity';

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

@Injectable()
export class AdminAuditService {
  private readonly logger = new Logger(AdminAuditService.name);

  constructor(
    @InjectRepository(AdminBlockchainAuditLog)
    private readonly repo: Repository<AdminBlockchainAuditLog>,
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
}
