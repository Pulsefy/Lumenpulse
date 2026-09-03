import {
  IsEnum,
  IsNotEmpty,
  IsOptional,
  IsString,
  MaxLength,
  IsObject,
} from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { DecisionType } from '../entities/review-decision-history.entity';

export class CreateReviewDecisionDto {
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
    enum: DecisionType,
    description: 'Decision made on the review',
    example: DecisionType.APPROVED,
  })
  @IsEnum(DecisionType)
  @IsNotEmpty()
  decisionType: DecisionType;

  @ApiPropertyOptional({
    description: 'Rationale for the decision',
    example: 'Project meets all quality standards and requirements.',
    maxLength: 5000,
  })
  @IsString()
  @IsOptional()
  @MaxLength(5000)
  rationale?: string;

  @ApiPropertyOptional({
    description: 'Additional metadata about the decision',
    example: { priority: 'high', category: 'quality' },
  })
  @IsObject()
  @IsOptional()
  metadata?: Record<string, any>;

  @ApiPropertyOptional({
    description: 'Previous decision state (for tracking changes)',
    example: 'deferred',
  })
  @IsString()
  @IsOptional()
  previousDecision?: string;
}
