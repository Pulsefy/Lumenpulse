import { IsNumber, IsOptional, Min } from 'class-validator';
import { Type } from 'class-transformer';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export class AssetBalanceDto {
  @ApiProperty({ description: 'Asset code', example: 'XLM' })
  assetCode: string;

  @ApiProperty({
    description: 'Asset issuer public key',
    example: 'GCZJM35NKGVK47BB4SPBDV25477PZYIYPVVG453LPYFNXLS3FGHDXOCM',
    nullable: true,
  })
  assetIssuer: string | null;

  @ApiProperty({ description: 'Asset amount', example: '1234.5678' })
  amount: string;

  @ApiProperty({ description: 'Value in USD', example: 567.89 })
  valueUsd: number;
}

export class PortfolioSnapshotDto {
  @ApiProperty({
    description: 'Snapshot ID',
    example: '123e4567-e89b-12d3-a456-426614174000',
  })
  id: string;

  @ApiProperty({ description: 'User ID', example: 'user-123' })
  userId: string;

  @ApiProperty({
    description: 'Snapshot creation timestamp',
    example: '2024-02-25T15:30:00Z',
  })
  createdAt: Date;

  @ApiProperty({ description: 'Asset balances', type: [AssetBalanceDto] })
  assetBalances: AssetBalanceDto[];

  @ApiProperty({
    description: 'Total portfolio value in USD',
    example: '15420.50',
  })
  totalValueUsd: string;
}

export class PortfolioSummaryResponseDto {
  @ApiProperty({
    description: 'Total portfolio value in USD',
    example: '15420.50',
  })
  totalValueUsd: string;

  @ApiProperty({
    description: 'Individual asset balances',
    type: [AssetBalanceDto],
  })
  assets: AssetBalanceDto[];

  @ApiProperty({
    description: 'Timestamp of the last recorded snapshot',
    nullable: true,
    example: '2024-02-25T15:30:00Z',
  })
  lastUpdated: Date | null;

  @ApiProperty({
    description:
      'Indicates whether the user has a linked Stellar account with snapshots',
    example: true,
  })
  hasLinkedAccount: boolean;
}

export class GetPortfolioHistoryDto {
  @ApiPropertyOptional({
    description: 'Page number for pagination',
    example: 1,
    minimum: 1,
    default: 1,
  })
  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  @Min(1)
  page?: number = 1;

  @ApiPropertyOptional({
    description: 'Number of items per page',
    example: 10,
    minimum: 1,
    default: 10,
  })
  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  @Min(1)
  limit?: number = 10;
}

export class PortfolioHistoryResponseDto {
  @ApiProperty({
    description: 'List of portfolio snapshots',
    type: [PortfolioSnapshotDto],
  })
  snapshots: PortfolioSnapshotDto[];

  @ApiProperty({ description: 'Total number of snapshots', example: 150 })
  total: number;

  @ApiProperty({ description: 'Current page number', example: 1 })
  page: number;

  @ApiProperty({ description: 'Items per page', example: 10 })
  limit: number;

  @ApiProperty({ description: 'Total number of pages', example: 15 })
  totalPages: number;
}

export class PortfolioSnapshotBatchStatusDto {
  @ApiProperty({
    description: 'Batch identifier for the snapshot job',
    example: '9b3b4a07-5b35-4f8c-9f26-8f3ac77e5b41',
  })
  batchId: string;

  @ApiProperty({
    description: 'Current status of the snapshot batch job',
    example: 'running',
  })
  status:
    | 'queued'
    | 'running'
    | 'completed'
    | 'completed_with_errors'
    | 'failed';

  @ApiProperty({
    description: 'Total users scheduled for snapshot generation',
    example: 1250,
  })
  total: number;

  @ApiProperty({
    description: 'Number of snapshots completed successfully',
    example: 600,
  })
  completed: number;

  @ApiProperty({
    description: 'Number of snapshots that failed after retries',
    example: 12,
  })
  failed: number;

  @ApiProperty({
    description: 'Completion percentage for the batch',
    example: 48,
  })
  progressPercent: number;

  @ApiProperty({
    description: 'Trigger source',
    example: 'manual',
  })
  triggeredBy: 'cron' | 'manual' | 'unknown';

  @ApiProperty({
    description: 'Timestamp when the batch was requested',
    example: '2026-03-29T10:30:00Z',
    nullable: true,
  })
  requestedAt: string | null;

  @ApiProperty({
    description: 'Timestamp when processing started',
    example: '2026-03-29T10:31:10Z',
    nullable: true,
  })
  startedAt: string | null;

  @ApiProperty({
    description: 'Timestamp when processing finished',
    example: '2026-03-29T10:42:10Z',
    nullable: true,
  })
  finishedAt: string | null;
}

export class TriggerSnapshotBatchResponseDto {
  @ApiProperty({
    description: 'Message confirming the batch was queued',
    example: 'Snapshot creation queued',
  })
  message: string;

  @ApiProperty({
    description: 'Batch identifier for tracking progress',
    example: '9b3b4a07-5b35-4f8c-9f26-8f3ac77e5b41',
  })
  batchId: string;

  @ApiProperty({
    description: 'Current status of the batch job',
    example: 'queued',
  })
  status:
    | 'queued'
    | 'running'
    | 'completed'
    | 'completed_with_errors'
    | 'failed';

  @ApiProperty({
    description: 'Total users scheduled for snapshot generation',
    example: 1250,
  })
  total: number;

  @ApiProperty({
    description: 'Number of snapshots completed successfully',
    example: 0,
  })
  completed: number;

  @ApiProperty({
    description: 'Number of snapshots that failed after retries',
    example: 0,
  })
  failed: number;

  @ApiProperty({
    description: 'Completion percentage for the batch',
    example: 0,
  })
  progressPercent: number;
}
