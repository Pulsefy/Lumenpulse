import { IsOptional, IsUUID, IsString, IsInt, Min, IsIn } from 'class-validator';

export class QueryTriageQueueDto {
  @IsOptional()
  @IsUUID()
  reviewerId?: string;

  @IsOptional()
  @IsString()
  @IsIn(['unassigned', 'in_review', 'completed'])
  state?: string;

  @IsOptional()
  @IsString()
  itemType?: string;

  @IsOptional()
  @IsInt()
  @Min(1)
  page?: number;

  @IsOptional()
  @IsInt()
  @Min(1)
  limit?: number;

  @IsOptional()
  @IsString()
  @IsIn(['created_at', 'priority', 'updated_at'])
  sortBy?: string;

  @IsOptional()
  @IsString()
  @IsIn(['ASC', 'DESC'])
  sortOrder?: string;
}
