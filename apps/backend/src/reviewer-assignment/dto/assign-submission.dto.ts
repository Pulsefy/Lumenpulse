import { IsUUID, IsString, IsInt, IsOptional, Min, Max } from 'class-validator';

export class AssignSubmissionDto {
  @IsUUID()
  itemId: string;

  @IsString()
  itemType: string;

  @IsUUID()
  reviewerId: string;

  @IsInt()
  @Min(0)
  @Max(100)
  @IsOptional()
  priority?: number;

  @IsString()
  @IsOptional()
  reason?: string;

  @IsOptional()
  metadata?: Record<string, any>;
}
