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

@Injectable()
export class WebhookService {
  private readonly logger = new Logger(WebhookService.name);
  private readonly webhookSecret: string;

  constructor(
    private readonly configService: ConfigService,
    private readonly notificationService: NotificationService,
    private readonly deliveryService: NotificationDeliveryService,
  ) {
    this.webhookSecret = this.configService.get<string>('WEBHOOK_SECRET', '');
  }

  /**
   * Legacy signature verification (kept for backward compatibility)
   * New implementations should use WebhookVerificationGuard
   */
  verifySignature(rawBody: Buffer, signatureHeader: string): void {
    if (!this.webhookSecret) {
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

    const expectedHash = crypto
      .createHmac('sha256', this.webhookSecret)
      .update(rawBody)
      .digest('hex');

    const expected = Buffer.from(expectedHash, 'hex');
    const received = Buffer.from(receivedHash, 'hex');

    if (
      expected.length !== received.length ||
      !crypto.timingSafeEqual(expected, received)
    ) {
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
