import { getHistoricalQuotes } from '../shared/yahoo.js';

const ADR_SYMBOLS = ['YPF', 'GGAL', 'LOMA', 'BMA', 'CAAP'] as const;
const UNDERPERFORM_THRESHOLD = -5; // % vs SPY
const VOLATILE_MIN_COUNT = 3;
const CACHE_TTL_MS = 24 * 60 * 60 * 1000;

let cache: 'STABLE' | 'VOLATILE' | null = null;
let cacheExpiresAt = 0;

export async function getArgentinaMacro(): Promise<'STABLE' | 'VOLATILE'> {
  if (cache && Date.now() < cacheExpiresAt) return cache;

  try {
    const spyOhlc = await getHistoricalQuotes('SPY', '5d', '1d');
    if (spyOhlc.length < 2) return 'STABLE';
    const spyReturn = ((spyOhlc[spyOhlc.length - 1].close - spyOhlc[0].close) / spyOhlc[0].close) * 100;

    let underperformCount = 0;
    for (const symbol of ADR_SYMBOLS) {
      try {
        const ohlc = await getHistoricalQuotes(symbol, '5d', '1d');
        if (ohlc.length < 2) continue;
        const ret = ((ohlc[ohlc.length - 1].close - ohlc[0].close) / ohlc[0].close) * 100;
        if (ret - spyReturn < UNDERPERFORM_THRESHOLD) underperformCount++;
      } catch {
        // Skip failed symbol
      }
    }

    const result: 'STABLE' | 'VOLATILE' = underperformCount >= VOLATILE_MIN_COUNT ? 'VOLATILE' : 'STABLE';
    cache = result;
    cacheExpiresAt = Date.now() + CACHE_TTL_MS;
    return result;
  } catch {
    return 'STABLE';
  }
}

export function invalidateArgentinaMacroCache(): void {
  cache = null;
  cacheExpiresAt = 0;
}
