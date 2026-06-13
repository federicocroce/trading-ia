/**
 * I/O de la columna de riesgo: trae el precio del índice (SPY) y su SMA200 para clasificar
 * el régimen. Cacheado (no cambia intradía). Lo consume la vista "Hoy" — fuente única.
 */
import { getHistoricalQuotes } from '../shared/yahoo.js';
import { classifyRegime, type Regime } from './risk.js';

export interface RegimeInfo {
  regime: Regime;
  indexPrice: number | null;
  indexSma200: number | null;
  basis: string;
  asOf: string;
}

let cache: RegimeInfo | null = null;
let cacheTime = 0;
const TTL_MS = 6 * 60 * 60 * 1000; // 6h

export async function getRegime(): Promise<RegimeInfo> {
  if (cache && Date.now() - cacheTime < TTL_MS) return cache;
  try {
    const candles = await getHistoricalQuotes('SPY', '2y', '1d');
    const closes = candles.map((c) => c.close);
    const sma200 = closes.length >= 200
      ? closes.slice(-200).reduce((a, b) => a + b, 0) / 200
      : null;
    const indexPrice = closes.at(-1) ?? null;
    cache = {
      regime: classifyRegime(indexPrice, sma200),
      indexPrice: indexPrice != null ? Math.round(indexPrice * 100) / 100 : null,
      indexSma200: sma200 != null ? Math.round(sma200 * 100) / 100 : null,
      basis: 'SPY vs SMA200',
      asOf: new Date().toISOString(),
    };
    cacheTime = Date.now();
    return cache;
  } catch {
    return { regime: 'unknown', indexPrice: null, indexSma200: null, basis: 'SPY vs SMA200', asOf: new Date().toISOString() };
  }
}
