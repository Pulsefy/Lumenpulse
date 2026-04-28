import {
  IsEnum,
  IsNotEmpty,
  IsOptional,
  IsString,
  MaxLength,
} from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { ReportReason, ReportType } from '../entities/content-report.entity';

export class CreateReportDto {
  @ApiProperty({
    enum: ReportType,
    description: 'Type of content being reported',
    example: ReportType.PROJECT,
  })
  @IsEnum(ReportType)
  @IsNotEmpty()
  targetType: ReportType;

  @ApiProperty({
    description: 'ID of the target content (project, user, etc.)',
    example: '123',
  })
  @IsString()
  @IsNotEmpty()
  targetId: string;

  @ApiProperty({
    enum: ReportReason,
    description: 'Reason for reporting',
    example: ReportReason.SPAM,
  })
  @IsEnum(ReportReason)
  @IsNotEmpty()
  reason: ReportReason;

  @ApiPropertyOptional({
    description: 'Additional details about the report',
    example: 'This project appears to be a scam with misleading information.',
    maxLength: 1000,
  })
  @IsString()
  @IsOptional()
  @MaxLength(1000)
  description?: string;
}
