import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  IsString,
  IsBoolean,
  IsOptional,
  IsEnum,
  IsInt,
  Min,
  ValidateNested,
} from 'class-validator';
import { Type } from 'class-transformer';
import { NotificationChannel } from '../notification-preference.entity';

export class EventCategoryPreferenceDto {
  @ApiProperty({ description: 'Whether this event category is enabled' })
  @IsBoolean()
  enabled: boolean;

  @ApiProperty({
    description: 'Channels to use for this event category',
    enum: NotificationChannel,
    isArray: true,
  })
  @IsEnum(NotificationChannel, { each: true })
  channels: NotificationChannel[];

  @ApiPropertyOptional({
    description: 'Override minimum severity for this category',
  })
  @IsString()
  @IsOptional()
  minSeverity?: string;
}

export class QuietHoursConfigDto {
  @ApiProperty({
    description: 'Start hour (0-23)',
    minimum: 0,
    maximum: 23,
  })
  @IsInt()
  @Min(0)
  startHour: number;

  @ApiProperty({
    description: 'End hour (0-23)',
    minimum: 0,
    maximum: 23,
  })
  @IsInt()
  @Min(0)
  endHour: number;

  @ApiProperty({
    description: 'Timezone',
    example: 'America/New_York',
  })
  @IsString()
  timezone: string;

  @ApiProperty({
    description: 'Allow critical notifications during quiet hours',
    default: true,
  })
  @IsBoolean()
  allowCritical: boolean;
}

export class CreateNotificationPreferenceDto {
  @ApiProperty({
    description: 'User ID',
    format: 'uuid',
  })
  @IsString()
  userId: string;

  @ApiPropertyOptional({
    description: 'Enabled notification channels',
    enum: NotificationChannel,
    isArray: true,
    default: [NotificationChannel.IN_APP],
  })
  @IsEnum(NotificationChannel, { each: true })
  @IsOptional()
  enabledChannels?: NotificationChannel[];

  @ApiPropertyOptional({
    description: 'Event category preferences',
    type: 'object',
    additionalProperties: {
      type: 'object',
      properties: {
        enabled: { type: 'boolean' },
        channels: {
          type: 'array',
          items: { enum: Object.values(NotificationChannel) },
        },
      },
    },
  })
  @ValidateNested({ each: true })
  @Type(() => EventCategoryPreferenceDto)
  @IsOptional()
  eventPreferences?: Record<string, EventCategoryPreferenceDto>;

  @ApiPropertyOptional({
    description: 'Quiet hours configuration',
    type: QuietHoursConfigDto,
  })
  @ValidateNested()
  @Type(() => QuietHoursConfigDto)
  @IsOptional()
  quietHours?: QuietHoursConfigDto;

  @ApiPropertyOptional({
    description: 'Maximum notifications per day (0 = unlimited)',
    default: 0,
  })
  @IsInt()
  @Min(0)
  @IsOptional()
  dailyLimit?: number;

  @ApiPropertyOptional({
    description: 'Minimum severity level',
    default: 'low',
    enum: ['low', 'medium', 'high', 'critical'],
  })
  @IsString()
  @IsOptional()
  minSeverity?: string;
}

export class UpdateNotificationPreferenceDto {
  @ApiPropertyOptional({
    description: 'Enabled notification channels',
    enum: NotificationChannel,
    isArray: true,
  })
  @IsEnum(NotificationChannel, { each: true })
  @IsOptional()
  enabledChannels?: NotificationChannel[];

  @ApiPropertyOptional({
    description: 'Event category preferences',
  })
  @IsOptional()
  eventPreferences?: Record<string, EventCategoryPreferenceDto>;

  @ApiPropertyOptional({
    description: 'Quiet hours configuration',
  })
  @ValidateNested()
  @Type(() => QuietHoursConfigDto)
  @IsOptional()
  quietHours?: QuietHoursConfigDto;

  @ApiPropertyOptional({
    description: 'Maximum notifications per day (0 = unlimited)',
  })
  @IsInt()
  @Min(0)
  @IsOptional()
  dailyLimit?: number;

  @ApiPropertyOptional({
    description: 'Minimum severity level',
    enum: ['low', 'medium', 'high', 'critical'],
  })
  @IsString()
  @IsOptional()
  minSeverity?: string;
}

export class NotificationPreferenceResponseDto {
  @ApiProperty({ format: 'uuid' })
  id: string;

  @ApiProperty({ format: 'uuid' })
  userId: string;

  @ApiProperty({ enum: NotificationChannel, isArray: true })
  enabledChannels: NotificationChannel[];

  @ApiProperty({ type: 'object', additionalProperties: true })
  eventPreferences: Record<string, EventCategoryPreferenceDto>;

  @ApiProperty({ type: QuietHoursConfigDto, nullable: true })
  quietHours: QuietHoursConfigDto | null;

  @ApiProperty({ description: 'Daily notification limit (0 = unlimited)' })
  dailyLimit: number;

  @ApiProperty({ enum: ['low', 'medium', 'high', 'critical'] })
  minSeverity: string;

  @ApiProperty()
  createdAt: Date;

  @ApiProperty()
  updatedAt: Date;
}
