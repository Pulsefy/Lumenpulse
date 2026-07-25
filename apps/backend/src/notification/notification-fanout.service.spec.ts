import { Test, TestingModule } from '@nestjs/testing';
import { NotificationFanoutService } from './notification-fanout.service';
import { NotificationService } from './notification.service';
import { NotificationPreferenceService } from './notification-preference.service';
import { NotificationDeliveryService } from './notification-delivery.service';
import { getRepositoryToken } from '@nestjs/typeorm';
import {
  NotificationSuppressionLog,
  SuppressionReason,
} from './notification-suppression-log.entity';
import { WatchlistItem } from '../watchlist/watchlist-item.entity';
import { NotificationType, NotificationSeverity } from './notification.entity';
import { EventCategory } from '../common/event-catalog';
import { NotificationChannel } from './notification-preference.entity';

const mockWatchlistRepository = {
  createQueryBuilder: jest.fn(),
};

const mockSuppressionLogRepository = {
  create: jest.fn(),
  save: jest.fn(),
  find: jest.fn(),
};

const mockNotificationService = {
  create: jest.fn(),
};

const mockPreferenceService = {
  findByUserId: jest.fn(),
  isWithinQuietHours: jest.fn(),
  meetsSeverityThreshold: jest.fn(),
  hasReachedDailyLimit: jest.fn(),
};

const mockDeliveryService = {
  deliverToUser: jest.fn(),
};

describe('NotificationFanoutService', () => {
  let service: NotificationFanoutService;

  beforeEach(async () => {
    jest.clearAllMocks();

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        NotificationFanoutService,
        {
          provide: NotificationService,
          useValue: mockNotificationService,
        },
        {
          provide: NotificationPreferenceService,
          useValue: mockPreferenceService,
        },
        {
          provide: NotificationDeliveryService,
          useValue: mockDeliveryService,
        },
        {
          provide: getRepositoryToken(WatchlistItem),
          useValue: mockWatchlistRepository,
        },
        {
          provide: getRepositoryToken(NotificationSuppressionLog),
          useValue: mockSuppressionLogRepository,
        },
      ],
    }).compile();

    service = module.get<NotificationFanoutService>(NotificationFanoutService);
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  describe('fanout', () => {
    it('should deliver notifications to watchlist-matching users', async () => {
      const mockQuery = {
        select: jest.fn().mockReturnThis(),
        where: jest.fn().mockReturnThis(),
        andWhere: jest.fn().mockReturnThis(),
        getRawMany: jest.fn().mockResolvedValue([
          { userId: 'user-1' },
          { userId: 'user-2' },
        ]),
      };
      mockWatchlistRepository.createQueryBuilder.mockReturnValue(mockQuery);

      mockPreferenceService.findByUserId.mockResolvedValue({
        userId: 'user-1',
        enabledChannels: [NotificationChannel.IN_APP],
        eventPreferences: {},
        quietHours: null,
        dailyLimit: 0,
        minSeverity: 'low',
      });
      mockPreferenceService.isWithinQuietHours.mockReturnValue(false);
      mockPreferenceService.meetsSeverityThreshold.mockReturnValue(true);
      mockPreferenceService.hasReachedDailyLimit.mockResolvedValue(false);

      const savedNotification = { id: 'notif-1', type: NotificationType.PROJECT };
      mockNotificationService.create.mockResolvedValue(savedNotification);
      mockDeliveryService.deliverToUser.mockResolvedValue([
        { id: 'log-1', status: 'delivered' },
      ]);

      const result = await service.fanout({
        notification: {
          type: NotificationType.PROJECT,
          title: 'Project Created',
          message: 'New project launched',
          severity: NotificationSeverity.MEDIUM,
          eventCategory: EventCategory.PROJECT,
          metadata: { symbol: 'LUMEN' },
        },
      });

      expect(result.totalTargeted).toBe(2);
      expect(result.delivered).toBe(2);
      expect(result.suppressed).toBe(0);
      expect(mockNotificationService.create).toHaveBeenCalledTimes(2);
    });

    it('should suppress notifications for users in quiet hours', async () => {
      const mockQuery = {
        select: jest.fn().mockReturnThis(),
        where: jest.fn().mockReturnThis(),
        andWhere: jest.fn().mockReturnThis(),
        getRawMany: jest.fn().mockResolvedValue([{ userId: 'user-1' }]),
      };
      mockWatchlistRepository.createQueryBuilder.mockReturnValue(mockQuery);

      mockPreferenceService.findByUserId.mockResolvedValue({
        userId: 'user-1',
        enabledChannels: [NotificationChannel.IN_APP],
        eventPreferences: {},
        quietHours: {
          startHour: 22,
          endHour: 7,
          timezone: 'UTC',
          allowCritical: true,
        },
        dailyLimit: 0,
        minSeverity: 'low',
      });
      mockPreferenceService.isWithinQuietHours.mockReturnValue(true);

      const result = await service.fanout({
        notification: {
          type: NotificationType.PRICE,
          title: 'Price Alert',
          message: 'Price threshold reached',
          severity: NotificationSeverity.LOW,
          eventCategory: EventCategory.PRICE,
          metadata: { symbol: 'XLM' },
        },
      });

      expect(result.totalTargeted).toBe(1);
      expect(result.delivered).toBe(0);
      expect(result.suppressed).toBe(1);
      expect(result.suppressionBreakdown[SuppressionReason.QUIET_HOURS]).toBe(1);
      expect(mockSuppressionLogRepository.save).toHaveBeenCalled();
    });

    it('should suppress notifications below severity threshold', async () => {
      const mockQuery = {
        select: jest.fn().mockReturnThis(),
        where: jest.fn().mockReturnThis(),
        andWhere: jest.fn().mockReturnThis(),
        getRawMany: jest.fn().mockResolvedValue([{ userId: 'user-1' }]),
      };
      mockWatchlistRepository.createQueryBuilder.mockReturnValue(mockQuery);

      mockPreferenceService.findByUserId.mockResolvedValue({
        userId: 'user-1',
        enabledChannels: [NotificationChannel.IN_APP],
        eventPreferences: {},
        quietHours: null,
        dailyLimit: 0,
        minSeverity: 'high',
      });
      mockPreferenceService.isWithinQuietHours.mockReturnValue(false);
      mockPreferenceService.meetsSeverityThreshold.mockReturnValue(false);

      const result = await service.fanout({
        notification: {
          type: NotificationType.PRICE,
          title: 'Price Update',
          message: 'Price changed',
          severity: NotificationSeverity.LOW,
          eventCategory: EventCategory.PRICE,
          metadata: { symbol: 'XLM' },
        },
      });

      expect(result.totalTargeted).toBe(1);
      expect(result.suppressed).toBe(1);
      expect(result.suppressionBreakdown[SuppressionReason.SEVERITY_THRESHOLD]).toBe(1);
    });

    it('should suppress notifications for disabled event categories', async () => {
      const mockQuery = {
        select: jest.fn().mockReturnThis(),
        where: jest.fn().mockReturnThis(),
        andWhere: jest.fn().mockReturnThis(),
        getRawMany: jest.fn().mockResolvedValue([{ userId: 'user-1' }]),
      };
      mockWatchlistRepository.createQueryBuilder.mockReturnValue(mockQuery);

      mockPreferenceService.findByUserId.mockResolvedValue({
        userId: 'user-1',
        enabledChannels: [NotificationChannel.IN_APP],
        eventPreferences: {
          price: { enabled: false, channels: [] },
        },
        quietHours: null,
        dailyLimit: 0,
        minSeverity: 'low',
      });
      mockPreferenceService.isWithinQuietHours.mockReturnValue(false);
      mockPreferenceService.meetsSeverityThreshold.mockReturnValue(true);
      mockPreferenceService.hasReachedDailyLimit.mockResolvedValue(false);

      const result = await service.fanout({
        notification: {
          type: NotificationType.PRICE,
          title: 'Price Update',
          message: 'Price updated',
          severity: NotificationSeverity.MEDIUM,
          eventCategory: EventCategory.PRICE,
          metadata: { symbol: 'XLM' },
        },
      });

      expect(result.totalTargeted).toBe(1);
      expect(result.suppressed).toBe(1);
      expect(result.suppressionBreakdown[SuppressionReason.EVENT_CATEGORY_DISABLED]).toBe(1);
    });

    it('should use explicit targetUserIds when provided', async () => {
      mockPreferenceService.findByUserId.mockResolvedValue({
        userId: 'user-explicit',
        enabledChannels: [NotificationChannel.IN_APP],
        eventPreferences: {},
        quietHours: null,
        dailyLimit: 0,
        minSeverity: 'low',
      });
      mockPreferenceService.isWithinQuietHours.mockReturnValue(false);
      mockPreferenceService.meetsSeverityThreshold.mockReturnValue(true);
      mockPreferenceService.hasReachedDailyLimit.mockResolvedValue(false);

      const savedNotification = { id: 'notif-1', type: NotificationType.ADMIN };
      mockNotificationService.create.mockResolvedValue(savedNotification);
      mockDeliveryService.deliverToUser.mockResolvedValue([
        { id: 'log-1', status: 'delivered' },
      ]);

      const result = await service.fanout({
        notification: {
          type: NotificationType.ADMIN,
          title: 'Admin Notice',
          message: 'System maintenance',
          severity: NotificationSeverity.HIGH,
          eventCategory: EventCategory.ADMIN,
        },
        targetUserIds: ['user-explicit'],
      });

      expect(result.totalTargeted).toBe(1);
      expect(result.delivered).toBe(1);
      expect(mockWatchlistRepository.createQueryBuilder).not.toHaveBeenCalled();
    });

    it('should return empty result when no symbols resolved and no explicit targets', async () => {
      const result = await service.fanout({
        notification: {
          type: NotificationType.SYSTEM,
          title: 'System Alert',
          message: 'General alert',
          severity: NotificationSeverity.HIGH,
          eventCategory: EventCategory.SYSTEM,
        },
      });

      expect(result.totalTargeted).toBe(0);
      expect(result.delivered).toBe(0);
      expect(result.suppressed).toBe(0);
    });

    it('should extract symbols from metadata for watchlist matching', async () => {
      const mockQuery = {
        select: jest.fn().mockReturnThis(),
        where: jest.fn().mockReturnThis(),
        andWhere: jest.fn().mockReturnThis(),
        getRawMany: jest.fn().mockResolvedValue([]),
      };
      mockWatchlistRepository.createQueryBuilder.mockReturnValue(mockQuery);

      await service.fanout({
        notification: {
          type: NotificationType.TOKEN,
          title: 'Token Event',
          message: 'Token burned',
          severity: NotificationSeverity.MEDIUM,
          eventCategory: EventCategory.TOKEN,
          metadata: { tokenSymbol: 'LUMEN' },
        },
      });

      expect(mockQuery.where).toHaveBeenCalledWith(
        'w.symbol IN (:...symbols)',
        { symbols: ['LUMEN'] },
      );
    });
  });

  describe('getSuppressionLogs', () => {
    it('should return suppression logs', async () => {
      const mockLogs = [
        {
          id: 'log-1',
          userId: 'user-1',
          eventCategory: 'price',
          notificationType: 'price',
          reason: SuppressionReason.QUIET_HOURS,
          createdAt: new Date(),
        },
      ];
      mockSuppressionLogRepository.find.mockResolvedValue(mockLogs);

      const result = await service.getSuppressionLogs('user-1');

      expect(result).toEqual(mockLogs);
      expect(mockSuppressionLogRepository.find).toHaveBeenCalledWith({
        where: { userId: 'user-1' },
        order: { createdAt: 'DESC' },
        take: 50,
      });
    });

    it('should filter by event category', async () => {
      mockSuppressionLogRepository.find.mockResolvedValue([]);

      await service.getSuppressionLogs(undefined, 'price', 10);

      expect(mockSuppressionLogRepository.find).toHaveBeenCalledWith({
        where: { eventCategory: 'price' },
        order: { createdAt: 'DESC' },
        take: 10,
      });
    });
  });
});
