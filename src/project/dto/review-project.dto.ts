import { IsEnum, IsString, IsOptional } from 'class-validator';

export enum ReviewAction {
  APPROVE = 'APPROVE',
  REQUEST_CHANGES = 'REQUEST_CHANGES',
}

export class ReviewProjectDto {
  @IsEnum(ReviewAction)
  action: ReviewAction;

  @IsString()
  @IsOptional()
  notes?: string;
}