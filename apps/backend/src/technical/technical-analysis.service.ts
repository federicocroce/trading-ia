import type { OHLC, TechnicalIndicators, TechnicalSummary, TASignal } from '@trading/shared';
import { getHistoricalQuotes } from '../shared/yahoo.js';
import { getActiveSymbolList } from '../db/repository.js';

// --- Cache ---
const historicalCache = new Map<string, { data: OHLC[]; fetchedAt: number }>();
const HISTORICAL_TTL = 60 * 60 * 1000; // 1 hour

async function getCachedHistory(symbol: string): Promise<OHLC[]> {
  const cached = historicalCache.get(symbol);
  if (cached && Date.now() - cached.fetchedAt < HISTORICAL_TTL) {
    return cached.data;
  }
  const data = await getHistoricalQuotes(symbol, '1y', '1d');
  historicalCache.set(symbol, { data, fetchedAt: Date.now() });
  return data;
}

// --- Indicator calculations ---

function calculateSMA(values: number[], period: number): number | null {
  if (values.length < period) return null;
  const slice = values.slice(-period);
  return slice.reduce((sum, v) => sum + v, 0) / period;
}

function calculateEMA(values: number[], period: number): number[] {
  if (values.length < period) return [];
  const k = 2 / (period + 1);
  const ema: number[] = [];

  // Seed with SMA
  let sum = 0;
  for (let i = 0; i < period; i++) sum += values[i];
  ema.push(sum / period);

  for (let i = period; i < values.length; i++) {
    ema.push(values[i] * k + ema[ema.length - 1] * (1 - k));
  }
  return ema;
}

function calculateRSI(closes: number[], period: number = 14): number | null {
  if (closes.length < period + 1) return null;

  let avgGain = 0;
  let avgLoss = 0;

  // Initial average
  for (let i = 1; i <= period; i++) {
    const diff = closes[i] - closes[i - 1];
    if (diff > 0) avgGain += diff;
    else avgLoss += Math.abs(diff);
  }
  avgGain /= period;
  avgLoss /= period;

  // Wilder's smoothing
  for (let i = period + 1; i < closes.length; i++) {
    const diff = closes[i] - closes[i - 1];
    const gain = diff > 0 ? diff : 0;
    const loss = diff < 0 ? Math.abs(diff) : 0;
    avgGain = (avgGain * (period - 1) + gain) / period;
    avgLoss = (avgLoss * (period - 1) + loss) / period;
  }

  if (avgLoss === 0) return 100;
  const rs = avgGain / avgLoss;
  return 100 - 100 / (1 + rs);
}

function calculateMACD(closes: number[]): { macdLine: number; signalLine: number; histogram: number } | null {
  if (closes.length < 35) return null; // Need at least 26 + 9 for signal line

  const ema12 = calculateEMA(closes, 12);
  const ema26 = calculateEMA(closes, 26);

  if (ema12.length === 0 || ema26.length === 0) return null;

  // Align: ema12 starts at index 12, ema26 at index 26. MACD line starts at index 26.
  const offset = 26 - 12; // = 14
  const macdLine: number[] = [];
  for (let i = 0; i < ema26.length; i++) {
    macdLine.push(ema12[i + offset] - ema26[i]);
  }

  if (macdLine.length < 9) return null;

  const signalEma = calculateEMA(macdLine, 9);
  if (signalEma.length === 0) return null;

  const lastMacd = macdLine[macdLine.length - 1];
  const lastSignal = signalEma[signalEma.length - 1];

  return {
    macdLine: Math.round(lastMacd * 1000) / 1000,
    signalLine: Math.round(lastSignal * 1000) / 1000,
    histogram: Math.round((lastMacd - lastSignal) * 1000) / 1000,
  };
}

function calculateBollingerBands(
  closes: number[],
  period: number = 20,
  multiplier: number = 2,
): { upper: number; middle: number; lower: number } | null {
  if (closes.length < period) return null;

  const slice = closes.slice(-period);
  const middle = slice.reduce((s, v) => s + v, 0) / period;
  const variance = slice.reduce((s, v) => s + (v - middle) ** 2, 0) / period;
  const stdDev = Math.sqrt(variance);

  return {
    upper: Math.round((middle + multiplier * stdDev) * 100) / 100,
    middle: Math.round(middle * 100) / 100,
    lower: Math.round((middle - multiplier * stdDev) * 100) / 100,
  };
}

function calculateVolumeRatio(volumes: number[], period: number = 20): number {
  if (volumes.length < period + 1) return 1;
  const avg = volumes.slice(-(period + 1), -1).reduce((s, v) => s + v, 0) / period;
  if (avg === 0) return 1;
  return Math.round((volumes[volumes.length - 1] / avg) * 100) / 100;
}

// --- Aggregate indicators ---

export function computeIndicators(history: OHLC[]): TechnicalIndicators {
  const closes = history.map((h) => h.close);
  const volumes = history.map((h) => h.volume);
  const currentPrice = closes[closes.length - 1] ?? 0;

  const sma20 = calculateSMA(closes, 20);
  const sma50 = calculateSMA(closes, 50);
  const sma200 = calculateSMA(closes, 200);

  return {
    rsi14: calculateRSI(closes, 14),
    macd: calculateMACD(closes),
    sma20: sma20 ? Math.round(sma20 * 100) / 100 : null,
    sma50: sma50 ? Math.round(sma50 * 100) / 100 : null,
    sma200: sma200 ? Math.round(sma200 * 100) / 100 : null,
    bollingerBands: calculateBollingerBands(closes, 20, 2),
    currentPrice,
    priceVsSma20: sma20 ? Math.round(((currentPrice - sma20) / sma20) * 10000) / 100 : 0,
    priceVsSma50: sma50 ? Math.round(((currentPrice - sma50) / sma50) * 10000) / 100 : 0,
    priceVsSma200: sma200 ? Math.round(((currentPrice - sma200) / sma200) * 10000) / 100 : 0,
    volumeRatio: calculateVolumeRatio(volumes, 20),
  };
}

// --- Score technical indicators (-100 to +100) ---

export function scoreTechnical(ind: TechnicalIndicators): { signal: TASignal; score: number } {
  let score = 0;

  // RSI
  if (ind.rsi14 != null) {
    if (ind.rsi14 < 30) score += 20;
    else if (ind.rsi14 < 40) score += 10;
    else if (ind.rsi14 > 70) score -= 20;
    else if (ind.rsi14 > 60) score -= 10;
  }

  // MACD
  if (ind.macd) {
    if (ind.macd.histogram > 0) score += 15;
    else score -= 15;
  }

  // Price vs SMA200 (long-term trend)
  if (ind.sma200 != null) {
    if (ind.priceVsSma200 > 0) score += 10;
    else score -= 10;
  }

  // Price vs SMA50
  if (ind.sma50 != null) {
    if (ind.priceVsSma50 > 0) score += 15;
    else score -= 15;
  }

  // Price vs SMA20
  if (ind.sma20 != null) {
    if (ind.priceVsSma20 > 0) score += 10;
    else score -= 10;
  }

  // Bollinger Bands
  if (ind.bollingerBands) {
    const { upper, lower } = ind.bollingerBands;
    const range = upper - lower;
    if (range > 0) {
      const pos = (ind.currentPrice - lower) / range;
      if (pos < 0.2) score += 10; // Near lower band
      else if (pos > 0.8) score -= 10; // Near upper band
    }
  }

  // Volume amplifier
  if (ind.volumeRatio > 1.5) {
    score = Math.round(score * 1.2);
  }

  // Clamp
  score = Math.max(-100, Math.min(100, score));

  const signal: TASignal = score > 20 ? 'bullish' : score < -20 ? 'bearish' : 'neutral';
  return { signal, score };
}

// --- Public API ---

export async function getTechnicalSummary(symbol: string): Promise<TechnicalSummary> {
  try {
    const history = await getCachedHistory(symbol);
    const indicators = computeIndicators(history);
    const { signal, score } = scoreTechnical(indicators);
    return { symbol, indicators, signal, score };
  } catch (err) {
    console.warn(`[TA] Failed for ${symbol}:`, (err as Error).message);
    return {
      symbol,
      indicators: {
        rsi14: null, macd: null, sma20: null, sma50: null, sma200: null, bollingerBands: null,
        currentPrice: 0, priceVsSma20: 0, priceVsSma50: 0, priceVsSma200: 0, volumeRatio: 1,
      },
      signal: 'neutral',
      score: 0,
    };
  }
}

export async function getAllTechnicalSummaries(): Promise<TechnicalSummary[]> {
  const results = await Promise.allSettled(getActiveSymbolList().map(getTechnicalSummary));
  return results
    .filter((r): r is PromiseFulfilledResult<TechnicalSummary> => r.status === 'fulfilled')
    .map((r) => r.value);
}

export function invalidateTechnicalCache(): void {
  historicalCache.clear();
}
