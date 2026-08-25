import { Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { AdminBlockchainAuditLog } from '../admin-audit/entities/admin-blockchain-audit-log.entity';
import { Request } from 'express';

export interface BlockchainAuditContext {
  actorId: string;
  actorEmail?: string;
  endpoint: string;
  targetContract?: string;
  paramsSummary: Record<string, unknown>;
  txHash?: string;
  responseStatus: number;
}

// Define error type for safe error handling
interface ErrorWithMessage {
  message: string;
  stack?: string;
}

@Injectable()
export class ContractAdminAuditService {
  private readonly logger = new Logger(ContractAdminAuditService.name);

  constructor(
    @InjectRepository(AdminBlockchainAuditLog)
    private readonly auditLogRepository: Repository<AdminBlockchainAuditLog>,
  ) {}

  /**
   * Log a blockchain admin operation with full context
   */
  async logBlockchainOperation(
    context: BlockchainAuditContext,
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    _request?: Request,
  ): Promise<void> {
    try {
      const auditLog = this.auditLogRepository.create({
        actorId: context.actorId,
        actorEmail: context.actorEmail || null,
        endpoint: context.endpoint,
        targetContract: context.targetContract || null,
        paramsSummary: context.paramsSummary,
        txHash: context.txHash || null,
        responseStatus: context.responseStatus,
      });

      await this.auditLogRepository.save(auditLog);

      this.logger.log(
        `Blockchain admin operation logged: ${context.endpoint} by actor ${context.actorId} ` +
          `- Status: ${context.responseStatus}`,
        {
          actorId: context.actorId,
          endpoint: context.endpoint,
          targetContract: context.targetContract,
          responseStatus: context.responseStatus,
          txHash: context.txHash,
        },
      );
    } catch (error) {
      const err = error as ErrorWithMessage;
      // Don't fail the main operation if logging fails
      this.logger.error(
        `Failed to log blockchain admin operation: ${err.message}`,
        {
          context,
          error: err.stack,
        },
      );
    }
  }

  /**
   * Log unauthorized access attempt
   */
  async logUnauthorizedAttempt(
    actorId: string,
    endpoint: string,
    request: Request,
    reason: string,
  ): Promise<void> {
    try {
      const auditLog = this.auditLogRepository.create({
        actorId: actorId || 'anonymous',
        actorEmail: null,
        endpoint: `UNAUTHORIZED_${endpoint}`,
        targetContract: null,
        paramsSummary: {
          path: request.path,
          method: request.method,
          query: request.query,
          reason,
        },
        txHash: null,
        responseStatus: 403,
      });

      await this.auditLogRepository.save(auditLog);

      this.logger.warn(
        `Unauthorized blockchain admin attempt logged: ${endpoint} by actor ${actorId || 'anonymous'} - Reason: ${reason}`,
      );
    } catch (error) {
      const err = error as ErrorWithMessage;
      this.logger.error(`Failed to log unauthorized attempt: ${err.message}`);
    }
  }
}
