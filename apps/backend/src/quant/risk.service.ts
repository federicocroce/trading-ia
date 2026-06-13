/**
 * I/O de la columna de riesgo: trae el precio de cada proxy y su SMA200 para clasificar el
 * régimen POR CLASE DE ACTIVO (la cartera es multi-activo, no solo US):
 *   - US / global  → SPY
 *   - Cripto       → BTC-USD
 *   - Argentina    → ARGT (ETF de acciones argentinas; refleja riesgo-país, peso, deuda ya
 *     descontados en el precio — la forma observable y confiable de "enterarse").
 * Cacheado (no cambia intradía). Lo consume la vista "Hoy" — fuente única.
 */
import { getHistoricalQuotes } from '../shared/yahoo.js';
import { classifyRegime, type Regime } from './risk.js';

export interface RegimeInfo {
  assetClass: 'us' | 'crypto' | 'argentina';
  label: string;
  proxy: string;
  regime: Regime;
  indexPrice: number | null;
  indexSma200: number | null;
  asOf: string;
}

export interface Regimes {
  us: RegimeInfo;
  crypto: RegimeInfo;
  argentina: RegimeInfo;
}

const PROXIES: Record<RegimeInfo['assetClass'], { symbol: string; label: string }> = {
  us: { symbol: 'SPY', label: 'US / global' },
  crypto: { symbol: 'BTC-USD', label: 'Cripto' },
  argentina: { symbol: 'ARGT', label: 'Argentina' },
};

const cache = new Map<string, { info: RegimeInfo; time: number }>();
const TTL_MS = 6 * 60 * 60 * 1000; // 6h

async function regimeFor(assetClass: RegimeInfo['assetClass']): Promise<RegimeInfo> {
  const { symbol, label } = PROXIES[assetClass];
  const hit = cache.get(symbol);
  if (hit && Date.now() - hit.time < TTL_MS) return hit.info;
  try {
    const candles = await getHistoricalQuotes(symbol, '2y', '1d');
    const closes = candles.map((c) => c.close);
    const sma200 = closes.length >= 200 ? closes.slice(-200).reduce((a, b) => a + b, 0) / 200 : null;
    const indexPrice = closes.at(-1) ?? null;
    const info: RegimeInfo = {
      assetClass, label, proxy: symbol,
      regime: classifyRegime(indexPrice, sma200),
      indexPrice: indexPrice != null ? Math.round(indexPrice * 100) / 100 : null,
      indexSma200: sma200 != null ? Math.round(sma200 * 100) / 100 : null,
      asOf: new Date().toISOString(),
    };
    cache.set(symbol, { info, time: Date.now() });
    return info;
  } catch {
    return { assetClass, label, proxy: symbol, regime: 'unknown', indexPrice: null, indexSma200: null, asOf: new Date().toISOString() };
  }
}

export async function getRegimes(): Promise<Regimes> {
  const [us, crypto, argentina] = await Promise.all([
    regimeFor('us'),
    regimeFor('crypto'),
    regimeFor('argentina'),
  ]);
  return { us, crypto, argentina };
}

/** Clasifica un símbolo en su clase de activo, para saber qué régimen le aplica. */
export function assetClassOf(symbol: string): RegimeInfo['assetClass'] {
  const s = symbol.toUpperCase();
  if (s.endsWith('-USD') || ['MARA', 'HUT', 'RIOT', 'COIN', 'MSTR', 'CLSK', 'BITF', 'CIFR'].includes(s)) return 'crypto';
  if (ARG_ADRS.has(s)) return 'argentina';
  return 'us';
}

const ARG_ADRS = new Set([
  'YPF', 'GGAL', 'PAM', 'BMA', 'VIST', 'CEPU', 'TGS', 'LOMA', 'CAAP', 'SUPV', 'EDN',
  'IRS', 'TEO', 'CRESY', 'BIOX', 'DESP', 'GLOB', 'MELI', 'BBAR',
]);
