import { IsEnum, IsOptional, IsString } from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export enum ChartInterval {
  ONE_HOUR = '1h',
  ONE_DAY = '1d',
}

export enum ChartRange {
  SEVEN_DAYS = '7d',
  THIRTY_DAYS = '30d',
}

export class ChartDataQueryDto {
  @ApiPropertyOptional({
    enum: ChartInterval,
    default: ChartInterval.ONE_HOUR,
    description: 'Data aggregation interval',
  })
  @IsEnum(ChartInterval)
  @IsOptional()
  interval?: ChartInterval = ChartInterval.ONE_HOUR;

  @ApiPropertyOptional({
    enum: ChartRange,
    default: ChartRange.SEVEN_DAYS,
    description: 'Time range for the chart',
  })
  @IsEnum(ChartRange)
  @IsOptional()
  range?: ChartRange = ChartRange.SEVEN_DAYS;

  @ApiPropertyOptional({
    description: 'Filter by asset symbol (e.g., XLM). Global if omitted.',
  })
  @IsString()
  @IsOptional()
  asset?: string;
}

export class ChartDataPointDto {
  @ApiProperty({
    description: 'Start of the bucket, in ISO-8601 format',
    example: '2026-08-27T00:00:00.000Z',
  })
  timestamp: string;

  @ApiProperty({
    description: 'Average sentiment score for the bucket',
    example: 0.42,
  })
  sentiment: number;

  @ApiProperty({
    description: 'Number of data points aggregated into the bucket',
    example: 128,
  })
  count: number;
}
