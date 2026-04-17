import { searchTavily, type WebSearchResult } from './tavily.js';
import { searchExa } from './exa.js';
import { getPortfolioPositions } from '../db/repository.js';
import { registerNovelTickers } from '../discovery/discovery-registry.js';
import { isValidTickerFormat } from '../discovery/ticker-validator.js';

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

const DISCOVERY_QUERIES = [
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
  const matches = text.match(/\b[A-Z]{1,5}\b/g) ?? [];
  return [...new Set(matches)].filter(isValidTickerFormat);
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
  const discoveryResults = await Promise.allSettled(
    DISCOVERY_QUERIES.map(async (query) => {
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

  const totalAttempts = positions.length + DISCOVERY_QUERIES.length;
  const totalSuccess = portfolioSuccessCount + discoverySuccessCount;
  return { articles, errors, allFailed: totalAttempts > 0 && totalSuccess === 0 };
}
