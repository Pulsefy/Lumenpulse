import {
  IsArray,
  ArrayMinSize,
  ArrayMaxSize,
  IsString,
  IsUUID,
  IsEnum,
  IsOptional,
  MaxLength,
  ValidateNested,
} from 'class-validator';
import { Type } from 'class-transformer';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { DecisionType } from '../entities/review-decision-history.entity';
import { MAX_BATCH_SIZE } from '../../common/bulk/bulk-operation.helper';

export class BulkReviewTriageItemDto {
  @ApiProperty({
    description: 'Target entity UUID to record a decision for',
    example: '550e8400-e29b-41d4-a716-446655440000',
  })
  @IsUUID()
  targetId: string;

  @ApiProperty({
    description: 'Type of the target entity (e.g., project, submission)',
    example: 'project',
  })
  @IsString()
  @MaxLength(50)
  targetType: string;

  @ApiProperty({
    enum: DecisionType,
    description: 'Review decision to record',
    example: DecisionType.APPROVED,
  })
  @IsEnum(DecisionType)
  decisionType: DecisionType;

  @ApiPropertyOptional({
    description: 'Rationale for the decision',
    maxLength: 5000,
  })
  @IsString()
  @IsOptional()
  @MaxLength(5000)
  rationale?: string;
}

export class BulkReviewTriageDto {
  @ApiProperty({
    type: [BulkReviewTriageItemDto],
    description: `Array of review decisions (max ${MAX_BATCH_SIZE})`,
  })
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(MAX_BATCH_SIZE)
  @ValidateNested({ each: true })
  @Type(() => BulkReviewTriageItemDto)
  items: BulkReviewTriageItemDto[];
}
