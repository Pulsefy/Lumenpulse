import { SetMetadata } from '@nestjs/common';

/**
 * Metadata key for blockchain audit decoration.
 */
export const BLOCKCHAIN_AUDIT_KEY = 'blockchain_audit_metadata';

/**
 * Configuration for blockchain audit logging.
 */
export interface BlockchainAuditConfig {
  /**
   * Target contract name (e.g., "matching_pool", "treasury", "registry").
   * Used to categorize and filter audit logs.
   */
  targetContract: string;

  /**
   * Soroban contract function name being called
   * (e.g., "create_round", "allocate_budget").
   */
  functionName: string;

  /**
   * Human-readable description of the action
   * (e.g., "Create a new matching round with specified funds").
   */
  description?: string;

  /**
   * Keys in the request body to extract and include in the audit log.
   * Set to ['*'] to include all non-sensitive keys.
   * Defaults to extracting all keys except sensitive ones.
   */
  paramsToLog?: string[];

  /**
   * Whether to extract transaction hash from response.
   * If true, the interceptor will look for txHash or hash in response.
   * Defaults to true.
   */
  extractTxHash?: boolean;
}

/**
 * Decorator to mark endpoints that perform blockchain admin actions.
 * When applied, the BlockchainAuditInterceptor will automatically
 * capture and persist audit trail data.
 *
 * @example
 * ```typescript
 * @Post('rounds')
 * @BlockchainAudit({
 *   targetContract: 'matching_pool',
 *   functionName: 'create_round',
 *   description: 'Create a new matching round',
 *   paramsToLog: ['name', 'matchingFunds'],
 * })
 * async createRound(@Body() dto: CreateRoundDto): Promise<RoundResponseDto> {
 *   // ...
 * }
 * ```
 */
export const BlockchainAudit = (config: BlockchainAuditConfig) =>
  SetMetadata(BLOCKCHAIN_AUDIT_KEY, config);
