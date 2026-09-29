jest.mock('../lib/config', () => ({
  config: {
    nodeEnv: 'development',
    stellar: { network: 'testnet' },
    featureFlags: { bootstrapDemoData: true },
  },
}));

import { ForbiddenException, NotFoundException } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import { BootstrapRunRegistryService } from '../bootstrap-runs/bootstrap-run-registry.service';
import {
  BootstrapResourceType,
  BootstrapRun,
  BootstrapRunKind,
  BootstrapRunStatus,
} from '../bootstrap-runs/entities/bootstrap-run.entity';
import { BootstrapTeardownService } from './bootstrap-teardown.service';
import { DemoBootstrapService } from './demo-bootstrap.service';

// eslint-disable-next-line @typescript-eslint/no-require-imports
const { config } = require('../lib/config');

const RUN_ID = '3f6c1a6e-2f4b-4b2a-9c0a-5d8f0b1c2d3e';
const DEMO_ADDRESS = 'GA5ZSEJYB37JRC5AVCIA5MOP4RHTM335X2KGX3IHOJAPP5RE34K4KZVN';

function buildRun(overrides: Partial<BootstrapRun> = {}): BootstrapRun {
  return {
    id: RUN_ID,
    kind: BootstrapRunKind.DEMO_SEED,
    status: BootstrapRunStatus.ACTIVE,
    network: 'testnet',
    environment: 'development',
    resources: [
      {
        type: BootstrapResourceType.DEMO_CONTRIBUTOR,
        identifier: DEMO_ADDRESS,
        label: 'Demo contributor demo-alice',
      },
      {
        type: BootstrapResourceType.DEMO_GRANT_ROUND,
        identifier: '0',
        label: 'Demo: Stellar Community Builders — Round 1',
      },
    ],
    createdBy: 'admin-1',
    createdAt: new Date('2026-08-01T00:00:00.000Z'),
    tornDownAt: null,
    tornDownBy: null,
    teardownSummary: null,
    ...overrides,
  };
}

describe('BootstrapTeardownService', () => {
  let service: BootstrapTeardownService;
  let registry: {
    findById: jest.Mock;
    list: jest.Mock;
    markTornDown: jest.Mock;
  };
  let demoBootstrap: {
    hasSeededResource: jest.Mock;
    removeSeededResource: jest.Mock;
  };

  beforeEach(async () => {
    config.nodeEnv = 'development';
    config.stellar.network = 'testnet';

    registry = {
      findById: jest.fn(),
      list: jest.fn().mockResolvedValue([]),
      markTornDown: jest.fn().mockResolvedValue(null),
    };
    demoBootstrap = {
      hasSeededResource: jest.fn().mockReturnValue(true),
      removeSeededResource: jest.fn().mockReturnValue(true),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        BootstrapTeardownService,
        { provide: BootstrapRunRegistryService, useValue: registry },
        { provide: DemoBootstrapService, useValue: demoBootstrap },
      ],
    }).compile();

    service = module.get(BootstrapTeardownService);
  });

  afterEach(() => jest.clearAllMocks());

  describe('environment gate', () => {
    it('allows a testnet-marked environment', () => {
      config.nodeEnv = 'staging';
      config.stellar.network = 'testnet';

      expect(service.evaluateEnvironmentGate().allowed).toBe(true);
    });

    it('allows a development environment on any network', () => {
      config.nodeEnv = 'development';
      config.stellar.network = 'mainnet';

      expect(service.evaluateEnvironmentGate().allowed).toBe(true);
    });

    it('refuses an unmarked non-testnet environment', () => {
      config.nodeEnv = 'staging';
      config.stellar.network = 'mainnet';

      const gate = service.evaluateEnvironmentGate();
      expect(gate.allowed).toBe(false);
      expect(gate.reasons.join(' ')).toContain(
        'not explicitly marked as testnet or development',
      );
    });

    it('refuses production even when the network says testnet', () => {
      config.nodeEnv = 'production';
      config.stellar.network = 'testnet';

      const gate = service.evaluateEnvironmentGate();
      expect(gate.allowed).toBe(false);
      expect(gate.reasons.join(' ')).toContain('never permitted in production');
    });

    it('throws ForbiddenException and touches nothing when refused', async () => {
      config.nodeEnv = 'production';
      config.stellar.network = 'mainnet';

      await expect(service.teardown(RUN_ID)).rejects.toBeInstanceOf(
        ForbiddenException,
      );
      expect(registry.findById).not.toHaveBeenCalled();
      expect(demoBootstrap.removeSeededResource).not.toHaveBeenCalled();
    });
  });

  describe('teardown', () => {
    it('throws NotFoundException for an unknown run identifier', async () => {
      registry.findById.mockResolvedValue(null);

      await expect(service.teardown(RUN_ID)).rejects.toBeInstanceOf(
        NotFoundException,
      );
    });

    it('removes every recorded resource and marks the run torn down', async () => {
      registry.findById.mockResolvedValue(buildRun());

      const result = await service.teardown(RUN_ID, {
        requestedBy: 'admin-2',
      });

      expect(result.dryRun).toBe(false);
      expect(result.status).toBe(BootstrapRunStatus.TORN_DOWN);
      expect(result.summary).toEqual({
        total: 2,
        removed: 2,
        notFound: 0,
        skipped: 0,
      });
      expect(demoBootstrap.removeSeededResource).toHaveBeenCalledTimes(2);
      expect(registry.markTornDown).toHaveBeenCalledWith(
        RUN_ID,
        expect.objectContaining({ tornDownBy: 'admin-2' }),
      );
    });

    it('reports already-removed resources as not_found instead of failing', async () => {
      registry.findById.mockResolvedValue(buildRun());
      demoBootstrap.removeSeededResource.mockReturnValue(false);

      const result = await service.teardown(RUN_ID);

      expect(result.success).toBe(true);
      expect(result.summary).toEqual({
        total: 2,
        removed: 0,
        notFound: 2,
        skipped: 0,
      });
    });

    it('skips on-chain testnet accounts with an explicit reason', async () => {
      registry.findById.mockResolvedValue(
        buildRun({
          kind: BootstrapRunKind.TESTNET_ACCOUNT,
          resources: [
            {
              type: BootstrapResourceType.TESTNET_ACCOUNT,
              identifier: DEMO_ADDRESS,
              label: 'Friendbot-funded testnet account (10000 XLM)',
            },
          ],
        }),
      );

      const result = await service.teardown(RUN_ID);

      expect(result.summary).toEqual({
        total: 1,
        removed: 0,
        notFound: 0,
        skipped: 1,
      });
      expect(result.resources[0].reason).toContain(
        'cannot be deleted on-chain',
      );
      expect(demoBootstrap.removeSeededResource).not.toHaveBeenCalled();
    });

    it('is idempotent — a second teardown reports the run as already torn down', async () => {
      registry.findById.mockResolvedValue(
        buildRun({
          status: BootstrapRunStatus.TORN_DOWN,
          tornDownAt: new Date('2026-08-02T00:00:00.000Z'),
        }),
      );

      const result = await service.teardown(RUN_ID);

      expect(result.status).toBe('already_torn_down');
      expect(demoBootstrap.removeSeededResource).not.toHaveBeenCalled();
      expect(registry.markTornDown).not.toHaveBeenCalled();
    });
  });

  describe('dry run', () => {
    it('lists what would be removed without mutating anything', async () => {
      registry.findById.mockResolvedValue(buildRun());

      const result = await service.teardown(RUN_ID, { dryRun: true });

      expect(result.dryRun).toBe(true);
      expect(result.status).toBe(BootstrapRunStatus.ACTIVE);
      expect(result.resources.map((r) => r.action)).toEqual([
        'would_remove',
        'would_remove',
      ]);
      expect(result.summary.removed).toBe(2);
      expect(demoBootstrap.removeSeededResource).not.toHaveBeenCalled();
      expect(registry.markTornDown).not.toHaveBeenCalled();
    });

    it('previews an already torn-down run rather than short-circuiting', async () => {
      registry.findById.mockResolvedValue(
        buildRun({ status: BootstrapRunStatus.TORN_DOWN }),
      );
      demoBootstrap.hasSeededResource.mockReturnValue(false);

      const result = await service.teardown(RUN_ID, { dryRun: true });

      expect(result.dryRun).toBe(true);
      expect(result.summary).toEqual({
        total: 2,
        removed: 0,
        notFound: 2,
        skipped: 0,
      });
    });
  });

  describe('listRuns', () => {
    it('maps recorded runs to summaries with their identifiers', async () => {
      registry.list.mockResolvedValue([buildRun()]);

      const runs = await service.listRuns({});

      expect(runs).toEqual([
        {
          runId: RUN_ID,
          kind: BootstrapRunKind.DEMO_SEED,
          status: BootstrapRunStatus.ACTIVE,
          network: 'testnet',
          environment: 'development',
          resourceCount: 2,
          createdAt: '2026-08-01T00:00:00.000Z',
          tornDownAt: undefined,
        },
      ]);
    });
  });
});
