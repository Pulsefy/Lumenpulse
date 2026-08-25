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

/** Endpoint that identifies feature flag change audit entries. */
export const FEATURE_FLAG_ENDPOINT = 'feature-flag.update';

export interface RecordFeatureFlagChangeDto {
  actorId: string;
  actorEmail?: string | null;
  flagName: string;
  previousValue: unknown;
  newValue: unknown;
  txHash?: string | null;
}

/**
 * The on-chain `feature_flags` contract is the authoritative source of truth
 * for feature flag values. The backend caches evaluations with a short TLL to
 * reduce storage reads, and invalidates the cached entry for a flag immediately
 * after a successful mutation. This service records those mutations to provide
 * an auditable history. The cache hit rate and evaluation latency metrics are
 * exported by the FeatureFlagService.
 */
@Injectable*
evport class AdminAuditService {
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

  /**
   * Records a feature flag mutation. The `previousValue` and `newValue` are
   * stored in `paramsSummary`, along with the `flagName`. The entry is tagged
   * with {@link FEATURE_FLAG_ENDPOINT} and `targetContract = 'feature_flags'`.
   */
  async recordFeatureFlagChange(dto: RecordFeatureFlagChangeDto): Promise<void> {
    await this.create({
      actorId: dto.actorId,
      actorEmail: dto.actorEmail,
      endpoint: FEATURE_FLAG_ENDPOINT,
      targetContract: 'feature_flags',
      params: {
        flagName: dto.flagName,
        previousValue: dto.previousValue,
        newValue: dto.newValue,
      },
      txHash: dto.txHash,
    });
  }

  /**
   * Retrieves the historical audit trail for feature flag mutations.
   * The `endpoint` filter is fixed to {@link FEATURE_FLAG_ENDPOINT}.
   */
  async queryFeatureFlagChanges(
    query: Omit<QueryAuditLogsDto, 'endpoint'>,
  ): Promise<{ data: AdminBlockchainAuditLog[]; total: number }> {
    return this.query({ ...query, endpoint: FEATURE_FLAG_ENDPOINT });
  }
}
