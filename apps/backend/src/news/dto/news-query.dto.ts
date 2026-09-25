import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  IsEnum,
  IsNotEmpty,
  IsOptional,
  IsString,
  MaxLength,
} from 'class-validator';
import { PaginationQueryDto } from '../../common/pagination';

/**
 * Query parameters for `GET /news`: the shared pagination contract plus
 * the news-specific filters.
 */
export class NewsListQueryDto extends PaginationQueryDto {
  @ApiPropertyOptional({ description: 'Content language', example: 'EN' })
  @IsOptional()
  @IsString()
  @MaxLength(8)
  lang?: string;

  @ApiPropertyOptional({
    description: 'Filter by article tag',
    example: 'stellar',
  })
  @IsOptional()
  @IsString()
  @MaxLength(50)
  tag?: string;

  @ApiPropertyOptional({
    description: 'Filter by article category',
    example: 'DeFi',
  })
  @IsOptional()
  @IsString()
  @MaxLength(50)
  category?: string;
}

/**
 * Query parameters for `GET /news/search`: the shared pagination contract
 * plus the required search terms.
 */
export class NewsSearchQueryDto extends PaginationQueryDto {
  @ApiProperty({ description: 'Search keyword', example: 'Bitcoin ETF' })
  @IsString()
  @IsNotEmpty()
  @MaxLength(200)
  q: string;

  @ApiProperty({ description: 'News source key', example: 'coindesk' })
  @IsString()
  @IsNotEmpty()
  @MaxLength(50)
  source: string;

  @ApiPropertyOptional({ description: 'Content language', example: 'EN' })
  @IsOptional()
  @IsString()
  @MaxLength(8)
  lang?: string;
}

export type NewsCategoryStatus = 'ACTIVE' | 'INACTIVE' | 'ALL';

/**
 * Query parameters for `GET /news/categories`: the shared pagination
 * contract plus the status filter.
 */
export class NewsCategoriesQueryDto extends PaginationQueryDto {
  @ApiPropertyOptional({
    enum: ['ACTIVE', 'INACTIVE', 'ALL'],
    description: 'Filter categories by status',
  })
  @IsOptional()
  @IsEnum(['ACTIVE', 'INACTIVE', 'ALL'])
  status?: NewsCategoryStatus;
}
