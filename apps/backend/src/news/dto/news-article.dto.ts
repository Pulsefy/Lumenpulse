export class NewsArticleDto {
  id: string;
  guid: string;
  title: string;
  subtitle: string | null;
  body: string;
  url: string;
  imageUrl: string | null;
  authors: string;
  source: string;
  sourceKey: string;
  sourceImageUrl: string | null;
  categories: string[];
  keywords: string[];
  sentiment: string;
  publishedAt: string;
  relatedCoins: string[];
}

export class NewsCategoryDto {
  id: string;
  name: string;
  status: string;
}

export class NewsArticlesResponseDto {
  articles: NewsArticleDto[];
  totalCount: number;
  fetchedAt: string;
}

export class NewsSearchResponseDto {
  articles: NewsArticleDto[];
  searchTerm: string;
  totalCount: number;
  fetchedAt: string;
}

export class NewsCategoriesResponseDto {
  categories: NewsCategoryDto[];
  totalCount: number;
  fetchedAt: string;
}

export class SingleArticleResponseDto {
  article: NewsArticleDto | null;
  fetchedAt: string;
}
