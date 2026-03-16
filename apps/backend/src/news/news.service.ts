import type { NewsItem } from '@trading/shared';
import { aggregateNews, type AggregationResult, type NewsSourceStats } from './news-aggregator.service.js';

// Cache to avoid hammering APIs
let cachedNews: NewsItem[] = [];
let cachedSourceStats: NewsSourceStats = {};
let lastFetch = 0;
const CACHE_TTL = 5 * 60 * 1000; // 5 minutes

export async function getNews(): Promise<NewsItem[]> {
  const now = Date.now();
  if (cachedNews.length > 0 && now - lastFetch < CACHE_TTL) {
    return cachedNews;
  }

  const result = await aggregateNews();
  cachedNews = result.news;
  cachedSourceStats = result.sourceStats;
  lastFetch = now;

  return cachedNews;
}

export function getSourceStats(): NewsSourceStats {
  return cachedSourceStats;
}

export function getLastAggregationResult(): AggregationResult | null {
  if (cachedNews.length === 0) return null;
  return {
    news: cachedNews,
    sourceStats: cachedSourceStats,
    totalRaw: 0,
    duplicatesRemoved: 0,
  };
}
