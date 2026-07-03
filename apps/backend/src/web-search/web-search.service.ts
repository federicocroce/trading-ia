import { searchTavily, type WebSearchResult } from './tavily.js';
import { searchExa } from './exa.js';
import { getPortfolioPositions } from '../db/repository.js';
import { registerNovelTickers } from '../discovery/discovery-registry.js';
import { isValidTickerFormat } from '../discovery/ticker-validator.js';
import { getActiveDiscoveryQueries } from '../intelligence/config.repository.js';
import { extractTickersFromText } from '../news/ticker-extraction.js';

export interface WebSearchArticle {
  date: string;
  symbol: string | null;
  query: string;
  layer: 'portfolio' | 'discovery';
  title: string;
  url: string;
  content: string;
  publishedAt: string | null;
  relatedSymbols: string[];
}

// Fallback discovery queries used when the DB has no active discovery queries configured
const FALLBACK_DISCOVERY_QUERIES = [
  // EN — global coverage
  'best stock market opportunities today',
  'AI semiconductors stocks news today',
  'oil energy stocks opportunities today',
  // ES — Argentine and regional coverage (primary local sources publish in Spanish)
  'acciones argentinas oportunidades hoy merval cedears',
  'bitcoin criptomonedas oportunidades esta semana',
  'noticias economicas argentina inversiones hoy',
  'bolsa new york oportunidades acciones hoy',
];

async function searchWithFallback(query: string, searchDepth: 'basic' | 'advanced' = 'advanced'): Promise<WebSearchResult[]> {
  try {
    return await searchTavily(query, 5, searchDepth);
  } catch (tavilyErr) {
    console.warn(`[web-search] Tavily failed for "${query}":`, (tavilyErr as Error).message.slice(0, 80));
    return await searchExa(query);
  }
}

function extractTickers(text: string): string[] {
  // No universe passed — this feeds discovery (registerNovelTickers), where the whole point is
  // finding tickers not yet known anywhere. extractTickersFromText still applies word-boundary
  // matching, the 1-2-letter-needs-$/()-context rule, and the expanded blocklist; the existing
  // Yahoo-quote validation downstream (validateTickers) is the final gate. Previously this used
  // a bare `\b[A-Z]{1,5}\b` regex with no context requirement for short tokens, which is exactly
  // the class of false positive ("EL"/"AS"/"ON" as common words) documented in task 6's evidence.
  return extractTickersFromText(text).filter(isValidTickerFormat);
}

export interface WebSearchStageResult {
  articles: WebSearchArticle[];
  errors: string[];
  allFailed: boolean;
}

export async function runWebSearch(date: string): Promise<WebSearchStageResult> {
  const positions = getPortfolioPositions();
  const errors: string[] = [];
  const articles: WebSearchArticle[] = [];

  // --- Layer 1: Portfolio (parallel, advanced depth for precision) ---
  const portfolioResults = await Promise.allSettled(
    positions.map(async (pos) => {
      const query = `"${pos.symbol}" stock news analysis today`;
      const results = await searchWithFallback(query, 'advanced');
      return { symbol: pos.symbol, query, results };
    }),
  );

  let portfolioSuccessCount = 0;
  for (const r of portfolioResults) {
    if (r.status === 'fulfilled') {
      portfolioSuccessCount++;
      for (const result of r.value.results) {
        articles.push({
          date,
          symbol: r.value.symbol,
          query: r.value.query,
          layer: 'portfolio',
          title: result.title,
          url: result.url,
          content: result.content,
          publishedAt: result.publishedAt,
          relatedSymbols: extractTickers(result.title + ' ' + result.content),
        });
      }
    } else {
      errors.push(`Portfolio search failed: ${(r as PromiseRejectedResult).reason?.message?.slice(0, 100)}`);
    }
  }

  // All portfolio searches failed → signal total failure
  if (positions.length > 0 && portfolioSuccessCount === 0) {
    return { articles, errors, allFailed: true };
  }

  // --- Layer 2: Discovery (parallel, basic depth — saves Tavily credits) ---
  // Use DB-configured discovery queries if available, otherwise fall back to hardcoded list
  const dbDiscoveryQueries = getActiveDiscoveryQueries();
  const discoveryQueryList = dbDiscoveryQueries.length > 0 ? dbDiscoveryQueries : FALLBACK_DISCOVERY_QUERIES;
  const discoveryResults = await Promise.allSettled(
    discoveryQueryList.map(async (query) => {
      const results = await searchWithFallback(query, 'basic');
      const discoveryArticles: WebSearchArticle[] = results.map((result) => {
        const tickers = extractTickers(result.title + ' ' + result.content);
        return {
          date,
          symbol: null,
          query,
          layer: 'discovery' as const,
          title: result.title,
          url: result.url,
          content: result.content,
          publishedAt: result.publishedAt,
          relatedSymbols: tickers,
        };
      });
      // Register novel tickers from discovery
      const allTickers = results.flatMap((r) => extractTickers(r.title + ' ' + r.content));
      if (allTickers.length > 0) {
        registerNovelTickers(allTickers, 'yahoo').catch(() => {});
      }
      return discoveryArticles;
    }),
  );

  let discoverySuccessCount = 0;
  for (const r of discoveryResults) {
    if (r.status === 'fulfilled') {
      discoverySuccessCount++;
      articles.push(...r.value);
    } else {
      errors.push(`Discovery failed: ${(r as PromiseRejectedResult).reason?.message?.slice(0, 80)}`);
    }
  }

  const totalAttempts = positions.length + discoveryQueryList.length;
  const totalSuccess = portfolioSuccessCount + discoverySuccessCount;
  return { articles, errors, allFailed: totalAttempts > 0 && totalSuccess === 0 };
}
