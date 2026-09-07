import { IsString, IsBoolean, IsEnum, IsObject, IsOptional, MaxLength } from 'class-validator';
import { SavedSearchDomain } from './saved-search.entity';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export class CreateSavedSearchDto {
  @ApiProperty({ description: 'Name of the saved search', maxLength: 255 })
  @IsString()
  @MaxLength(255)
  name: string;

  @ApiProperty({ enum: SavedSearchDomain, description: 'Domain for the search' })
  @IsEnum(SavedSearchDomain)
  domain: SavedSearchDomain;

  @ApiProperty({ description: 'The search query or filter parameters as a JSON object' })
  @IsObject()
  query: Record<string, unknown>;

  @ApiPropertyOptional({ description: 'Whether to subscribe to new results for this search' })
  @IsOptional()
  @IsBoolean()
  notifyOnNewResults?: boolean;
}
