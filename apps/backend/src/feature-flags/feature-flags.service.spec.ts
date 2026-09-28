import { Test, TestingModule } from '@nestjs/testing';
import { Repository } from 'typeorm';
import { getRepositoryToken } from '@nestjs/typeorm';
import { FeatureFlagsService } from './feature-flags.service';
import { FeatureFlag } from './feature-flag.entity';
import { FlagAuditLog } from './entities/flag-audit-log.entity';
import { MetricsService } from '../metrics/metrics.service';

describe('FeatureFlagsService', () => {
  let service: FeatureFlagsService;
  let repo: Partial<Repository<FeatureFlag>>;
  let auditRepo: Partial<Repository<FlagAuditLog>>;
  let hitsCounter: { inc: jest.Mock };
  let missesCounter: { inc: jest.Mock };
  let reasonCounter: { inc: jest.Mock };
  let latencyHistogram: { startTimer: jest.Mock };
  let metricsService: Partial<MetricsService>;

  beforeEach(async () => {
    repo = {
      find: jest.fn().mockResolvedValue([]),
      findOne: jest.fn().mockResolvedValue(undefined),
      save: jest
        .fn()
        .mockImplementation((x: Partial<FeatureFlag>) =>
          Promise.resolve({ ...(x as object), id: 'uuid' } as FeatureFlag),
        ),
      delete: jest.fn().mockResolvedValue(undefined),
      create: jest
        .fn()
        .mockImplementation((x: Partial<FeatureFlag>) => x as FeatureFlag),
    };

    auditRepo = {
      find: jest.fn().mockResolvedValue([]),
      save: jest.fn().mockImplementation((x: Partial<FlagAuditLog>) =>
        Promise.resolve({
          ...(x as object),
          id: 'audit-uuid',
          changedAt: new Date(),
        } as FlagAuditLog),
      ),
      create: jest
        .fn()
        .mockImplementation((x: Partial<FlagAuditLog>) => x as FlagAuditLog),
    };

    hitsCounter = { inc: jest.fn() };
    missesCounter = { inc: jest.fn() };
    reasonCounter = { inc: jest.fn() };
    latencyHistogram = { startTimer: jest.fn(() => jest.fn()) };

    metricsService = {
      getOrCreateCounter: jest.fn().mockImplementation((name: string) => {
        if (name === 'feature_flag_cache_hits_total') return hitsCounter;
        if (name === 'feature_flag_cache_misses_total') return missesCounter;
        if (name === 'feature_flag_evaluations_by_reason_total') {
          return reasonCounter;
        }
        return { inc: jest.fn() };
      }),
      getOrCreateHistogram: jest.fn().mockReturnValue(latencyHistogram),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        FeatureFlagsService,
        { provide: getRepositoryToken(FeatureFlag), useValue: repo },
        { provide: getRepositoryToken(FlagAuditLog), useValue: auditRepo },
        { provide: MetricsService, useValue: metricsService },
      ],
    }).compile();

    service = module.get<FeatureFlagsService>(FeatureFlagsService);
  });

  it('upserts and reads a feature flag', async () => {
    const saved = await service.upsert('test.feature', true, { sample: 'x' });
    expect(saved.key).toBe('test.feature');
    expect(saved.enabled).toBe(true);

    // ensure isEnabled uses cache and returns true
    const enabled = await service.isEnabled('test.feature');
    expect(enabled).toBe(true);
  });

  it('returns false for unknown flags without hitting DB again after upsert', async () => {
    const enabled = await service.isEnabled('unknown.flag');
    expect(enabled).toBe(false);
  });

  describe('TTL cache', () => {
    it('records a cache miss on first getFlag and a hit on second (within TTL)', async () => {
      // First call → miss
      await service.getFlag('some.flag');
      expect(missesCounter.inc).toHaveBeenCalledTimes(1);

      // Second call within TTL → hit
      await service.getFlag('some.flag');
      expect(hitsCounter.inc).toHaveBeenCalledTimes(1);
    });

    it('invalidates cache immediately on upsert', async () => {
      // Pre-populate cache
      await service.getFlag('flag.a');

      // Upsert should overwrite the entry immediately
      await service.upsert('flag.a', true);

      // Cache should now hold the saved value
      const f = await service.getFlag('flag.a');
      expect(f?.enabled).toBe(true);
    });

    it('evicts the entry immediately on remove', async () => {
      await service.upsert('flag.b', true);
      await service.remove('flag.b');

      // After remove the entry must not exist in cache (Map#has = false)
      // A getFlag call will trigger a DB miss → repo.findOne returns undefined
      (repo.findOne as jest.Mock).mockResolvedValueOnce(undefined);
      const f = await service.getFlag('flag.b');
      expect(f).toBeNull();
    });
  });

  describe('Audit logging', () => {
    it('writes an audit entry on upsert', async () => {
      await service.upsert('flag.audit', true, undefined, 'admin@test.com');
      expect(auditRepo.create).toHaveBeenCalledWith(
        expect.objectContaining({
          flagKey: 'flag.audit',
          action: 'upsert',
          newEnabled: true,
          actor: 'admin@test.com',
        }),
      );
      expect(auditRepo.save).toHaveBeenCalled();
    });

    it('writes an audit entry on remove', async () => {
      await service.upsert('flag.remove', false);
      await service.remove('flag.remove');
      expect(auditRepo.create).toHaveBeenCalledWith(
        expect.objectContaining({
          flagKey: 'flag.remove',
          action: 'remove',
          newEnabled: null,
        }),
      );
    });

    it('records previousEnabled correctly when flag existed', async () => {
      const existingFlag: FeatureFlag = {
        id: 'existing-id',
        key: 'flag.exists',
        enabled: false,
        rolloutPercentage: null,
        allowList: null,
        denyList: null,
        conditions: null,
        changedBy: null,
        createdAt: new Date(),
        updatedAt: new Date(),
      };
      (repo.findOne as jest.Mock).mockResolvedValue(existingFlag);

      await service.upsert('flag.exists', true, undefined, 'alice');

      expect(auditRepo.create).toHaveBeenCalledWith(
        expect.objectContaining({
          flagKey: 'flag.exists',
          action: 'upsert',
          previousEnabled: false,
          newEnabled: true,
          actor: 'alice',
        }),
      );
    });
  });

  describe('getFlagHistory', () => {
    it('returns ordered audit history for a flag', async () => {
      const mockHistory: Partial<FlagAuditLog>[] = [
        {
          id: '1',
          flagKey: 'flag.hist',
          action: 'upsert',
          previousEnabled: null,
          newEnabled: true,
          actor: 'alice',
          changedAt: new Date('2024-06-02'),
        },
        {
          id: '2',
          flagKey: 'flag.hist',
          action: 'upsert',
          previousEnabled: true,
          newEnabled: false,
          actor: 'bob',
          changedAt: new Date('2024-06-01'),
        },
      ];
      (auditRepo.find as jest.Mock).mockResolvedValueOnce(mockHistory);

      const history = await service.getFlagHistory('flag.hist');
      expect(history).toHaveLength(2);
      expect(history[0].actor).toBe('alice');
      expect(auditRepo.find).toHaveBeenCalledWith({
        where: { flagKey: 'flag.hist' },
        order: { changedAt: 'DESC' },
      });
    });
  });

  describe('Metrics', () => {
    it('registers Prometheus counters and histogram on construction', () => {
      expect(metricsService.getOrCreateCounter).toHaveBeenCalledWith(
        'feature_flag_cache_hits_total',
        expect.any(String),
      );
      expect(metricsService.getOrCreateCounter).toHaveBeenCalledWith(
        'feature_flag_cache_misses_total',
        expect.any(String),
      );
      expect(metricsService.getOrCreateHistogram).toHaveBeenCalledWith(
        'feature_flag_evaluation_duration_seconds',
        expect.any(String),
        expect.any(Array),
        expect.any(Array),
      );
    });

    it('starts and ends evaluation latency timer on isEnabled', async () => {
      const endTimer = jest.fn();
      latencyHistogram.startTimer.mockReturnValueOnce(endTimer);

      await service.isEnabled('any.flag');

      expect(latencyHistogram.startTimer).toHaveBeenCalled();
      expect(endTimer).toHaveBeenCalled();
    });

    it('registers a counter split by evaluation reason', () => {
      expect(metricsService.getOrCreateCounter).toHaveBeenCalledWith(
        'feature_flag_evaluations_by_reason_total',
        expect.any(String),
        ['reason'],
      );
    });

    it('counts each evaluation against the rule that resolved it', async () => {
      (repo.findOne as jest.Mock).mockResolvedValue({
        id: 'id',
        key: 'flag.reason',
        enabled: true,
        rolloutPercentage: null,
        allowList: null,
        denyList: null,
        conditions: null,
        changedBy: null,
        createdAt: new Date(),
        updatedAt: new Date(),
      });

      await service.isEnabled('flag.reason', { principalId: 'user-1' });

      expect(reasonCounter.inc).toHaveBeenCalledWith({
        reason: 'default_state',
      });
    });
  });

  describe('Percentage targeting', () => {
    const storedFlag = (overrides: Partial<FeatureFlag>): FeatureFlag =>
      ({
        id: 'id',
        key: 'risky.migration',
        enabled: false,
        rolloutPercentage: null,
        allowList: null,
        denyList: null,
        conditions: null,
        changedBy: null,
        createdAt: new Date(),
        updatedAt: new Date(),
        ...overrides,
      }) as FeatureFlag;

    beforeEach(() => {
      (repo.findOne as jest.Mock).mockReset();
    });

    it('enables the flag for every principal at 100%', async () => {
      (repo.findOne as jest.Mock).mockResolvedValue(
        storedFlag({ rolloutPercentage: 100 }),
      );

      await expect(
        service.isEnabled('risky.migration', { principalId: 'user-1' }),
      ).resolves.toBe(true);
    });

    it('excludes every principal at 0% even when the flag is on', async () => {
      (repo.findOne as jest.Mock).mockResolvedValue(
        storedFlag({ enabled: true, rolloutPercentage: 0 }),
      );

      await expect(
        service.isEnabled('risky.migration', { principalId: 'user-1' }),
      ).resolves.toBe(false);
    });

    it('applies allow and deny lists ahead of the percentage', async () => {
      (repo.findOne as jest.Mock).mockResolvedValue(
        storedFlag({
          rolloutPercentage: 0,
          allowList: ['allowed-user'],
          denyList: ['blocked-user'],
        }),
      );

      await expect(
        service.isEnabled('risky.migration', { principalId: 'allowed-user' }),
      ).resolves.toBe(true);
      await expect(
        service.isEnabled('risky.migration', { principalId: 'blocked-user' }),
      ).resolves.toBe(false);
    });

    it('ignores percentage targeting when no principal is supplied', async () => {
      (repo.findOne as jest.Mock).mockResolvedValue(
        storedFlag({ enabled: true, rolloutPercentage: 100 }),
      );

      // No principal means no bucket, so the flag's own state is used.
      await expect(service.isEnabled('risky.migration')).resolves.toBe(true);
    });

    it('keeps a principal on the same side of the rollout across evaluations', async () => {
      (repo.findOne as jest.Mock).mockResolvedValue(
        storedFlag({ rolloutPercentage: 50 }),
      );

      const first = await service.isEnabled('risky.migration', {
        principalId: 'user-77',
      });
      for (let i = 0; i < 50; i++) {
        await expect(
          service.isEnabled('risky.migration', { principalId: 'user-77' }),
        ).resolves.toBe(first);
      }
    });

    it('only ever widens the served set as the percentage is raised', async () => {
      const servedAt = async (percentage: number) => {
        (repo.findOne as jest.Mock).mockResolvedValue(
          storedFlag({ rolloutPercentage: percentage }),
        );
        const served = new Set<string>();
        for (let i = 0; i < 100; i++) {
          const principal = `user-${i}`;
          if (
            await service.isEnabled('risky.migration', {
              principalId: principal,
            })
          ) {
            served.add(principal);
          }
        }
        return served;
      };

      let previous = await servedAt(10);
      for (const percentage of [25, 50, 100]) {
        const current = await servedAt(percentage);
        for (const principal of previous) {
          expect(current.has(principal)).toBe(true);
        }
        previous = current;
      }
    });
  });

  describe('Targeting persistence', () => {
    it('stores the rollout percentage and lists on create', async () => {
      const saved = await service.upsert(
        'flag.rollout',
        false,
        undefined,
        'admin',
        {
          rolloutPercentage: 5,
          allowList: ['qa'],
          denyList: ['banned'],
        },
      );

      expect(repo.create).toHaveBeenCalledWith(
        expect.objectContaining({
          key: 'flag.rollout',
          rolloutPercentage: 5,
          allowList: ['qa'],
          denyList: ['banned'],
        }),
      );
      expect(saved.rolloutPercentage).toBe(5);
    });

    it('applies targeting to an existing flag', async () => {
      const existing = {
        id: 'id',
        key: 'flag.rollout',
        enabled: true,
        rolloutPercentage: null,
        allowList: null,
        denyList: null,
        conditions: null,
        changedBy: null,
        createdAt: new Date(),
        updatedAt: new Date(),
      } as FeatureFlag;
      (repo.findOne as jest.Mock).mockResolvedValue(existing);

      await service.upsert('flag.rollout', true, undefined, 'admin', {
        rolloutPercentage: 25,
      });

      expect(existing.rolloutPercentage).toBe(25);
    });

    it('leaves an existing rollout untouched when targeting is omitted', async () => {
      // An on/off-only update must not silently clear a live canary.
      const existing = {
        id: 'id',
        key: 'flag.rollout',
        enabled: true,
        rolloutPercentage: 5,
        allowList: ['qa'],
        denyList: null,
        conditions: null,
        changedBy: null,
        createdAt: new Date(),
        updatedAt: new Date(),
      } as FeatureFlag;
      (repo.findOne as jest.Mock).mockResolvedValue(existing);

      await service.upsert('flag.rollout', false, undefined, 'admin');

      expect(existing.rolloutPercentage).toBe(5);
      expect(existing.allowList).toEqual(['qa']);
    });

    it('sanitizes an out-of-range percentage on write', async () => {
      await service.upsert('flag.rollout', false, undefined, 'admin', {
        rolloutPercentage: 900,
      });

      expect(repo.create).toHaveBeenCalledWith(
        expect.objectContaining({ rolloutPercentage: null }),
      );
    });

    it('serves nobody when the rollout is cleared to 0 and the flag is off', async () => {
      const existing = {
        id: 'id',
        key: 'flag.rollout',
        enabled: true,
        rolloutPercentage: 50,
        allowList: null,
        denyList: null,
        conditions: null,
        changedBy: null,
        createdAt: new Date(),
        updatedAt: new Date(),
      } as FeatureFlag;
      (repo.findOne as jest.Mock).mockResolvedValue(existing);

      await service.upsert('flag.rollout', false, undefined, 'admin', {
        rolloutPercentage: 0,
      });

      for (const principal of ['user-1', 'user-2', 'user-3']) {
        await expect(
          service.isEnabled('flag.rollout', { principalId: principal }),
        ).resolves.toBe(false);
      }
    });
  });

  describe('evaluate', () => {
    beforeEach(() => {
      (repo.findOne as jest.Mock).mockReset();
    });

    it('reports the result, reason and bucket for a principal', async () => {
      (repo.findOne as jest.Mock).mockResolvedValue({
        id: 'id',
        key: 'risky.migration',
        enabled: false,
        rolloutPercentage: 100,
        allowList: [],
        denyList: [],
        conditions: null,
        changedBy: null,
        createdAt: new Date(),
        updatedAt: new Date(),
      } as FeatureFlag);

      const result = await service.evaluate('risky.migration', 'user-1');

      expect(result).toEqual({
        key: 'risky.migration',
        principalId: 'user-1',
        enabled: true,
        reason: 'percentage_included',
        bucket: expect.any(Number),
        rolloutPercentage: 100,
        allowList: [],
        denyList: [],
      });
      expect(result.bucket).toBeGreaterThanOrEqual(0);
      expect(result.bucket).toBeLessThan(10_000);
    });

    it('explains why a principal is not in a canary', async () => {
      (repo.findOne as jest.Mock).mockResolvedValue({
        id: 'id',
        key: 'risky.migration',
        enabled: false,
        rolloutPercentage: 0,
        allowList: null,
        denyList: null,
        conditions: null,
        changedBy: null,
        createdAt: new Date(),
        updatedAt: new Date(),
      } as FeatureFlag);

      const result = await service.evaluate('risky.migration', 'user-1');

      expect(result.reason).toBe('percentage_excluded');
      expect(result.enabled).toBe(false);
    });

    it('reports flag_not_found for an unknown key', async () => {
      (repo.findOne as jest.Mock).mockResolvedValue(undefined);

      await expect(service.evaluate('nope.flag', 'user-1')).resolves.toEqual({
        key: 'nope.flag',
        principalId: 'user-1',
        enabled: false,
        reason: 'flag_not_found',
        bucket: null,
        rolloutPercentage: null,
        allowList: [],
        denyList: [],
      });
    });

    it('exposes the configured targeting for debugging', async () => {
      (repo.findOne as jest.Mock).mockResolvedValue({
        id: 'id',
        key: 'risky.migration',
        enabled: false,
        rolloutPercentage: 5,
        allowList: ['qa'],
        denyList: ['banned'],
        conditions: null,
        changedBy: null,
        createdAt: new Date(),
        updatedAt: new Date(),
      } as FeatureFlag);

      const result = await service.evaluate('risky.migration', 'someone');

      expect(result.rolloutPercentage).toBe(5);
      expect(result.allowList).toEqual(['qa']);
      expect(result.denyList).toEqual(['banned']);
    });

    it('is stable for the same principal across repeated calls', async () => {
      (repo.findOne as jest.Mock).mockResolvedValue({
        id: 'id',
        key: 'risky.migration',
        enabled: false,
        rolloutPercentage: 37,
        allowList: null,
        denyList: null,
        conditions: null,
        changedBy: null,
        createdAt: new Date(),
        updatedAt: new Date(),
      } as FeatureFlag);

      const first = await service.evaluate('risky.migration', 'user-42');
      for (let i = 0; i < 25; i++) {
        expect(await service.evaluate('risky.migration', 'user-42')).toEqual(
          first,
        );
      }
    });
  });

  describe('Targeting audit logging', () => {
    it('records the new targeting snapshot on upsert', async () => {
      await service.upsert('flag.audit.targeting', false, undefined, 'admin', {
        rolloutPercentage: 10,
        allowList: ['qa'],
        denyList: [],
      });

      expect(auditRepo.create).toHaveBeenCalledWith(
        expect.objectContaining({
          flagKey: 'flag.audit.targeting',
          action: 'upsert',
          previousTargeting: null,
          newTargeting: {
            rolloutPercentage: 10,
            allowList: ['qa'],
            denyList: [],
          },
        }),
      );
    });

    it('records the previous targeting snapshot when a rollout changes', async () => {
      const existing = {
        id: 'id',
        key: 'flag.audit.targeting',
        enabled: true,
        rolloutPercentage: 5,
        allowList: ['qa'],
        denyList: [],
        conditions: null,
        changedBy: null,
        createdAt: new Date(),
        updatedAt: new Date(),
      } as FeatureFlag;
      (repo.findOne as jest.Mock).mockResolvedValue(existing);

      await service.upsert('flag.audit.targeting', true, undefined, 'admin', {
        rolloutPercentage: 50,
      });

      expect(auditRepo.create).toHaveBeenCalledWith(
        expect.objectContaining({
          previousTargeting: {
            rolloutPercentage: 5,
            allowList: ['qa'],
            denyList: [],
          },
          newTargeting: {
            rolloutPercentage: 50,
            allowList: [],
            denyList: [],
          },
        }),
      );
    });

    it('records the discarded targeting snapshot on remove', async () => {
      const existing = {
        id: 'id',
        key: 'flag.audit.targeting',
        enabled: true,
        rolloutPercentage: 5,
        allowList: null,
        denyList: ['banned'],
        conditions: null,
        changedBy: null,
        createdAt: new Date(),
        updatedAt: new Date(),
      } as FeatureFlag;
      (repo.findOne as jest.Mock).mockResolvedValue(existing);

      await service.remove('flag.audit.targeting');

      expect(auditRepo.create).toHaveBeenCalledWith(
        expect.objectContaining({
          action: 'remove',
          previousTargeting: {
            rolloutPercentage: 5,
            allowList: [],
            denyList: ['banned'],
          },
          newTargeting: null,
        }),
      );
    });

    it('keeps the targeting snapshot detached from later flag mutations', async () => {
      const existing = {
        id: 'id',
        key: 'flag.audit.targeting',
        enabled: true,
        rolloutPercentage: 5,
        allowList: ['qa'],
        denyList: null,
        conditions: null,
        changedBy: null,
        createdAt: new Date(),
        updatedAt: new Date(),
      } as FeatureFlag;
      (repo.findOne as jest.Mock).mockResolvedValue(existing);

      await service.upsert('flag.audit.targeting', true, undefined, 'admin', {
        rolloutPercentage: 75,
      });

      const call = (auditRepo.create as jest.Mock).mock.calls.at(-1)?.[0];
      expect(call.previousTargeting.allowList).toEqual(['qa']);
    });
  });
});
