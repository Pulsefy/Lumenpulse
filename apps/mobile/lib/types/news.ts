export interface Article {
  id: string;
  title: string;
  source: string;
  publishedAt: string;
  description?: string;
  content?: string;
  url?: string;
  /** Remote URL of the article's hero/thumbnail image, if provided by the API. */
  imageUrl?: string;
}
