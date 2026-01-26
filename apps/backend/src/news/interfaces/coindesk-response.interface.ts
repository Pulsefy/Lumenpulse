export interface CoinDeskSourceData {
  TYPE: string;
  ID: number;
  SOURCE_KEY: string;
  NAME: string;
  IMAGE_URL: string;
  URL: string;
  LANG: string;
  SOURCE_TYPE: string;
  LAUNCH_DATE: number | null;
  SORT_ORDER: number;
  BENCHMARK_SCORE: number;
  STATUS: string;
  LAST_UPDATED_TS: number;
  CREATED_ON: number;
  UPDATED_ON: number;
}

export interface CoinDeskCategoryData {
  TYPE: string;
  ID: number;
  NAME: string;
  CATEGORY: string;
}

export interface CoinDeskArticle {
  TYPE: string;
  ID: number;
  GUID: string;
  PUBLISHED_ON: number;
  PUBLISHED_ON_NS: number | null;
  IMAGE_URL: string;
  TITLE: string;
  SUBTITLE: string | null;
  AUTHORS: string;
  URL: string;
  SOURCE_ID: number;
  BODY: string;
  KEYWORDS: string;
  LANG: string;
  UPVOTES: number;
  DOWNVOTES: number;
  SCORE: number;
  SENTIMENT: string;
  STATUS: string;
  CREATED_ON: number;
  UPDATED_ON: number;
  SOURCE_DATA: CoinDeskSourceData;
  CATEGORY_DATA: CoinDeskCategoryData[];
}

export interface CoinDeskCategoryFilter {
  INCLUDED_WORDS?: string[];
  INCLUDED_PHRASES?: string[];
  EXCLUDED_PHRASES?: string[];
}

export interface CoinDeskCategory {
  TYPE: string;
  ID: number;
  NAME: string;
  FILTER?: CoinDeskCategoryFilter;
  STATUS: string;
  CREATED_ON: number;
  UPDATED_ON: number | null;
}

export interface CoinDeskError {
  type?: number;
  message?: string;
  other_info?: Record<string, unknown>;
}

export interface CoinDeskArticleListResponse {
  Data: CoinDeskArticle[];
  Err: CoinDeskError;
}

export interface CoinDeskSearchResponse {
  Data: CoinDeskArticle[];
  Err: CoinDeskError;
}

export interface CoinDeskCategoryListResponse {
  Data: CoinDeskCategory[];
  Err: CoinDeskError;
}

export interface CoinDeskSingleArticleResponse {
  Data: CoinDeskArticle;
  Err: CoinDeskError;
}
