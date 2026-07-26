import { IsString, IsIn, IsOptional } from 'class-validator';

export class UpdateAssignmentStateDto {
  @IsString()
  @IsIn(['unassigned', 'in_review', 'completed'])
  state: string;

  @IsString()
  @IsOptional()
  reason?: string;

  @IsOptional()
  metadata?: Record<string, any>;
}
