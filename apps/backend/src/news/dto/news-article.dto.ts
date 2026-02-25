import { ApiProperty } from '@nestjs/swagger';

export class NewsArticleDto {
  @ApiProperty({
    description: 'Unique article identifier',
    example: '123e4567-e89b-12d3-a456-426614174000',
  })
  id: string;

  @ApiProperty({
    description: 'Article GUID from source',
    example: 'coindesk-article-12345',
  })
  guid: string;

  @ApiProperty({
    description: 'Article title',
    example: 'Bitcoin Reaches New All-Time High',
  })
  title: string;

  @ApiProperty({
    description: 'Article subtitle',
    example: 'Market analysts predict continued growth',
    nullable: true,
  })
  subtitle: string | null;

  @ApiProperty({ description: 'Full article content' })
  body: string;

  @ApiProperty({
    description: 'Article URL',
    example: 'https://coindesk.com/article/bitcoin-ath',
  })
  url: string;

  @ApiProperty({
    description: 'Article image URL',
    example: 'https://cdn.coindesk.com/image.jpg',
    nullable: true,
  })
  imageUrl: string | null;

  @ApiProperty({
    description: 'Article authors',
    example: 'John Doe, Jane Smith',
  })
  authors: string;

  @ApiProperty({ description: 'News source name', example: 'CoinDesk' })
  source: string;

  @ApiProperty({ description: 'News source key', example: 'coindesk' })
  sourceKey: string;

  @ApiProperty({ description: 'Source logo URL', nullable: true })
  sourceImageUrl: string | null;

  @ApiProperty({
    description: 'Article categories',
    type: [String],
    example: ['Bitcoin', 'Markets'],
  })
  categories: string[];

  @ApiProperty({
    description: 'Article keywords',
    type: [String],
    example: ['BTC', 'cryptocurrency', 'trading'],
  })
  keywords: string[];

  @ApiProperty({
    description: 'Sentiment analysis result',
    example: 'positive',
  })
  sentiment: string;

  @ApiProperty({
    description: 'Publication timestamp',
    example: '2024-02-25T15:30:00Z',
  })
  publishedAt: string;

  @ApiProperty({
    description: 'Related cryptocurrency symbols',
    type: [String],
    example: ['BTC', 'ETH'],
  })
  relatedCoins: string[];
}

export class NewsCategoryDto {
  @ApiProperty({ description: 'Category ID', example: 'cat-123' })
  id: string;

  @ApiProperty({ description: 'Category name', example: 'DeFi' })
  name: string;

  @ApiProperty({ description: 'Category status', example: 'ACTIVE' })
  status: string;
}

export class NewsArticlesResponseDto {
  @ApiProperty({ description: 'List of news articles', type: [NewsArticleDto] })
  articles: NewsArticleDto[];

  @ApiProperty({ description: 'Total number of articles', example: 150 })
  totalCount: number;

  @ApiProperty({
    description: 'Timestamp when data was fetched',
    example: '2024-02-25T15:30:00Z',
  })
  fetchedAt: string;
}

export class NewsSearchResponseDto {
  @ApiProperty({
    description: 'List of matching articles',
    type: [NewsArticleDto],
  })
  articles: NewsArticleDto[];

  @ApiProperty({ description: 'Search term used', example: 'Bitcoin ETF' })
  searchTerm: string;

  @ApiProperty({
    description: 'Total number of matching articles',
    example: 42,
  })
  totalCount: number;

  @ApiProperty({
    description: 'Timestamp when search was performed',
    example: '2024-02-25T15:30:00Z',
  })
  fetchedAt: string;
}

export class NewsCategoriesResponseDto {
  @ApiProperty({
    description: 'List of news categories',
    type: [NewsCategoryDto],
  })
  categories: NewsCategoryDto[];

  @ApiProperty({ description: 'Total number of categories', example: 12 })
  totalCount: number;

  @ApiProperty({
    description: 'Timestamp when data was fetched',
    example: '2024-02-25T15:30:00Z',
  })
  fetchedAt: string;
}

export class SingleArticleResponseDto {
  @ApiProperty({
    description: 'Article details',
    type: NewsArticleDto,
    nullable: true,
  })
  article: NewsArticleDto | null;

  @ApiProperty({
    description: 'Timestamp when data was fetched',
    example: '2024-02-25T15:30:00Z',
  })
  fetchedAt: string;
}
