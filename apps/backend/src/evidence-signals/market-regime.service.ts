import { getHistoricalQuotes } from '../shared/yahoo.js';
import type { MarketRegimeData, EvidenceMarketRegime } from '@trading/shared';

const CACHE_TTL_MS = 60 * 60 * 1000; // 1 hour

let cachedRegime: MarketRegimeData | null = null;
let cacheExpiresAt = 0;

function computeSMA(prices: number[], period: number): number | null {
  if (prices.length < period) return null;
  const slice = prices.slice(prices.length - period);
  return slice.reduce((a, b) => a + b, 0) / period;
}

/** Exported for testing. Applies VIX override to SPY-based regime. */
export function applyVixGate(spyRegime: EvidenceMarketRegime, vix: number): EvidenceMarketRegime {
  if (vix > 30) return 'bear';
  if (vix > 20 && spyRegime === 'bull') return 'neutral';
  return spyRegime;
}

/**
 * Fail-safe cuando el régimen no puede calcularse: mejor stale que ciego.
 * Devuelve el régimen previo marcado degraded, o un neutral degradado que los
 * consumidores deben tratar como bloqueo de LONGs nuevos (no como neutral real).
 */
export function buildDegradedRegime(prev: MarketRegimeData | null): MarketRegimeData {
  if (prev) return { ...prev, degraded: true };
  return {
    regime: 'neutral',
    degraded: true,
    spyPrice: 0,
    sma200: 0,
    priceVsSma200Pct: 0,
    checkedAt: new Date().toISOString(),
  };
}

export async function getMarketRegime(): Promise<MarketRegimeData> {
  if (cachedRegime && Date.now() < cacheExpiresAt) return cachedRegime;

  try {
    // 1y of daily data to compute SMA200 accurately
    const ohlc = await getHistoricalQuotes('SPY', '1y', '1d');

    if (ohlc.length < 50) {
      const fallback: MarketRegimeData = {
        regime: 'neutral',
        spyPrice: 0,
        sma200: 0,
        priceVsSma200Pct: 0,
        checkedAt: new Date().toISOString(),
      };
      cachedRegime = fallback;
      cacheExpiresAt = Date.now() + CACHE_TTL_MS;
      return fallback;
    }

    const closes = ohlc.map((c) => c.close);
    const spyPrice = closes[closes.length - 1];
    const sma200 = computeSMA(closes, Math.min(200, closes.length));
    const sma50 = computeSMA(closes, Math.min(50, closes.length));

    if (!sma200 || !sma50) {
      const fallback: MarketRegimeData = {
        regime: 'neutral',
        spyPrice,
        sma200: 0,
        priceVsSma200Pct: 0,
        checkedAt: new Date().toISOString(),
      };
      cachedRegime = fallback;
      cacheExpiresAt = Date.now() + CACHE_TTL_MS;
      return fallback;
    }

    const priceVsSma200Pct = Math.round(((spyPrice - sma200) / sma200) * 10000) / 100;

    // Bull: SPY above SMA200 AND SMA50 above SMA200 (both conditions)
    // Bear: SPY below SMA200 (clear downtrend)
    // Neutral: SPY above SMA200 but SMA50 < SMA200 (recovering or topping)
    let regime: EvidenceMarketRegime;
    if (spyPrice > sma200 && sma50 > sma200) {
      regime = 'bull';
    } else if (spyPrice < sma200) {
      regime = 'bear';
    } else {
      regime = 'neutral';
    }

    let vix = 0;
    try {
      const vixOhlc = await getHistoricalQuotes('^VIX', '5d', '1d');
      if (vixOhlc.length > 0) {
        vix = vixOhlc[vixOhlc.length - 1].close;
        regime = applyVixGate(regime, vix);
      }
    } catch {
      // VIX fetch failure: keep SPY-based regime
    }

    const result: MarketRegimeData = {
      regime,
      spyPrice: Math.round(spyPrice * 100) / 100,
      sma200: Math.round(sma200 * 100) / 100,
      priceVsSma200Pct,
      checkedAt: new Date().toISOString(),
      degraded: false,
    };

    cachedRegime = result;
    cacheExpiresAt = Date.now() + CACHE_TTL_MS;

    console.log(`[MarketRegime] SPY=${spyPrice.toFixed(2)} SMA200=${sma200.toFixed(2)} SMA50=${sma50.toFixed(2)} VIX=${vix.toFixed(2)} → ${regime.toUpperCase()} (${priceVsSma200Pct > 0 ? '+' : ''}${priceVsSma200Pct}% vs SMA200)`);

    return result;
  } catch (err) {
    console.warn('[MarketRegime] Failed to compute regime:', (err as Error).message);
    const fallback = buildDegradedRegime(cachedRegime);
    // TTL corto para reintentar pronto en vez de cachear la ceguera todo el TTL normal.
    cachedRegime = fallback;
    cacheExpiresAt = Date.now() + 5 * 60 * 1000;
    return fallback;
  }
}

export function invalidateMarketRegimeCache(): void {
  cachedRegime = null;
  cacheExpiresAt = 0;
}
