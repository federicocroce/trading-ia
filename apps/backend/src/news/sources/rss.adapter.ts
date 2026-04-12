import type { RawNewsArticle } from '@trading/shared';
import type { NewsSourceAdapter } from './adapter.js';
import { reportOk, reportError } from '../../shared/service-health.js';
import { getActiveNewsSources } from '../../db/repository.js';

// Fallback RSS feeds used only if the DB returns no active RSS sources.
const DEFAULT_RSS_FEEDS = [
  'https://www.cnbc.com/id/100003114/device/rss/rss.html',        // CNBC Top News
  'https://feeds.finance.yahoo.com/rss/2.0/headline?s=^GSPC&region=US&lang=en-US', // Yahoo Finance S&P
  'https://feeds.marketwatch.com/marketwatch/topstories/',          // MarketWatch
  'https://www.investing.com/rss/news.rss',                         // Investing.com
];

interface RSSItem {
  title?: string;
  link?: string;
  pubDate?: string;
  isoDate?: string;
  contentSnippet?: string;
  content?: string;
  guid?: string;
  creator?: string;
  categories?: string[];
}

interface RSSFeed {
  title?: string;
  items: RSSItem[];
}

function getFeeds(): string[] {
  // ENV override takes priority (useful for local dev / testing)
  const envFeeds = process.env.RSS_FEEDS;
  if (envFeeds) {
    return envFeeds.split(',').map((f) => f.trim()).filter(Boolean);
  }

  // Load from DB (news_sources table, type = 'rss', active = true)
  const dbSources = getActiveNewsSources('rss');
  if (dbSources.length > 0) {
    return dbSources.map((s) => s.url).filter((url): url is string => !!url);
  }

  // Fallback to hardcoded defaults if DB is empty
  return DEFAULT_RSS_FEEDS;
}

function extractSourceName(feedUrl: string, feedTitle?: string): string {
  if (feedTitle) return `RSS:${feedTitle}`;
  try {
    const hostname = new URL(feedUrl).hostname.replace('www.', '').replace('feeds.', '');
    return `RSS:${hostname}`;
  } catch {
    return 'RSS:Unknown';
  }
}

function findRelatedSymbols(title: string, content: string | undefined, symbols: string[]): string[] {
  const text = `${title} ${content ?? ''}`.toUpperCase();
  return symbols.filter((s) => {
    // Para crypto como BTC-USD, buscar tambien BTC y Bitcoin.
    // TODO: alias names could be derived from the symbol name/description fields in DB.
    const variants = [s.toUpperCase()];
    if (s === 'BTC-USD') variants.push('BTC', 'BITCOIN');
    if (s === 'ETH-USD') variants.push('ETH', 'ETHEREUM');
    return variants.some((v) => text.includes(v));
  });
}

async function fetchRSSFeed(feedUrl: string): Promise<RSSFeed | null> {
  try {
    // Importar rss-parser dinamicamente (para no romper si no esta instalado)
    const Parser = (await import('rss-parser')).default;
    const parser = new Parser({
      timeout: 10000,
      headers: {
        'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7)',
      },
    });
    return await parser.parseURL(feedUrl) as RSSFeed;
  } catch (err) {
    console.warn(`[RSS] Failed to fetch ${feedUrl}: ${(err as Error).message.slice(0, 100)}`);
    return null;
  }
}

function toRawArticle(
  item: RSSItem,
  feedUrl: string,
  feedTitle: string | undefined,
  symbols: string[],
): RawNewsArticle | null {
  if (!item.title) return null;

  const publishedAt = item.isoDate ?? item.pubDate
    ? new Date(item.isoDate ?? item.pubDate!).toISOString()
    : new Date().toISOString();

  return {
    externalId: `rss-${item.guid ?? item.link ?? item.title}`,
    title: item.title,
    summary: item.contentSnippet?.slice(0, 300) || undefined,
    url: item.link ?? '',
    publishedAt,
    source: extractSourceName(feedUrl, feedTitle),
    sourceType: 'rss',
    relatedSymbols: findRelatedSymbols(item.title, item.contentSnippet, symbols),
    category: item.categories?.[0] || undefined,
    language: 'en',
  };
}

export const rssAdapter: NewsSourceAdapter = {
  name: 'RSS Feeds',
  type: 'rss',

  async isAvailable(): Promise<boolean> {
    try {
      await import('rss-parser');
      return true;
    } catch {
      console.warn('[RSS] rss-parser not installed, RSS adapter disabled');
      return false;
    }
  },

  async fetchNews(symbols: string[]): Promise<RawNewsArticle[]> {
    const feeds = getFeeds();
    const results = await Promise.allSettled(
      feeds.map(async (feedUrl) => {
        const feed = await fetchRSSFeed(feedUrl);
        if (!feed) return [];

        return feed.items
          .slice(0, 15) // max 15 items por feed
          .map((item) => toRawArticle(item, feedUrl, feed.title, symbols))
          .filter((a): a is RawNewsArticle => a !== null);
      }),
    );

    const articles: RawNewsArticle[] = [];
    let failedFeeds = 0;
    for (const r of results) {
      if (r.status === 'fulfilled') {
        articles.push(...r.value);
      } else {
        failedFeeds++;
      }
    }

    if (articles.length > 0) {
      reportOk('RSS Noticias');
    } else if (failedFeeds > 0) {
      reportError('RSS Noticias', `${failedFeeds}/${feeds.length} feeds fallaron, sin articulos`);
    }

    // Filtrar articulos muy viejos (> 3 dias)
    const threeDaysAgo = Date.now() - 3 * 24 * 60 * 60 * 1000;
    return articles.filter((a) => new Date(a.publishedAt).getTime() > threeDaysAgo);
  },
};
