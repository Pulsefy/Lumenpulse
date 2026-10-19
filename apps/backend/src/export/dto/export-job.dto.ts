import { IsEnum } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';
import { ExportStatus, ExportType } from '../entities/export-job.entity';
import {
  PaginatedResponseDto,
  ResolvedPagination,
} from '../../common/pagination/pagination-response.dto';

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

/**
 * Paginated response for `GET /exports`.
 *
 * Wraps the bare `ExportJobResponseDto[]` array that was previously returned
 * so that `GET /exports` follows the standard
 * `items / total / page / pageSize / totalPages` envelope.
 */
export class ExportJobListResponseDto extends PaginatedResponseDto<ExportJobResponseDto> {
  constructor(
    items: ExportJobResponseDto[],
    pagination: ResolvedPagination,
    total: number,
  ) {
    super(items, pagination, total);
  }
}
