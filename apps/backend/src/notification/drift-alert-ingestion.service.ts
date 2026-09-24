import { Injectable, Logger } from '@nestjs/common';
import { NotificationService } from './notification.service';
import { NotificationType, NotificationSeverity } from './notification.entity';
import { DriftAlertRequestDto } from './dto/drift-alert.dto';

const DEFAULT_DRIFT_SEVERITY = NotificationSeverity.HIGH;

/**
 * How many recently accepted alert IDs to remember for duplicate
 * suppression. The primary dedup happens in the data-processing alert
 * engine; this guards against retry storms re-creating the same alert.
 */
const DEDUP_CACHE_SIZE = 1_000;

@Injectable()
export class DriftAlertIngestionService {
  private readonly logger = new Logger(DriftAlertIngestionService.name);
  private readonly recentAlertIds = new Set<string>();
  private readonly dedupOrder: string[] = [];

  constructor(private readonly notificationService: NotificationService) {}

  /**
   * Persist a drift alert as a backend notification.
   *
   * Called from the authenticated ingest controller. Delivery to channels
   * (push, etc.) is not fanned out here — the notification is created as a
   * broadcast (userId null) unless explicit target users are provided,
   * mirroring how system-level anomaly notifications are stored.
   */
  async ingestAlert(dto: DriftAlertRequestDto): Promise<{
    created: boolean;
    notificationIds: string[];
    duplicate: boolean;
  }> {
    if (dto.alertId && this.recentAlertIds.has(dto.alertId)) {
      this.logger.log(
        `Duplicate drift alert ${dto.alertId} ignored (already accepted recently)`,
      );
      return { created: false, notificationIds: [], duplicate: true };
    }

    const metadata: Record<string, unknown> = {
      ...(dto.metadata ?? {}),
      source: 'data-processing',
      alertId: dto.alertId ?? null,
    };

    const notificationType =
      dto.type === NotificationType.ANOMALY
        ? NotificationType.ANOMALY
        : (dto.type as NotificationType);

    const targetUserIds = dto.targetUserIds?.length
      ? [...new Set(dto.targetUserIds)]
      : [null];

    const notificationIds: string[] = [];
    for (const userId of targetUserIds) {
      const notification = await this.notificationService.create({
        type: notificationType,
        title: dto.title,
        message: dto.message,
        severity: dto.severity ?? DEFAULT_DRIFT_SEVERITY,
        metadata,
        userId,
      });
      notificationIds.push(notification.id);
    }

    if (dto.alertId) {
      this.rememberAlertId(dto.alertId);
    }

    this.logger.log(
      `Drift alert ingested: type=${notificationType} severity=${dto.severity} ` +
        `notifications=${notificationIds.length} alertId=${dto.alertId ?? 'n/a'}`,
    );

    return { created: true, notificationIds, duplicate: false };
  }

  private rememberAlertId(alertId: string): void {
    if (this.recentAlertIds.has(alertId)) {
      return;
    }
    this.recentAlertIds.add(alertId);
    this.dedupOrder.push(alertId);
    while (this.dedupOrder.length > DEDUP_CACHE_SIZE) {
      const oldest = this.dedupOrder.shift();
      if (oldest !== undefined) {
        this.recentAlertIds.delete(oldest);
      }
    }
  }
}
