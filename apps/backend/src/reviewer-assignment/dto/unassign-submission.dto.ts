import { IsUUID, IsString, IsOptional } from 'class-validator';

export class UnassignSubmissionDto {
  @IsUUID()
  itemId: string;

  @IsString()
  itemType: string;

  @IsString()
  @IsOptional()
  reason?: string;

  @IsOptional()
  metadata?: Record<string, any>;
}
