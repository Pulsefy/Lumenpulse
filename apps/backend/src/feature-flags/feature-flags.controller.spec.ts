import { Test, TestingModule } from '@nestjs/testing';
import { FeatureFlagsController } from './feature-flags.controller';
import { FeatureFlagsService } from './feature-flags.service';
import { FlagAuditLog } from './entities/flag-audit-log.entity';

describe('FeatureFlagsController', () => {
  let controller: FeatureFlagsController;
  let service: Partial<FeatureFlagsService>;

  beforeEach(async () => {
    service = {
      listFlags: jest.fn().mockResolvedValue([]),
      getFlag: jest.fn().mockResolvedValue(null),
      isEnabled: jest.fn().mockResolvedValue(true),
      evaluate: jest.fn().mockResolvedValue({
        key: 'my.feature',
        principalId: 'user-1',
        enabled: true,
        reason: 'percentage_included',
        bucket: 412,
        rolloutPercentage: 10,
        allowList: [],
        denyList: [],
      }),
      upsert: jest.fn().mockResolvedValue({
        id: 'uuid',
        key: 'test.flag',
        enabled: true,
        rolloutPercentage: null,
        allowList: null,
        denyList: null,
        conditions: null,
        changedBy: null,
        createdAt: new Date(),
        updatedAt: new Date(),
      }),
      remove: jest.fn().mockResolvedValue(undefined),
      getFlagHistory: jest.fn().mockResolvedValue([]),
    };

    const module: TestingModule = await Test.createTestingModule({
      controllers: [FeatureFlagsController],
      providers: [
        {
          provide: FeatureFlagsService,
          useValue: service,
        },
      ],
    }).compile();

    controller = module.get<FeatureFlagsController>(FeatureFlagsController);
  });

  it('should be defined', () => {
    expect(controller).toBeDefined();
  });

  describe('list', () => {
    it('returns all feature flags', async () => {
      const result = await controller.list();
      expect(result).toEqual([]);
      expect(service.listFlags).toHaveBeenCalled();
    });
  });

  describe('check', () => {
    it('returns key and enabled status', async () => {
      (service.isEnabled as jest.Mock).mockResolvedValueOnce(true);
      const result = await controller.check('my.feature');
      expect(result).toEqual({ key: 'my.feature', enabled: true });
      expect(service.isEnabled).toHaveBeenCalledWith('my.feature');
    });

    it('applies targeting when a principalId is supplied', async () => {
      (service.evaluate as jest.Mock).mockResolvedValueOnce({
        key: 'my.feature',
        principalId: 'user-1',
        enabled: true,
        reason: 'percentage_included',
        bucket: 412,
        rolloutPercentage: 10,
        allowList: [],
        denyList: [],
      });

      const result = await controller.check('my.feature', 'user-1');

      expect(result).toEqual({ key: 'my.feature', enabled: true });
      expect(service.evaluate).toHaveBeenCalledWith('my.feature', 'user-1');
      expect(service.isEnabled).not.toHaveBeenCalled();
    });

    it('reports the targeted result as false for an excluded principal', async () => {
      (service.evaluate as jest.Mock).mockResolvedValueOnce({
        key: 'my.feature',
        principalId: 'user-2',
        enabled: false,
        reason: 'percentage_excluded',
        bucket: 9000,
        rolloutPercentage: 10,
        allowList: [],
        denyList: [],
      });

      expect(await controller.check('my.feature', 'user-2')).toEqual({
        key: 'my.feature',
        enabled: false,
      });
    });
  });

  describe('evaluate', () => {
    it('returns the full decision for a principal', async () => {
      const result = await controller.evaluate('my.feature', 'user-1');

      expect(result).toEqual({
        key: 'my.feature',
        principalId: 'user-1',
        enabled: true,
        reason: 'percentage_included',
        bucket: 412,
        rolloutPercentage: 10,
        allowList: [],
        denyList: [],
      });
      expect(service.evaluate).toHaveBeenCalledWith('my.feature', 'user-1');
    });

    it('surfaces the reason for a principal outside the rollout', async () => {
      (service.evaluate as jest.Mock).mockResolvedValueOnce({
        key: 'my.feature',
        principalId: 'user-9',
        enabled: false,
        reason: 'deny_list',
        bucket: null,
        rolloutPercentage: 100,
        allowList: [],
        denyList: ['user-9'],
      });

      const result = await controller.evaluate('my.feature', 'user-9');

      expect(result.reason).toBe('deny_list');
      expect(result.enabled).toBe(false);
    });
  });

  describe('history', () => {
    it('returns audit log history for a flag', async () => {
      const mockHistory: Partial<FlagAuditLog>[] = [
        {
          id: 'log-1',
          flagKey: 'my.feature',
          action: 'upsert',
          previousEnabled: null,
          newEnabled: true,
          actor: 'admin@test.com',
          changedAt: new Date(),
        },
      ];
      (service.getFlagHistory as jest.Mock).mockResolvedValueOnce(mockHistory);
      const result = await controller.history('my.feature');
      expect(result).toEqual(mockHistory);
      expect(service.getFlagHistory).toHaveBeenCalledWith('my.feature');
    });
  });

  describe('get', () => {
    it('returns flag by key', async () => {
      const mockFlag = {
        id: 'uuid',
        key: 'my.feature',
        enabled: true,
        rolloutPercentage: 5,
        allowList: null,
        denyList: null,
        conditions: null,
        changedBy: null,
        createdAt: new Date(),
        updatedAt: new Date(),
      };
      (service.getFlag as jest.Mock).mockResolvedValueOnce(mockFlag);
      const result = await controller.get('my.feature');
      expect(result).toEqual(mockFlag);
      expect(service.getFlag).toHaveBeenCalledWith('my.feature');
    });
  });

  describe('upsert', () => {
    it('calls service.upsert with body params', async () => {
      const body = {
        key: 'new.flag',
        enabled: true,
        conditions: { role: 'admin' },
        changedBy: 'user@test.com',
      };
      await controller.upsert(body);
      expect(service.upsert).toHaveBeenCalledWith(
        'new.flag',
        true,
        { role: 'admin' },
        'user@test.com',
        undefined,
      );
    });

    it('forwards targeting when a rollout percentage is supplied', async () => {
      await controller.upsert({
        key: 'new.flag',
        enabled: false,
        rolloutPercentage: 5,
        changedBy: 'user@test.com',
      });

      expect(service.upsert).toHaveBeenCalledWith(
        'new.flag',
        false,
        undefined,
        'user@test.com',
        {
          rolloutPercentage: 5,
          allowList: undefined,
          denyList: undefined,
        },
      );
    });

    it('forwards targeting when only the lists are supplied', async () => {
      await controller.upsert({
        key: 'new.flag',
        enabled: true,
        allowList: ['qa'],
        denyList: ['banned'],
      });

      expect(service.upsert).toHaveBeenCalledWith(
        'new.flag',
        true,
        undefined,
        undefined,
        {
          rolloutPercentage: undefined,
          allowList: ['qa'],
          denyList: ['banned'],
        },
      );
    });

    it('omits targeting entirely when no targeting field is present', async () => {
      // Keeps an on/off-only update from clearing a live rollout.
      await controller.upsert({ key: 'new.flag', enabled: false });

      expect(service.upsert).toHaveBeenCalledWith(
        'new.flag',
        false,
        undefined,
        undefined,
        undefined,
      );
    });
  });

  describe('remove', () => {
    it('calls service.remove with key', async () => {
      await controller.remove('delete.flag');
      expect(service.remove).toHaveBeenCalledWith('delete.flag');
    });
  });
});
