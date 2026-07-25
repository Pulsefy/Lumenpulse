import { Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { NotificationService, CreateNotificationDto } from './notification.service';
import { NotificationPreferenceService } from './notification-preference.service';
import { NotificationDeliveryService } from './notification-delivery.service';
import {
  NotificationSuppressionLog,
  SuppressionReason,
} from './notification-suppression-log.entity';
import {
  NotificationPreference,
} from './notification-preference.entity';
import { WatchlistItem, WatchlistItemType } from '../watchlist/watchlist-item.entity';
import { NotificationType, NotificationSeverity } from './notification.entity';
import { EventCategory } from '../common/event-catalog';
import {
  FanoutRequestDto,
  FanoutResultDto,
} from './dto/fanout.dto';

/**
 * Maps notification types to the watchlist item type they relate to.
 * Used to resolve which users' watchlists are relevant for a given event.
 */
const NOTIFICATION_TO_WATCHLIST_TYPE: Record<string, WatchlistItemType> = {
  [NotificationType.PROJECT]: WatchlistItemType.PROJECT,
  [NotificationType.CONTRIBUTION]: WatchlistItemType.PROJECT,
  [NotificationType.MILESTONE]: WatchlistItemType.PROJECT,
  [NotificationType.GOVERNANCE]: WatchlistItemType.PROJECT,
  [NotificationType.TOKEN]: WatchlistItemType.ASSET,
  [NotificationType.POOL]: WatchlistItemType.ASSET,
  [NotificationType.PRICE]: WatchlistItemType.ASSET,
};

/**
 * Maps EventCategory to the NotificationEventCategory strings used in preferences
 */
const EVENT_CATEGORY_TO_PREFERENCE_KEY: Record<string, string> = {
  [EventCategory.PROJECT]: 'project',
  [EventCategory.CONTRIBUTION]: 'contribution',
  [EventCategory.MILESTONE]: 'milestone',
  [EventCategory.GOVERNANCE]: 'governance',
  [EventCategory.TOKEN]: 'token',
  [EventCategory.POOL]: 'pool',
  [EventCategory.PRICE]: 'price',
  [EventCategory.MODULE]: 'system_alert',
  [EventCategory.ADMIN]: 'system_alert',
  [EventCategory.REPUTATION]: 'portfolio_update',
  [EventCategory.SYSTEM]: 'anomaly',
};

@Injectable()
export class NotificationFanoutService {
  private readonly logger = new Logger(NotificationFanoutService.name);

  constructor(
    private readonly notificationService: NotificationService,
    private readonly preferenceService: NotificationPreferenceService,
    private readonly deliveryService: NotificationDeliveryService,
    @InjectRepository(WatchlistItem)
    private readonly watchlistRepository: Repository<WatchlistItem>,
    @InjectRepository(NotificationSuppressionLog)
    private readonly suppressionLogRepository: Repository<NotificationSuppressionLog>,
  ) {}

  /**
   * Fan out a notification to all users whose watchlists match the event context,
   * filtered by their stored notification preferences.
   */
  async fanout(request: FanoutRequestDto): Promise<FanoutResultDto> {
    const { notification, targetUserIds, symbols } = request;
    const eventCategoryKey =
      EVENT_CATEGORY_TO_PREFERENCE_KEY[notification.eventCategory] ??
      notification.eventCategory;

    // Resolve target user IDs from watchlists or explicit list
    const resolvedUserIds = await this.resolveTargetUsers(
      notification.type,
      notification.metadata,
      targetUserIds,
      symbols,
    );

    this.logger.log(
      `Fanout for ${notification.type} [${notification.eventCategory}]: ` +
        `${resolvedUserIds.length} target users resolved`,
    );

    const result: FanoutResultDto = {
      totalTargeted: resolvedUserIds.length,
      delivered: 0,
      suppressed: 0,
      suppressionBreakdown: {},
      notificationIds: [],
    };

    // Process each target user
    for (const userId of resolvedUserIds) {
      const suppressionReason = await this.checkSuppression(
        userId,
        eventCategoryKey,
        notification.severity,
      );

      if (suppressionReason) {
        result.suppressed++;
        result.suppressionBreakdown[suppressionReason] =
          (result.suppressionBreakdown[suppressionReason] ?? 0) + 1;

        await this.logSuppression(
          userId,
          notification.eventCategory,
          notification.type,
          suppressionReason,
        );
        continue;
      }

      // Create the notification for this user
      const createDto: CreateNotificationDto = {
        type: notification.type,
        title: notification.title,
        message: notification.message,
        severity: notification.severity,
        metadata: {
          ...notification.metadata,
          fanout: true,
          eventCategory: notification.eventCategory,
        },
        userId,
      };

      const savedNotification =
        await this.notificationService.create(createDto);

      result.notificationIds.push(savedNotification.id);

      // Deliver to all enabled channels
      try {
        const logs = await this.deliveryService.deliverToUser(
          savedNotification,
          userId,
          eventCategoryKey,
        );
        result.delivered += logs.length > 0 ? 1 : 0;
      } catch (error) {
        this.logger.error(
          `Delivery failed for user ${userId}, notification ${savedNotification.id}`,
          error,
        );
      }
    }

    this.logger.log(
      `Fanout complete: ${result.delivered} delivered, ` +
        `${result.suppressed} suppressed out of ${result.totalTargeted} targeted`,
    );

    return result;
  }

  /**
   * Resolve which users should receive this notification based on
   * watchlist membership and/or explicit targeting.
   */
  private async resolveTargetUsers(
    notificationType: string,
    metadata: Record<string, unknown> | undefined,
    explicitUserIds: string[] | undefined,
    explicitSymbols: string[] | undefined,
  ): Promise<string[]> {
    // If explicit user IDs are provided, use those directly
    if (explicitUserIds && explicitUserIds.length > 0) {
      return [...new Set(explicitUserIds)];
    }

    // Determine symbols to match against watchlists
    const symbolsToMatch = this.extractSymbolsFromMetadata(
      notificationType,
      metadata,
      explicitSymbols,
    );

    if (symbolsToMatch.length === 0) {
      this.logger.warn(
        `No symbols resolved for fanout of ${notificationType}. ` +
          `Provide explicit targetUserIds or ensure metadata contains relevant identifiers.`,
      );
      return [];
    }

    // Determine watchlist type to filter by
    const watchlistType = NOTIFICATION_TO_WATCHLIST_TYPE[notificationType];

    // Find all users who have any of these symbols in their watchlist
    const query = this.watchlistRepository
      .createQueryBuilder('w')
      .select('DISTINCT w.userId', 'userId')
      .where('w.symbol IN (:...symbols)', { symbols: symbolsToMatch });

    if (watchlistType) {
      query.andWhere('w.type = :type', { type: watchlistType });
    }

    const rows = await query.getRawMany<{ userId: string }>();
    return rows.map((r) => r.userId);
  }

  /**
   * Extract relevant symbols from the notification metadata.
   * Supports explicit symbols override, then falls back to metadata fields.
   */
  private extractSymbolsFromMetadata(
    notificationType: string,
    metadata: Record<string, unknown> | undefined,
    explicitSymbols: string[] | undefined,
  ): string[] {
    if (explicitSymbols && explicitSymbols.length > 0) {
      return explicitSymbols.map((s) => s.toUpperCase());
    }

    if (!metadata) return [];

    const symbols: string[] = [];

    // Common metadata fields that contain symbol references
    const symbolFields = ['symbol', 'symbols', 'tokenSymbol', 'assetSymbol'];
    for (const field of symbolFields) {
      const val = metadata[field];
      if (typeof val === 'string') {
        symbols.push(val.toUpperCase());
      } else if (Array.isArray(val)) {
        symbols.push(...val.filter((v): v is string => typeof v === 'string').map((v) => v.toUpperCase()));
      }
    }

    // For project-related events, use projectId as a fallback symbol
    if (
      [NotificationType.PROJECT, NotificationType.CONTRIBUTION, NotificationType.MILESTONE].includes(
        notificationType as NotificationType,
      )
    ) {
      const projectId = metadata['projectId'] as string | undefined;
      if (projectId && !symbols.includes(projectId.toUpperCase())) {
        symbols.push(projectId.toUpperCase());
      }
    }

    return [...new Set(symbols)];
  }

  /**
   * Check whether a notification to a specific user should be suppressed.
   * Returns the suppression reason or null if delivery should proceed.
   */
  private async checkSuppression(
    userId: string,
    eventCategoryKey: string,
    severity: NotificationSeverity,
  ): Promise<SuppressionReason | null> {
    // Check preferences exist
    let preferences: NotificationPreference;
    try {
      preferences = await this.preferenceService.findByUserId(userId);
    } catch {
      // No preferences found - user gets default delivery (not suppressed)
      return null;
    }

    // Check quiet hours
    if (this.preferenceService.isWithinQuietHours(preferences, severity)) {
      return SuppressionReason.QUIET_HOURS;
    }

    // Check severity threshold
    if (
      !this.preferenceService.meetsSeverityThreshold(
        preferences,
        severity,
        eventCategoryKey,
      )
    ) {
      return SuppressionReason.SEVERITY_THRESHOLD;
    }

    // Check daily limit
    if (await this.preferenceService.hasReachedDailyLimit(userId)) {
      return SuppressionReason.DAILY_LIMIT;
    }

    // Check if event category is disabled
    const eventPref = preferences.eventPreferences[eventCategoryKey];
    if (eventPref && !eventPref.enabled) {
      return SuppressionReason.EVENT_CATEGORY_DISABLED;
    }

    return null;
  }

  /**
   * Record a suppression event for debugging and observability.
   */
  private async logSuppression(
    userId: string,
    eventCategory: string,
    notificationType: string,
    reason: SuppressionReason,
  ): Promise<void> {
    try {
      const log = this.suppressionLogRepository.create({
        userId,
        eventCategory,
        notificationType,
        reason,
        metadata: { timestamp: new Date().toISOString() },
      });
      await this.suppressionLogRepository.save(log);
    } catch (error) {
      this.logger.error(
        `Failed to log suppression for user ${userId}: ${error}`,
      );
    }
  }

  /**
   * Retrieve suppression logs for observability/debugging.
   */
  async getSuppressionLogs(
    userId?: string,
    eventCategory?: string,
    limit: number = 50,
  ): Promise<NotificationSuppressionLog[]> {
    const where: Record<string, unknown> = {};
    if (userId) where.userId = userId;
    if (eventCategory) where.eventCategory = eventCategory;

    return this.suppressionLogRepository.find({
      where,
      order: { createdAt: 'DESC' },
      take: limit,
    });
  }
}
