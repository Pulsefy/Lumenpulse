import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  IsString,
  IsOptional,
  IsBoolean,
  MaxLength,
  MinLength,
  IsObject,
} from 'class-validator';

/**
 * Payload used when creating a new saved search.
 *
 * `query` is the raw search string, while `filters` carries structured
 * filter values (status, owner, kind, etc.).  The backend stores both
 * verbatim so the search can be re-run with the exact original inputs.
 */
export class CreateSavedSearchDto {
  @ApiProperty({
    description: 'User-chosen label for the saved search',
    example: 'Verified Lumen projects',
  })
  @IsString()
  @MinLength(1)
  @MaxLength(120)
  name: string;

  @ApiPropertyOptional({
    description: 'Raw search query string at save time',
    example: 'Lumen',
  })
  @IsOptional()
  @IsString()
  @MaxLength(500)
  query?: string;

  @ApiPropertyOptional({
    description:
      'Structured filter snapshot (status, ownerPublicKey, kind, etc.)',
    example: { kind: 'project', status: 'VERIFIED' },
  })
  @IsOptional()
  @IsObject()
  filters?: Record<string, unknown>;

  @ApiPropertyOptional({
    description:
      'Whether notifications should fire when new results are available',
    default: false,
  })
  @IsOptional()
  @IsBoolean()
  notificationsEnabled?: boolean;
}

/**
 * Payload used when renaming or toggling notifications for a saved search.
 * All fields optional — only supplied fields are applied.
 */
export class UpdateSavedSearchDto {
  @ApiPropertyOptional({ description: 'New label', example: 'Renamed search' })
  @IsOptional()
  @IsString()
  @MinLength(1)
  @MaxLength(120)
  name?: string;

  @ApiPropertyOptional({ description: 'Updated raw query string' })
  @IsOptional()
  @IsString()
  @MaxLength(500)
  query?: string;

  @ApiPropertyOptional({ description: 'Updated filter snapshot' })
  @IsOptional()
  @IsObject()
  filters?: Record<string, unknown>;

  @ApiPropertyOptional({ description: 'Toggle notifications for this search' })
  @IsOptional()
  @IsBoolean()
  notificationsEnabled?: boolean;
}

/**
 * Response shape returned for a single saved search.
 */
export class SavedSearchResponseDto {
  @ApiProperty({ format: 'uuid' })
  id: string;

  @ApiProperty({ format: 'uuid' })
  userId: string;

  @ApiProperty({ example: 'Verified Lumen projects' })
  name: string;

  @ApiProperty({ example: 'Lumen' })
  query: string;

  @ApiProperty({ type: 'object', additionalProperties: true })
  filters: Record<string, unknown>;

  @ApiProperty({ example: false })
  notificationsEnabled: boolean;

  @ApiProperty()
  createdAt: Date;

  @ApiProperty()
  updatedAt: Date;
}

/**
 * Response shape for the list endpoint.
 */
export class SavedSearchListResponseDto {
  @ApiProperty({ type: [SavedSearchResponseDto] })
  items: SavedSearchResponseDto[];

  @ApiProperty({ example: 3 })
  total: number;
}
