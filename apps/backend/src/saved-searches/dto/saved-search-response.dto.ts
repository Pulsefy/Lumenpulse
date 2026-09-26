import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsEnum, IsOptional } from 'class-validator';
import { SavedSearchDomain } from '../entities/saved-search.entity';

export class ListSavedSearchesQueryDto {
  @ApiPropertyOptional({
    description: 'Filter results to a single domain.',
    enum: SavedSearchDomain,
    example: SavedSearchDomain.GRANTS,
  })
  @IsOptional()
  @IsEnum(SavedSearchDomain)
  domain?: SavedSearchDomain;
}

export class SavedSearchResponseDto {
  @ApiProperty() id: string;
  @ApiProperty() userId: string;
  @ApiProperty() name: string;
  @ApiProperty({ enum: SavedSearchDomain }) domain: SavedSearchDomain;
  @ApiProperty({ type: 'object' }) filters: Record<string, unknown>;
  @ApiProperty() isSubscribed: boolean;
  @ApiPropertyOptional({ nullable: true }) lastNotifiedAt: Date | null;
  @ApiProperty() createdAt: Date;
  @ApiProperty() updatedAt: Date;
}

export class SavedSearchListResponseDto {
  @ApiProperty({ type: [SavedSearchResponseDto] })
  items: SavedSearchResponseDto[];

  @ApiProperty({ description: 'Total number of saved searches for the user' })
  total: number;
}
