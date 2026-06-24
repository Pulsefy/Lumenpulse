import { Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository, FindOptionsOrder } from 'typeorm';
import { BlockchainAuditLog } from './entities/blockchain-audit-log.entity';

export interface CreateBlockchainAuditLogDto {
  actorId: string;
  actorDisplay: string;
  endpoint: string;
  httpMethod: string;
  targetContract: string;
  functionName: string;
  contractAddress: string;
  paramsSummary?: Record<string, any> | null;
  txHash: string;
  txStatus: 'pending' | 'success' | 'failed';
  ledgerSeq?: number | null;
  actionDescription?: string | null;
  ipAddress?: string | null;
  errorMessage?: string | null;
}

export interface BlockchainAuditQueryOptions {
  limit?: number;
  offset?: number;
  actorId?: string;
  targetContract?: string;
  txStatus?: string;
  startDate?: Date;
  endDate?: Date;
  sortBy?: 'createdAt' | 'txHash' | 'targetContract';
  sortOrder?: 'ASC' | 'DESC';
}

/**
 * Service for persisting and querying blockchain admin audit logs.
 * Handles:
 * - Redaction of sensitive data before persistence
 * - Flexible querying for compliance and investigation
 * - Audit trail for all blockchain-triggered actions
 */
@Injectable()
export class BlockchainAuditService {
  private readonly logger = new Logger(BlockchainAuditService.name);

  private readonly SENSITIVE_KEYS = [
    'secret',
    'privateKey',
    'password',
    'token',
    'apiKey',
    'signingKey',
  ];

  constructor(
    @InjectRepository(BlockchainAuditLog)
    private readonly auditLogRepo: Repository<BlockchainAuditLog>,
  ) {}

  /**
   * Creates and persists a blockchain audit log entry.
   * Automatically redacts sensitive data from paramsSummary.
   */
  async log(dto: CreateBlockchainAuditLogDto): Promise<BlockchainAuditLog> {
    const redactedParams = this.redactSensitiveData(dto.paramsSummary);

    const auditLog = this.auditLogRepo.create({
      actorId: dto.actorId,
      actorDisplay: dto.actorDisplay,
      endpoint: dto.endpoint,
      httpMethod: dto.httpMethod,
      targetContract: dto.targetContract,
      functionName: dto.functionName,
      contractAddress: dto.contractAddress,
      paramsSummary: redactedParams,
      txHash: dto.txHash,
      txStatus: dto.txStatus,
      ledgerSeq: dto.ledgerSeq ?? null,
      actionDescription: dto.actionDescription ?? null,
      ipAddress: dto.ipAddress ?? null,
      errorMessage: dto.errorMessage ?? null,
    });

    const saved = await this.auditLogRepo.save(auditLog);

    this.logger.log(
      {
        id: saved.id,
        actor: dto.actorDisplay,
        action: `${dto.httpMethod} ${dto.endpoint}`,
        contract: dto.targetContract,
        txHash: dto.txHash,
      },
      'Blockchain audit logged',
    );

    return saved;
  }

  /**
   * Queries audit logs with optional filters.
   * Returns paginated results sorted by creation date or other fields.
   */
  async query(
    options: BlockchainAuditQueryOptions,
  ): Promise<[BlockchainAuditLog[], number]> {
    const {
      limit = 50,
      offset = 0,
      actorId,
      targetContract,
      txStatus,
      startDate,
      endDate,
      sortBy = 'createdAt',
      sortOrder = 'DESC',
    } = options;

    const query = this.auditLogRepo.createQueryBuilder('log');

    if (actorId) {
      query.andWhere('log.actorId = :actorId', { actorId });
    }

    if (targetContract) {
      query.andWhere('log.targetContract = :targetContract', {
        targetContract,
      });
    }

    if (txStatus) {
      query.andWhere('log.txStatus = :txStatus', { txStatus });
    }

    if (startDate) {
      query.andWhere('log.createdAt >= :startDate', { startDate });
    }

    if (endDate) {
      query.andWhere('log.createdAt <= :endDate', { endDate });
    }

    const orderByMap: Record<
      string,
      FindOptionsOrder<BlockchainAuditLog>
    > = {
      createdAt: { createdAt: sortOrder },
      txHash: { txHash: sortOrder },
      targetContract: { targetContract: sortOrder },
    };

    const orderBy = orderByMap[sortBy] || { createdAt: sortOrder };
    query.orderBy(orderBy);

    query.skip(offset).take(limit);

    return query.getManyAndCount();
  }

  /**
   * Finds a single audit log by ID.
   */
  async findById(id: string): Promise<BlockchainAuditLog | null> {
    return this.auditLogRepo.findOne({ where: { id } });
  }

  /**
   * Finds all audit logs for a specific transaction hash.
   */
  async findByTxHash(txHash: string): Promise<BlockchainAuditLog[]> {
    return this.auditLogRepo.find({
      where: { txHash },
      order: { createdAt: 'DESC' },
    });
  }

  /**
   * Finds all audit logs for a specific actor.
   */
  async findByActor(actorId: string, limit = 50): Promise<BlockchainAuditLog[]> {
    return this.auditLogRepo.find({
      where: { actorId },
      order: { createdAt: 'DESC' },
      take: limit,
    });
  }

  /**
   * Finds all audit logs for a specific contract.
   */
  async findByContract(
    targetContract: string,
    limit = 50,
  ): Promise<BlockchainAuditLog[]> {
    return this.auditLogRepo.find({
      where: { targetContract },
      order: { createdAt: 'DESC' },
      take: limit,
    });
  }

  /**
   * Redacts sensitive data from params before persistence.
   * Recursively processes nested objects and arrays.
   */
  private redactSensitiveData(
    obj: Record<string, any> | null | undefined,
  ): Record<string, any> | null {
    if (!obj) return null;

    const redacted = { ...obj };

    for (const key of Object.keys(redacted)) {
      const value = redacted[key];

      // Check if key matches sensitive pattern
      const isSensitiveKey = this.SENSITIVE_KEYS.some((sensitive) =>
        key.toLowerCase().includes(sensitive.toLowerCase()),
      );

      if (isSensitiveKey) {
        redacted[key] = '[REDACTED]';
      } else if (typeof value === 'object' && value !== null) {
        if (Array.isArray(value)) {
          // Recursively process arrays
          redacted[key] = value.map((item) =>
            typeof item === 'object' ? this.redactSensitiveData(item) : item,
          );
        } else {
          // Recursively process nested objects
          redacted[key] = this.redactSensitiveData(value);
        }
      }
    }

    return redacted;
  }

  /**
   * Deletes old audit logs (older than specified days).
   * Useful for retention policies.
   */
  async deleteOlderThan(daysOld: number): Promise<number> {
    const cutoffDate = new Date();
    cutoffDate.setDate(cutoffDate.getDate() - daysOld);

    const result = await this.auditLogRepo.delete({
      createdAt: this.auditLogRepo.manager
        .getRepository(BlockchainAuditLog)
        .createQueryBuilder()
        .where('createdAt < :cutoff', { cutoff: cutoffDate })
        .getQuery() as any,
    });

    this.logger.log(
      { daysOld, deletedCount: result.affected },
      'Deleted old blockchain audit logs',
    );

    return result.affected || 0;
  }
}
