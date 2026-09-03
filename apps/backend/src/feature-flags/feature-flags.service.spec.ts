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
      save: jest
        .fn()
        .mockImplementation((x: Partial<FlagAuditLog>) =>
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
    latencyHistogram = { startTimer: jest.fn(() => jest.fn()) };

    metricsService = {
      getOrCreateCounter: jest.fn().mockImplementation((name: string) => {
        if (name === 'feature_flag_cache_hits_total') return hitsCounter;
        if (name === 'feature_flag_cache_misses_total') return missesCounter;
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
  });
});
