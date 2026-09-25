import { IsOptional, IsString, IsEnum } from 'class-validator';
import { ApiPropertyOptional } from '@nestjs/swagger';
import { CommentVisibility } from '../entities/review-comment.entity';

export class QueryReviewHistoryDto {
  @ApiPropertyOptional({
    description: 'Filter by target ID',
    example: '123',
  })
  @IsString()
  @IsOptional()
  targetId?: string;

  @ApiPropertyOptional({
    description: 'Filter by target type',
    example: 'project',
  })
  @IsString()
  @IsOptional()
  targetType?: string;

  @ApiPropertyOptional({
    description: 'Filter by comment visibility',
    enum: CommentVisibility,
  })
  @IsEnum(CommentVisibility)
  @IsOptional()
  visibility?: CommentVisibility;

  @ApiPropertyOptional({
    description: 'Page number',
    example: '1',
  })
  @IsString()
  @IsOptional()
  page?: string;

  @ApiPropertyOptional({
    description: 'Items per page',
    example: '20',
  })
  @IsString()
  @IsOptional()
  limit?: string;
}
