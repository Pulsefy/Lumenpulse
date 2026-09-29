import {
  IsEnum,
  IsNotEmpty,
  IsOptional,
  IsString,
  MaxLength,
} from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { CommentVisibility } from '../entities/review-comment.entity';

export class CreateReviewCommentDto {
  @ApiProperty({
    description: 'ID of the target entity being reviewed',
    example: '123',
  })
  @IsString()
  @IsNotEmpty()
  targetId: string;

  @ApiProperty({
    description:
      'Type of the target entity (e.g., project, submission, report)',
    example: 'project',
  })
  @IsString()
  @IsNotEmpty()
  targetType: string;

  @ApiProperty({
    enum: CommentVisibility,
    description: 'Visibility of the comment',
    example: CommentVisibility.PUBLIC,
  })
  @IsEnum(CommentVisibility)
  @IsOptional()
  visibility?: CommentVisibility;

  @ApiProperty({
    description: 'Comment content',
    example: 'This project looks promising but needs more documentation.',
    maxLength: 5000,
  })
  @IsString()
  @IsNotEmpty()
  @MaxLength(5000)
  content: string;

  @ApiPropertyOptional({
    description: 'ID of the parent comment for threaded replies',
    example: 'comment-uuid',
  })
  @IsString()
  @IsOptional()
  parentId?: string;
}
