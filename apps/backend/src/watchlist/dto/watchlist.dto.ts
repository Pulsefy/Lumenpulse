import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  IsString,
  IsEnum,
  IsOptional,
  IsUrl,
  MaxLength,
  IsInt,
  Min,
} from 'class-validator';
import { WatchlistItemType } from '../watchlist-item.entity';

export class AddToWatchlistDto {
  @ApiProperty({
    description: 'Asset or project symbol (e.g. XLM, USDC)',
    example: 'XLM',
  })
  @IsString()
  @MaxLength(50)
  symbol: string;

  @ApiPropertyOptional({
    description: 'Display name (e.g. Stellar Lumens)',
    example: 'Stellar Lumens',
  })
  @IsOptional()
  @IsString()
  @MaxLength(255)
  name?: string;

  @ApiProperty({
    description: 'Type of watchlist item',
    enum: WatchlistItemType,
    example: WatchlistItemType.ASSET,
  })
  @IsEnum(WatchlistItemType)
  type: WatchlistItemType;

  @ApiPropertyOptional({
    description: 'Stellar asset issuer address',
    example: 'GABCD...',
  })
  @IsOptional()
  @IsString()
  @MaxLength(56)
  assetIssuer?: string;

  @ApiPropertyOptional({
    description: 'Image URL for the asset/project',
    example: 'https://example.com/icon.png',
  })
  @IsOptional()
  @IsUrl()
  @MaxLength(500)
  imageUrl?: string;

  @ApiPropertyOptional({
    description: 'Personal notes about this item',
    example: 'Watching for breakout above resistance',
  })
  @IsOptional()
  @IsString()
  notes?: string;

  @ApiPropertyOptional({
    description: 'Sort order for the watchlist item (lower = higher priority)',
    example: 0,
  })
  @IsOptional()
  @IsInt()
  @Min(0)
  sortOrder?: number;
}

export class UpdateWatchlistDto {
  @ApiPropertyOptional({
    description: 'Display name',
    example: 'Stellar Lumens',
  })
  @IsOptional()
  @IsString()
  @MaxLength(255)
  name?: string;

  @ApiPropertyOptional({
    description: 'Image URL for the asset/project',
    example: 'https://example.com/icon.png',
  })
  @IsOptional()
  @IsUrl()
  @MaxLength(500)
  imageUrl?: string;

  @ApiPropertyOptional({
    description: 'Personal notes about this item',
    example: 'Updated analysis notes',
  })
  @IsOptional()
  @IsString()
  notes?: string;

  @ApiPropertyOptional({
    description: 'Sort order for the watchlist item',
    example: 1,
  })
  @IsOptional()
  @IsInt()
  @Min(0)
  sortOrder?: number;
}

export class WatchlistItemResponseDto {
  @ApiProperty({ description: 'Unique ID of the watchlist item' })
  id: string;

  @ApiProperty({ description: 'User ID' })
  userId: string;

  @ApiProperty({ description: 'Asset or project symbol', example: 'XLM' })
  symbol: string;

  @ApiPropertyOptional({
    description: 'Display name',
    example: 'Stellar Lumens',
  })
  name: string | null;

  @ApiProperty({
    description: 'Type of watchlist item',
    enum: WatchlistItemType,
  })
  type: WatchlistItemType;

  @ApiPropertyOptional({
    description: 'Stellar asset issuer address',
  })
  assetIssuer: string | null;

  @ApiPropertyOptional({ description: 'Image URL' })
  imageUrl: string | null;

  @ApiPropertyOptional({ description: 'Personal notes' })
  notes: string | null;

  @ApiProperty({ description: 'Sort order' })
  sortOrder: number;

  @ApiProperty({ description: 'Created at timestamp' })
  createdAt: Date;

  @ApiProperty({ description: 'Updated at timestamp' })
  updatedAt: Date;
}

export class WatchlistResponseDto {
  @ApiProperty({
    description: 'List of watchlist items',
    type: [WatchlistItemResponseDto],
  })
  items: WatchlistItemResponseDto[];

  @ApiProperty({ description: 'Total number of items' })
  total: number;
}
