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
  timestamp: string;
  sentiment: number;
  count: number;
}

export class ChartAxisMetaDto {
  /** Stable identifier that series reference via `axisId`. */
  id: string;

  /** Human-readable axis title. */
  label: string;
}

export class ChartSeriesMetaDto {
  /** Property of ChartDataPointDto that holds this series' values. */
  key: string;

  /** Human-readable series name for legends, tooltips and table headers. */
  label: string;

  /** Id of the y-axis this series is plotted against. */
  axisId: string;
}

export class ChartRangeOptionDto {
  @ApiProperty({ enum: ChartRange })
  range: ChartRange;

  /** Human-readable label for the time-range selector. */
  label: string;

  @ApiProperty({ enum: ChartInterval })
  interval: ChartInterval;
}

export class ChartMetaDto {
  xAxis: ChartAxisMetaDto;
  yAxes: ChartAxisMetaDto[];
  series: ChartSeriesMetaDto[];
  ranges: ChartRangeOptionDto[];
}
