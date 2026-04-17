import type { NewsItem, RawNewsArticle } from '@trading/shared';
import { getAvailableAdapters } from './sources/index.js';
import { getActiveSymbolList, getAllSymbols, getWebSearchArticlesForDate } from '../db/repository.js';
import { registerNovelTickers } from '../discovery/discovery-registry.js';
import { isValidTickerFormat } from '../discovery/ticker-validator.js';

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

const MACRO_KEYWORDS = [
  'fed', 'federal reserve', 'interest rate', 'rate cut', 'rate hike', 'rate decision',
  'tariff', 'trade war', 'trade deal', 'sanctions', 'inflation', 'cpi', 'pce', 'deflation',
  'recession', 'gdp', 'geopolitical', 'conflict', 'war', 'escalation', 'opec',
  'ecb', 'bank of japan', 'boj', 'central bank', 'monetary policy', 'quantitative',
  'arancel', 'guerra', 'inflacion', 'reserva federal', 'banco central', 'tasas de interes',
];

function hasMacroKeywords(title: string): boolean {
  const lower = title.toLowerCase();
  return MACRO_KEYWORDS.some((k) => lower.includes(k));
}

function classifyImpact(relatedTickers: string[], activeSymbols: string[], title = ''): 'high' | 'medium' | 'low' {
  const portfolioTickers = relatedTickers.filter((t) => activeSymbols.includes(t));
  if (portfolioTickers.length >= 2) return 'high';
  if (portfolioTickers.length === 1) return 'medium';
  if (hasMacroKeywords(title)) return 'medium';
  return 'low';
}

const PLAZA_SECTORS: Record<string, string[]> = {
  'argentina-energy':   ['energy', 'argentina'],
  'argentina-finance':  ['finance', 'argentina'],
  'argentina-cedears':  ['argentina'],
  'us-energy':          ['energy'],
  'us-tech':            ['tech'],
  'crypto':             ['crypto'],
  'bonds':              ['bonds'],
  'etfs-sectors':       ['etf'],
  'commodities':        ['commodities'],
  'emerging-markets':   ['emerging'],
  'global':             ['global'],
};

function buildTickerSectorMap(): Map<string, string[]> {
  const map = new Map<string, string[]>();
  for (const s of getAllSymbols()) {
    if (s.plaza && PLAZA_SECTORS[s.plaza]) {
      map.set(s.symbol, PLAZA_SECTORS[s.plaza]);
    }
  }
  return map;
}

function classifySectors(relatedTickers: string[], tickerSectorMap: Map<string, string[]>): string[] {
  const sectors = new Set<string>();
  for (const ticker of relatedTickers) {
    const tickerSectors = tickerSectorMap.get(ticker);
    if (tickerSectors) tickerSectors.forEach(s => sectors.add(s));
  }
  if (sectors.size === 0) sectors.add('global');
  return Array.from(sectors);
}

// --- Convert RawNewsArticle to NewsItem ---

function toNewsItem(article: RawNewsArticle, activeSymbols: string[], tickerSectorMap: Map<string, string[]>): NewsItem {
  return {
    id: article.externalId,
    time: article.publishedAt,
    title: article.title,
    source: article.source,
    impact: classifyImpact(article.relatedSymbols, activeSymbols, article.title),
    sectors: classifySectors(article.relatedSymbols, tickerSectorMap),
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
  const tickerSectorMap = buildTickerSectorMap();

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

  // Prepend today's web search articles
  const today = new Date().toISOString().split('T')[0];
  const webSearchRows = getWebSearchArticlesForDate(today);
  if (webSearchRows.length > 0) {
    const webSearchRaw: RawNewsArticle[] = webSearchRows.map((row) => ({
      externalId: `web-search-${row.id}`,
      title: row.title,
      url: row.url,
      publishedAt: row.publishedAt ?? new Date().toISOString(),
      source: 'WebSearch',
      sourceType: 'web' as const,
      relatedSymbols: row.relatedSymbols,
    }));
    allArticles.unshift(...webSearchRaw);
    sourceStats['WebSearch'] = webSearchRaw.length;
    console.log(`[aggregator] WebSearch: ${webSearchRaw.length} artículos prepended`);
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
  const news = deduped
    .map((a) => toNewsItem(a, symbols, tickerSectorMap))
    .sort((a, b) => new Date(b.time).getTime() - new Date(a.time).getTime());

  console.log(
    `[aggregator] ${news.length} noticias de ${Object.keys(sourceStats).length} fuentes` +
    ` (${duplicatesRemoved} duplicados removidos de ${totalRaw} totales)`,
  );

  // --- Discover novel tickers from news ---
  try {
    const allMentionedTickers = new Set<string>();
    for (const article of deduped) {
      for (const ticker of article.relatedSymbols) {
        if (isValidTickerFormat(ticker)) allMentionedTickers.add(ticker);
      }
    }
    const known = new Set(symbols);
    const novel = [...allMentionedTickers].filter(t => !known.has(t));

    if (novel.length > 0) {
      // Determine source (best guess from adapters)
      const source = Object.keys(sourceStats).includes('Finnhub') ? 'finnhub' as const : 'yahoo' as const;
      registerNovelTickers(novel, source).catch(err =>
        console.warn('[aggregator] Error registrando novel tickers:', err),
      );
      console.log(`[aggregator] ${novel.length} novel tickers detectados: ${novel.slice(0, 10).join(', ')}${novel.length > 10 ? '...' : ''}`);
    }
  } catch {
    // Non-critical, don't fail aggregation
  }

  return { news, sourceStats, totalRaw, duplicatesRemoved };
}
