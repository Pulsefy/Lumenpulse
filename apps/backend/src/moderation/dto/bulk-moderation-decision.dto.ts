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
import { ReportStatus } from '../entities/content-report.entity';
import { MAX_BATCH_SIZE } from '../../common/bulk/bulk-operation.helper';

export class BulkModerationItemDto {
  @ApiProperty({
    description: 'Content report UUID',
    example: '550e8400-e29b-41d4-a716-446655440000',
  })
  @IsUUID()
  id: string;

  @ApiProperty({
    enum: ReportStatus,
    description: 'Decision to apply to this report',
    example: ReportStatus.RESOLVED,
  })
  @IsEnum(ReportStatus)
  status: ReportStatus;

  @ApiPropertyOptional({
    description: 'Moderator notes for this specific report',
    example: 'Confirmed spam — content removed.',
    maxLength: 2000,
  })
  @IsString()
  @IsOptional()
  @MaxLength(2000)
  reviewNotes?: string;
}

export class BulkModerationDecisionDto {
  @ApiProperty({
    type: [BulkModerationItemDto],
    description: `Array of moderation decisions (max ${MAX_BATCH_SIZE})`,
  })
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(MAX_BATCH_SIZE)
  @ValidateNested({ each: true })
  @Type(() => BulkModerationItemDto)
  items: BulkModerationItemDto[];
}
