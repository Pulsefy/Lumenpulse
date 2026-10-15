import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  IsString,
  IsEnum,
  IsBoolean,
  IsOptional,
  IsObject,
  MaxLength,
  MinLength,
} from 'class-validator';
import { SavedSearchDomain } from '../entities/saved-search.entity';

export class CreateSavedSearchDto {
  @ApiProperty({
    description: 'Human-readable name for this saved search',
    example: 'Stellar DeFi grants – round 4',
    maxLength: 120,
  })
  @IsString()
  @MinLength(1)
  @MaxLength(120)
  name: string;

  @ApiProperty({
    description: 'Domain this search targets',
    enum: SavedSearchDomain,
    example: SavedSearchDomain.GRANTS,
  })
  @IsEnum(SavedSearchDomain)
  domain: SavedSearchDomain;

  @ApiProperty({
    description:
      'Domain-specific filter parameters as a JSON object.  ' +
      'These mirror the query parameters accepted by the corresponding ' +
      'discovery endpoint (e.g. GET /grants/rounds, GET /search/projects, ' +
      'GET /news).',
    example: { status: 'active', keyword: 'DeFi' },
    additionalProperties: true,
  })
  @IsObject()
  filters: Record<string, unknown>;

  @ApiPropertyOptional({
    description:
      'When true the user will receive notifications when new results match this search.',
    default: false,
  })
  @IsOptional()
  @IsBoolean()
  isSubscribed?: boolean;
}
