import { IsOptional, IsString } from 'class-validator';
import { ApiPropertyOptional } from '@nestjs/swagger';
import { ReportStatus, ReportType } from '../entities/content-report.entity';

export class QueryReportsDto {
  @ApiPropertyOptional({
    enum: ReportStatus,
    description: 'Filter by report status',
    example: ReportStatus.PENDING,
  })
  @IsOptional()
  @IsString()
  status?: ReportStatus;

  @ApiPropertyOptional({
    enum: ReportType,
    description: 'Filter by target type',
    example: ReportType.PROJECT,
  })
  @IsOptional()
  @IsString()
  targetType?: ReportType;

  @ApiPropertyOptional({
    description: 'Filter by target ID',
    example: '123',
  })
  @IsOptional()
  @IsString()
  targetId?: string;

  @ApiPropertyOptional({
    description: 'Page number (default: 1)',
    example: 1,
  })
  @IsOptional()
  @IsString()
  page?: string;

  @ApiPropertyOptional({
    description: 'Items per page (default: 20, max: 100)',
    example: 20,
  })
  @IsOptional()
  @IsString()
  limit?: string;
}
