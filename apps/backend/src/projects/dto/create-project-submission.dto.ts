import { IsString, IsOptional, IsUrl, IsEnum, MinLength, MaxLength } from 'class-validator';
import { ProjectType } from '../entities/project-submission.entity';

export class CreateProjectSubmissionDto {
  @IsString()
  @MinLength(5, { message: 'Title must be at least 5 characters long' })
  @MaxLength(255, { message: 'Title must be at most 255 characters long' })
  title: string;

  @IsString()
  @MinLength(20, { message: 'Description must be at least 20 characters long' })
  description: string;

  @IsOptional()
  @IsString()
  detailedContent?: string;

  @IsEnum(ProjectType)
  projectType: ProjectType;

  @IsOptional()
  @IsUrl()
  repositoryUrl?: string;

  @IsOptional()
  @IsUrl()
  liveUrl?: string;

  @IsOptional()
  metadata?: Record<string, unknown>;
}
