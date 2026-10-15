import { IsEnum, IsOptional, IsString } from 'class-validator';
import { ReportStatus } from '../../moderation/entities/content-report.entity';
import { PortfolioAnomalyStatus } from '../../portfolio/entities/portfolio-anomaly.entity';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

/**
 * Supported review domains to aggregate aging metrics across.
 */
export enum ReviewDomain {
  MODERATION = 'moderation',
  ANOMALY = 'anomaly',
}

/**
 * Query parameters for review aging metrics.
 */
export class ReviewMetricsQueryDto {
  @ApiPropertyOptional({
    enum: ReviewDomain,
    description:
      'Limit metrics to a specific review domain. When omitted, metrics are aggregated across all domains.',
  })
  @IsOptional()
  @IsEnum(ReviewDomain)
  domain?: ReviewDomain;

  @ApiPropertyOptional({
    description:
      'Filter by report status (applies only when domain=moderation).',
    enum: ReportStatus,
  })
  @IsOptional()
  @IsEnum(ReportStatus)
  moderationStatus?: ReportStatus;

  @ApiPropertyOptional({
    description: 'Filter by anomaly status (applies only when domain=anomaly).',
    enum: PortfolioAnomalyStatus,
  })
  @IsOptional()
  @IsEnum(PortfolioAnomalyStatus)
  anomalyStatus?: PortfolioAnomalyStatus;

  @ApiPropertyOptional({
    description:
      'Filter by reviewer UUID. Returns items assigned to a specific reviewer.',
    example: 'd290f1ee-6c54-4b01-90e6-d701748f0851',
  })
  @IsOptional()
  @IsString()
  reviewerId?: string;
}

/**
 * Single aging-bucket entry.
 */
export class AgingBucket {
  @ApiProperty({
    description:
      'Human-readable label for the bucket (e.g. "< 1 day", "1–3 days").',
  })
  label: string;

  @ApiProperty({
    description: 'Lower bound of the bucket in hours (inclusive).',
  })
  minHours: number;

  @ApiProperty({
    description:
      'Upper bound of the bucket in hours (exclusive, null for open-ended).',
    nullable: true,
  })
  maxHours: number | null;

  @ApiProperty({ description: 'Number of items in this bucket.' })
  count: number;
}

/**
 * Per-domain breakdown within the aging report.
 */
export class DomainAgingSnapshot {
  @ApiProperty({ enum: ReviewDomain, description: 'Domain label.' })
  domain: ReviewDomain;

  @ApiProperty({ description: 'Total number of pending/in-review items.' })
  totalOpen: number;

  @ApiProperty({
    description:
      'Average age of open items in milliseconds (elapsed since creation).',
  })
  averageAgeMs: number;

  @ApiProperty({
    description: 'Median age of open items in milliseconds.',
    nullable: true,
  })
  medianAgeMs: number | null;

  @ApiProperty({
    description: 'Age of the oldest open item in milliseconds.',
    nullable: true,
  })
  oldestAgeMs: number | null;

  @ApiProperty({
    description: 'Age of the newest open item in milliseconds.',
    nullable: true,
  })
  newestAgeMs: number | null;

  @ApiProperty({
    type: [AgingBucket],
    description: 'Aging distribution across predefined time buckets.',
  })
  buckets: AgingBucket[];
}

/**
 * Full review aging response.
 */
export class ReviewMetricsResponseDto {
  @ApiProperty({
    description:
      'ISO-8601 timestamp when the snapshot was computed (server time).',
    example: '2026-07-25T19:14:00.000Z',
  })
  computedAt: string;

  @ApiProperty({
    type: [DomainAgingSnapshot],
    description: 'Per-domain aging data.',
  })
  domains: DomainAgingSnapshot[];

  @ApiProperty({
    description:
      'Grand total of pending/in-review items across all included domains.',
  })
  grandTotalOpen: number;
}
