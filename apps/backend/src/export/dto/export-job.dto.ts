import { IsEnum } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';
import { ExportStatus, ExportType } from '../entities/export-job.entity';

export class CreateExportJobDto {
  @ApiProperty({
    enum: ExportType,
    description: 'Type of export to generate',
    example: ExportType.PORTFOLIO_HISTORY,
  })
  @IsEnum(ExportType)
  type: ExportType;
}

export class ExportJobResponseDto {
  @ApiProperty({
    description: 'Unique export job ID',
    example: 'b3f1c2a4-5e6d-4f7a-8b9c-0d1e2f3a4b5c',
  })
  id: string;

  @ApiProperty({
    enum: ExportType,
    description: 'Type of export being generated',
    example: ExportType.PORTFOLIO_HISTORY,
  })
  type: ExportType;

  @ApiProperty({
    enum: ExportStatus,
    description: 'Current processing status of the export job',
    example: ExportStatus.COMPLETED,
  })
  status: ExportStatus;

  @ApiProperty({
    description: 'Timestamp the export job was created',
    example: '2026-08-27T12:00:00.000Z',
  })
  createdAt: Date;

  @ApiProperty({
    description: 'Timestamp the export job was last updated',
    example: '2026-08-27T12:05:00.000Z',
  })
  updatedAt: Date;
}
