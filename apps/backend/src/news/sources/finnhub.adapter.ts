import type { RawNewsArticle } from '@trading/shared';
import type { NewsSourceAdapter } from './adapter.js';

const FINNHUB_BASE = 'https://finnhub.io/api/v1';

interface FinnhubNewsItem {
  id: number;
  category: string;
  datetime: number;      // unix timestamp
  headline: string;
  image: string;
  related: string;       // comma-separated tickers
  source: string;
  summary: string;
  url: string;
}

function getApiKey(): string | undefined {
  return process.env.FINNHUB_API_KEY;
}

function todayStr(): string {
  return new Date().toISOString().slice(0, 10);
}

function daysAgoStr(days: number): string {
  const d = new Date();
  d.setDate(d.getDate() - days);
  return d.toISOString().slice(0, 10);
}

async function fetchCompanyNews(symbol: string, apiKey: string): Promise<FinnhubNewsItem[]> {
  // Finnhub company-news: noticias de una empresa especifica
  const from = daysAgoStr(3);
  const to = todayStr();
  const url = `${FINNHUB_BASE}/company-news?symbol=${encodeURIComponent(symbol)}&from=${from}&to=${to}&token=${apiKey}`;

  try {
    const res = await fetch(url);
    if (!res.ok) return [];
    const data = (await res.json()) as FinnhubNewsItem[];
    return Array.isArray(data) ? data.slice(0, 5) : []; // max 5 por symbol
  } catch {
    return [];
  }
}

async function fetchMarketNews(apiKey: string): Promise<FinnhubNewsItem[]> {
  // Noticias generales de mercado
  const url = `${FINNHUB_BASE}/news?category=general&token=${apiKey}`;

  try {
    const res = await fetch(url);
    if (!res.ok) return [];
    const data = (await res.json()) as FinnhubNewsItem[];
    return Array.isArray(data) ? data.slice(0, 10) : [];
  } catch {
    return [];
  }
}

function toRawArticle(item: FinnhubNewsItem): RawNewsArticle {
  const relatedSymbols = item.related
    ? item.related.split(',').map((s) => s.trim()).filter(Boolean)
    : [];

  return {
    externalId: `finnhub-${item.id}`,
    title: item.headline,
    summary: item.summary || undefined,
    url: item.url,
    publishedAt: new Date(item.datetime * 1000).toISOString(),
    source: `Finnhub (${item.source})`,
    sourceType: 'api',
    relatedSymbols,
    category: item.category || undefined,
    language: 'en',
  };
}

export const finnhubAdapter: NewsSourceAdapter = {
  name: 'Finnhub',
  type: 'api',

  async isAvailable(): Promise<boolean> {
    return !!getApiKey();
  },

  async fetchNews(symbols: string[]): Promise<RawNewsArticle[]> {
    const apiKey = getApiKey();
    if (!apiKey) return [];

    // Filtrar simbolos crypto (Finnhub no soporta BTC-USD, etc)
    const stockSymbols = symbols.filter((s) => !s.includes('-'));

    // Fetch company news para cada symbol + market news general
    const [companyResults, marketNews] = await Promise.all([
      Promise.allSettled(stockSymbols.map((s) => fetchCompanyNews(s, apiKey))),
      fetchMarketNews(apiKey),
    ]);

    const articles: RawNewsArticle[] = [];

    for (const r of companyResults) {
      if (r.status === 'fulfilled') {
        articles.push(...r.value.map(toRawArticle));
      }
    }

    articles.push(...marketNews.map(toRawArticle));

    return articles;
  },
};
