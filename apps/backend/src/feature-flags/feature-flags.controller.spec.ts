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
      upsert: jest.fn().mockResolvedValue({
        id: 'uuid',
        key: 'test.flag',
        enabled: true,
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
