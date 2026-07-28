import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  IsString,
  IsEnum,
  IsOptional,
  IsBoolean,
  IsObject,
  MaxLength,
} from 'class-validator';
import { SavedSearchDomain } from '../saved-search.entity';

export class CreateSavedSearchDto {
  @ApiProperty({
    description: 'A user-friendly name for this saved search',
    example: 'Stellar projects with active vaults',
  })
  @IsString()
  @MaxLength(255)
  name: string;

  @ApiProperty({
    description: 'Domain of the search',
    enum: SavedSearchDomain,
    example: SavedSearchDomain.PROJECTS,
  })
  @IsEnum(SavedSearchDomain)
  domain: SavedSearchDomain;

  @ApiProperty({
    description:
      'Search query filters/parameters (suitable for both web & mobile)',
    example: { q: 'stellar', status: 'VERIFIED' },
  })
  @IsObject()
  query: Record<string, unknown>;

  @ApiPropertyOptional({
    description: 'Whether search subscription is active for notifications',
    example: true,
  })
  @IsOptional()
  @IsBoolean()
  isSubscribed?: boolean;
}

export class SavedSearchResponseDto {
  @ApiProperty({ description: 'Unique ID of the saved search' })
  id: string;

  @ApiProperty({ description: 'User ID' })
  userId: string;

  @ApiProperty({ description: 'Name of the saved search' })
  name: string;

  @ApiProperty({ description: 'Domain of the search', enum: SavedSearchDomain })
  domain: SavedSearchDomain;

  @ApiProperty({ description: 'Search query filters/parameters' })
  query: Record<string, unknown>;

  @ApiProperty({ description: 'Whether search subscription is active' })
  isSubscribed: boolean;

  @ApiProperty({ description: 'Created at timestamp' })
  createdAt: Date;

  @ApiProperty({ description: 'Updated at timestamp' })
  updatedAt: Date;
}
