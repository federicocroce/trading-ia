import type { NewsItem, RawNewsArticle } from '@trading/shared';
import { aggregateNews, type AggregationResult, type NewsSourceStats } from './news-aggregator.service.js';
import { insertNewsArticles, getNewsArticlesSince, getExistingExternalIds } from '../db/repository.js';
import { reportOk, reportError } from '../shared/service-health.js';

let cachedSourceStats: NewsSourceStats = {};
let lastApiFetch = 0;
const API_FETCH_INTERVAL = 12 * 60 * 60 * 1000; // 12 horas

interface AggregationStats {
  totalRaw: number;
  duplicatesRemoved: number;
  sourceStats: NewsSourceStats;
}
let lastAggregationStats: AggregationStats = { totalRaw: 0, duplicatesRemoved: 0, sourceStats: {} };

export function getLastAggregationStats(): AggregationStats {
  return lastAggregationStats;
}

/**
 * Convert a DB row back to a NewsItem.
 */
function dbRowToNewsItem(row: {
  externalId: string;
  title: string;
  source: string;
  sourceType: string;
  publishedAt: string;
  relatedSymbols: string;
  url: string | null;
  sentiment: string | null;
  impact: string | null;
  summary: string | null;
  body: string | null;
  bodyFetchedAt: string | null;
}): NewsItem {
  const tickers: string[] = JSON.parse(row.relatedSymbols);
  return {
    id: row.externalId,
    time: row.publishedAt,
    title: row.title,
    source: row.source,
    impact: (row.impact as 'high' | 'medium' | 'low') ?? 'low',
    sectors: [],
    sentiment: (row.sentiment as 'positive' | 'negative' | 'neutral') ?? 'neutral',
    url: row.url ?? undefined,
    relatedTickers: tickers,
    sourceType: row.sourceType as 'api' | 'rss' | 'scraper',
    summary: row.summary ?? undefined,
    body: row.body ?? undefined,
    bodyFetchedAt: row.bodyFetchedAt ?? undefined,
  };
}

/**
 * Persist new raw articles to DB (skips duplicates by externalId).
 */
function persistArticles(articles: RawNewsArticle[]): number {
  if (articles.length === 0) return 0;

  const existingIds = getExistingExternalIds(articles.map((a) => a.externalId));
  const newArticles = articles.filter((a) => !existingIds.has(a.externalId));
  if (newArticles.length === 0) return 0;

  return insertNewsArticles(
    newArticles.map((a) => ({
      externalId: a.externalId,
      source: a.source,
      sourceType: a.sourceType,
      title: a.title,
      summary: a.summary,
      url: a.url,
      publishedAt: a.publishedAt,
      relatedSymbols: a.relatedSymbols,
    })),
  );
}

function newsItemToRaw(n: NewsItem): RawNewsArticle {
  return {
    externalId: n.id,
    title: n.title,
    summary: undefined,
    url: n.url ?? '',
    publishedAt: n.time,
    source: n.source,
    sourceType: (n.sourceType ?? 'api') as 'api' | 'rss' | 'scraper',
    relatedSymbols: n.relatedTickers,
  };
}

/**
 * Load news from DB (last 3 days).
 */
function loadFromDB(): NewsItem[] {
  const threeDaysAgo = new Date(Date.now() - 3 * 24 * 60 * 60 * 1000).toISOString();
  const rows = getNewsArticlesSince(threeDaysAgo);
  return rows.map(dbRowToNewsItem);
}

/**
 * Fetch from APIs, persist to DB, return count of new articles.
 */
async function fetchAndPersist(): Promise<{ news: NewsItem[]; newCount: number }> {
  const result = await aggregateNews();
  cachedSourceStats = result.sourceStats;
  lastAggregationStats = { totalRaw: result.totalRaw, duplicatesRemoved: result.duplicatesRemoved, sourceStats: result.sourceStats };
  lastApiFetch = Date.now();

  const newCount = persistArticles(result.news.map(newsItemToRaw));
  console.log(`[news] API fetch: ${result.news.length} noticias, ${newCount} nuevas guardadas en BD`);
  reportOk('Noticias');

  return { news: result.news, newCount };
}

/**
 * Main news getter:
 * 1. Si hay noticias en BD, servir de BD
 * 2. Si pasaron 12h desde ultimo fetch a APIs, ir a buscar nuevas
 * 3. Si BD vacía, forzar fetch a APIs
 */
export async function getNews(): Promise<NewsItem[]> {
  const now = Date.now();
  const shouldFetchAPIs = now - lastApiFetch >= API_FETCH_INTERVAL;

  // Fetch from APIs if interval passed
  if (shouldFetchAPIs) {
    try {
      await fetchAndPersist();
    } catch (err) {
      reportError('Noticias', `Error al obtener noticias: ${(err as Error).message.slice(0, 100)}`);
      console.warn('[news] API fetch failed, using BD:', (err as Error).message);
    }
  }

  // Always serve from DB
  const dbNews = loadFromDB();
  if (dbNews.length > 0) return dbNews;

  // DB empty and haven't fetched yet? Force fetch
  if (!shouldFetchAPIs) {
    try {
      await fetchAndPersist();
      return loadFromDB();
    } catch (err) {
      reportError('Noticias', `Error al obtener noticias: ${(err as Error).message.slice(0, 100)}`);
      return [];
    }
  }

  return [];
}

/**
 * Read news ONLY from BD — never fetch from APIs.
 * Used by "Analizar" process to avoid hitting APIs.
 */
export function getNewsFromDB(): NewsItem[] {
  return loadFromDB();
}

export function getSourceStats(): NewsSourceStats {
  return cachedSourceStats;
}

export function getLastAggregationResult(): AggregationResult | null {
  const news = loadFromDB();
  if (news.length === 0) return null;
  return { news, sourceStats: cachedSourceStats, totalRaw: 0, duplicatesRemoved: 0 };
}

/** Force a fresh fetch from APIs (ignores interval) — DOES NOT run LLM analysis */
export async function forceRefreshNews(): Promise<{ newCount: number }> {
  try {
    const result = await fetchAndPersist();
    return { newCount: result.newCount };
  } catch (err) {
    console.warn('[news] Force refresh failed:', (err as Error).message?.slice(0, 100));
    return { newCount: 0 };
  }
}
