import { registerAs } from '@nestjs/config';
import { config } from '../../lib/config';

const DEFAULT_SOROBAN_RPC_URLS = {
  testnet: 'https://soroban-testnet.stellar.org',
  mainnet: 'https://soroban.stellar.org',
} as const;

export interface StellarConfig {
  horizonUrl: string;
  network: 'testnet' | 'mainnet';
  timeout: number;
  retryAttempts: number;
  retryDelay: number;
  balanceCacheTTL: number;
  operationsCacheTTL: number;
  sorobanRpcUrl: string | null;
  serverSecret: ReturnType<typeof config.stellar.serverSecret.reveal>;
}

export default registerAs('stellar', (): StellarConfig => {
  return {
    horizonUrl: config.stellar.horizonUrl,
    network: config.stellar.network,
    timeout: config.stellar.timeout,
    retryAttempts: config.stellar.retryAttempts,
    retryDelay: config.stellar.retryDelay,
    balanceCacheTTL: config.stellar.balanceCacheTTL,
    operationsCacheTTL: config.stellar.operationsCacheTTL,
    sorobanRpcUrl:
      config.stellar.sorobanRpcUrl ??
      DEFAULT_SOROBAN_RPC_URLS[config.stellar.network],
    serverSecret: config.stellar.serverSecret.reveal(),
  };
});
