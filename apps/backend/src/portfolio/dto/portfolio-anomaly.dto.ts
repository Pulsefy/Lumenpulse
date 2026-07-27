import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsEnum, IsNotEmpty, IsOptional, IsString, MaxLength } from 'class-validator';
import {
  PortfolioAnomalySeverity,
  PortfolioAnomalyStatus,
} from '../entities/portfolio-anomaly.entity';

export class CreatePortfolioAnomalyDto {
  @ApiProperty({ description: 'The affected user identifier' })
  @IsString()
  @IsNotEmpty()
  userId: string;

  @ApiProperty({ description: 'Short anomaly title' })
  @IsString()
  @IsNotEmpty()
  @MaxLength(255)
  title: string;

  @ApiPropertyOptional({ description: 'Detailed anomaly description' })
  @IsOptional()
  @IsString()
  description?: string;

  @ApiProperty({ description: 'Machine-readable anomaly category' })
  @IsString()
  @IsNotEmpty()
  anomalyType: string;

  @ApiProperty({
    enum: PortfolioAnomalySeverity,
    description: 'Severity for the anomaly',
  })
  @IsEnum(PortfolioAnomalySeverity)
  severity: PortfolioAnomalySeverity;
}

export class ReviewPortfolioAnomalyDto {
  @ApiProperty({
    enum: PortfolioAnomalyStatus,
    description: 'Desired review state for the anomaly',
  })
  @IsEnum(PortfolioAnomalyStatus)
  status: PortfolioAnomalyStatus;

  @ApiPropertyOptional({ description: 'Reviewer follow-up notes' })
  @IsOptional()
  @IsString()
  reviewerNotes?: string;
}

export class PortfolioAnomalyResponseDto {
  @ApiProperty({ description: 'Anomaly identifier' })
  id: string;

  @ApiProperty({ description: 'Affected user identifier' })
  userId: string;

  @ApiProperty({ description: 'Short anomaly title' })
  title: string;

  @ApiPropertyOptional({ description: 'Detailed anomaly description' })
  description: string | null;

  @ApiProperty({ description: 'Machine-readable anomaly category' })
  anomalyType: string;

  @ApiProperty({ enum: PortfolioAnomalySeverity })
  severity: PortfolioAnomalySeverity | string;

  @ApiProperty({ enum: PortfolioAnomalyStatus })
  status: PortfolioAnomalyStatus | string;

  @ApiPropertyOptional({ description: 'Reviewer identifier' })
  reviewerId: string | null;

  @ApiPropertyOptional({ description: 'Reviewer follow-up notes' })
  reviewerNotes: string | null;

  @ApiPropertyOptional({ description: 'When the anomaly was reviewed' })
  reviewedAt: Date | null;

  @ApiPropertyOptional({ description: 'When the review notes were last updated' })
  reviewerNotesUpdatedAt: Date | null;

  @ApiProperty({ description: 'Creation timestamp' })
  createdAt: Date;

  @ApiProperty({ description: 'Last update timestamp' })
  updatedAt: Date;

  @ApiProperty({ description: 'Optimistic locking version' })
  version: number;
}

export class PortfolioAnomaliesListResponseDto {
  @ApiProperty({ type: [PortfolioAnomalyResponseDto] })
  anomalies: PortfolioAnomalyResponseDto[];

  @ApiProperty({ description: 'Total number of anomalies' })
  total: number;
}
