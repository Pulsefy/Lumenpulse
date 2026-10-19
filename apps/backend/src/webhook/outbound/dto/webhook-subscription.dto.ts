import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  IsString,
  IsUrl,
  IsArray,
  IsOptional,
  IsEnum,
  ArrayNotEmpty,
  MaxLength,
  MinLength,
  IsInt,
  Min,
  Max,
} from 'class-validator';
import { WebhookSubscriptionStatus } from '../entities/webhook-subscription.entity';

export class CreateWebhookSubscriptionDto {
  @ApiProperty({
    description: 'Human-readable subscription name',
    example: 'Partner A Round & Milestone Webhooks',
  })
  @IsString()
  @MinLength(1)
  @MaxLength(255)
  name: string;

  @ApiProperty({
    description: 'HTTPS URL where webhook POST payloads will be delivered',
    example: 'https://partner.example.com/webhooks/lumenpulse',
  })
  @IsUrl({ require_tld: false, protocols: ['http', 'https'] })
  targetUrl: string;

  @ApiProperty({
    description:
      'List of event types to subscribe to (e.g. pool.round_finalized, milestone.approved, or wildcards like pool.*)',
    example: ['pool.round_finalized', 'milestone.approved'],
    type: [String],
  })
  @IsArray()
  @ArrayNotEmpty()
  @IsString({ each: true })
  eventTypes: string[];

  @ApiPropertyOptional({
    description:
      'Optional initial secret. If omitted, a cryptographically secure 32-byte hex secret is automatically generated.',
    example: 'd9b7f5c2a1e843219087654321abcdef1234567890abcdef1234567890abcdef',
  })
  @IsOptional()
  @IsString()
  @MinLength(16)
  @MaxLength(512)
  secret?: string;

  @ApiPropertyOptional({
    description: 'Optional partner identifier',
    example: 'partner-123',
  })
  @IsOptional()
  @IsString()
  @MaxLength(120)
  partnerId?: string;

  @ApiPropertyOptional({
    description: 'Optional metadata key-value pairs',
    example: { environment: 'production' },
  })
  @IsOptional()
  metadata?: Record<string, unknown>;
}

export class UpdateWebhookSubscriptionDto {
  @ApiPropertyOptional({
    description: 'Updated subscription name',
    example: 'Partner A Webhooks Updated',
  })
  @IsOptional()
  @IsString()
  @MinLength(1)
  @MaxLength(255)
  name?: string;

  @ApiPropertyOptional({
    description: 'Updated HTTPS target URL',
    example: 'https://partner.example.com/v2/webhooks',
  })
  @IsOptional()
  @IsUrl({ require_tld: false, protocols: ['http', 'https'] })
  targetUrl?: string;

  @ApiPropertyOptional({
    description: 'Updated list of event types',
    example: ['pool.round_finalized', 'milestone.approved', 'governance.*'],
    type: [String],
  })
  @IsOptional()
  @IsArray()
  @ArrayNotEmpty()
  @IsString({ each: true })
  eventTypes?: string[];

  @ApiPropertyOptional({
    description: 'Subscription status',
    enum: WebhookSubscriptionStatus,
    example: WebhookSubscriptionStatus.ACTIVE,
  })
  @IsOptional()
  @IsEnum(WebhookSubscriptionStatus)
  status?: WebhookSubscriptionStatus;

  @ApiPropertyOptional({
    description: 'Optional metadata key-value pairs',
  })
  @IsOptional()
  metadata?: Record<string, unknown>;
}

export class RotateWebhookSecretDto {
  @ApiPropertyOptional({
    description:
      'Optional new secret value. If omitted, a cryptographically secure 32-byte hex secret is generated automatically.',
  })
  @IsOptional()
  @IsString()
  @MinLength(16)
  @MaxLength(512)
  newSecret?: string;

  @ApiPropertyOptional({
    description:
      'Overlap window in milliseconds during which the previous secret remains valid for verification. Default: 86400000 (24h). Max: 2592000000 (30d).',
    example: 86400000,
  })
  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(2592000000)
  overlapMs?: number;

  @ApiPropertyOptional({
    description: 'Reason for rotation, for audit and record-keeping',
    example: 'Quarterly key rotation',
  })
  @IsOptional()
  @IsString()
  @MaxLength(500)
  reason?: string;
}
