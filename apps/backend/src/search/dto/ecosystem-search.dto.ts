import { ApiProperty } from '@nestjs/swagger';
import { IsBoolean, IsIn, IsInt, IsOptional, IsString, Max, Min } from 'class-validator';

export type EcosystemEntityKind = 'tag' | 'category';

export class EcosystemSearchQueryDto {
  @ApiProperty({
    description: 'Search query (matches tag/category value)',
    required: false,
    example: 'stellar',
  })
  @IsOptional()
  @IsString()
  q?: string;

  @ApiProperty({
    description: 'Entity kinds to include',
    required: false,
    enum: ['tag', 'category'],
    default: 'tag',
    example: 'tag',
  })
  @IsOptional()
  @IsIn(['tag', 'category'])
  kind?: EcosystemEntityKind;

  @ApiProperty({
    description: 'Pagination limit (top N by usage)',
    required: false,
    default: 25,
    minimum: 1,
    maximum: 200,
    example: 25,
  })
  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(200)
  limit?: number;

  @ApiProperty({
    description: 'Whether to include entity usage counts',
    required: false,
    default: true,
    example: true,
  })
  @IsOptional()
  @IsBoolean()
  includeCounts?: boolean;
}

export class EcosystemEntityDto {
  @ApiProperty({ enum: ['tag', 'category'], example: 'tag' })
  kind: EcosystemEntityKind;

  @ApiProperty({ example: 'stellar' })
  value: string;

  @ApiProperty({ example: 123, required: false })
  count?: number;
}

export class EcosystemSearchResponseDto {
  @ApiProperty({ type: [EcosystemEntityDto] })
  items: EcosystemEntityDto[];
}

