import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  IsString,
  IsOptional,
  IsObject,
  ValidateNested,
  IsEnum,
} from 'class-validator';
import { Type } from 'class-transformer';

export class ModelHealthSignalDto {
  @ApiProperty({
    enum: ['trustworthy', 'degraded', 'unavailable'],
    example: 'trustworthy',
  })
  @IsEnum(['trustworthy', 'degraded', 'unavailable'])
  state: 'trustworthy' | 'degraded' | 'unavailable';

  @ApiProperty({
    description: 'Human-readable explanation of the signal state',
  })
  @IsString()
  detail: string;

  @ApiPropertyOptional({
    description:
      'Structured context for the signal (feature names, age in seconds, ...)',
  })
  @IsObject()
  @IsOptional()
  @Type(() => Object)
  value?: unknown;
}

export class ModelHealthSnapshotDto {
  @ApiProperty({
    description: 'Model type identifier, e.g. sentiment or price_predictor',
  })
  @IsString()
  model_type: string;

  @ApiPropertyOptional({
    description:
      'Currently promoted model version from the registry, or null when none is live',
    example: 'v1.1',
  })
  @IsString()
  @IsOptional()
  live_version: string | null;

  @ApiProperty({ type: ModelHealthSignalDto })
  @ValidateNested()
  @Type(() => ModelHealthSignalDto)
  drift: ModelHealthSignalDto;

  @ApiProperty({ type: ModelHealthSignalDto })
  @ValidateNested()
  @Type(() => ModelHealthSignalDto)
  calibration_age: ModelHealthSignalDto;

  @ApiProperty({ type: ModelHealthSignalDto })
  @ValidateNested()
  @Type(() => ModelHealthSignalDto)
  data_freshness: ModelHealthSignalDto;

  @ApiProperty({
    enum: ['trustworthy', 'degraded', 'unavailable'],
    example: 'trustworthy',
  })
  @IsEnum(['trustworthy', 'degraded', 'unavailable'])
  overall: 'trustworthy' | 'degraded' | 'unavailable';

  @ApiProperty({ description: 'ISO-8601 UTC time this model was assessed' })
  @IsString()
  checked_at: string;

  @ApiProperty({
    description:
      'True when this assessment moved the model into a non-trustworthy state since the last assessment',
    example: false,
  })
  transitioned_to_degraded: boolean;
}

export class ModelHealthResponseDto {
  @ApiProperty({ description: 'ISO-8601 UTC time this report was generated' })
  @IsString()
  checked_at: string;

  @ApiProperty({
    description: 'Per-model SLO health snapshots keyed by model type',
    type: () => [ModelHealthSnapshotDto],
  })
  @IsObject()
  models: Record<string, ModelHealthSnapshotDto>;
}
