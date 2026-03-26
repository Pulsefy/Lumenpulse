import Constants from 'expo-constants';

/**
 * Application Configuration
 * Centralized place for all environment variables and config
 */

export const config = {
  /**
   * API Configuration
   */
  api: {
    baseUrl:
      process.env.EXPO_PUBLIC_API_URL ||
      Constants.expoConfig?.extra?.backendUrl ||
      'http://localhost:3000',
    timeout: 30000, // 30 seconds
  },

  /**
   * Stellar / Soroban Configuration
   */
  stellar: {
    network: process.env.EXPO_PUBLIC_STELLAR_NETWORK || 'testnet',
    sorobanRpcUrl: process.env.EXPO_PUBLIC_SOROBAN_RPC_URL || 'https://soroban-testnet.stellar.org',
    crowdfundContractId: process.env.EXPO_PUBLIC_CROWDFUND_CONTRACT_ID || '',
    explorerUrl: process.env.EXPO_PUBLIC_STELLAR_EXPLORER_URL || 'https://stellar.expert/explorer',
  },

  /**
   * App Configuration
   */
  app: {
    variant: process.env.EXPO_PUBLIC_APP_VARIANT || 'development',
    name: Constants.expoConfig?.name || 'Lumenpulse',
    version: Constants.expoConfig?.version || '1.0.0',
  },

  /**
   * Environment helpers
   */
  isDevelopment: process.env.EXPO_PUBLIC_APP_VARIANT === 'development',
  isProduction: process.env.EXPO_PUBLIC_APP_VARIANT === 'production',
} as const;

export default config;
