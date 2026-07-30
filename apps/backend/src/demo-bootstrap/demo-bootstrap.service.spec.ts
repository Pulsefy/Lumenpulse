import { Test, TestingModule } from '@nestjs/testing';
import { ServiceUnavailableException } from '@nestjs/common';
import { DemoBootstrapService } from './demo-bootstrap.service';
import { DemoScenario } from './dto/demo-bootstrap.dto';

// Mock the config module before importing the service
jest.mock('../lib/config', () => ({
  config: {
    stellar: {
      network: 'testnet',
    },
    featureFlags: {
      bootstrapDemoData: true,
    },
  },
}));

// eslint-disable-next-line @typescript-eslint/no-require-imports
const { config } = require('../lib/config');

describe('DemoBootstrapService', () => {
  let service: DemoBootstrapService;

  beforeEach(async () => {
    // Reset config to testnet + enabled before each test
    config.stellar.network = 'testnet';
    config.featureFlags.bootstrapDemoData = true;

    const module: TestingModule = await Test.createTestingModule({
      providers: [DemoBootstrapService],
    }).compile();

    service = module.get<DemoBootstrapService>(DemoBootstrapService);
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  describe('isEnvironmentAllowed', () => {
    it('should return true when testnet and flag enabled', () => {
      expect(service.isEnvironmentAllowed).toBe(true);
    });

    it('should return false when network is mainnet', () => {
      config.stellar.network = 'mainnet';
      expect(service.isEnvironmentAllowed).toBe(false);
    });

    it('should return false when flag is disabled', () => {
      config.featureFlags.bootstrapDemoData = false;
      expect(service.isEnvironmentAllowed).toBe(false);
    });
  });

  describe('getStatus', () => {
    it('should return enabled=true and isSeeded=false initially', () => {
      const status = service.getStatus();
      expect(status.enabled).toBe(true);
      expect(status.network).toBe('testnet');
      expect(status.isSeeded).toBe(false);
      expect(status.lastSeededAt).toBeUndefined();
    });

    it('should return isSeeded=true after seeding', () => {
      service.seed();
      const status = service.getStatus();
      expect(status.isSeeded).toBe(true);
      expect(status.lastSeededAt).toBeDefined();
      expect(status.seededData).toBeDefined();
    });
  });

  describe('seed', () => {
    it('should seed full scenario by default', () => {
      const result = service.seed();
      expect(result.success).toBe(true);
      expect(result.seededAt).toBeDefined();
      expect(result.details?.contributorsSeeded).toBe(3);
      expect(result.details?.grantRoundsSeeded).toBe(2);
    });

    it('should seed only contributors when scenario=contributors', () => {
      const result = service.seed(DemoScenario.CONTRIBUTORS);
      expect(result.details?.contributorsSeeded).toBe(3);
      expect(result.details?.grantRoundsSeeded).toBe(0);
    });

    it('should seed only grant rounds when scenario=grant_round', () => {
      const result = service.seed(DemoScenario.GRANT_ROUND);
      expect(result.details?.contributorsSeeded).toBe(0);
      expect(result.details?.grantRoundsSeeded).toBe(2);
    });

    it('should be idempotent — calling seed twice resets state', () => {
      service.seed();
      const second = service.seed();
      expect(second.success).toBe(true);
      expect(second.seededAt).toBeDefined();
      // After second seed, status should reflect the latest seed
      const status = service.getStatus();
      expect(status.isSeeded).toBe(true);
    });

    it('should throw ServiceUnavailableException when not allowed', () => {
      config.stellar.network = 'mainnet';
      expect(() => service.seed()).toThrow(ServiceUnavailableException);
    });
  });

  describe('reset', () => {
    it('should clear seeded data', () => {
      service.seed();
      expect(service.getStatus().isSeeded).toBe(true);

      const result = service.reset();
      expect(result.success).toBe(true);
      expect(service.getStatus().isSeeded).toBe(false);
    });

    it('should succeed even when no data is seeded', () => {
      const result = service.reset();
      expect(result.success).toBe(true);
      expect(result.message).toContain('No demo data was present');
    });

    it('should throw ServiceUnavailableException when not allowed', () => {
      config.featureFlags.bootstrapDemoData = false;
      expect(() => service.reset()).toThrow(ServiceUnavailableException);
    });
  });
});
