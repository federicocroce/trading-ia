import type { RawNewsArticle } from '@trading/shared';
import type { NewsSourceAdapter } from './adapter.js';
import { reportOk, reportError } from '../../shared/service-health.js';

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
    return Array.isArray(data) ? data.slice(0, 20) : [];
  } catch (err) {
    console.warn(`[Finnhub] Market news error: ${(err as Error).message?.slice(0, 80)}`);
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
    if (!apiKey) {
      reportError('Finnhub', 'API key no configurada (FINNHUB_API_KEY)');
      return [];
    }

    // Filtrar simbolos crypto y ETFs (Finnhub no los soporta en company-news)
    const stockSymbols = symbols.filter((s) => !s.includes('-'));

    // 1. Market news primero (siempre funciona)
    const marketNews = await fetchMarketNews(apiKey);
    const articles: RawNewsArticle[] = marketNews.map(toRawArticle);

    // 2. Company news — rotar simbolos priorizando portfolio
    // Priorizar: portfolio primero, luego rotar el resto por fecha
    const portfolioSymbols = stockSymbols.slice(0, Math.min(stockSymbols.length, 7)); // Primeros son watchlist/portfolio
    const otherSymbols = stockSymbols.slice(7);
    // Rotar otros por hora del dia para cubrir todos con el tiempo
    const rotationOffset = Math.floor(Date.now() / (3600_000)) % Math.max(1, otherSymbols.length);
    const rotatedOthers = [...otherSymbols.slice(rotationOffset), ...otherSymbols.slice(0, rotationOffset)];
    const companySymbols = [...portfolioSymbols, ...rotatedOthers].slice(0, 15);
    const companyResults = await Promise.allSettled(
      companySymbols.map((s) => fetchCompanyNews(s, apiKey)),
    );

    let failedCount = 0;
    for (const r of companyResults) {
      if (r.status === 'fulfilled') {
        articles.push(...r.value.map(toRawArticle));
      } else {
        failedCount++;
      }
    }

    if (articles.length > 0) {
      reportOk('Finnhub');
    } else {
      reportError('Finnhub', `Sin noticias obtenidas (${failedCount} errores de ${companySymbols.length} simbolos)`);
    }

    return articles;
  },
};
