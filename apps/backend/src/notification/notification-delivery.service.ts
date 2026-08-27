import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { NotificationService } from './notification.service';
import { NotificationPreferenceService } from './notification-preference.service';
import { NotificationChannel } from './notification-preference.entity';
import { Notification, NotificationSeverity } from './notification.entity';
import {
  NotificationDeliveryLog,
  DeliveryStatus,
} from './notification-delivery-log.entity';
import { PushToken } from './push-token.entity';
import { QueryProfilerService } from '../common/profiling/query-profiler.service';
import { MetricsService } from '../metrics/metrics.service';

/**
 * Notification Delivery Orchestration Service
 * Routes notifications to the appropriate delivery channels based on user preferences
 */
@Injectable()
export class NotificationDeliveryService implements OnModuleInit {
  private readonly logger = new Logger(NotificationDeliveryService.name);
  private readonly MAX_RETRIES = 3;

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

  private async sleep(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
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

      // Deliver to each enabled channel
      for (const channel of enabledChannels) {
        const deliveryLog = await this.deliverToChannel(
          notification,
          userId,
          channel,
          eventCategory,
        );
        deliveryLogs.push(deliveryLog);
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

  /**
   * Deliver notification to a specific channel
   */
  private async deliverToChannel(
    notification: Notification,
    userId: string,
    channel: NotificationChannel,
    eventCategory?: string,
  ): Promise<NotificationDeliveryLog> {
    // Create delivery log
    const deliveryLog = this.deliveryLogRepository.create({
      notificationId: notification.id,
      userId,
      channel,
      status: DeliveryStatus.PENDING,
      eventCategory: eventCategory ?? null,
      severity: notification.severity,
      retryCount: 0,
      metadata: {},
    });

    let success = false;
    let lastError: any;

    this.metricsService.incrementCounter('notification_delivery_attempts_total', { channel: channel as string });

    while (deliveryLog.retryCount <= this.MAX_RETRIES && !success) {
      try {
        switch (channel) {
          case NotificationChannel.IN_APP:
            await this.deliverInApp(notification, userId);
            deliveryLog.status = DeliveryStatus.DELIVERED;
            break;

          case NotificationChannel.EMAIL:
            await this.deliverEmail(notification, userId);
            deliveryLog.status = DeliveryStatus.SENT;
            break;

          case NotificationChannel.PUSH:
            await this.deliverPush(notification, userId);
            deliveryLog.status = DeliveryStatus.SENT;
            break;

          case NotificationChannel.WEBHOOK:
            await this.deliverWebhook(notification, userId);
            deliveryLog.status = DeliveryStatus.SENT;
            break;

          case NotificationChannel.SMS:
            await this.deliverSMS(notification, userId);
            deliveryLog.status = DeliveryStatus.SENT;
            break;

          default:
            deliveryLog.status = DeliveryStatus.FAILED;
            deliveryLog.errorMessage = `Unknown channel: ${channel as string}`;
            const unknownError = new Error(deliveryLog.errorMessage);
            (unknownError as any).isPermanent = true;
            throw unknownError;
        }

        success = true;
        this.metricsService.incrementCounter('notification_delivery_success_total', { channel: channel as string });
      } catch (error) {
        lastError = error;

        // Check if error is permanent
        const isPermanent = error instanceof Error && (error as any).isPermanent === true;

        if (isPermanent || deliveryLog.retryCount >= this.MAX_RETRIES) {
          break; // Exit retry loop for permanent failures or max retries reached
        }

        deliveryLog.retryCount++;
        const backoffMs = Math.pow(2, deliveryLog.retryCount) * 1000;
        this.logger.warn(`Delivery failed for ${channel}, retrying in ${backoffMs}ms... (Attempt ${deliveryLog.retryCount}/${this.MAX_RETRIES})`);
        await this.sleep(backoffMs);
      }
    }

    if (!success) {
      deliveryLog.status = DeliveryStatus.FAILED;
      deliveryLog.errorMessage = lastError instanceof Error ? lastError.message : 'Unknown error';
      deliveryLog.metadata = {
        ...((deliveryLog.metadata as object) || {}),
        error: lastError instanceof Error ? lastError.stack : undefined,
        isPermanentFailure: true,
        failureReason: deliveryLog.errorMessage,
      };

      this.logger.error(
        `Failed to deliver notification via ${channel} to user ${userId}. Permanent failure recorded.`,
        lastError,
      );
      this.metricsService.incrementCounter('notification_delivery_permanent_failures_total', { channel: channel as string });

      // Fallback for critical notifications
      if (notification.severity === NotificationSeverity.CRITICAL) {
        this.logger.log(`Attempting channel failover for critical notification ${notification.id}`);
        await this.attemptChannelFailover(notification, userId, channel, eventCategory);
      }
    }

    return this.deliveryLogRepository.save(deliveryLog);
  }

  /**
   * Attempt failover to alternate channel for critical notifications
   */
  private async attemptChannelFailover(
    notification: Notification,
    userId: string,
    failedChannel: NotificationChannel,
    eventCategory?: string,
  ): Promise<void> {
    const fallbackChannel = failedChannel === NotificationChannel.PUSH 
      ? NotificationChannel.EMAIL 
      : (failedChannel === NotificationChannel.EMAIL ? NotificationChannel.SMS : null);

    if (!fallbackChannel) {
      this.logger.log(`No fallback channel defined for failed channel ${failedChannel}`);
      return;
    }

    this.logger.log(`Failover channel selected: ${fallbackChannel} for notification ${notification.id}`);
    
    try {
      if (fallbackChannel === NotificationChannel.EMAIL) {
        await this.deliverEmail(notification, userId);
      } else if (fallbackChannel === NotificationChannel.SMS) {
        await this.deliverSMS(notification, userId);
      }
      this.logger.log(`Failover to ${fallbackChannel} succeeded`);
      this.metricsService.incrementCounter('notification_delivery_failover_success_total', { channel: fallbackChannel as string });
    } catch (err) {
      this.logger.error(`Failover to ${fallbackChannel} failed`, err);
    }
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
    // TODO(#1021): Implement primary email delivery
    // This would integrate with an email service (e.g., SendGrid)
    try {
      this.logger.log(
        `Email notification ${notification.id} sent to user ${userId} via Primary Provider`,
      );
      await Promise.resolve();
    } catch (error) {
      this.logger.warn(`Primary email provider failed, failing over to secondary...`);
      // TODO(#1021): Implement secondary email delivery
      // This would integrate with a fallback email service (e.g., AWS SES)
      this.logger.log(`Email notification ${notification.id} sent to user ${userId} via Secondary Provider`);
    }
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
      // We can mark this as a permanent failure so it doesn't keep retrying
      const error = new Error('No active push tokens available');
      (error as any).isPermanent = true;
      throw error;
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
        status: DeliveryStatus.FAILED,
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

        // TODO(#1025): Re-queue for delivery via background job processor
        retryCount++;
      } catch (error) {
        this.logger.error(`Failed to retry delivery ${delivery.id}`, error);
      }
    }

    this.logger.log(`Retried ${retryCount} failed deliveries`);
    return retryCount;
  }
}
