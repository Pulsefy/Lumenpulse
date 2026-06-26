import Constants from 'expo-constants';

/**
 * Application Configuration
 * Centralized place for all environment variables and config
 */

export type AppEnvironment = 'testnet' | 'mainnet';

export interface EnvironmentConfig {
  id: AppEnvironment;
  label: string;
  apiBaseUrl: string;
  stellarNetwork: AppEnvironment;
  sorobanRpcUrl: string;
  crowdfundContractId: string;
  explorerNetwork: 'testnet' | 'public';
}

const sharedApiBaseUrl =
  process.env.EXPO_PUBLIC_API_URL ||
  Constants.expoConfig?.extra?.backendUrl ||
  'http://localhost:3000';

export const environmentConfigs: Record<AppEnvironment, EnvironmentConfig> = {
  testnet: {
    id: 'testnet',
    label: 'Testnet',
    apiBaseUrl: process.env.EXPO_PUBLIC_TESTNET_API_URL || sharedApiBaseUrl,
    stellarNetwork: 'testnet',
    sorobanRpcUrl:
      process.env.EXPO_PUBLIC_TESTNET_SOROBAN_RPC_URL ||
      process.env.EXPO_PUBLIC_SOROBAN_RPC_URL ||
      'https://soroban-testnet.stellar.org',
    crowdfundContractId:
      process.env.EXPO_PUBLIC_TESTNET_CROWDFUND_CONTRACT_ID ||
      process.env.EXPO_PUBLIC_CROWDFUND_CONTRACT_ID ||
      '',
    explorerNetwork: 'testnet',
  },
  mainnet: {
    id: 'mainnet',
    label: 'Mainnet',
    apiBaseUrl: process.env.EXPO_PUBLIC_MAINNET_API_URL || '',
    stellarNetwork: 'mainnet',
    sorobanRpcUrl: process.env.EXPO_PUBLIC_MAINNET_SOROBAN_RPC_URL || '',
    crowdfundContractId: process.env.EXPO_PUBLIC_MAINNET_CROWDFUND_CONTRACT_ID || '',
    explorerNetwork: 'public',
  },
};

let activeEnvironment: AppEnvironment = 'testnet';

export function getActiveEnvironment(): AppEnvironment {
  return activeEnvironment;
}

export function setActiveEnvironment(environment: AppEnvironment): void {
  activeEnvironment = environment;
}

export function getEnvironmentConfig(environment = activeEnvironment): EnvironmentConfig {
  return environmentConfigs[environment];
}

export const config = {
  /**
   * API Configuration
   */
  api: {
    baseUrl: environmentConfigs.testnet.apiBaseUrl,
    timeout: 30000, // 30 seconds
  },

  /**
   * Stellar / Soroban Configuration
   */
  stellar: {
    network: environmentConfigs.testnet.stellarNetwork,
    sorobanRpcUrl: environmentConfigs.testnet.sorobanRpcUrl,
    crowdfundContractId: environmentConfigs.testnet.crowdfundContractId,
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
