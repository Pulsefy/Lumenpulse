import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsEnum, IsOptional } from 'class-validator';
import {
  CursorPaginationQueryDto,
  SortOrder,
} from '../../common/dto/cursor-pagination.dto';
import { VerificationStatus } from './verification.dto';

export enum ProjectSortBy {
  REGISTERED_AT = 'registeredAt',
  VOTES_FOR = 'votesFor',
}

export class ProjectListQueryDto extends CursorPaginationQueryDto {
  @ApiPropertyOptional({ enum: VerificationStatus })
  @IsOptional()
  @IsEnum(VerificationStatus)
  status?: VerificationStatus;

  @ApiPropertyOptional({ enum: ProjectSortBy, default: ProjectSortBy.REGISTERED_AT })
  @IsOptional()
  @IsEnum(ProjectSortBy)
  sortBy?: ProjectSortBy = ProjectSortBy.REGISTERED_AT;
}

export interface ProjectListResponseDto<T> {
  items: T[];
  nextCursor?: string;
  total: number;
  limit: number;
  sortOrder: SortOrder;
  sortBy: ProjectSortBy;
}
