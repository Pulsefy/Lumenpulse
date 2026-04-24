import { Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { PushToken, PushTokenPlatform } from './push-token.entity';
import { DeepLinkDataDto } from './dto/deep-link.dto';

interface ExpoPushMessage {
  to: string;
  title: string;
  body: string;
  data?: Record<string, unknown>;
  sound?: string;
  priority?: 'default' | 'normal' | 'high';
  channelId?: string;
}

interface ExpoPushTicket {
  status: 'ok' | 'error';
  id?: string;
  message?: string;
  details?: {
    error?: string;
  };
}

@Injectable()
export class PushNotificationService {
  private readonly logger = new Logger(PushNotificationService.name);
  private readonly expoPushUrl = 'https://exp.host/--/api/v2/push/send';

  constructor(
    @InjectRepository(PushToken)
    private readonly pushTokenRepository: Repository<PushToken>,
  ) {}

  /**
   * Register a device push token for a user
   */
  async registerToken(
    userId: string,
    token: string,
    platform: string,
    deviceName?: string | null,
  ): Promise<PushToken> {
    this.logger.log(`Registering push token for user ${userId}`);

    // Deactivate any existing token with the same value
    const existing = await this.pushTokenRepository.findOne({
      where: { token },
    });

    if (existing) {
      existing.userId = userId;
      existing.platform = this.parsePlatform(platform);
      existing.deviceName = deviceName || null;
      existing.isActive = true;
      return this.pushTokenRepository.save(existing);
    }

    const pushToken = this.pushTokenRepository.create({
      userId,
      token,
      platform: this.parsePlatform(platform),
      deviceName: deviceName || null,
      isActive: true,
    } as Partial<PushToken>);

    return this.pushTokenRepository.save(pushToken as PushToken);
  }

  /**
   * Unregister (deactivate) a device push token
   */
  async unregisterToken(userId: string, token: string): Promise<void> {
    this.logger.log(`Unregistering push token for user ${userId}`);
    await this.pushTokenRepository.update(
      { userId, token },
      { isActive: false },
    );
  }

  /**
   * Get all active push tokens for a user
   */
  async getActiveTokensForUser(userId: string): Promise<PushToken[]> {
    return this.pushTokenRepository.find({
      where: { userId, isActive: true },
    });
  }

  /**
   * Send push notification to a specific user
   */
  async sendToUser(
    userId: string,
    title: string,
    body: string,
    deepLink?: DeepLinkDataDto,
    extraData?: Record<string, unknown>,
  ): Promise<{ success: number; failed: number }> {
    const tokens = await this.getActiveTokensForUser(userId);

    if (tokens.length === 0) {
      this.logger.warn(`No active push tokens found for user ${userId}`);
      return { success: 0, failed: 0 };
    }

    return this.sendToTokens(
      tokens.map((t) => t.token),
      title,
      body,
      deepLink,
      extraData,
    );
  }

  /**
   * Send push notification to multiple tokens
   */
  async sendToTokens(
    tokens: string[],
    title: string,
    body: string,
    deepLink?: DeepLinkDataDto,
    extraData?: Record<string, unknown>,
  ): Promise<{ success: number; failed: number }> {
    if (tokens.length === 0) {
      return { success: 0, failed: 0 };
    }

    const messages: ExpoPushMessage[] = tokens.map((token) => ({
      to: token,
      title,
      body,
      sound: 'default',
      priority: 'high',
      channelId: 'default',
      data: {
        ...extraData,
        ...(deepLink ? { deepLink } : {}),
      },
    }));

    try {
      const response = await fetch(this.expoPushUrl, {
        method: 'POST',
        headers: {
          'Accept': 'application/json',
          'Accept-Encoding': 'gzip, deflate',
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(messages),
      });

      if (!response.ok) {
        const errorText = await response.text();
        this.logger.error(`Expo push API error: ${errorText}`);
        return { success: 0, failed: tokens.length };
      }

      const result = (await response.json()) as { data: ExpoPushTicket[] };
      let success = 0;
      let failed = 0;

      result.data.forEach((ticket, index) => {
        if (ticket.status === 'ok') {
          success++;
        } else {
          failed++;
          this.logger.warn(
            `Push failed for token ${tokens[index]}: ${ticket.message}`,
          );
          // Deactivate invalid tokens
          if (ticket.details?.error === 'DeviceNotRegistered') {
            this.deactivateToken(tokens[index]).catch(() => {});
          }
        }
      });

      this.logger.log(
        `Push notification sent: ${success} success, ${failed} failed`,
      );
      return { success, failed };
    } catch (error: unknown) {
      this.logger.error(
        `Failed to send push notification: ${
          error instanceof Error ? error.message : 'Unknown error'
        }`,
      );
      return { success: 0, failed: tokens.length };
    }
  }

  /**
   * Send push notification to all active tokens (broadcast)
   */
  async broadcast(
    title: string,
    body: string,
    deepLink?: DeepLinkDataDto,
    extraData?: Record<string, unknown>,
  ): Promise<{ success: number; failed: number }> {
    const tokens = await this.pushTokenRepository.find({
      where: { isActive: true },
    });

    if (tokens.length === 0) {
      this.logger.warn('No active push tokens found for broadcast');
      return { success: 0, failed: 0 };
    }

    // Send in batches of 100 (Expo limit)
    let totalSuccess = 0;
    let totalFailed = 0;
    const batchSize = 100;

    for (let i = 0; i < tokens.length; i += batchSize) {
      const batch = tokens.slice(i, i + batchSize);
      const result = await this.sendToTokens(
        batch.map((t) => t.token),
        title,
        body,
        deepLink,
        extraData,
      );
      totalSuccess += result.success;
      totalFailed += result.failed;
    }

    return { success: totalSuccess, failed: totalFailed };
  }

  /**
   * Send notification for key lifecycle events with appropriate deep links
   */
  async sendLifecycleNotification(
    userId: string,
    eventType: 'price_alert' | 'transaction_complete' | 'news_update' | 'security_alert',
    payload: {
      title: string;
      body: string;
      entityId?: string;
      entityType?: string;
      extraParams?: Record<string, unknown>;
    },
  ): Promise<{ success: number; failed: number }> {
    const deepLink = this.buildDeepLinkForEvent(eventType, payload);

    return this.sendToUser(
      userId,
      payload.title,
      payload.body,
      deepLink,
      { eventType, entityId: payload.entityId },
    );
  }

  private buildDeepLinkForEvent(
    eventType: string,
    payload: {
      entityId?: string;
      entityType?: string;
      extraParams?: Record<string, unknown>;
    },
  ): DeepLinkDataDto | undefined {
    switch (eventType) {
      case 'price_alert':
        return {
          screen: 'asset_detail' as any,
          id: payload.entityId,
          params: payload.extraParams,
        };
      case 'transaction_complete':
        return {
          screen: 'transaction_detail' as any,
          id: payload.entityId,
          params: payload.extraParams,
        };
      case 'news_update':
        return {
          screen: 'news_detail' as any,
          id: payload.entityId,
          params: payload.extraParams,
        };
      case 'security_alert':
        return {
          screen: 'settings_notifications' as any,
          params: payload.extraParams,
        };
      default:
        return undefined;
    }
  }

  private async deactivateToken(token: string): Promise<void> {
    await this.pushTokenRepository.update(
      { token },
      { isActive: false },
    );
  }

  private parsePlatform(platform: string): PushTokenPlatform {
    switch (platform.toLowerCase()) {
      case 'ios':
        return PushTokenPlatform.IOS;
      case 'web':
        return PushTokenPlatform.WEB;
      default:
        return PushTokenPlatform.ANDROID;
    }
  }
}
