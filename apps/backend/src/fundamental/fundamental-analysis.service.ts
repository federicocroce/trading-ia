import type { FundamentalData, FundamentalSummary, FASignal } from '@trading/shared';
import { getFundamentals } from '../shared/yahoo.js';
import { getActiveSymbolList } from '../db/repository.js';

// --- Cache ---
const fundamentalCache = new Map<string, { data: FundamentalData; fetchedAt: number }>();
const FUNDAMENTAL_TTL = 60 * 60 * 1000; // 1 hour

async function getCachedFundamentals(symbol: string): Promise<FundamentalData> {
  const cached = fundamentalCache.get(symbol);
  if (cached && Date.now() - cached.fetchedAt < FUNDAMENTAL_TTL) {
    return cached.data;
  }
  const data = await getFundamentals(symbol);
  fundamentalCache.set(symbol, { data, fetchedAt: Date.now() });
  return data;
}

// --- Scoring (-100 to +100) ---

export function scoreFundamental(data: FundamentalData): { signal: FASignal; score: number } {
  // Crypto or no data: neutral
  if (data.peRatio == null && data.eps == null && data.fiftyTwoWeekHigh == null) {
    return { signal: 'fair', score: 0 };
  }

  let score = 0;

  // P/E ratio
  if (data.peRatio != null && data.eps != null) {
    if (data.peRatio > 0 && data.peRatio < 15 && data.eps > 0) score += 25;
    else if (data.peRatio > 0 && data.peRatio < 20) score += 10;
    else if (data.peRatio > 30) score -= 20;
    else if (data.peRatio > 25) score -= 10;
    // Negative P/E (losses)
    if (data.peRatio < 0) score -= 15;
  }

  // 52-week position
  if (data.priceVs52wLow != null && data.priceVs52wHigh != null) {
    // Near 52w low (within 10% above low)
    if (data.priceVs52wLow < 10) score += 15;
    else if (data.priceVs52wLow < 20) score += 5;
    // Near 52w high (within 5% below high)
    if (data.priceVs52wHigh > -5 && data.priceVs52wHigh <= 0) score -= 10;
  }

  // Dividend yield
  if (data.dividendYield != null) {
    if (data.dividendYield > 0.03) score += 10;
    else if (data.dividendYield > 0.02) score += 5;
  }

  // Forward P/E improvement
  if (data.peRatio != null && data.forwardPE != null && data.peRatio > 0 && data.forwardPE > 0) {
    if (data.forwardPE < data.peRatio * 0.8) score += 10; // Earnings expected to grow 20%+
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
    return { symbol, data, signal, score };
  } catch (err) {
    console.warn(`[FA] Failed for ${symbol}:`, (err as Error).message);
    return {
      symbol,
      data: {
        symbol, marketCap: null, peRatio: null, forwardPE: null, eps: null,
        dividendYield: null, fiftyTwoWeekHigh: null, fiftyTwoWeekLow: null,
        currentPrice: 0, priceVs52wHigh: null, priceVs52wLow: null,
        avgVolume: null, beta: null,
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
  fundamentalCache.clear();
}
