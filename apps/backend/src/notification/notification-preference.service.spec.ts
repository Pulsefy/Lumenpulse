import { Test, TestingModule } from '@nestjs/testing';
import { NotificationPreferenceService } from './notification-preference.service';
import { getRepositoryToken } from '@nestjs/typeorm';
import {
  NotificationPreference,
  NotificationChannel,
} from './notification-preference.entity';

const mockNotificationPreferenceRepository = {
  findOne: jest.fn(),
  create: jest.fn(),
  save: jest.fn(),
  delete: jest.fn(),
};

describe('NotificationPreferenceService', () => {
  let service: NotificationPreferenceService;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        NotificationPreferenceService,
        {
          provide: getRepositoryToken(NotificationPreference),
          useValue: mockNotificationPreferenceRepository,
        },
      ],
    }).compile();

    service = module.get<NotificationPreferenceService>(
      NotificationPreferenceService,
    );
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  describe('createOrUpdate', () => {
    it('should create new preferences if not exist', async () => {
      const dto = {
        userId: 'user-123',
        enabledChannels: [
          NotificationChannel.IN_APP,
          NotificationChannel.EMAIL,
        ],
        eventPreferences: {},
        dailyLimit: 50,
        minSeverity: 'low',
      };

      mockNotificationPreferenceRepository.findOne.mockResolvedValue(null);
      mockNotificationPreferenceRepository.create.mockReturnValue(dto);
      mockNotificationPreferenceRepository.save.mockResolvedValue({
        id: 'pref-id',
        ...dto,
      });

      const result = await service.createOrUpdate(dto);

      expect(result).toBeDefined();
      expect(result.userId).toBe('user-123');
      expect(mockNotificationPreferenceRepository.save).toHaveBeenCalled();
    });

    it('should update existing preferences', async () => {
      const existing = {
        id: 'pref-id',
        userId: 'user-123',
        enabledChannels: [NotificationChannel.IN_APP],
        eventPreferences: {},
        quietHours: null,
        dailyLimit: 0,
        minSeverity: 'low',
      };

      const dto = {
        userId: 'user-123',
        enabledChannels: [NotificationChannel.EMAIL],
      };

      mockNotificationPreferenceRepository.findOne.mockResolvedValue(existing);
      mockNotificationPreferenceRepository.save.mockResolvedValue({
        ...existing,
        ...dto,
      });

      const result = await service.createOrUpdate(dto as any);

      expect(result).toBeDefined();
      expect(mockNotificationPreferenceRepository.save).toHaveBeenCalled();
    });
  });

  describe('findByUserId', () => {
    it('should return preferences for user', async () => {
      const mockPreference = {
        id: 'pref-id',
        userId: 'user-123',
        enabledChannels: [NotificationChannel.IN_APP],
        eventPreferences: {},
        quietHours: null,
        dailyLimit: 0,
        minSeverity: 'low',
      };

      mockNotificationPreferenceRepository.findOne.mockResolvedValue(
        mockPreference,
      );

      const result = await service.findByUserId('user-123');

      expect(result).toBeDefined();
      expect(result.userId).toBe('user-123');
    });

    it('should throw NotFoundException if preferences not found', async () => {
      mockNotificationPreferenceRepository.findOne.mockResolvedValue(null);

      await expect(service.findByUserId('user-999')).rejects.toThrow(
        'Notification preferences not found for user user-999',
      );
    });
  });

  describe('isWithinQuietHours', () => {
    it('should return false if quiet hours not set', () => {
      const preference = {
        quietHours: null,
      } as NotificationPreference;

      const result = service.isWithinQuietHours(preference, 'low');
      expect(result).toBe(false);
    });

    it('should return true during quiet hours for non-critical', () => {
      const preference = {
        quietHours: {
          startHour: 22,
          endHour: 7,
          timezone: 'UTC',
          allowCritical: true,
        },
      } as NotificationPreference;

      // Mock current time to be 23:00 UTC
      const mockDate = new Date();
      mockDate.setUTCHours(23);
      jest.spyOn(global, 'Date').mockImplementation(() => mockDate);

      const result = service.isWithinQuietHours(preference, 'low');
      expect(result).toBe(true);
    });

    it('should return false for critical notifications if allowed', () => {
      const preference = {
        quietHours: {
          startHour: 22,
          endHour: 7,
          timezone: 'UTC',
          allowCritical: true,
        },
      } as NotificationPreference;

      const mockDate = new Date();
      mockDate.setUTCHours(23);
      jest.spyOn(global, 'Date').mockImplementation(() => mockDate);

      const result = service.isWithinQuietHours(preference, 'critical');
      expect(result).toBe(false);
    });
  });

  describe('meetsSeverityThreshold', () => {
    it('should return true if notification severity meets threshold', () => {
      const preference = {
        minSeverity: 'medium',
      } as NotificationPreference;

      expect(service.meetsSeverityThreshold(preference, 'high')).toBe(true);
      expect(service.meetsSeverityThreshold(preference, 'critical')).toBe(true);
      expect(service.meetsSeverityThreshold(preference, 'medium')).toBe(true);
      expect(service.meetsSeverityThreshold(preference, 'low')).toBe(false);
    });
  });

  describe('getEnabledChannelsForEvent', () => {
    it('should return event-specific channels if defined', async () => {
      const mockPreference = {
        id: 'pref-id',
        userId: 'user-123',
        enabledChannels: [NotificationChannel.IN_APP],
        eventPreferences: {
          anomaly: {
            enabled: true,
            channels: [NotificationChannel.EMAIL, NotificationChannel.PUSH],
          },
        },
        quietHours: null,
        dailyLimit: 0,
        minSeverity: 'low',
      };

      mockNotificationPreferenceRepository.findOne.mockResolvedValue(
        mockPreference,
      );

      const result = await service.getEnabledChannelsForEvent(
        'user-123',
        'anomaly',
      );

      expect(result).toEqual([
        NotificationChannel.EMAIL,
        NotificationChannel.PUSH,
      ]);
    });

    it('should return empty array if event is disabled', async () => {
      const mockPreference = {
        id: 'pref-id',
        userId: 'user-123',
        enabledChannels: [NotificationChannel.IN_APP],
        eventPreferences: {
          marketing: {
            enabled: false,
            channels: [NotificationChannel.EMAIL],
          },
        },
        quietHours: null,
        dailyLimit: 0,
        minSeverity: 'low',
      };

      mockNotificationPreferenceRepository.findOne.mockResolvedValue(
        mockPreference,
      );

      const result = await service.getEnabledChannelsForEvent(
        'user-123',
        'marketing',
      );

      expect(result).toEqual([]);
    });
  });
});
