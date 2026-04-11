import type { FundamentalData, FundamentalSummary, FASignal } from '@trading/shared';
import { getFundamentals } from '../shared/yahoo.js';
import { getActiveSymbolList, getFundamentalFromCache, getFundamentalCacheRaw, upsertFundamentalCache } from '../db/repository.js';
import { reportOk, reportError } from '../shared/service-health.js';

// --- Cache (BD-backed, 7 days TTL) ---

async function getCachedFundamentals(symbol: string): Promise<FundamentalData> {
  // Check BD cache first
  const cached = getFundamentalFromCache(symbol);
  if (cached) {
    try {
      const data = JSON.parse(cached) as FundamentalData;
      // Adaptive TTL: if earnings < 14 days away, only use cache if < 1 day old
      if (data.nextEarningsDate) {
        const daysToEarnings = Math.floor((new Date(data.nextEarningsDate).getTime() - Date.now()) / (1000 * 60 * 60 * 24));
        if (daysToEarnings >= 0 && daysToEarnings <= 14) {
          // Check cache age — getFundamentalFromCache already checks expiresAt (7d)
          // but we need tighter check here. Read fetchedAt from cache row.
          const cacheRow = getFundamentalCacheRaw(symbol);
          if (cacheRow?.fetchedAt) {
            const ageMs = Date.now() - new Date(cacheRow.fetchedAt).getTime();
            const oneDayMs = 24 * 60 * 60 * 1000;
            if (ageMs > oneDayMs) {
              console.log(`[FA] ${symbol}: earnings in ${daysToEarnings}d, cache > 1d old — refreshing`);
              // Fall through to fetch fresh
            } else {
              return data;
            }
          }
        } else {
          return data;
        }
      } else {
        return data;
      }
    } catch { /* re-fetch */ }
  }
  // Fetch fresh from Yahoo
  const data = await getFundamentals(symbol);
  try {
    upsertFundamentalCache(symbol, JSON.stringify(data));
  } catch { /* non-critical */ }
  return data;
}

/**
 * Force refresh fundamentals from Yahoo Finance (bypass cache).
 * Called by "Actualizar fundamentales" button.
 */
export async function forceRefreshFundamentals(symbols: string[]): Promise<number> {
  let refreshed = 0;
  for (let i = 0; i < symbols.length; i += 3) {
    const batch = symbols.slice(i, i + 3);
    const results = await Promise.allSettled(
      batch.map(async (symbol) => {
        const data = await getFundamentals(symbol);
        upsertFundamentalCache(symbol, JSON.stringify(data));
        return data;
      }),
    );
    refreshed += results.filter(r => r.status === 'fulfilled').length;
    // Delay between batches to avoid Yahoo rate limit (400 errors)
    if (i + 3 < symbols.length) {
      await new Promise(resolve => setTimeout(resolve, 1500));
    }
  }
  console.log(`[FA] Refreshed ${refreshed}/${symbols.length} fundamentals`);
  return refreshed;
}

// --- Scoring (-100 to +100) ---

export function scoreFundamental(data: FundamentalData): { signal: FASignal; score: number } {
  // Crypto or no data: neutral
  if (data.peRatio == null && data.forwardPE == null && data.eps == null && data.fiftyTwoWeekHigh == null) {
    return { signal: 'fair', score: 0 };
  }

  let score = 0;

  // P/E ratio (current valuation)
  if (data.peRatio != null && data.eps != null) {
    if (data.peRatio > 0 && data.peRatio < 15 && data.eps > 0) score += 25;
    else if (data.peRatio > 0 && data.peRatio < 20) score += 10;
    else if (data.peRatio > 50) score -= 15;
    else if (data.peRatio > 30) score -= 10;
    if (data.peRatio < 0) score -= 15;
  }

  // Forward P/E standalone (future valuation — important for growth stocks)
  if (data.forwardPE != null && data.forwardPE > 0) {
    if (data.forwardPE < 10) score += 20;
    else if (data.forwardPE < 15) score += 10;
    else if (data.forwardPE < 20) score += 5;
    else if (data.forwardPE > 40) score -= 10;
  }

  // Forward P/E improvement vs current (earnings growth expectation)
  if (data.peRatio != null && data.forwardPE != null && data.peRatio > 0 && data.forwardPE > 0) {
    const improvement = 1 - (data.forwardPE / data.peRatio);
    if (improvement > 0.5) score += 15;       // Forward PE 50%+ lower = massive growth expected
    else if (improvement > 0.2) score += 10;   // 20%+ improvement
  }

  // CAP total P/E contribution (avoid P/E dominating the score)
  const peContribution = score; // at this point, score is only P/E-related
  if (peContribution > 35) score = 35;
  if (peContribution < -35) score = -35;

  // 52-week position
  if (data.priceVs52wLow != null && data.priceVs52wHigh != null) {
    if (data.priceVs52wLow < 10) score += 15;
    else if (data.priceVs52wLow < 20) score += 5;
    if (data.priceVs52wHigh > -5 && data.priceVs52wHigh <= 0) score -= 10;
  }

  // Dividend yield
  if (data.dividendYield != null) {
    if (data.dividendYield > 0.03) score += 10;
    else if (data.dividendYield > 0.02) score += 5;
  }

  // Revenue growth (ampliado)
  if (data.revenueGrowth != null) {
    if (data.revenueGrowth > 25) score += 15;
    else if (data.revenueGrowth > 15) score += 10;
    else if (data.revenueGrowth > 5) score += 3;
    else if (data.revenueGrowth < -10) score -= 10;
  }

  // Debt to Equity
  if (data.debtToEquity != null) {
    if (data.debtToEquity < 0.5) score += 8;
    else if (data.debtToEquity > 2.0) score -= 10;
    else if (data.debtToEquity > 1.5) score -= 5;
  }

  // Free Cash Flow
  if (data.freeCashFlow != null) {
    if (data.freeCashFlow > 0) score += 5;
    else score -= 8;
  }

  // ROE (Return on Equity)
  if (data.returnOnEquity != null) {
    if (data.returnOnEquity > 20) score += 10;
    else if (data.returnOnEquity > 15) score += 8;
    else if (data.returnOnEquity < 0) score -= 5;
  }

  // Earnings surprise
  if (data.earningsSurprise != null) {
    if (data.earningsSurprise > 5) score += 8;
    else if (data.earningsSurprise > 0) score += 3;
    else if (data.earningsSurprise < -5) score -= 8;
  }

  // Operating margin
  if (data.operatingMargin != null) {
    if (data.operatingMargin > 25) score += 5;
    else if (data.operatingMargin > 15) score += 3;
    else if (data.operatingMargin < 0) score -= 5;
  }

  // Clamp
  score = Math.max(-100, Math.min(100, score));

  const signal: FASignal = score > 15 ? 'undervalued' : score < -15 ? 'overvalued' : 'fair';
  return { signal, score };
}

// --- Public API ---

export async function getFundamentalSummary(symbol: string): Promise<FundamentalSummary> {
  try {
    const data = await getCachedFundamentals(symbol);
    const { signal, score } = scoreFundamental(data);
    if (data.peRatio != null || data.forwardPE != null) {
      reportOk('Analisis Fundamental');
    }
    return { symbol, data, signal, score };
  } catch (err) {
    reportError('Analisis Fundamental', `Fallo para ${symbol}: ${(err as Error).message.slice(0, 100)}`);
    console.warn(`[FA] Failed for ${symbol}:`, (err as Error).message);
    return {
      symbol,
      data: {
        symbol, marketCap: null, peRatio: null, forwardPE: null, eps: null,
        dividendYield: null, fiftyTwoWeekHigh: null, fiftyTwoWeekLow: null,
        currentPrice: 0, priceVs52wHigh: null, priceVs52wLow: null,
        avgVolume: null, beta: null,
        revenueGrowth: null, grossMargin: null, operatingMargin: null, netMargin: null,
        debtToEquity: null, freeCashFlow: null, returnOnEquity: null, returnOnAssets: null,
        earningsSurprise: null, nextEarningsDate: null,
      },
      signal: 'fair',
      score: 0,
    };
  }
}

export async function getAllFundamentalSummaries(): Promise<FundamentalSummary[]> {
  const results = await Promise.allSettled(getActiveSymbolList().map(getFundamentalSummary));
  return results
    .filter((r): r is PromiseFulfilledResult<FundamentalSummary> => r.status === 'fulfilled')
    .map((r) => r.value);
}

export function invalidateFundamentalCache(): void {
  // Cache is now in BD — this function is kept for backward compat
  // Actual invalidation happens via forceRefreshFundamentals()
}
