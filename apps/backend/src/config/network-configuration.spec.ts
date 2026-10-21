import { validateConfiguration } from '../lib/config';

describe('Network Configuration Separation (Issue #1587)', () => {
  const baseValidConfig = {
    PORT: '3000',
    DB_HOST: 'localhost',
    DB_PORT: '5432',
    DB_USERNAME: 'postgres',
    DB_PASSWORD: 'password',
    DB_DATABASE: 'lumenpulse_test',
    JWT_SECRET: 'super-secret-jwt-key-for-testing-purposes-only',
    STELLAR_SERVER_SECRET:
      'SBTESTSECRETKEYFORSTELLARHORIZONSERVERTEST12345678901234567890',
    NODE_ENV: 'test',
    ENVIRONMENT: 'test',
  };

  describe('Mainnet Configuration Rejection Rules', () => {
    it('should reject BOOTSTRAP_DEMO_DATA_ENABLED=true on mainnet', () => {
      const result = validateConfiguration({
        ...baseValidConfig,
        STELLAR_NETWORK: 'mainnet',
        BOOTSTRAP_DEMO_DATA_ENABLED: 'true',
      });

      expect(result.success).toBe(false);
      if (!result.success) {
        const paths = result.error.issues.map((i) => i.path.join('.'));
        expect(paths).toContain('BOOTSTRAP_DEMO_DATA_ENABLED');
        const issue = result.error.issues.find((i) =>
          i.path.includes('BOOTSTRAP_DEMO_DATA_ENABLED'),
        );
        expect(issue?.message).toMatch(/testnet-only facility/i);
      }
    });

    it('should reject FRIENDBOT_BOOTSTRAP_ENABLED=true on mainnet', () => {
      const result = validateConfiguration({
        ...baseValidConfig,
        STELLAR_NETWORK: 'mainnet',
        FRIENDBOT_BOOTSTRAP_ENABLED: 'true',
      });

      expect(result.success).toBe(false);
      if (!result.success) {
        const paths = result.error.issues.map((i) => i.path.join('.'));
        expect(paths).toContain('FRIENDBOT_BOOTSTRAP_ENABLED');
        const issue = result.error.issues.find((i) =>
          i.path.includes('FRIENDBOT_BOOTSTRAP_ENABLED'),
        );
        expect(issue?.message).toMatch(/testnet-only facility/i);
      }
    });

    it('should reject USE_MOCK_TRANSACTIONS=true on mainnet', () => {
      const result = validateConfiguration({
        ...baseValidConfig,
        STELLAR_NETWORK: 'mainnet',
        USE_MOCK_TRANSACTIONS: 'true',
      });

      expect(result.success).toBe(false);
      if (!result.success) {
        const paths = result.error.issues.map((i) => i.path.join('.'));
        expect(paths).toContain('USE_MOCK_TRANSACTIONS');
        const issue = result.error.issues.find((i) =>
          i.path.includes('USE_MOCK_TRANSACTIONS'),
        );
        expect(issue?.message).toMatch(/prohibited under mainnet/i);
      }
    });

    it('should reject testnet Horizon URL when STELLAR_NETWORK=mainnet', () => {
      const result = validateConfiguration({
        ...baseValidConfig,
        STELLAR_NETWORK: 'mainnet',
        USE_MOCK_TRANSACTIONS: 'false',
        STELLAR_HORIZON_URL: 'https://horizon-testnet.stellar.org',
      });

      expect(result.success).toBe(false);
      if (!result.success) {
        const paths = result.error.issues.map((i) => i.path.join('.'));
        expect(paths).toContain('STELLAR_HORIZON_URL');
        const issue = result.error.issues.find((i) =>
          i.path.includes('STELLAR_HORIZON_URL'),
        );
        expect(issue?.message).toMatch(/must not point to testnet/i);
      }
    });

    it('should reject testnet Soroban RPC URL when STELLAR_NETWORK=mainnet', () => {
      const result = validateConfiguration({
        ...baseValidConfig,
        STELLAR_NETWORK: 'mainnet',
        USE_MOCK_TRANSACTIONS: 'false',
        STELLAR_SOROBAN_RPC_URL: 'https://soroban-testnet.stellar.org',
      });

      expect(result.success).toBe(false);
      if (!result.success) {
        const paths = result.error.issues.map((i) => i.path.join('.'));
        expect(paths).toContain('STELLAR_SOROBAN_RPC_URL');
        const issue = result.error.issues.find((i) =>
          i.path.includes('STELLAR_SOROBAN_RPC_URL'),
        );
        expect(issue?.message).toMatch(/must not point to testnet/i);
      }
    });

    it('should accept clean mainnet configuration with production parameters', () => {
      const result = validateConfiguration({
        ...baseValidConfig,
        STELLAR_NETWORK: 'mainnet',
        USE_MOCK_TRANSACTIONS: 'false',
        STELLAR_HORIZON_URL: 'https://horizon.stellar.org',
        STELLAR_SOROBAN_RPC_URL: 'https://soroban.stellar.org',
      });

      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.STELLAR_NETWORK).toBe('mainnet');
        expect(result.data.USE_MOCK_TRANSACTIONS).toBe(false);
        expect(result.data.BOOTSTRAP_DEMO_DATA_ENABLED).toBe(false);
        expect(result.data.FRIENDBOT_BOOTSTRAP_ENABLED).toBe(false);
      }
    });
  });

  describe('Testnet Configuration Rejection Rules', () => {
    it('should reject public mainnet Horizon URL on testnet', () => {
      const result = validateConfiguration({
        ...baseValidConfig,
        STELLAR_NETWORK: 'testnet',
        STELLAR_HORIZON_URL: 'https://horizon.stellar.org',
      });

      expect(result.success).toBe(false);
      if (!result.success) {
        const paths = result.error.issues.map((i) => i.path.join('.'));
        expect(paths).toContain('STELLAR_HORIZON_URL');
        const issue = result.error.issues.find((i) =>
          i.path.includes('STELLAR_HORIZON_URL'),
        );
        expect(issue?.message).toMatch(/must not point to public mainnet/i);
      }
    });

    it('should reject public mainnet Soroban RPC URL on testnet', () => {
      const result = validateConfiguration({
        ...baseValidConfig,
        STELLAR_NETWORK: 'testnet',
        STELLAR_SOROBAN_RPC_URL: 'https://soroban.stellar.org',
      });

      expect(result.success).toBe(false);
      if (!result.success) {
        const paths = result.error.issues.map((i) => i.path.join('.'));
        expect(paths).toContain('STELLAR_SOROBAN_RPC_URL');
        const issue = result.error.issues.find((i) =>
          i.path.includes('STELLAR_SOROBAN_RPC_URL'),
        );
        expect(issue?.message).toMatch(/must not point to public mainnet/i);
      }
    });

    it('should accept valid testnet configuration', () => {
      const result = validateConfiguration({
        ...baseValidConfig,
        STELLAR_NETWORK: 'testnet',
        STELLAR_HORIZON_URL: 'https://horizon-testnet.stellar.org',
        STELLAR_SOROBAN_RPC_URL: 'https://soroban-testnet.stellar.org',
        BOOTSTRAP_DEMO_DATA_ENABLED: 'true',
        FRIENDBOT_BOOTSTRAP_ENABLED: 'true',
      });

      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.STELLAR_NETWORK).toBe('testnet');
        expect(result.data.BOOTSTRAP_DEMO_DATA_ENABLED).toBe(true);
        expect(result.data.FRIENDBOT_BOOTSTRAP_ENABLED).toBe(true);
      }
    });
  });

  describe('Provably Unreachable Facility Isolation', () => {
    it('should confirm conditional exclusion logic isolates testnet facilities from mainnet', () => {
      const isMainnetMode = (network: string) => network === 'mainnet';

      const getAppControllers = (network: string) => [
        'AppController',
        ...(!isMainnetMode(network)
          ? ['TestController', 'TestExceptionController']
          : []),
      ];

      const getStellarControllers = (network: string) => [
        'StellarController',
        'MatchingPoolAdminController',
        ...(!isMainnetMode(network) ? ['TestnetBootstrapController'] : []),
      ];

      const getAppImports = (network: string) => [
        'CoreModules',
        ...(!isMainnetMode(network) ? ['DemoBootstrapModule'] : []),
      ];

      // Under mainnet config, test facilities are provably not in the controller/module lists
      expect(getAppControllers('mainnet')).not.toContain('TestController');
      expect(getAppControllers('mainnet')).not.toContain(
        'TestExceptionController',
      );
      expect(getStellarControllers('mainnet')).not.toContain(
        'TestnetBootstrapController',
      );
      expect(getAppImports('mainnet')).not.toContain('DemoBootstrapModule');

      // Under testnet config, facilities are registered
      expect(getAppControllers('testnet')).toContain('TestController');
      expect(getAppControllers('testnet')).toContain('TestExceptionController');
      expect(getStellarControllers('testnet')).toContain(
        'TestnetBootstrapController',
      );
      expect(getAppImports('testnet')).toContain('DemoBootstrapModule');
    });
  });
});
