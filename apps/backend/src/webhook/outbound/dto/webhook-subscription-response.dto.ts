import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { WebhookSubscriptionStatus } from '../entities/webhook-subscription.entity';

export class WebhookSubscriptionResponseDto {
  @ApiProperty({ example: 'a1b2c3d4-e5f6-7890-abcd-ef1234567890' })
  id: string;

  @ApiPropertyOptional({ example: 'partner-123' })
  partnerId: string | null;

  @ApiProperty({ example: 'Partner A Webhooks' })
  name: string;

  @ApiProperty({ example: 'https://partner.example.com/webhooks' })
  targetUrl: string;

  @ApiProperty({
    example: ['pool.round_finalized', 'milestone.approved'],
    type: [String],
  })
  eventTypes: string[];

  @ApiProperty({
    enum: WebhookSubscriptionStatus,
    example: WebhookSubscriptionStatus.ACTIVE,
  })
  status: WebhookSubscriptionStatus;

  @ApiProperty({ example: 'sec_active_12345' })
  secretId: string;

  @ApiPropertyOptional({ example: 'sec_prev_67890' })
  previousSecretId: string | null;

  @ApiPropertyOptional({ example: '2026-10-19T21:00:00.000Z' })
  overlapExpiresAt: string | null;

  @ApiProperty({ example: 1 })
  secretVersion: number;

  @ApiPropertyOptional({
    description: 'The secret value (returned on creation/rotation)',
    example: 'd9b7f5c2a1e843219087654321abcdef1234567890abcdef1234567890abcdef',
  })
  secret?: string;

  @ApiPropertyOptional()
  metadata: Record<string, unknown> | null;

  @ApiProperty({ example: '2026-10-18T21:00:00.000Z' })
  createdAt: string;

  @ApiProperty({ example: '2026-10-18T21:00:00.000Z' })
  updatedAt: string;
}

export class WebhookSecretRotationResponseDto {
  @ApiProperty({ example: 'a1b2c3d4-e5f6-7890-abcd-ef1234567890' })
  subscriptionId: string;

  @ApiProperty({ example: 'sec_active_new' })
  secretId: string;

  @ApiPropertyOptional({ example: 'sec_prev_old' })
  previousSecretId: string | null;

  @ApiPropertyOptional({ example: '2026-10-19T21:00:00.000Z' })
  overlapExpiresAt: string | null;

  @ApiProperty({
    description:
      'The newly generated or configured secret value for the subscriber',
    example: 'd9b7f5c2a1e843219087654321abcdef1234567890abcdef1234567890abcdef',
  })
  newSecret: string;

  @ApiProperty({ example: 2 })
  version: number;

  @ApiProperty({ example: '2026-10-18T21:00:00.000Z' })
  rotatedAt: string;
}

export class WebhookDeliveryResponseDto {
  @ApiProperty({ example: 'b2c3d4e5-f6a7-8901-bcde-f12345678901' })
  id: string;

  @ApiProperty({ example: 'a1b2c3d4-e5f6-7890-abcd-ef1234567890' })
  subscriptionId: string;

  @ApiProperty({ example: 'pool.round_finalized' })
  eventType: string;

  @ApiProperty({ example: { roundId: 1, totalPool: '1000000' } })
  payload: Record<string, unknown>;

  @ApiProperty({ example: 'DELIVERED' })
  status: string;

  @ApiProperty({ example: 1 })
  attempts: number;

  @ApiProperty({ example: 5 })
  maxAttempts: number;

  @ApiPropertyOptional({ example: 200 })
  responseStatusCode: number | null;

  @ApiPropertyOptional({ example: '{"received": true}' })
  responseBody: string | null;

  @ApiPropertyOptional({ example: null })
  lastError: string | null;

  @ApiPropertyOptional({ example: { 'X-Webhook-Signature': 'sha256=...' } })
  requestHeaders: Record<string, string> | null;

  @ApiPropertyOptional({ example: 45 })
  executionDurationMs: number | null;

  @ApiPropertyOptional({ example: '2026-10-18T21:05:00.000Z' })
  deliveredAt: string | null;

  @ApiProperty({ example: '2026-10-18T21:00:00.000Z' })
  createdAt: string;
}

export class WebhookDeadLetterResponseDto {
  @ApiProperty({ example: 'c3d4e5f6-a7b8-9012-cdef-123456789012' })
  id: string;

  @ApiProperty({ example: 'b2c3d4e5-f6a7-8901-bcde-f12345678901' })
  deliveryId: string;

  @ApiProperty({ example: 'a1b2c3d4-e5f6-7890-abcd-ef1234567890' })
  subscriptionId: string;

  @ApiProperty({ example: 'milestone.approved' })
  eventType: string;

  @ApiProperty({ example: { milestoneId: 'm-1' } })
  payload: Record<string, unknown>;

  @ApiProperty({ example: 5 })
  attempts: number;

  @ApiPropertyOptional({
    example: 'Connection refused: https://partner.example.com',
  })
  lastErrorMessage: string | null;

  @ApiProperty({
    example: [{ timestamp: '2026-10-18T21:00:00Z', error: 'ECONNREFUSED' }],
  })
  errorHistory: Array<{
    timestamp: string;
    error: string;
    statusCode?: number | null;
  }>;

  @ApiProperty({ example: 'pending' })
  status: string;

  @ApiPropertyOptional()
  maintainerNotes: string | null;

  @ApiPropertyOptional()
  resolvedBy: string | null;

  @ApiPropertyOptional()
  resolvedAt: string | null;

  @ApiPropertyOptional()
  replayedAt: string | null;

  @ApiProperty({ example: 0 })
  replayCount: number;

  @ApiProperty({ example: '2026-10-18T21:00:00.000Z' })
  createdAt: string;
}

export class PaginatedWebhookDeliveriesDto {
  @ApiProperty({ type: [WebhookDeliveryResponseDto] })
  data: WebhookDeliveryResponseDto[];

  @ApiProperty({ example: 100 })
  total: number;

  @ApiProperty({ example: 0 })
  page: number;

  @ApiProperty({ example: 20 })
  limit: number;

  @ApiProperty({ example: 5 })
  totalPages: number;
}

export class PaginatedWebhookDeadLettersDto {
  @ApiProperty({ type: [WebhookDeadLetterResponseDto] })
  data: WebhookDeadLetterResponseDto[];

  @ApiProperty({ example: 12 })
  total: number;

  @ApiProperty({ example: 0 })
  page: number;

  @ApiProperty({ example: 20 })
  limit: number;

  @ApiProperty({ example: 1 })
  totalPages: number;
}
