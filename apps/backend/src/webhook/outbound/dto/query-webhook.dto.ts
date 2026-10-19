import { ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { IsOptional, IsInt, Min, Max, IsEnum, IsString } from 'class-validator';
import { WebhookSubscriptionStatus } from '../entities/webhook-subscription.entity';
import { WebhookDeliveryStatus } from '../entities/webhook-delivery.entity';
import { WebhookDeadLetterStatus } from '../entities/webhook-dead-letter.entity';

export class QuerySubscriptionsDto {
  @ApiPropertyOptional({ example: 0, default: 0 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  page?: number = 0;

  @ApiPropertyOptional({ example: 20, default: 20 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(100)
  limit?: number = 20;

  @ApiPropertyOptional({
    enum: WebhookSubscriptionStatus,
    description: 'Filter by subscription status',
  })
  @IsOptional()
  @IsEnum(WebhookSubscriptionStatus)
  status?: WebhookSubscriptionStatus;

  @ApiPropertyOptional({
    description: 'Filter by subscribed event type or prefix',
    example: 'pool.round_finalized',
  })
  @IsOptional()
  @IsString()
  eventType?: string;

  @ApiPropertyOptional({
    description: 'Filter by partner ID',
    example: 'partner-123',
  })
  @IsOptional()
  @IsString()
  partnerId?: string;
}

export class QueryDeliveriesDto {
  @ApiPropertyOptional({ example: 0, default: 0 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  page?: number = 0;

  @ApiPropertyOptional({ example: 20, default: 20 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(100)
  limit?: number = 20;

  @ApiPropertyOptional({
    enum: WebhookDeliveryStatus,
    description: 'Filter by delivery status',
  })
  @IsOptional()
  @IsEnum(WebhookDeliveryStatus)
  status?: WebhookDeliveryStatus;

  @ApiPropertyOptional({
    description: 'Filter by event type',
    example: 'pool.round_finalized',
  })
  @IsOptional()
  @IsString()
  eventType?: string;
}

export class QueryDeadLetterDto {
  @ApiPropertyOptional({ example: 0, default: 0 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  page?: number = 0;

  @ApiPropertyOptional({ example: 20, default: 20 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(100)
  limit?: number = 20;

  @ApiPropertyOptional({
    enum: WebhookDeadLetterStatus,
    description: 'Filter by dead-letter status',
  })
  @IsOptional()
  @IsEnum(WebhookDeadLetterStatus)
  status?: WebhookDeadLetterStatus;

  @ApiPropertyOptional({
    description: 'Filter by subscription ID',
    example: 'a1b2c3d4-e5f6-7890-abcd-ef1234567890',
  })
  @IsOptional()
  @IsString()
  subscriptionId?: string;

  @ApiPropertyOptional({
    description: 'Filter by event type',
    example: 'milestone.approved',
  })
  @IsOptional()
  @IsString()
  eventType?: string;
}

export class ResolveWebhookDeadLetterDto {
  @ApiPropertyOptional({
    description: 'Maintainer notes for resolving without replaying',
    example: 'Partner confirmed milestone received out-of-band',
  })
  @IsOptional()
  @IsString()
  maintainerNotes?: string;

  @ApiPropertyOptional({
    description: 'Reason for resolving without replaying',
    example: 'Partner confirmed milestone received out-of-band',
  })
  @IsOptional()
  @IsString()
  reason?: string;
}
