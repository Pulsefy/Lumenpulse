import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  IsString,
  IsEnum,
  IsOptional,
  IsArray,
  ValidateNested,
  IsObject,
} from 'class-validator';
import { Type } from 'class-transformer';
import {
  NotificationType,
  NotificationSeverity,
} from '../notification.entity';
import { EventCategory } from '../../common/event-catalog';

export class FanoutNotificationDto {
  @ApiProperty({
    description: 'Type of notification event',
    enum: NotificationType,
  })
  @IsEnum(NotificationType)
  type: NotificationType;

  @ApiProperty({ description: 'Notification title' })
  @IsString()
  title: string;

  @ApiProperty({ description: 'Notification message body' })
  @IsString()
  message: string;

  @ApiProperty({
    description: 'Notification severity level',
    enum: NotificationSeverity,
  })
  @IsEnum(NotificationSeverity)
  severity: NotificationSeverity;

  @ApiProperty({
    description: 'Event category for preference matching',
    enum: EventCategory,
  })
  @IsEnum(EventCategory)
  eventCategory: EventCategory;

  @ApiPropertyOptional({
    description:
      'Metadata context for the event (e.g., projectId, symbol, poolId)',
  })
  @IsObject()
  @IsOptional()
  metadata?: Record<string, unknown>;
}

export class FanoutRequestDto {
  @ApiProperty({
    description: 'The notification event to fan out to targeted users',
    type: FanoutNotificationDto,
  })
  @ValidateNested()
  @Type(() => FanoutNotificationDto)
  notification: FanoutNotificationDto;

  @ApiPropertyOptional({
    description:
      'Specific user IDs to target. If omitted, targets all watchlist-matching users.',
    type: [String],
  })
  @IsArray()
  @IsString({ each: true })
  @IsOptional()
  targetUserIds?: string[];

  @ApiPropertyOptional({
    description:
      'Symbols to match against watchlists. If omitted, derived from notification metadata.',
    type: [String],
  })
  @IsArray()
  @IsString({ each: true })
  @IsOptional()
  symbols?: string[];
}

export class FanoutResultDto {
  @ApiProperty({ description: 'Total users targeted for fanout' })
  totalTargeted: number;

  @ApiProperty({ description: 'Notifications successfully delivered' })
  delivered: number;

  @ApiProperty({ description: 'Notifications suppressed' })
  suppressed: number;

  @ApiProperty({
    description: 'Breakdown of suppression reasons',
    type: 'object',
    additionalProperties: true,
  })
  suppressionBreakdown: Record<string, number>;

  @ApiProperty({
    description: 'IDs of created notifications',
    type: [String],
  })
  notificationIds: string[];
}

export class SuppressionLogResponseDto {
  @ApiProperty({ format: 'uuid' })
  id: string;

  @ApiProperty({ format: 'uuid' })
  userId: string;

  @ApiProperty()
  eventCategory: string;

  @ApiProperty()
  notificationType: string;

  @ApiProperty()
  reason: string;

  @ApiProperty({ type: 'object', nullable: true, additionalProperties: true })
  metadata: Record<string, unknown> | null;

  @ApiProperty()
  createdAt: Date;
}
