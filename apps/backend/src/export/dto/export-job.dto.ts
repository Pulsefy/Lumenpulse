import { IsEnum } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';
import { ExportStatus, ExportType } from '../entities/export-job.entity';

export class CreateExportJobDto {
  @ApiProperty({ enum: ExportType, description: 'Type of export to generate' })
  @IsEnum(ExportType)
  type: ExportType;
}

export class ExportJobResponseDto {
  @ApiProperty()
  id: string;

  @ApiProperty({ enum: ExportType })
  type: ExportType;

  @ApiProperty({ enum: ExportStatus })
  status: ExportStatus;

  @ApiProperty()
  createdAt: Date;

  @ApiProperty()
  updatedAt: Date;
}
