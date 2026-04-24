import { IsString, IsEnum, MinLength, IsOptional } from 'class-validator';
import { FeedbackType } from '../entities/review-feedback.entity';

export class ReviewSubmissionDto {
  @IsEnum(FeedbackType)
  type: FeedbackType;

  @IsString()
  @MinLength(10, { message: 'Feedback message must be at least 10 characters long' })
  message: string;

  @IsOptional()
  suggestions?: Record<string, unknown>;
}
