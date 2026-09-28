import {
  IsArray,
  ArrayMinSize,
  ArrayMaxSize,
  IsUUID,
  IsString,
  IsOptional,
  MaxLength,
  ValidateNested,
} from 'class-validator';
import { Type } from 'class-transformer';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { MAX_BATCH_SIZE } from '../../common/bulk/bulk-operation.helper';

export class BulkDeadLetterReplayItemDto {
  @ApiProperty({
    description: 'Dead-letter queue entry UUID',
    example: '550e8400-e29b-41d4-a716-446655440000',
  })
  @IsUUID()
  id: string;

  @ApiPropertyOptional({
    description: 'Optional per-item reason for the replay',
    example: 'Contract deployed — safe to retry.',
    maxLength: 500,
  })
  @IsString()
  @IsOptional()
  @MaxLength(500)
  reason?: string;
}

export class BulkDeadLetterReplayDto {
  @ApiProperty({
    type: [BulkDeadLetterReplayItemDto],
    description: `Dead-letter entries to replay (max ${MAX_BATCH_SIZE})`,
  })
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(MAX_BATCH_SIZE)
  @ValidateNested({ each: true })
  @Type(() => BulkDeadLetterReplayItemDto)
  items: BulkDeadLetterReplayItemDto[];
}
