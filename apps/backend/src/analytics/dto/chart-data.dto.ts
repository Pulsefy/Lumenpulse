import { IsEnum, IsOptional, IsString } from 'class-validator';
import { ApiPropertyOptional } from '@nestjs/swagger';

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
  timestamp: string;
  sentiment: number;
  count: number;
}
