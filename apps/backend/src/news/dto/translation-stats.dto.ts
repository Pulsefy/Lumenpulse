import { ApiProperty } from '@nestjs/swagger';

export class TranslationStatsDto {
  @ApiProperty({
    description: 'Total number of articles',
    example: 1000,
  })
  totalArticles: number;

  @ApiProperty({
    description: 'Number of translated articles',
    example: 250,
  })
  translatedArticles: number;

  @ApiProperty({
    description: 'Number of articles in original English',
    example: 750,
  })
  englishArticles: number;

  @ApiProperty({
    description: 'Breakdown by language',
    example: { en: 750, es: 100, fr: 80, de: 70 },
  })
  languageBreakdown: Record<string, number>;

  @ApiProperty({
    description: 'Average translation confidence',
    example: 0.92,
  })
  averageConfidence: number;
}

export class ArticleTranslationDto {
  @ApiProperty({
    description: 'Article ID',
    example: '123e4567-e89b-12d3-a456-426614174000',
  })
  id: string;

  @ApiProperty({
    description: 'Translated title',
    example: 'Bitcoin reaches new all-time high',
  })
  title: string;

  @ApiProperty({
    description: 'Original title (if translated)',
    example: 'Bitcoin alcanza nuevo máximo histórico',
    nullable: true,
  })
  originalTitle: string | null;

  @ApiProperty({
    description: 'Original language code',
    example: 'es',
    nullable: true,
  })
  originalLanguage: string | null;

  @ApiProperty({
    description: 'Whether the article was translated',
    example: true,
  })
  isTranslated: boolean;

  @ApiProperty({
    description: 'Translation confidence score',
    example: 0.95,
    nullable: true,
  })
  translationConfidence: number | null;
}
