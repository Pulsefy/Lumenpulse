import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { NotificationService } from './notification.service';
import { NotificationPreferenceService } from './notification-preference.service';
import { NotificationChannel } from './notification-preference.entity';
import { Notification } from './notification.entity';
import {
  NotificationDeliveryLog,
  DeliveryStatus,
} from './notification-delivery-log.entity';
import { PushToken } from './push-token.entity';
import { QueryProfilerService } from '../common/profiling/query-profiler.service';
import { MetricsService } from '../metrics/metrics.service';
import { NotificationSeverity } from './notification.entity';

/**
 * Notification Delivery Orchestration Service
 * Routes notifications to the appropriate delivery channels based on user preferences
 */
@Injectable()
export class NotificationDeliveryService implements OnModuleInit {
  private readonly logger = new Logger(NotificationDeliveryService.name);

  constructor(
    private readonly notificationService: NotificationService,
    private readonly preferenceService: NotificationPreferenceService,
    @InjectRepository(NotificationDeliveryLog)
    private readonly deliveryLogRepository: Repository<NotificationDeliveryLog>,
    @InjectRepository(PushToken)
    private readonly pushTokenRepository: Repository<PushToken>,
    private readonly profiler: QueryProfilerService,
    private readonly metricsService: MetricsService,
  ) {}

  onModuleInit() {
    this.logger.log('Notification delivery service initialized');
  }

  /**
   * Deliver a notification to all enabled channels for a user
   */
  async deliverToUser(
    notification: Notification,
    userId: string,
    eventCategory?: string,
  ): Promise<NotificationDeliveryLog[]> {
    return this.profiler.profile(
      async () => this.doDeliverToUser(notification, userId, eventCategory),
      { label: 'NotificationDeliveryService.deliverToUser', thresholdMs: 300 },
    );
  }

  private async doDeliverToUser(
    notification: Notification,
    userId: string,
    eventCategory?: string,
  ): Promise<NotificationDeliveryLog[]> {
    const deliveryLogs: NotificationDeliveryLog[] = [];

    try {
      // Get user preferences
      const preferences = await this.preferenceService.findByUserId(userId);

      // Check quiet hours
      if (
        this.preferenceService.isWithinQuietHours(
          preferences,
          notification.severity,
        )
      ) {
        this.logger.log(
          `Skipping notification ${notification.id} for user ${userId} - within quiet hours`,
        );
        return deliveryLogs;
      }

      // Check severity threshold
      if (
        !this.preferenceService.meetsSeverityThreshold(
          preferences,
          notification.severity,
          eventCategory,
        )
      ) {
        this.logger.log(
          `Skipping notification ${notification.id} for user ${userId} - below severity threshold`,
        );
        return deliveryLogs;
      }

      // Check daily limit
      if (await this.preferenceService.hasReachedDailyLimit(userId)) {
        this.logger.log(
          `Skipping notification ${notification.id} for user ${userId} - daily limit reached`,
        );
        return deliveryLogs;
      }

      // Get enabled channels for this event
      const enabledChannels = eventCategory
        ? await this.preferenceService.getEnabledChannelsForEvent(
            userId,
            eventCategory,
          )
        : preferences.enabledChannels;

      let anySuccess = false;
      // Deliver to each enabled channel
      for (const channel of enabledChannels) {
        const deliveryLog = await this.deliverToChannel(
          notification,
          userId,
          channel,
          eventCategory,
        );
        deliveryLogs.push(deliveryLog);
        if (deliveryLog.status === DeliveryStatus.DELIVERED) {
          anySuccess = true;
        }
      }

      // Fallback for critical notifications
      if (!anySuccess && notification.severity === NotificationSeverity.CRITICAL) {
        const fallbackChannel = NotificationChannel.EMAIL; // or SMS
        if (!enabledChannels.includes(fallbackChannel)) {
          this.logger.warn(`All preferred channels failed for critical notification ${notification.id}, using fallback: ${fallbackChannel}`);
          const fallbackLog = await this.deliverToChannel(
            notification,
            userId,
            fallbackChannel,
            eventCategory,
          );
          deliveryLogs.push(fallbackLog);
        }
      }

      return deliveryLogs;
    } catch (error) {
      this.logger.error(
        `Failed to deliver notification ${notification.id} to user ${userId}`,
        error,
      );
      throw error;
    }
  }

  
  private async deliverWithRetry(
    channelFn: () => Promise<void>,
    maxRetries: number = 3,
  ): Promise<void> {
    for (let attempt = 0; attempt <= maxRetries; attempt++) {
      try {
        await channelFn();
        return;
      } catch (error) {
        if (attempt === maxRetries) {
          throw error;
        }
        const delay = Math.pow(2, attempt) * 1000;
        await new Promise((resolve) => setTimeout(resolve, delay));
      }
    }
  }

  private async deliverToChannel(
    notification: Notification,
    userId: string,
    channel: NotificationChannel,
    eventCategory?: string,
  ): Promise<NotificationDeliveryLog> {
    const deliveryLog = this.deliveryLogRepository.create({
      notificationId: notification.id,
      userId,
      channel,
      status: DeliveryStatus.PENDING,
      eventCategory: eventCategory ?? null,
      severity: notification.severity,
      retryCount: 0,
    });

    try {
      this.metricsService.incrementCounter('notification_delivery_attempts_total', { channel });
      
      let deliveryFn: () => Promise<void>;
      
      switch (channel) {
        case NotificationChannel.IN_APP:
          deliveryFn = () => this.deliverInApp(notification, userId);
          break;
        case NotificationChannel.EMAIL:
          deliveryFn = () => this.deliverEmail(notification, userId);
          break;
        case NotificationChannel.PUSH:
          deliveryFn = () => this.deliverPush(notification, userId);
          break;
        case NotificationChannel.WEBHOOK:
          deliveryFn = () => this.deliverWebhook(notification, userId);
          break;
        case NotificationChannel.SMS:
          deliveryFn = () => this.deliverSMS(notification, userId);
          break;
        default:
          throw new Error(`Unknown channel: ${channel as string}`);
      }

      // 3 retries max by default
      await this.deliverWithRetry(async () => {
        deliveryLog.retryCount++;
        await deliveryFn();
      }, 3);

      deliveryLog.status = DeliveryStatus.DELIVERED;
      this.metricsService.incrementCounter('notification_delivery_successes_total', { channel });
    } catch (error) {
      deliveryLog.status = DeliveryStatus.PERMANENT_FAILURE;
      deliveryLog.errorMessage = error instanceof Error ? error.message : 'Unknown error';
      deliveryLog.metadata = { error: error instanceof Error ? error.stack : undefined };
      
      this.metricsService.incrementCounter('notification_delivery_permanent_failures_total', { channel });

      this.logger.error(`Permanent failure delivering via ${channel} to user ${userId}`, error);
    }

    return this.deliveryLogRepository.save(deliveryLog);
  }
/**
   * Deliver notification in-app (already stored in database)
   */
  private async deliverInApp(
    notification: Notification,
    userId: string,
  ): Promise<void> {
    // In-app notifications are already stored in the notification table
    // Just mark as delivered
    this.logger.log(
      `In-app notification ${notification.id} delivered to user ${userId}`,
    );
    await Promise.resolve();
  }

  /**
   * Deliver notification via email
   */
  private async deliverEmail(
    notification: Notification,
    userId: string,
  ): Promise<void> {
    // TODO(#1021): Implement email delivery
    // This would integrate with an email service (e.g., SendGrid, AWS SES)
    this.logger.log(
      `Email notification ${notification.id} sent to user ${userId}`,
    );
    await Promise.resolve();
  }

  /**
   * Deliver notification via push notification
   */
  private async deliverPush(
    notification: Notification,
    userId: string,
  ): Promise<void> {
    // Get user's active push tokens
    const tokens = await this.pushTokenRepository.find({
      where: { userId, isActive: true },
    });

    if (tokens.length === 0) {
      this.logger.warn(
        `No active push tokens for user ${userId}, skipping push delivery`,
      );
      return;
    }

    // TODO(#1022): Implement push notification delivery
    // This would integrate with FCM (Firebase Cloud Messaging) or APNs
    for (const token of tokens) {
      this.logger.log(
        `Push notification ${notification.id} sent to device ${token.id}`,
      );
    }
  }

  /**
   * Deliver notification via webhook
   */
  private async deliverWebhook(
    notification: Notification,
    userId: string,
  ): Promise<void> {
    // TODO(#1023): Implement webhook delivery
    // This would send an HTTP POST to a user-configured webhook URL
    this.logger.log(
      `Webhook notification ${notification.id} sent for user ${userId}`,
    );
    await Promise.resolve();
  }

  /**
   * Deliver notification via SMS
   */
  private async deliverSMS(
    notification: Notification,
    userId: string,
  ): Promise<void> {
    // TODO(#1024): Implement SMS delivery
    // This would integrate with Twilio or similar SMS service
    this.logger.log(
      `SMS notification ${notification.id} sent to user ${userId}`,
    );
    await Promise.resolve();
  }

  /**
   * Get delivery logs for a notification
   */
  async getDeliveryLogsForNotification(
    notificationId: string,
  ): Promise<NotificationDeliveryLog[]> {
    return this.deliveryLogRepository.find({
      where: { notificationId },
      order: { createdAt: 'DESC' },
    });
  }

  /**
   * Get delivery logs for a user
   */
  async getDeliveryLogsForUser(
    userId: string,
    limit: number = 50,
  ): Promise<NotificationDeliveryLog[]> {
    return this.profiler.profile(
      () =>
        this.deliveryLogRepository.find({
          where: { userId },
          order: { createdAt: 'DESC' },
          take: limit,
        }),
      {
        label: 'NotificationDeliveryService.getDeliveryLogsForUser',
        thresholdMs: 150,
      },
    );
  }

  /**
   * Retry failed deliveries
   */
  async retryFailedDeliveries(maxRetries: number = 3): Promise<number> {
    const failedDeliveries = await this.deliveryLogRepository.find({
      where: {
        status: DeliveryStatus.PERMANENT_FAILURE,
        retryCount: maxRetries,
      },
    });

    let retryCount = 0;
    for (const delivery of failedDeliveries) {
      try {
        delivery.retryCount += 1;
        delivery.status = DeliveryStatus.PENDING;
        delivery.errorMessage = null;
        await this.deliveryLogRepository.save(delivery);

        // TODO(#1025): Re-queue for delivery
        retryCount++;
      } catch (error) {
        this.logger.error(`Failed to retry delivery ${delivery.id}`, error);
      }
    }

    this.logger.log(`Retried ${retryCount} failed deliveries`);
    return retryCount;
  }
}
