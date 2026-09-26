import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  IsString,
  IsEnum,
  IsOptional,
  IsUUID,
  IsObject,
  IsArray,
  MaxLength,
} from 'class-validator';
import { Type } from 'class-transformer';
import { NotificationType, NotificationSeverity } from '../notification.entity';
import { EventCategory } from '../../common/event-catalog';

/**
 * Payload accepted from the Python data-processing service when it routes a
 * drift alert (#1447) into the backend notification system. This is a thin
 * wrapper around the existing notification creation model: the severity is
 * validated against the backend's NotificationSeverity enum, which is the
 * backend notification priority model (low | medium | high | critical).
 */
export class DriftAlertRequestDto {
  @ApiProperty({
    description: 'Notification type for the drift alert',
    enum: NotificationType,
    example: NotificationType.DRIFT,
  })
  @IsEnum(NotificationType)
  type: NotificationType;

  @ApiProperty({ description: 'Notification title' })
  @IsString()
  @MaxLength(255)
  title: string;

  @ApiProperty({ description: 'Notification message body' })
  @IsString()
  message: string;

  @ApiProperty({
    description:
      'Priority/severity of the notification (backend priority model: low | medium | high | critical)',
    enum: NotificationSeverity,
    example: NotificationSeverity.HIGH,
  })
  @IsEnum(NotificationSeverity)
  severity: NotificationSeverity;

  @ApiPropertyOptional({
    description: 'Event category for preference matching',
    enum: EventCategory,
    example: EventCategory.SYSTEM,
  })
  @IsEnum(EventCategory)
  @IsOptional()
  eventCategory?: EventCategory;

  @ApiPropertyOptional({
    description:
      'Idempotency identifier for this alert (dedup key produced by the alert suppression engine). ' +
      'Repeat deliveries with the same alertId are acknowledged but not re-created.',
  })
  @IsUUID()
  @IsOptional()
  alertId?: string;

  @ApiPropertyOptional({
    description: 'Metadata context for the alert (drift findings, run id, ...)',
  })
  @IsObject()
  @IsOptional()
  @Type(() => Object)
  metadata?: Record<string, unknown>;

  @ApiPropertyOptional({
    description:
      'Optional specific user IDs to target. If omitted the notification is created as a broadcast (visible to all users).',
    type: [String],
  })
  @IsArray()
  @IsString({ each: true })
  @IsOptional()
  targetUserIds?: string[];
}

export class DriftAlertResponseDto {
  @ApiProperty({ description: 'Whether a notification was created' })
  created: boolean;

  @ApiProperty({
    description: 'IDs of notifications created (empty when deduplicated)',
    type: [String],
  })
  notificationIds: string[];

  @ApiProperty({
    description:
      'Whether this delivery was a duplicate of a previously accepted alert',
  })
  duplicate: boolean;
}
