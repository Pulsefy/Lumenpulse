import { Test, TestingModule } from '@nestjs/testing';
import { ServiceUnavailableException } from '@nestjs/common';
import { BootstrapRunRegistryService } from '../bootstrap-runs/bootstrap-run-registry.service';
import { BootstrapResourceType } from '../bootstrap-runs/entities/bootstrap-run.entity';
import { DemoBootstrapService } from './demo-bootstrap.service';
import { DemoScenario } from './dto/demo-bootstrap.dto';

// Mock the config module before importing the service
jest.mock('../lib/config', () => ({
  config: {
    nodeEnv: 'test',
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

const DEMO_ALICE_ADDRESS =
  'GA5ZSEJYB37JRC5AVCIA5MOP4RHTM335X2KGX3IHOJAPP5RE34K4KZVN';

describe('DemoBootstrapService', () => {
  let service: DemoBootstrapService;
  let runRegistry: { recordSafely: jest.Mock };

  beforeEach(async () => {
    // Reset config to testnet + enabled before each test
    config.stellar.network = 'testnet';
    config.featureFlags.bootstrapDemoData = true;

    runRegistry = {
      recordSafely: jest.fn().mockResolvedValue('run-1'),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        DemoBootstrapService,
        { provide: BootstrapRunRegistryService, useValue: runRegistry },
      ],
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

    it('should return isSeeded=true after seeding', async () => {
      await service.seed();
      const status = service.getStatus();
      expect(status.isSeeded).toBe(true);
      expect(status.lastSeededAt).toBeDefined();
      expect(status.seededData).toBeDefined();
    });
  });

  describe('seed', () => {
    it('should seed full scenario by default', async () => {
      const result = await service.seed();
      expect(result.success).toBe(true);
      expect(result.seededAt).toBeDefined();
      expect(result.details?.contributorsSeeded).toBe(3);
      expect(result.details?.grantRoundsSeeded).toBe(2);
    });

    it('should seed only contributors when scenario=contributors', async () => {
      const result = await service.seed(DemoScenario.CONTRIBUTORS);
      expect(result.details?.contributorsSeeded).toBe(3);
      expect(result.details?.grantRoundsSeeded).toBe(0);
    });

    it('should seed only grant rounds when scenario=grant_round', async () => {
      const result = await service.seed(DemoScenario.GRANT_ROUND);
      expect(result.details?.contributorsSeeded).toBe(0);
      expect(result.details?.grantRoundsSeeded).toBe(2);
    });

    it('should be idempotent — calling seed twice resets state', async () => {
      await service.seed();
      const second = await service.seed();
      expect(second.success).toBe(true);
      expect(second.seededAt).toBeDefined();
      // After second seed, status should reflect the latest seed
      const status = service.getStatus();
      expect(status.isSeeded).toBe(true);
    });

    it('should throw ServiceUnavailableException when not allowed', async () => {
      config.stellar.network = 'mainnet';
      await expect(service.seed()).rejects.toBeInstanceOf(
        ServiceUnavailableException,
      );
    });

    it('records a bootstrap run describing every seeded resource', async () => {
      const result = await service.seed(DemoScenario.FULL, true, 'admin-1');

      expect(result.runId).toBe('run-1');
      expect(runRegistry.recordSafely).toHaveBeenCalledTimes(1);

      const recorded = runRegistry.recordSafely.mock.calls[0][0];
      expect(recorded.kind).toBe('demo_seed');
      expect(recorded.createdBy).toBe('admin-1');
      expect(recorded.resources).toHaveLength(5);
      expect(recorded.resources).toContainEqual({
        type: BootstrapResourceType.DEMO_CONTRIBUTOR,
        identifier: DEMO_ALICE_ADDRESS,
        label: 'Demo contributor demo-alice',
      });
    });

    it('still seeds when the run registry write fails', async () => {
      runRegistry.recordSafely.mockResolvedValueOnce(null);

      const result = await service.seed();

      expect(result.success).toBe(true);
      expect(result.runId).toBeUndefined();
      expect(service.getStatus().isSeeded).toBe(true);
    });
  });

  describe('per-resource removal', () => {
    it('reports a seeded resource as present, then removes it once', async () => {
      await service.seed(DemoScenario.CONTRIBUTORS);

      expect(
        service.hasSeededResource(
          BootstrapResourceType.DEMO_CONTRIBUTOR,
          DEMO_ALICE_ADDRESS,
        ),
      ).toBe(true);
      expect(
        service.removeSeededResource(
          BootstrapResourceType.DEMO_CONTRIBUTOR,
          DEMO_ALICE_ADDRESS,
        ),
      ).toBe(true);
      // Second removal is a no-op — teardown reports it as not_found.
      expect(
        service.removeSeededResource(
          BootstrapResourceType.DEMO_CONTRIBUTOR,
          DEMO_ALICE_ADDRESS,
        ),
      ).toBe(false);
    });

    it('reports isSeeded=false once the last resource is removed', async () => {
      await service.seed(DemoScenario.GRANT_ROUND);

      expect(
        service.removeSeededResource(
          BootstrapResourceType.DEMO_GRANT_ROUND,
          '0',
        ),
      ).toBe(true);
      expect(
        service.removeSeededResource(
          BootstrapResourceType.DEMO_GRANT_ROUND,
          '1',
        ),
      ).toBe(true);
      expect(service.getStatus().isSeeded).toBe(false);
    });

    it('never removes a testnet account resource', async () => {
      await service.seed();

      expect(
        service.removeSeededResource(
          BootstrapResourceType.TESTNET_ACCOUNT,
          DEMO_ALICE_ADDRESS,
        ),
      ).toBe(false);
    });
  });

  describe('reset', () => {
    it('should clear seeded data', async () => {
      await service.seed();
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
