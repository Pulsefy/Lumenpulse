import { IsEnum, IsOptional, IsString, MaxLength } from 'class-validator';
import { ApiPropertyOptional } from '@nestjs/swagger';
import { ReportStatus } from '../entities/content-report.entity';

export class UpdateReportDto {
  @ApiPropertyOptional({
    enum: ReportStatus,
    description: 'New status for the report',
    example: ReportStatus.UNDER_REVIEW,
  })
  @IsEnum(ReportStatus)
  @IsOptional()
  status?: ReportStatus;

  @ApiPropertyOptional({
    description: 'Notes from the moderator reviewing this report',
    example: 'Investigated and confirmed spam. Taking action.',
    maxLength: 2000,
  })
  @IsString()
  @IsOptional()
  @MaxLength(2000)
  reviewNotes?: string;
}
