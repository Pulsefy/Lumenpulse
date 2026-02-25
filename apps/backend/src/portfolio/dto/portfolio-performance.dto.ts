import { ApiProperty } from '@nestjs/swagger';

export class TimeWindowPerformanceDto {
  @ApiProperty({
    description: 'The time window identifier',
    enum: ['24h', '7d', '30d'],
    example: '24h',
  })
  window: '24h' | '7d' | '30d';

  @ApiProperty({
    description: 'Whether data is available for this time window',
    example: true,
  })
  hasData: boolean;

  @ApiProperty({
    description: 'Absolute profit/loss in USD',
    example: 234.56,
    nullable: true,
  })
  absolutePnl: number | null;

  @ApiProperty({
    description: 'Percentage change from baseline',
    example: 5.67,
    nullable: true,
  })
  percentageChange: number | null;

  @ApiProperty({
    description: 'Current portfolio value in USD',
    example: 15420.5,
  })
  currentValueUsd: number;

  @ApiProperty({
    description: 'Baseline portfolio value in USD (value at start of window)',
    example: 14650.0,
    nullable: true,
  })
  baselineValueUsd: number | null;

  @ApiProperty({
    description: 'Date of the baseline snapshot',
    example: '2024-02-24T15:30:00Z',
    nullable: true,
  })
  baselineDate: Date | null;
}

export class PortfolioPerformanceResponseDto {
  @ApiProperty({
    description: 'User ID',
    example: 'user-123',
  })
  userId: string;

  @ApiProperty({
    description: 'Current total portfolio value in USD',
    example: 15420.5,
  })
  currentValueUsd: number;

  @ApiProperty({
    description: 'Timestamp when performance was calculated',
    example: '2024-02-25T15:30:00Z',
  })
  calculatedAt: Date;

  @ApiProperty({
    description: 'Performance metrics for each time window',
    type: [TimeWindowPerformanceDto],
  })
  windows: TimeWindowPerformanceDto[];
}
