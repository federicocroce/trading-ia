import type { RawNewsArticle } from '@trading/shared';
import type { NewsSourceAdapter } from './adapter.js';
import { getActiveNewsSearchKeywords } from '../../db/repository.js';
import { extractTickersFromText } from '../ticker-extraction.js';

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

// Static fallback keywords — used only when DB returns no active search keywords.
const FALLBACK_FINANCIAL_KEYWORDS = [
  'stock market', 'oil price', 'cryptocurrency',
  'Argentina economy', 'Vaca Muerta', 'energy sector',
  'Federal Reserve', 'interest rate', 'S&P 500',
  'Bitcoin', 'Ethereum',
];

function getFinancialKeywords(): string[] {
  const dbKeywords = getActiveNewsSearchKeywords();
  if (dbKeywords.length > 0) {
    return dbKeywords.map((k) => k.keyword);
  }
  return FALLBACK_FINANCIAL_KEYWORDS;
}

function buildQuery(symbols: string[]): string {
  // Combinar algunos tickers clave con keywords generales de la BD
  const tickerNames = symbols
    .filter((s) => !s.includes('-'))
    .slice(0, 5)
    .map((s) => `"${s}"`);

  const financialKeywords = getFinancialKeywords();
  const parts = [...tickerNames.slice(0, 3), ...financialKeywords.slice(0, 3)];
  return parts.join(' OR ');
}

// IMPORTANT: never uppercase the whole text before matching — that turns a word-boundary
// regex into a de-facto substring match (the historical bug: "Broadband"/"Comcast" uppercased
// contain "ROAD"/"CAST" as literal substrings, wrongly tagging unrelated tickers). Match
// against the ORIGINAL, case-preserved text and require candidates to be real ALL-CAPS tokens
// that belong to the known `symbols` universe. See ticker-extraction.ts for full rationale.
export function findRelatedSymbols(title: string, description: string | null, symbols: string[]): string[] {
  const text = `${title} ${description ?? ''}`;
  const matched = new Set(extractTickersFromText(text, new Set(symbols)));

  // Curated aliases for cases where the ticker itself never appears verbatim in the text.
  // Whole-word, case-insensitive — safe because these are long, unambiguous words, not
  // substrings of unrelated words.
  if (symbols.includes('BTC-USD') && /\b(BTC|Bitcoin)\b/i.test(text)) matched.add('BTC-USD');
  if (symbols.includes('ETH-USD') && /\b(ETH|Ethereum)\b/i.test(text)) matched.add('ETH-USD');
  if (symbols.includes('XOM') && /\bExxon\b/i.test(text)) matched.add('XOM');
  if (symbols.includes('CVX') && /\bChevron\b/i.test(text)) matched.add('CVX');

  return symbols.filter((s) => matched.has(s));
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
