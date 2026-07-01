import { SetMetadata } from '@nestjs/common';

export const AUDIT_BLOCKCHAIN_KEY = 'audit_blockchain_action';

export interface AuditBlockchainMeta {
  /**
   * Which field in the request body or params holds the contract address.
   * e.g. 'tokenAddress', 'contractId', 'roundId'
   */
  contractField?: string;
  /**
   * Which field in the response object holds the transaction hash.
   * e.g. 'txHash', 'transactionHash'
   */
  txHashField?: string;
}

/**
 * Mark an admin controller method for blockchain audit trail persistence.
 *
 * @example
 * @AuditBlockchainAction({ contractField: 'tokenAddress', txHashField: 'txHash' })
 * @Post('rounds')
 * createRound(@Body() dto: CreateRoundDto) { ... }
 */
export const AuditBlockchainAction = (meta: AuditBlockchainMeta = {}) =>
  SetMetadata(AUDIT_BLOCKCHAIN_KEY, meta);
