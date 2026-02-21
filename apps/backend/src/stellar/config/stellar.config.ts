import { registerAs } from '@nestjs/config';

export interface StellarConfig {
  horizonUrl: string;
  network: 'testnet' | 'mainnet';
  timeout: number;
  retryAttempts: number;
  retryDelay: number;
}

export default registerAs('stellar', (): StellarConfig => {
  const network = (process.env.STELLAR_NETWORK || 'testnet') as
    | 'testnet'
    | 'mainnet';

  const defaultHorizonUrls = {
    testnet: 'https://horizon-testnet.stellar.org',
    mainnet: 'https://horizon.stellar.org',
  };

  return {
    horizonUrl: process.env.STELLAR_HORIZON_URL || defaultHorizonUrls[network],
    network,
    timeout: parseInt(process.env.STELLAR_TIMEOUT || '30000', 10),
    retryAttempts: parseInt(process.env.STELLAR_RETRY_ATTEMPTS || '3', 10),
    retryDelay: parseInt(process.env.STELLAR_RETRY_DELAY || '1000', 10),
  };
});
