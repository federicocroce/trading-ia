import type { NewsItem, RawNewsArticle } from '@trading/shared';
import { getAvailableAdapters } from './sources/index.js';
import { getActiveSymbolList } from '../db/repository.js';

// --- Deduplication ---

function tokenize(text: string): Set<string> {
  return new Set(
    text
      .toLowerCase()
      .replace(/[^a-z0-9\s]/g, '')
      .split(/\s+/)
      .filter((t) => t.length > 2), // ignore short words
  );
}

function jaccardSimilarity(a: Set<string>, b: Set<string>): number {
  if (a.size === 0 && b.size === 0) return 1;
  let intersection = 0;
  for (const token of a) {
    if (b.has(token)) intersection++;
  }
  const union = a.size + b.size - intersection;
  return union > 0 ? intersection / union : 0;
}

function deduplicateArticles(articles: RawNewsArticle[], threshold: number = 0.7): RawNewsArticle[] {
  if (articles.length === 0) return [];

  const tokenized = articles.map((a) => tokenize(a.title));
  const keep = new Array<boolean>(articles.length).fill(true);

  for (let i = 0; i < articles.length; i++) {
    if (!keep[i]) continue;
    for (let j = i + 1; j < articles.length; j++) {
      if (!keep[j]) continue;
      if (jaccardSimilarity(tokenized[i], tokenized[j]) >= threshold) {
        // Keep the one with more relatedSymbols, or the first one
        if (articles[j].relatedSymbols.length > articles[i].relatedSymbols.length) {
          keep[i] = false;
          break;
        } else {
          keep[j] = false;
        }
      }
    }
  }

  return articles.filter((_, i) => keep[i]);
}

// --- Impact classification ---

function classifyImpact(relatedTickers: string[], activeSymbols: string[]): 'high' | 'medium' | 'low' {
  const portfolioTickers = relatedTickers.filter((t) => activeSymbols.includes(t));
  if (portfolioTickers.length >= 2) return 'high';
  if (portfolioTickers.length === 1) return 'medium';
  return 'low';
}

function classifySectors(relatedTickers: string[]): string[] {
  const sectors = new Set<string>();
  const sectorMap: Record<string, string> = {
    VIST: 'energy', YPF: 'energy', PAM: 'energy', TGS: 'energy', CEPU: 'energy',
    GGAL: 'finance', BMA: 'finance',
    XOM: 'energy', CVX: 'energy',
    'BTC-USD': 'crypto', 'ETH-USD': 'crypto',
  };
  const argTickers = ['VIST', 'YPF', 'PAM', 'GGAL', 'BMA', 'TGS', 'CEPU'];

  for (const ticker of relatedTickers) {
    if (sectorMap[ticker]) sectors.add(sectorMap[ticker]);
    if (argTickers.includes(ticker)) sectors.add('argentina');
  }
  if (sectors.size === 0) sectors.add('global');
  return Array.from(sectors);
}

// --- Convert RawNewsArticle to NewsItem ---

function toNewsItem(article: RawNewsArticle, activeSymbols: string[]): NewsItem {
  return {
    id: article.externalId,
    time: article.publishedAt,
    title: article.title,
    source: article.source,
    impact: classifyImpact(article.relatedSymbols, activeSymbols),
    sectors: classifySectors(article.relatedSymbols),
    sentiment: 'neutral', // Will be classified by LLM later
    url: article.url || undefined,
    relatedTickers: article.relatedSymbols,
    sourceType: article.sourceType,
  };
}

// --- Source stats ---

export interface NewsSourceStats {
  [sourceName: string]: number;
}

export interface AggregationResult {
  news: NewsItem[];
  sourceStats: NewsSourceStats;
  totalRaw: number;
  duplicatesRemoved: number;
}

// --- Main aggregation ---

export async function aggregateNews(): Promise<AggregationResult> {
  const adapters = await getAvailableAdapters();
  const symbols = getActiveSymbolList();

  // Fetch from all sources in parallel
  const results = await Promise.allSettled(
    adapters.map(async (adapter) => {
      const start = Date.now();
      const articles = await adapter.fetchNews(symbols);
      const elapsed = Date.now() - start;
      console.log(`[aggregator] ${adapter.name}: ${articles.length} articulos (${elapsed}ms)`);
      return { name: adapter.name, articles };
    }),
  );

  // Collect all articles + stats
  const allArticles: RawNewsArticle[] = [];
  const sourceStats: NewsSourceStats = {};

  for (const r of results) {
    if (r.status === 'fulfilled') {
      allArticles.push(...r.value.articles);
      sourceStats[r.value.name] = r.value.articles.length;
    } else {
      console.warn(`[aggregator] Source failed:`, r.reason);
    }
  }

  const totalRaw = allArticles.length;

  // Deduplicate by externalId first
  const seenIds = new Set<string>();
  const uniqueById = allArticles.filter((a) => {
    if (seenIds.has(a.externalId)) return false;
    seenIds.add(a.externalId);
    return true;
  });

  // Deduplicate by title similarity
  const deduped = deduplicateArticles(uniqueById);
  const duplicatesRemoved = totalRaw - deduped.length;

  // Convert to NewsItem and sort by time (newest first)
  const activeSymbols = getActiveSymbolList();
  const news = deduped
    .map((a) => toNewsItem(a, activeSymbols))
    .sort((a, b) => new Date(b.time).getTime() - new Date(a.time).getTime());

  console.log(
    `[aggregator] ${news.length} noticias de ${Object.keys(sourceStats).length} fuentes` +
    ` (${duplicatesRemoved} duplicados removidos de ${totalRaw} totales)`,
  );

  return { news, sourceStats, totalRaw, duplicatesRemoved };
}
