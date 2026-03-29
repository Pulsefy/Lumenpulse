import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  IsString,
  IsNumber,
  IsNotEmpty,
  IsOptional,
  IsDateString,
  IsIn,
  Min,
  Max,
} from 'class-validator';

export class DataProcessingWebhookDto {
  @ApiProperty({
    description: 'Event category',
    example: 'high_priority_insight',
  })
  @IsString()
  @IsNotEmpty()
  @IsIn(['high_priority_insight'])
  event: string;

  @ApiProperty({
    description: 'Type of intelligence event',
    example: 'anomaly',
  })
  @IsString()
  @IsNotEmpty()
  @IsIn(['anomaly', 'sentiment_spike'])
  type: string;

  @ApiProperty({
    description: 'Name of the affected metric',
    example: 'volume',
  })
  @IsString()
  @IsNotEmpty()
  metric_name: string;

  @ApiProperty({
    description: 'Normalised severity score (0–1)',
    example: 0.85,
  })
  @IsNumber()
  @Min(0)
  @Max(1)
  severity_score: number;

  @ApiProperty({ description: 'Observed metric value', example: 1234567.89 })
  @IsNumber()
  current_value: number;

  @ApiProperty({ description: 'Baseline rolling mean', example: 800000.0 })
  @IsNumber()
  baseline_mean: number;

  @ApiProperty({
    description: 'Baseline rolling standard deviation',
    example: 120000.0,
  })
  @IsNumber()
  baseline_std: number;

  @ApiProperty({ description: 'Z-score deviation from baseline', example: 3.6 })
  @IsNumber()
  z_score: number;

  @ApiPropertyOptional({
    description: 'ISO-8601 timestamp from data-processing service',
    example: '2026-03-28T20:30:00.000000',
  })
  @IsOptional()
  @IsDateString()
  timestamp?: string;
}
