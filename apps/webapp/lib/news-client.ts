/**
 * Client-side news service.
 *
 * Fetches news from the Next.js API route (/api/news), which proxies the
 * NestJS backend. No API keys are ever exposed to the browser.
 */

export interface NewsData {
  id: number;
  title: string;
  excerpt: string;
  category: string;
  author: string;
  date: string;
  imageUrl: string;
  url: string;
  sentiment: 'Bullish' | 'Bearish' | 'Neutral';
  fundingStatus: 'Funded' | 'Seeking Funding' | 'Closed';
  timestamp: number;
}

/** Shape returned by the backend NewsArticlesResponseDto */
interface BackendArticle {
  id: string;
  title: string;
  subtitle?: string | null;
  body?: string;
  url: string;
  imageUrl?: string | null;
  authors?: string;
  source?: string;
  categories?: string[];
  keywords?: string[];
  sentiment?: string;
  publishedAt: string;
  relatedCoins?: string[];
}

interface BackendNewsResponse {
  articles: BackendArticle[];
  totalCount: number;
  fetchedAt: string;
}

const FUNDING_STATUSES: NewsData['fundingStatus'][] = [
  'Funded',
  'Seeking Funding',
  'Closed',
];

/** Map backend sentiment string to the UI's three-value enum */
function mapSentiment(raw?: string): NewsData['sentiment'] {
  const upper = (raw ?? '').toUpperCase();
  if (upper === 'POSITIVE' || upper === 'BULLISH') return 'Bullish';
  if (upper === 'NEGATIVE' || upper === 'BEARISH') return 'Bearish';
  return 'Neutral';
}

/** Transform a single backend article into the NewsData shape the UI expects */
export function transformBackendArticle(
  article: BackendArticle,
  index: number,
): NewsData {
  const excerpt =
    (article.body && article.body.trim().length > 0
      ? article.body.trim().slice(0, 200)
      : article.subtitle?.trim()) || 'No description available';

  const category =
    article.categories && article.categories.length > 0
      ? article.categories[0]
      : 'Crypto';

  const author =
    (article.authors && article.authors.trim().length > 0
      ? article.authors.trim()
      : article.source) || 'Unknown';

  const timestamp = article.publishedAt
    ? Date.parse(article.publishedAt)
    : Date.now();

  const date = new Date(timestamp).toLocaleDateString('en-US', {
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });

  const imageUrl =
    article.imageUrl && article.imageUrl.trim().length > 0
      ? article.imageUrl
      : `https://picsum.photos/seed/crypto-${index}/800/450`;

  const fundingStatus =
    FUNDING_STATUSES[Math.floor(Math.random() * FUNDING_STATUSES.length)];

  return {
    id: index + 1,
    title: article.title || 'Untitled',
    excerpt,
    category,
    author,
    date,
    imageUrl,
    url: article.url || '#',
    sentiment: mapSentiment(article.sentiment),
    fundingStatus,
    timestamp,
  };
}

/**
 * Fetch crypto news articles from the server-side proxy route.
 * Throws on network/HTTP errors so callers can handle fallback.
 */
export async function fetchCryptoNews(limit = 20): Promise<NewsData[]> {
  const params = new URLSearchParams({ limit: String(limit) });
  const response = await fetch(`/api/news?${params.toString()}`, {
    headers: { Accept: 'application/json' },
  });

  if (!response.ok) {
    throw new Error(`News API returned ${response.status}`);
  }

  const data: BackendNewsResponse = await response.json();

  if (!Array.isArray(data.articles) || data.articles.length === 0) {
    return [];
  }

  return data.articles.map((article, idx) =>
    transformBackendArticle(article, idx),
  );
}
