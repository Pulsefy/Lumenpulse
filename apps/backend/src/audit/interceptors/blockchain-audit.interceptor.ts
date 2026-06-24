import {
  Injectable,
  NestInterceptor,
  ExecutionContext,
  CallHandler,
  Logger,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { Observable } from 'rxjs';
import { tap, catchError } from 'rxjs/operators';
import {
  BLOCKCHAIN_AUDIT_KEY,
  BlockchainAuditConfig,
} from '../decorators/blockchain-audit.decorator';
import { BlockchainAuditService } from '../blockchain-audit.service';
import { config } from '../../lib/config';

interface RequestWithUser {
  headers: Record<string, string | string[] | undefined>;
  ip?: string;
  connection?: { remoteAddress?: string };
  body?: Record<string, unknown>;
  user?: { id?: string; sub?: string; email?: string };
  method?: string;
  path?: string;
  url?: string;
}

/**
 * Interceptor that automatically captures and persists audit logs
 * for blockchain admin actions marked with @BlockchainAudit().
 *
 * Captures:
 * - Who (actor ID and display name)
 * - What (endpoint, contract, function, and sanitized parameters)
 * - Where (IP address)
 * - When (timestamp)
 * - Proof (transaction hash, ledger sequence, status)
 */
@Injectable()
export class BlockchainAuditInterceptor implements NestInterceptor {
  private readonly logger = new Logger(BlockchainAuditInterceptor.name);

  constructor(
    private readonly reflector: Reflector,
    private readonly blockchainAuditService: BlockchainAuditService,
  ) {}

  intercept(context: ExecutionContext, next: CallHandler): Observable<any> {
    const auditConfig = this.reflector.get<BlockchainAuditConfig>(
      BLOCKCHAIN_AUDIT_KEY,
      context.getHandler(),
    );

    // Skip if no audit config is present
    if (!auditConfig) {
      return next.handle();
    }

    const request = context.switchToHttp().getRequest<RequestWithUser>();
    const httpMethod = request.method || 'UNKNOWN';
    const endpoint = request.path || request.url || 'UNKNOWN';

    // Extract actor information
    const actorId = request.user?.id || request.user?.sub || 'unknown';
    const actorDisplay =
      request.user?.email || request.user?.id || 'unknown-actor';

    // Extract client IP
    const ipAddress = this.extractClientIp(request);

    // Extract and sanitize params
    const requestBody = request.body || {};
    const paramsSummary = this.extractParams(
      requestBody,
      auditConfig.paramsToLog,
    );

    return next.handle().pipe(
      tap((response: unknown) => {
        // Log successfully completed blockchain action
        void this.logBlockchainAction(
          {
            actorId,
            actorDisplay,
            endpoint,
            httpMethod,
            targetContract: auditConfig.targetContract,
            functionName: auditConfig.functionName,
            contractAddress: this.getContractAddress(
              auditConfig.targetContract,
            ),
            paramsSummary,
            actionDescription: auditConfig.description,
            ipAddress,
          },
          response,
          null,
        );
      }),
      catchError((error: Error) => {
        // Log failed blockchain action
        void this.logBlockchainAction(
          {
            actorId,
            actorDisplay,
            endpoint,
            httpMethod,
            targetContract: auditConfig.targetContract,
            functionName: auditConfig.functionName,
            contractAddress: this.getContractAddress(
              auditConfig.targetContract,
            ),
            paramsSummary,
            actionDescription: auditConfig.description,
            ipAddress,
          },
          null,
          error,
        );

        throw error;
      }),
    );
  }

  /**
   * Logs blockchain action asynchronously.
   */
  private async logBlockchainAction(
    baseData: {
      actorId: string;
      actorDisplay: string;
      endpoint: string;
      httpMethod: string;
      targetContract: string;
      functionName: string;
      contractAddress: string;
      paramsSummary: Record<string, any> | null;
      actionDescription?: string;
      ipAddress: string | null;
    },
    response: unknown,
    error: Error | null,
  ): Promise<void> {
    try {
      const txHash = this.extractTxHash(response) || 'pending';
      const ledgerSeq = this.extractLedgerSeq(response);
      const txStatus = error ? 'failed' : 'success';
      const errorMessage = error ? error.message : null;

      await this.blockchainAuditService.log({
        ...baseData,
        txHash,
        txStatus,
        ledgerSeq,
        errorMessage,
      });
    } catch (logError) {
      this.logger.error(
        {
          error: logError instanceof Error ? logError.message : String(logError),
          endpoint: baseData.endpoint,
          actor: baseData.actorDisplay,
        },
        'Failed to log blockchain audit action',
      );
    }
  }

  /**
   * Extracts transaction hash from response.
   * Looks for common field names: txHash, hash, transactionHash.
   */
  private extractTxHash(response: unknown): string | null {
    if (!response || typeof response !== 'object') {
      return null;
    }

    const obj = response as Record<string, any>;

    // Check common field names
    const hashFields = ['txHash', 'hash', 'transactionHash', 'tx_hash'];
    for (const field of hashFields) {
      if (field in obj && typeof obj[field] === 'string') {
        return obj[field];
      }
    }

    return null;
  }

  /**
   * Extracts ledger sequence from response.
   * Looks for common field names: ledger, ledgerSeq, ledgerSequence.
   */
  private extractLedgerSeq(response: unknown): number | null {
    if (!response || typeof response !== 'object') {
      return null;
    }

    const obj = response as Record<string, any>;

    // Check common field names
    const ledgerFields = ['ledger', 'ledgerSeq', 'ledgerSequence', 'ledger_seq'];
    for (const field of ledgerFields) {
      if (field in obj) {
        const value = obj[field];
        if (typeof value === 'number') {
          return value;
        }
        if (typeof value === 'string') {
          const parsed = parseInt(value, 10);
          if (!isNaN(parsed)) {
            return parsed;
          }
        }
      }
    }

    return null;
  }

  /**
   * Extracts client IP address from request.
   * Checks x-forwarded-for header first, then falls back to direct connection.
   */
  private extractClientIp(request: RequestWithUser): string | null {
    const xForwardedFor = request.headers['x-forwarded-for'];
    if (typeof xForwardedFor === 'string') {
      return xForwardedFor.split(',')[0].trim();
    }
    if (Array.isArray(xForwardedFor) && xForwardedFor.length > 0) {
      return xForwardedFor[0].split(',')[0].trim();
    }
    return request.ip || request.connection?.remoteAddress || null;
  }

  /**
   * Extracts specified parameters from request body.
   * If paramsToLog is ['*'], includes all keys except sensitive ones.
   * Otherwise, includes only specified keys.
   */
  private extractParams(
    body: Record<string, any>,
    paramsToLog?: string[],
  ): Record<string, any> | null {
    if (!body || Object.keys(body).length === 0) {
      return null;
    }

    const sensitiveKeys = [
      'password',
      'secret',
      'privateKey',
      'token',
      'apiKey',
      'signingKey',
    ];

    let keysToInclude: string[];

    if (!paramsToLog || paramsToLog.length === 0) {
      // Default: include all keys except sensitive ones
      keysToInclude = Object.keys(body).filter(
        (key) =>
          !sensitiveKeys.some((sensitive) =>
            key.toLowerCase().includes(sensitive.toLowerCase()),
          ),
      );
    } else if (paramsToLog.includes('*')) {
      // Include all keys
      keysToInclude = Object.keys(body);
    } else {
      // Include only specified keys
      keysToInclude = paramsToLog.filter((key) => key in body);
    }

    const extracted: Record<string, any> = {};
    for (const key of keysToInclude) {
      extracted[key] = body[key];
    }

    return Object.keys(extracted).length > 0 ? extracted : null;
  }

  /**
   * Gets the Soroban contract address for a contract name.
   */
  private getContractAddress(contractName: string): string {
    const contractMap: Record<string, string | null> = {
      matching_pool: config.stellar.contracts.matchingPool,
      matchingPool: config.stellar.contracts.matchingPool,
      treasury: config.stellar.contracts.treasury,
      registry: config.stellar.contracts.projectRegistry,
      projectRegistry: config.stellar.contracts.projectRegistry,
    };

    const address = contractMap[contractName];
    return (address && typeof address === 'string') ? address : 'unknown';
  }
}
