import {
  Injectable,
  Logger,
  UnauthorizedException,
  BadRequestException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import * as crypto from 'crypto';
import { DataProcessingWebhookDto } from './dto/webhook-payload.dto';
import { NotificationService } from '../notification/notification.service';
import { NotificationDeliveryService } from '../notification/notification-delivery.service';
import {
  NotificationType,
  NotificationSeverity,
  Notification,
} from '../notification/notification.entity';

interface WebhookSecretEntry {
  id: string;
  secret: string;
  active: boolean;
}

@Injectable()
export class WebhookService {
  private readonly logger = new Logger(WebhookService.name);

  constructor(
    private readonly configService: ConfigService,
    private readonly notificationService: NotificationService,
    private readonly deliveryService: NotificationDeliveryService,
  ) {}

  /**
   * Sign a payload using the active webhook secret for outgoing notifications.
   */
  signPayload(payload: any): string {
    const activeSecret = this.getActiveWebhookSecret();
    if (!activeSecret) {
      this.logger.warn(
        'WEBHOOK_SECRET is not set — cannot sign outgoing webhook',
      );
      return '';
    }

    return this.createSignatureHeader(
      JSON.stringify(payload),
      activeSecret.secret,
    );
  }

  /**
   * Build signature headers for current and previous secrets when rotation is enabled.
   */
  buildSignatureHeaders(
    payload: any,
    options?: { secretId?: string; previousSecretId?: string },
  ): Record<string, string> {
    const body = JSON.stringify(payload);
    const secrets = this.getConfiguredWebhookSecrets();
    const headers: Record<string, string> = {};

    const activeSecret = secrets.find((entry) => entry.active) ?? secrets[0];
    const previousSecret = secrets.find((entry) => !entry.active);

    if (activeSecret) {
      headers['X-Webhook-Signature'] = this.createSignatureHeader(
        body,
        activeSecret.secret,
      );
      headers['X-Webhook-Secret-Id'] = options?.secretId ?? activeSecret.id;
    }

    if (previousSecret) {
      headers['X-Webhook-Previous-Signature'] = this.createSignatureHeader(
        body,
        previousSecret.secret,
      );
      headers['X-Webhook-Previous-Secret-Id'] =
        options?.previousSecretId ?? previousSecret.id;
    }

    return headers;
  }

  private getActiveWebhookSecret(): WebhookSecretEntry | undefined {
    return this.getConfiguredWebhookSecrets().find((entry) => entry.active);
  }

  private getConfiguredWebhookSecrets(): WebhookSecretEntry[] {
    const secrets: WebhookSecretEntry[] = [];
    const legacySecret = this.configService.get<string>('WEBHOOK_SECRET', '');

    if (legacySecret) {
      secrets.push({
        id: this.configService.get<string>('WEBHOOK_SECRET_ID', 'default'),
        secret: legacySecret,
        active: true,
      });
    }

    const configuredSecrets = this.configService.get<string>(
      'WEBHOOK_SECRETS',
      '',
    );
    if (configuredSecrets) {
      try {
        const parsed = JSON.parse(configuredSecrets) as
          WebhookSecretEntry[] | WebhookSecretEntry;
        const entries = Array.isArray(parsed) ? parsed : [parsed];
        for (const entry of entries) {
          if (entry?.secret) {
            secrets.push({
              id: entry.id ?? 'configured-secret',
              secret: entry.secret,
              active: entry.active ?? false,
            });
          }
        }
      } catch (error) {
        this.logger.warn(
          'Failed to parse WEBHOOK_SECRETS; falling back to legacy secret configuration',
          error,
        );
      }
    }

    const previousSecret = this.configService.get<string>(
      'WEBHOOK_PREVIOUS_SECRET',
      '',
    );
    if (previousSecret) {
      secrets.push({
        id: this.configService.get<string>(
          'WEBHOOK_PREVIOUS_SECRET_ID',
          'previous',
        ),
        secret: previousSecret,
        active: false,
      });
    }

    return secrets.filter(
      (entry, index, collection) =>
        entry.secret &&
        index ===
          collection.findIndex(
            (candidate) =>
              candidate.id === entry.id && candidate.secret === entry.secret,
          ),
    );
  }

  private createSignatureHeader(body: string, secret: string): string {
    const hash = crypto.createHmac('sha256', secret).update(body).digest('hex');
    return `sha256=${hash}`;
  }

  /**
   * Legacy signature verification (kept for backward compatibility)
   * New implementations should use WebhookVerificationGuard
   */
  verifySignature(rawBody: Buffer, signatureHeader: string): void {
    const secrets = this.getConfiguredWebhookSecrets();
    if (!secrets.length) {
      this.logger.warn(
        'WEBHOOK_SECRET is not set — skipping signature verification',
      );
      return;
    }

    if (!signatureHeader) {
      throw new UnauthorizedException('Missing X-Webhook-Signature header');
    }

    const [scheme, receivedHash] = signatureHeader.split('=');
    if (scheme !== 'sha256' || !receivedHash) {
      throw new UnauthorizedException(
        'Invalid signature format — expected sha256=<hex>',
      );
    }

    const received = Buffer.from(receivedHash, 'hex');
    const matches = secrets.some((entry) => {
      const expectedHash = crypto
        .createHmac('sha256', entry.secret)
        .update(rawBody)
        .digest('hex');
      const expected = Buffer.from(expectedHash, 'hex');

      return (
        expected.length === received.length &&
        crypto.timingSafeEqual(expected, received)
      );
    });

    if (!matches) {
      throw new UnauthorizedException('Webhook signature mismatch');
    }
  }

  async handleDataProcessingEvent(
    payload: DataProcessingWebhookDto,
  ): Promise<Notification> {
    const {
      type,
      metric_name,
      severity_score,
      current_value,
      baseline_mean,
      z_score,
    } = payload;

    if (type !== 'anomaly' && type !== 'sentiment_spike') {
      throw new BadRequestException(`Unsupported event type: ${type}`);
    }

    const severity = this.resolveSeverity(severity_score);
    const title = this.buildTitle(type, metric_name, severity);
    const message = this.buildMessage(
      type,
      metric_name,
      current_value,
      baseline_mean,
      z_score,
      severity_score,
    );

    // Create the notification
    const notification = await this.notificationService.create({
      type:
        type === 'sentiment_spike'
          ? NotificationType.SENTIMENT_SPIKE
          : NotificationType.ANOMALY,
      title,
      message,
      severity,
      metadata: {
        metric_name,
        severity_score,
        current_value,
        baseline_mean,
        baseline_std: payload.baseline_std,
        z_score,
        timestamp: payload.timestamp,
      },
      userId: null, // broadcast — visible to all users
    });

    // TODO: In a production system, you'd want to deliver to specific users
    // based on their watchlists, portfolios, or preferences.
    // Example:
    // const usersToNotify = await this.getUsersForEvent(payload);
    // for (const user of usersToNotify) {
    //   await this.deliveryService.deliverToUser(
    //     notification,
    //     user.id,
    //     type,
    //   );
    // }

    return notification;
  }

  private resolveSeverity(score: number): NotificationSeverity {
    if (score >= 0.9) return NotificationSeverity.CRITICAL;
    if (score >= 0.7) return NotificationSeverity.HIGH;
    if (score >= 0.4) return NotificationSeverity.MEDIUM;
    return NotificationSeverity.LOW;
  }

  private buildTitle(
    type: string,
    metricName: string,
    severity: NotificationSeverity,
  ): string {
    const label =
      type === 'sentiment_spike' ? 'Sentiment Spike' : 'Anomaly Detected';
    const metric = metricName.replace(/_/g, ' ');
    return `[${severity.toUpperCase()}] ${label} in ${metric}`;
  }

  private buildMessage(
    type: string,
    metricName: string,
    currentValue: number,
    baselineMean: number,
    zScore: number,
    severityScore: number,
  ): string {
    const metric = metricName.replace(/_/g, ' ');
    const pct =
      baselineMean !== 0
        ? (((currentValue - baselineMean) / baselineMean) * 100).toFixed(1)
        : '0';
    const direction = currentValue >= baselineMean ? 'above' : 'below';

    if (type === 'sentiment_spike') {
      return (
        `Sentiment spike detected for ${metric}. ` +
        `Current value ${currentValue.toFixed(4)} is ${Math.abs(Number(pct))}% ${direction} baseline ` +
        `(z-score: ${zScore.toFixed(2)}, severity: ${(severityScore * 100).toFixed(0)}%).`
      );
    }

    return (
      `Anomaly detected in ${metric}. ` +
      `Current value ${currentValue.toFixed(2)} is ${Math.abs(Number(pct))}% ${direction} baseline of ${baselineMean.toFixed(2)} ` +
      `(z-score: ${zScore.toFixed(2)}, severity: ${(severityScore * 100).toFixed(0)}%).`
    );
  }
}
