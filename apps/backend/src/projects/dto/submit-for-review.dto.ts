import { IsString, MinLength, IsOptional } from 'class-validator';

export class SubmitForReviewDto {
  @IsOptional()
  @IsString()
  @MinLength(10, { message: 'Message must be at least 10 characters long' })
  coverLetter?: string;
}
