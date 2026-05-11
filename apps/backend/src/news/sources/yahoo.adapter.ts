import type { RawNewsArticle } from '@trading/shared';
import type { NewsSourceAdapter } from './adapter.js';

const YAHOO_SEARCH = 'https://query1.finance.yahoo.com/v1/finance/search';
const NEWS_PER_QUERY = 6;

const YAHOO_HEADERS = {
  'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7)',
};

// Always-run queries — high-alpha, high-frequency events. Run on every fetch.
const ALWAYS_RUN_QUERIES = [
  'stock market today biggest movers',
  'earnings beat surprise stocks today',
  'fed reserve rate decision market',
  'analyst upgrade downgrade today',
];

// Rotating queries — broader thematic coverage. Run 4 of these per fetch via hourly rotation.
const ROTATING_QUERIES = [
  'oil energy stocks news today',
  'bitcoin ethereum crypto news',
  'tech stocks AI semiconductor news',
  'bond yields treasury rates',
  'gold commodities news today',
  'emerging markets argentina stocks',
  'biotech pharma healthcare news',
  'consumer retail spending news',
];

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

async function fetchNewsForQuery(query: string): Promise<YahooNewsItem[]> {
  const url = `${YAHOO_SEARCH}?q=${encodeURIComponent(query)}&newsCount=${NEWS_PER_QUERY}&quotesCount=0`;

  try {
    const res = await fetch(url, { headers: YAHOO_HEADERS });
    if (!res.ok) return [];
    const data = (await res.json()) as YahooSearchResponse;
    return data.news ?? [];
  } catch {
    return [];
  }
}

function toRawArticle(item: YahooNewsItem): RawNewsArticle {
  return {
    externalId: `yahoo-${item.uuid}`,
    title: item.title,
    summary: undefined,
    url: item.link,
    publishedAt: new Date(item.providerPublishTime * 1000).toISOString(),
    source: 'Yahoo Finance',
    sourceType: 'api',
    relatedSymbols: item.relatedTickers ?? [],
    category: undefined,
    language: 'en',
  };
}

export const yahooAdapter: NewsSourceAdapter = {
  name: 'Yahoo Finance',
  type: 'api',

  async isAvailable(): Promise<boolean> {
    return true;
  },

  async fetchNews(_symbols: string[]): Promise<RawNewsArticle[]> {
    // Always run high-alpha queries (Fed, earnings, movers, upgrades) every fetch
    // to never miss critical macro catalysts. Plus 4 rotating thematic queries.
    const hourOffset = Math.floor(Date.now() / 3600_000) % ROTATING_QUERIES.length;
    const rotatingPicks = [
      ROTATING_QUERIES[hourOffset],
      ROTATING_QUERIES[(hourOffset + 1) % ROTATING_QUERIES.length],
      ROTATING_QUERIES[(hourOffset + 2) % ROTATING_QUERIES.length],
      ROTATING_QUERIES[(hourOffset + 3) % ROTATING_QUERIES.length],
    ];
    const queriesToRun = [...ALWAYS_RUN_QUERIES, ...rotatingPicks];

    const results = await Promise.allSettled(queriesToRun.map(fetchNewsForQuery));

    const articles: RawNewsArticle[] = [];
    const seenUuids = new Set<string>();
    for (const r of results) {
      if (r.status !== 'fulfilled') continue;
      for (const item of r.value) {
        if (seenUuids.has(item.uuid)) continue;
        seenUuids.add(item.uuid);
        articles.push(toRawArticle(item));
      }
    }

    return articles;
  },
};
