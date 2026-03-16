import type { RawNewsArticle } from '@trading/shared';
import type { NewsSourceAdapter } from './adapter.js';

const YAHOO_SEARCH = 'https://query1.finance.yahoo.com/v1/finance/search';
const NEWS_PER_SYMBOL = 5;

const YAHOO_HEADERS = {
  'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7)',
};

interface YahooNewsItem {
  uuid: string;
  title: string;
  publisher: string;
  link: string;
  providerPublishTime: number;
  type: string;
  relatedTickers?: string[];
  thumbnail?: {
    resolutions: Array<{ url: string; width: number; height: number; tag: string }>;
  };
}

interface YahooSearchResponse {
  news?: YahooNewsItem[];
}

async function fetchNewsForSymbol(symbol: string): Promise<YahooNewsItem[]> {
  const url = `${YAHOO_SEARCH}?q=${encodeURIComponent(symbol)}&newsCount=${NEWS_PER_SYMBOL}&quotesCount=0`;

  try {
    const res = await fetch(url, { headers: YAHOO_HEADERS });
    if (!res.ok) return [];
    const data = (await res.json()) as YahooSearchResponse;
    return data.news ?? [];
  } catch {
    return [];
  }
}

function toRawArticle(item: YahooNewsItem, queriedSymbol: string): RawNewsArticle {
  return {
    externalId: `yahoo-${item.uuid}`,
    title: item.title,
    summary: undefined,
    url: item.link,
    publishedAt: new Date(item.providerPublishTime * 1000).toISOString(),
    source: 'Yahoo Finance',
    sourceType: 'api',
    relatedSymbols: item.relatedTickers ?? [queriedSymbol],
    category: undefined,
    language: 'en',
  };
}

export const yahooAdapter: NewsSourceAdapter = {
  name: 'Yahoo Finance',
  type: 'api',

  async isAvailable(): Promise<boolean> {
    return true; // siempre disponible, no requiere API key
  },

  async fetchNews(symbols: string[]): Promise<RawNewsArticle[]> {
    const results = await Promise.allSettled(
      symbols.map(async (symbol) => {
        const items = await fetchNewsForSymbol(symbol);
        return items.map((item) => toRawArticle(item, symbol));
      }),
    );

    const articles: RawNewsArticle[] = [];
    for (const r of results) {
      if (r.status === 'fulfilled') {
        articles.push(...r.value);
      }
    }

    return articles;
  },
};
