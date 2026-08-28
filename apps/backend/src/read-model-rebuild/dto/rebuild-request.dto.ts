import { ApiProperty } from '@nestjs/swagger';
import { IsEnum, IsOptional, IsString } from 'class-validator';
import { RebuildDataset } from '../entities/read-model-rebuild-job.entity';

export class RebuildRequestDto {
  @ApiProperty({
    description: 'Dataset to rebuild',
    enum: RebuildDataset,
    example: RebuildDataset.KPI_SNAPSHOTS,
  })
  @IsEnum(RebuildDataset)
  dataset: RebuildDataset;

  @ApiProperty({
    description: 'Optional contract ID to scope the rebuild',
    required: false,
    example: 'CBBQW7T65XBDPIPXEIIPJVJEEIBSPC566HMEU2LTBAULLKCNUFRFBKRO',
  })
  @IsOptional()
  @IsString()
  contractId?: string;

  @ApiProperty({
    description: 'Reason for triggering the rebuild (for audit)',
    required: false,
    example: 'KPI computation logic updated to handle corrections',
  })
  @IsOptional()
  @IsString()
  reason?: string;

  @ApiProperty({
    description: 'Idempotency key to prevent duplicate rebuilds',
    required: false,
    example: 'rebuild-kpi-snapshots-2024-01-01',
  })
  @IsOptional()
  @IsString()
  idempotencyKey?: string;

  @ApiProperty({
    description: 'Whether to force rebuild even if in progress',
    required: false,
    default: false,
  })
  @IsOptional()
  force?: boolean;
}
