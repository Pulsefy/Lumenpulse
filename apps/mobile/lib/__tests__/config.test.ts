import {
  getActiveEnvironment,
  getEnvironmentConfig,
  setActiveEnvironment,
  validateEnvironmentConfig,
  config,
  environmentConfigs,
} from '../config';

describe('config', () => {
  it('has a default testnet environment', () => {
    expect(getActiveEnvironment()).toBe('testnet');
    expect(getEnvironmentConfig().stellarNetwork).toBe('testnet');
  });

  it('allows switching the active environment', () => {
    setActiveEnvironment('mainnet');
    expect(getActiveEnvironment()).toBe('mainnet');
    expect(getEnvironmentConfig().explorerNetwork).toBe('public');

    setActiveEnvironment('testnet');
  });

  describe('validateEnvironmentConfig', () => {
    // Save original __DEV__ value
    const originalDev = (global as any).__DEV__;

    afterEach(() => {
      // Restore original __DEV__ value
      Object.defineProperty(global, '__DEV__', {
        configurable: true,
        writable: true,
        value: originalDev,
      });
    });

    it('does not throw in development mode', () => {
      // Set __DEV__ to true (development mode)
      Object.defineProperty(global, '__DEV__', {
        configurable: true,
        writable: true,
        value: true,
      });

      // Should not throw even if config is invalid in dev
      expect(() => validateEnvironmentConfig()).not.toThrow();
    });

    it('checks mainnet API URL is set (not empty or localhost) in production', () => {
      // Set __DEV__ to false (production mode)
      Object.defineProperty(global, '__DEV__', {
        configurable: true,
        writable: true,
        value: false,
      });

      // Override config.isProduction to simulate production
      const originalIsProduction = config.isProduction;
      Object.defineProperty(config, 'isProduction', {
        configurable: true,
        get: () => true,
      });

      // Get the current mainnet config
      const mainnetConfig = getEnvironmentConfig('mainnet');

      // If mainnet API URL is not set or is localhost, validation should throw
      if (!mainnetConfig.apiBaseUrl || mainnetConfig.apiBaseUrl.includes('localhost')) {
        expect(() => validateEnvironmentConfig()).toThrow(
          /Mainnet API URL is not properly configured/,
        );
      } else {
        // If properly configured, should not throw
        expect(() => validateEnvironmentConfig()).not.toThrow();
      }
    });

    it('checks mainnet Soroban RPC URL is set (not empty or localhost) in production', () => {
      // Set __DEV__ to false (production mode)
      Object.defineProperty(global, '__DEV__', {
        configurable: true,
        writable: true,
        value: false,
      });

      // Override config.isProduction to simulate production
      const originalIsProduction = config.isProduction;
      Object.defineProperty(config, 'isProduction', {
        configurable: true,
        get: () => true,
      });

      // Ensure mainnet API URL passes validation first so we can test the Soroban check in isolation
      const originalMainnetApiBaseUrl = environmentConfigs.mainnet.apiBaseUrl;
      Object.defineProperty(environmentConfigs.mainnet, 'apiBaseUrl', {
        configurable: true,
        writable: true,
        value: 'https://api.lumenpulse.example.com',
      });

      // Get the current mainnet config
      const mainnetConfig = getEnvironmentConfig('mainnet');

      try {
        // If mainnet Soroban RPC URL is not set or is localhost, validation should throw
        if (!mainnetConfig.sorobanRpcUrl || mainnetConfig.sorobanRpcUrl.includes('localhost')) {
          expect(() => validateEnvironmentConfig()).toThrow(
            /Mainnet Soroban RPC URL is not properly configured/,
          );
        } else {
          // If properly configured, should not throw
          expect(() => validateEnvironmentConfig()).not.toThrow();
        }
      } finally {
        Object.defineProperty(environmentConfigs.mainnet, 'apiBaseUrl', {
          configurable: true,
          writable: true,
          value: originalMainnetApiBaseUrl,
        });
      }
    });

    it('detects testnet defaulting to localhost in production', () => {
      // Set __DEV__ to false (production mode)
      Object.defineProperty(global, '__DEV__', {
        configurable: true,
        writable: true,
        value: false,
      });

      // Override config.isProduction to simulate production
      const originalIsProduction = config.isProduction;
      Object.defineProperty(config, 'isProduction', {
        configurable: true,
        get: () => true,
      });

      // Ensure both mainnet checks pass first so we can test the testnet-localhost check in isolation
      const originalMainnetApiBaseUrl = environmentConfigs.mainnet.apiBaseUrl;
      const originalMainnetSorobanRpcUrl = environmentConfigs.mainnet.sorobanRpcUrl;
      Object.defineProperty(environmentConfigs.mainnet, 'apiBaseUrl', {
        configurable: true,
        writable: true,
        value: 'https://api.lumenpulse.example.com',
      });
      Object.defineProperty(environmentConfigs.mainnet, 'sorobanRpcUrl', {
        configurable: true,
        writable: true,
        value: 'https://soroban-rpc.example.com',
      });

      // Get the current testnet config
      const testnetConfig = getEnvironmentConfig('testnet');

      try {
        // If testnet API URL defaulted to localhost, validation should throw
        if (testnetConfig.apiBaseUrl === 'http://localhost:3000') {
          expect(() => validateEnvironmentConfig()).toThrow(
            /Testnet API URL defaulted to localhost/,
          );
        }
      } finally {
        Object.defineProperty(environmentConfigs.mainnet, 'apiBaseUrl', {
          configurable: true,
          writable: true,
          value: originalMainnetApiBaseUrl,
        });
        Object.defineProperty(environmentConfigs.mainnet, 'sorobanRpcUrl', {
          configurable: true,
          writable: true,
          value: originalMainnetSorobanRpcUrl,
        });
      }
    });
  });
});
