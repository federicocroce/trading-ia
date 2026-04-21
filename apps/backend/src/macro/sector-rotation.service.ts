import { getHistoricalQuotes } from '../shared/yahoo.js';
import type { SectorRotationData, SectorCategory } from '@trading/shared';

const SECTOR_ETFS: Record<string, string> = {
  XLK: 'Technology',
  XLF: 'Financials',
  XLE: 'Energy',
  XLV: 'Healthcare',
  XLY: 'Consumer Discretionary',
  XLP: 'Consumer Staples',
  XLI: 'Industrials',
  XLB: 'Materials',
  XLU: 'Utilities',
  XLRE: 'Real Estate',
  XLC: 'Communication Services',
};

/** Exported for testing. Computes % return over last `days` closes. */
export function computeReturn(closes: number[], days: number): number {
  if (closes.length < days + 1) return 0;
  const recent = closes[closes.length - 1];
  const past = closes[closes.length - 1 - days];
  return Math.round(((recent - past) / past) * 10000) / 100;
}

/** Exported for testing. Maps RS values to category. */
export function classifySector(rs1m: number, rs3m: number): SectorCategory {
  if (rs1m > 2 && rs3m > 3) return 'LEADING';
  if (rs1m < -2 || rs3m < -3) return 'LAGGING';
  return 'NEUTRAL';
}

let cache: SectorRotationData[] | null = null;
let cacheExpiresAt = 0;
const CACHE_TTL_MS = 7 * 24 * 60 * 60 * 1000; // 7 days

export async function getSectorRotation(): Promise<SectorRotationData[]> {
  if (cache && Date.now() < cacheExpiresAt) return cache;

  const spyOhlc = await getHistoricalQuotes('SPY', '6mo', '1d');
  const spyCloses = spyOhlc.map((c) => c.close);
  const spyReturn1m = computeReturn(spyCloses, 21);
  const spyReturn3m = computeReturn(spyCloses, 63);

  const results: SectorRotationData[] = [];

  for (const [etf, sectorName] of Object.entries(SECTOR_ETFS)) {
    try {
      const ohlc = await getHistoricalQuotes(etf, '6mo', '1d');
      const closes = ohlc.map((c) => c.close);

      const return1m = computeReturn(closes, 21);
      const return3m = computeReturn(closes, 63);
      const rs1m = Math.round((return1m - spyReturn1m) * 100) / 100;
      const rs3m = Math.round((return3m - spyReturn3m) * 100) / 100;

      results.push({
        etf,
        sectorName,
        return1m,
        return3m,
        relativeStrength1m: rs1m,
        relativeStrength3m: rs3m,
        category: classifySector(rs1m, rs3m),
        updatedAt: new Date().toISOString(),
      });
    } catch {
      // Skip failed ETF — partial results are fine
    }
  }

  cache = results;
  cacheExpiresAt = Date.now() + CACHE_TTL_MS;
  return results;
}

export function invalidateSectorRotationCache(): void {
  cache = null;
  cacheExpiresAt = 0;
}
