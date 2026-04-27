import { registerAs } from '@nestjs/config';
import { config } from '../../lib/config';

export interface StellarConfig {
  horizonUrl: string;
  network: 'testnet' | 'mainnet';
  timeout: number;
  retryAttempts: number;
  retryDelay: number;
}

export default registerAs('stellar', (): StellarConfig => {
  return {
    horizonUrl: config.stellar.horizonUrl,
    network: config.stellar.network,
    timeout: config.stellar.timeout,
    retryAttempts: config.stellar.retryAttempts,
    retryDelay: config.stellar.retryDelay,
  };
});
