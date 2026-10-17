import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsEnum, IsOptional, IsString } from 'class-validator';
import { PaginatedQueryDto } from '../../common/pagination/pagination-query.dto';
import { VerificationStatus } from '../../verification/dto/verification.dto';

/**
 * Query DTO for `GET /search/projects`.
 *
 * Extends {@link PaginatedQueryDto} so the endpoint accepts the standard
 * `page` / `pageSize` parameters. The previous `offset` / `limit` style has
 * been replaced by page-based pagination for consistency across all list
 * endpoints.
 */
export class ProjectSearchQueryDto extends PaginatedQueryDto {
  @ApiPropertyOptional({
    description: 'Search query (matches project name or numeric id)',
    example: 'Lumen',
  })
  @IsOptional()
  @IsString()
  q?: string;

  @ApiPropertyOptional({
    description: 'Filter by verification status',
    enum: VerificationStatus,
    example: VerificationStatus.Pending,
  })
  @IsOptional()
  @IsEnum(VerificationStatus)
  status?: VerificationStatus;

  @ApiPropertyOptional({
    description: 'Filter by owner Stellar public key',
    example: 'GA5ZSEJYB37JRC5AVCIA5MOP4RHTM335X2KGX3IHOJAPP5RE34K4KZVN',
  })
  @IsOptional()
  @IsString()
  ownerPublicKey?: string;
}

export class ProjectSearchItemDto {
  @ApiProperty({ example: 1 })
  projectId: number;

  @ApiProperty({ example: 'LumenPulse' })
  name: string;

  @ApiProperty({
    example: 'GA5ZSEJYB37JRC5AVCIA5MOP4RHTM335X2KGX3IHOJAPP5RE34K4KZVN',
  })
  ownerPublicKey: string;

  @ApiProperty({
    enum: VerificationStatus,
    example: VerificationStatus.Pending,
  })
  status: VerificationStatus;

  @ApiProperty({ example: 0 })
  votesFor: number;

  @ApiProperty({ example: 0 })
  votesAgainst: number;

  @ApiProperty({ example: 1712345678 })
  registeredAt: number;

  @ApiProperty({ example: 0 })
  resolvedAt: number;

  @ApiProperty({
    description: 'Percentage of quorum reached (0–100)',
    example: 0,
  })
  quorumProgress: number;

  @ApiProperty({
    description: 'Relevance score used for ordering',
    example: 100,
  })
  score: number;
}

/**
 * Paginated response for `GET /search/projects`.
 *
 * Follows the standard envelope: `items / total / page / pageSize / totalPages`.
 */
export class ProjectSearchResponseDto {
  @ApiProperty({ type: [ProjectSearchItemDto] })
  items: ProjectSearchItemDto[];

  @ApiProperty({ example: 42 })
  total: number;

  @ApiProperty({
    description: 'Current page number (1-indexed)',
    example: 1,
  })
  page: number;

  @ApiProperty({
    description: 'Number of items per page',
    example: 20,
  })
  pageSize: number;

  @ApiProperty({
    description: 'Total number of pages (always ≥ 1)',
    example: 3,
  })
  totalPages: number;
}
