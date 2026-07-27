import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsBoolean, IsEnum, IsObject, IsOptional, IsString, MaxLength } from 'class-validator';
import { ReviewDecision } from '../entities/review-history.entity';

export class CreateReviewHistoryDto {
  @ApiProperty({ example: 'project-submission' })
  @IsString()
  @MaxLength(100)
  targetType: string;

  @ApiProperty({ example: '42' })
  @IsString()
  @MaxLength(255)
  targetId: string;

  @ApiProperty({ enum: ReviewDecision, example: ReviewDecision.Comment })
  @IsEnum(ReviewDecision)
  decision: ReviewDecision;

  @ApiPropertyOptional({ example: 'Please provide an updated budget breakdown.' })
  @IsOptional()
  @IsString()
  comment?: string;

  @ApiPropertyOptional({ default: false, description: 'Visible only in privileged review timelines.' })
  @IsOptional()
  @IsBoolean()
  isInternal?: boolean;

  @ApiPropertyOptional({ example: { section: 'budget', source: 'mobile' } })
  @IsOptional()
  @IsObject()
  metadata?: Record<string, unknown>;
}

export class ReviewHistoryItemDto {
  @ApiProperty()
  id: string;

  @ApiPropertyOptional()
  submissionId: number | null;

  @ApiProperty()
  targetType: string;

  @ApiProperty()
  targetId: string;

  @ApiProperty({ enum: ReviewDecision })
  decision: ReviewDecision;

  @ApiPropertyOptional()
  comment?: string | null;

  @ApiProperty()
  actorId: string;

  @ApiProperty()
  metadata: Record<string, unknown>;

  @ApiProperty()
  createdAt: Date;
}
