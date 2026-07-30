import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsOptional, IsInt, Min, Max, IsEnum, IsString } from 'class-validator';
import { Type } from 'class-transformer';

export enum FeedActivityType {
  CONTRIBUTOR_REGISTERED = 'contributor_registered',
  GRANT_CONTRIBUTION = 'grant_contribution',
  REPUTATION_CHANGE = 'reputation_change',
}

export enum FeedSortOrder {
  ASC = 'ASC',
  DESC = 'DESC',
}

export class ContributorFeedQueryDto {
  @ApiPropertyOptional({
    description: 'Page number (1-indexed)',
    default: 1,
    minimum: 1,
  })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  page?: number = 1;

  @ApiPropertyOptional({
    description: 'Items per page',
    default: 20,
    minimum: 1,
    maximum: 100,
  })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(100)
  limit?: number = 20;

  @ApiPropertyOptional({
    description: 'Filter by activity type',
    enum: FeedActivityType,
  })
  @IsOptional()
  @IsEnum(FeedActivityType)
  activityType?: FeedActivityType;

  @ApiPropertyOptional({
    description: 'Filter by contributor Stellar address',
    example: 'GA5ZSEJYB37JRC5AVCIA5MOP4RHTM335X2KGX3IHOJAPP5RE34K4KZVN',
  })
  @IsOptional()
  @IsString()
  contributorAddress?: string;

  @ApiPropertyOptional({
    description: 'Sort order by timestamp',
    enum: FeedSortOrder,
    default: FeedSortOrder.DESC,
  })
  @IsOptional()
  @IsEnum(FeedSortOrder)
  sortOrder?: FeedSortOrder = FeedSortOrder.DESC;
}

export class FeedActivityItemDto {
  @ApiProperty({
    description: 'Unique activity identifier (stable for ordering)',
    example: 'activity_abc123',
  })
  id: string;

  @ApiProperty({
    description: 'Type of activity',
    enum: FeedActivityType,
  })
  activityType: FeedActivityType;

  @ApiProperty({
    description: 'Stellar address of the contributor',
    example: 'GA5ZSEJYB37JRC5AVCIA5MOP4RHTM335X2KGX3IHOJAPP5RE34K4KZVN',
  })
  contributorAddress: string;

  @ApiPropertyOptional({
    description: 'GitHub handle of the contributor (if known)',
    example: 'octocat',
  })
  githubHandle?: string;

  @ApiProperty({
    description: 'ISO 8601 timestamp of the activity',
    example: '2026-07-01T12:00:00.000Z',
  })
  timestamp: string;

  @ApiProperty({
    description: 'Human-readable summary of the activity',
    example: 'Contributor registered on testnet',
  })
  summary: string;

  @ApiPropertyOptional({
    description: 'Additional metadata for profile or moderation UIs',
  })
  metadata?: Record<string, unknown>;
}

export class ContributorFeedResponseDto {
  @ApiProperty({
    description: 'List of feed activity items for the current page',
    type: [FeedActivityItemDto],
  })
  items: FeedActivityItemDto[];

  @ApiProperty({
    description: 'Total number of items matching the query',
    example: 42,
  })
  total: number;

  @ApiProperty({
    description: 'Current page number',
    example: 1,
  })
  page: number;

  @ApiProperty({
    description: 'Items per page',
    example: 20,
  })
  limit: number;

  @ApiProperty({
    description: 'Total number of pages',
    example: 3,
  })
  totalPages: number;

  @ApiProperty({
    description:
      'Whether this is a sparse/first-time contributor (fewer than 2 activities)',
    example: false,
  })
  isSparseContributor: boolean;
}
