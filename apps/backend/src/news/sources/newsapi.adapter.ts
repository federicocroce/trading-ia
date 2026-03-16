import type { RawNewsArticle } from '@trading/shared';
import type { NewsSourceAdapter } from './adapter.js';

const NEWSAPI_BASE = 'https://newsapi.org/v2';

interface NewsAPIArticle {
  source: { id: string | null; name: string };
  author: string | null;
  title: string;
  description: string | null;
  url: string;
  publishedAt: string;
  content: string | null;
}

interface NewsAPIResponse {
  status: string;
  totalResults: number;
  articles: NewsAPIArticle[];
}

function getApiKey(): string | undefined {
  return process.env.NEWSAPI_API_KEY;
}

// Buscar noticias financieras relevantes al portfolio
// NewsAPI free tier: 100 req/dia, solo historico >24h en paid
const FINANCIAL_KEYWORDS = [
  'stock market', 'oil price', 'cryptocurrency',
  'Argentina economy', 'Vaca Muerta', 'energy sector',
  'Federal Reserve', 'interest rate', 'S&P 500',
  'Bitcoin', 'Ethereum',
];

function buildQuery(symbols: string[]): string {
  // Combinar algunos tickers clave con keywords generales
  const tickerNames = symbols
    .filter((s) => !s.includes('-'))
    .slice(0, 5)
    .map((s) => `"${s}"`);

  const parts = [...tickerNames.slice(0, 3), ...FINANCIAL_KEYWORDS.slice(0, 3)];
  return parts.join(' OR ');
}

function findRelatedSymbols(title: string, description: string | null, symbols: string[]): string[] {
  const text = `${title} ${description ?? ''}`.toUpperCase();
  return symbols.filter((s) => {
    const variants = [s.toUpperCase()];
    if (s === 'BTC-USD') variants.push('BTC', 'BITCOIN');
    if (s === 'ETH-USD') variants.push('ETH', 'ETHEREUM');
    if (s === 'XOM') variants.push('EXXON');
    if (s === 'CVX') variants.push('CHEVRON');
    return variants.some((v) => text.includes(v));
  });
}

function toRawArticle(article: NewsAPIArticle, symbols: string[]): RawNewsArticle | null {
  if (!article.title || article.title === '[Removed]') return null;

  return {
    externalId: `newsapi-${article.url}`,
    title: article.title,
    summary: article.description?.slice(0, 300) || undefined,
    url: article.url,
    publishedAt: article.publishedAt,
    source: `NewsAPI (${article.source.name})`,
    sourceType: 'api',
    relatedSymbols: findRelatedSymbols(article.title, article.description, symbols),
    category: undefined,
    language: 'en',
  };
}

export const newsapiAdapter: NewsSourceAdapter = {
  name: 'NewsAPI',
  type: 'api',

  async isAvailable(): Promise<boolean> {
    return !!getApiKey();
  },

  async fetchNews(symbols: string[]): Promise<RawNewsArticle[]> {
    const apiKey = getApiKey();
    if (!apiKey) return [];

    const query = buildQuery(symbols);
    const url = `${NEWSAPI_BASE}/everything?q=${encodeURIComponent(query)}&language=en&sortBy=publishedAt&pageSize=20&apiKey=${apiKey}`;

    try {
      const res = await fetch(url);
      if (!res.ok) {
        console.warn(`[NewsAPI] HTTP ${res.status}: ${await res.text().then((t) => t.slice(0, 100))}`);
        return [];
      }

      const data = (await res.json()) as NewsAPIResponse;
      if (data.status !== 'ok') return [];

      return data.articles
        .map((a) => toRawArticle(a, symbols))
        .filter((a): a is RawNewsArticle => a !== null);
    } catch (err) {
      console.warn(`[NewsAPI] Error: ${(err as Error).message.slice(0, 100)}`);
      return [];
    }
  },
};
