
export interface SorobanRpcConfig {
  rpcUrl: string;
  timeoutMs: number;
  maxAttempts: number;
  baseDelayMs: number;
  maxDelayMs: number;
}

/** NestJS injection token for the config object. */
export const SOROBAN_RPC_CONFIG = Symbol('SOROBAN_RPC_CONFIG');