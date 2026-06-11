import type { OHLC, TechnicalIndicators, TechnicalSummary, TASignal, SRLevel, DivergenceSignal, WeeklyAnalysis } from '@trading/shared';
import { getHistoricalQuotes, getQuote } from '../shared/yahoo.js';
import { getActiveSymbolList, getHistoricalFromCache, upsertHistoricalCache } from '../db/repository.js';
import { analyzeTimingSignals } from './timing-analysis.service.js';
import { sanitizeMovingAverages } from './indicator-sanity.js';
import { reportOk, reportError } from '../shared/service-health.js';

// --- Cache (BD-backed: daily=1d TTL, weekly=7d TTL) ---

async function getCachedHistory(symbol: string): Promise<OHLC[]> {
  // Check BD cache first
  const cached = getHistoricalFromCache(symbol, 'daily');
  if (cached) {
    try {
      const history = JSON.parse(cached) as OHLC[];
      // Append today's price as latest candle (if market is open)
      try {
        const quote = await getQuote(symbol);
        if (quote.current > 0) {
          const today = new Date().toISOString().split('T')[0];
          const lastDate = history.length > 0 ? history[history.length - 1].date : '';
          if (lastDate !== today) {
            history.push({
              date: today,
              open: quote.open ?? quote.current,
              high: quote.high ?? quote.current,
              low: quote.low ?? quote.current,
              close: quote.current,
              volume: 0,
            });
          } else {
            // Update today's candle
            history[history.length - 1].close = quote.current;
            history[history.length - 1].high = Math.max(history[history.length - 1].high, quote.current);
            history[history.length - 1].low = Math.min(history[history.length - 1].low, quote.current);
          }
        }
      } catch { /* non-critical, use cached as-is */ }
      return history;
    } catch { /* re-fetch */ }
  }

  // Fetch fresh from Yahoo
  const data = await getHistoricalQuotes(symbol, '1y', '1d');
  try {
    upsertHistoricalCache(symbol, 'daily', JSON.stringify(data));
  } catch { /* non-critical */ }
  return data;
}

async function getCachedWeeklyHistory(symbol: string): Promise<OHLC[]> {
  const cached = getHistoricalFromCache(symbol, 'weekly');
  if (cached) {
    try {
      return JSON.parse(cached) as OHLC[];
    } catch { /* re-fetch */ }
  }

  const data = await getHistoricalQuotes(symbol, '2y', '1wk');
  try {
    upsertHistoricalCache(symbol, 'weekly', JSON.stringify(data));
  } catch { /* non-critical */ }
  return data;
}

// =====================================================
// Divergence detection (RSI + MACD)
// =====================================================

/**
 * Find swing lows (local minima) in a series.
 * A swing low is a point lower than its ±window neighbors.
 */
function findSwingLows(values: number[], window: number = 3): Array<{ index: number; value: number }> {
  const swings: Array<{ index: number; value: number }> = [];
  for (let i = window; i < values.length - window; i++) {
    let isLow = true;
    for (let j = 1; j <= window; j++) {
      if (values[i] >= values[i - j] || values[i] >= values[i + j]) {
        isLow = false;
        break;
      }
    }
    if (isLow) swings.push({ index: i, value: values[i] });
  }
  return swings;
}

/**
 * Find swing highs (local maxima) in a series.
 */
function findSwingHighs(values: number[], window: number = 3): Array<{ index: number; value: number }> {
  const swings: Array<{ index: number; value: number }> = [];
  for (let i = window; i < values.length - window; i++) {
    let isHigh = true;
    for (let j = 1; j <= window; j++) {
      if (values[i] <= values[i - j] || values[i] <= values[i + j]) {
        isHigh = false;
        break;
      }
    }
    if (isHigh) swings.push({ index: i, value: values[i] });
  }
  return swings;
}

/**
 * Detect RSI divergence by comparing price swing points with RSI swing points.
 */
function detectRSIDivergence(
  closes: number[],
  period: number = 14,
  lookback: number = 30,
  timeframe: 'daily' | 'weekly' = 'daily',
): DivergenceSignal | null {
  if (closes.length < period + lookback) return null;

  // Build RSI series for the lookback window
  const rsiSeries: number[] = [];
  for (let end = closes.length - lookback; end <= closes.length; end++) {
    const rsi = calculateRSI(closes.slice(0, end), period);
    if (rsi != null) rsiSeries.push(rsi);
  }
  if (rsiSeries.length < lookback) return null;

  const priceWindow = closes.slice(-lookback);

  // Bullish divergence: price makes lower low, RSI makes higher low
  const priceLows = findSwingLows(priceWindow, 2);
  const rsiLows = findSwingLows(rsiSeries, 2);

  if (priceLows.length >= 2 && rsiLows.length >= 2) {
    const [priceLow1, priceLow2] = priceLows.slice(-2);
    // Find RSI values closest to the price low indices
    const rsiAtLow1 = rsiSeries[priceLow1.index] ?? null;
    const rsiAtLow2 = rsiSeries[priceLow2.index] ?? null;

    if (rsiAtLow1 != null && rsiAtLow2 != null) {
      // Price makes LOWER low, RSI makes HIGHER low
      if (priceLow2.value < priceLow1.value && rsiAtLow2 > rsiAtLow1 + 2) {
        const tf = timeframe === 'weekly' ? 'semanal' : 'diaria';
        return {
          type: 'bullish',
          indicator: 'rsi',
          timeframe,
          description: `Divergencia alcista RSI ${tf}: precio hace nuevo minimo pero RSI no confirma — senal de rebote`,
        };
      }
    }
  }

  // Bearish divergence: price makes higher high, RSI makes lower high
  const priceHighs = findSwingHighs(priceWindow, 2);

  if (priceHighs.length >= 2) {
    const [priceHigh1, priceHigh2] = priceHighs.slice(-2);
    const rsiAtHigh1 = rsiSeries[priceHigh1.index] ?? null;
    const rsiAtHigh2 = rsiSeries[priceHigh2.index] ?? null;

    if (rsiAtHigh1 != null && rsiAtHigh2 != null) {
      // Price makes HIGHER high, RSI makes LOWER high
      if (priceHigh2.value > priceHigh1.value && rsiAtHigh2 < rsiAtHigh1 - 2) {
        const tf = timeframe === 'weekly' ? 'semanal' : 'diaria';
        return {
          type: 'bearish',
          indicator: 'rsi',
          timeframe,
          description: `Divergencia bajista RSI ${tf}: precio en maximos pero RSI pierde fuerza — riesgo de correccion`,
        };
      }
    }
  }

  return null;
}

/**
 * Detect MACD histogram divergence.
 */
function detectMACDDivergence(
  closes: number[],
  lookback: number = 30,
  timeframe: 'daily' | 'weekly' = 'daily',
): DivergenceSignal | null {
  if (closes.length < 35 + lookback) return null;

  // Build MACD histogram series
  const ema12 = calculateEMA(closes, 12);
  const ema26 = calculateEMA(closes, 26);
  if (ema12.length === 0 || ema26.length === 0) return null;

  const offset = 26 - 12;
  const macdLine: number[] = [];
  for (let i = 0; i < ema26.length; i++) {
    macdLine.push(ema12[i + offset] - ema26[i]);
  }
  if (macdLine.length < 9) return null;

  const signalEma = calculateEMA(macdLine, 9);
  if (signalEma.length === 0) return null;

  const sigOffset = macdLine.length - signalEma.length;
  const histogram: number[] = [];
  for (let i = 0; i < signalEma.length; i++) {
    histogram.push(macdLine[i + sigOffset] - signalEma[i]);
  }

  const histWindow = histogram.slice(-lookback);
  const priceWindow = closes.slice(-lookback);

  if (histWindow.length < lookback || priceWindow.length < lookback) return null;

  // Bullish: price lower low, histogram higher low
  const priceLows = findSwingLows(priceWindow, 2);
  const histLows = findSwingLows(histWindow, 2);

  if (priceLows.length >= 2 && histLows.length >= 2) {
    const [priceLow1, priceLow2] = priceLows.slice(-2);
    const histAtLow1 = histWindow[priceLow1.index] ?? null;
    const histAtLow2 = histWindow[priceLow2.index] ?? null;

    if (histAtLow1 != null && histAtLow2 != null) {
      if (priceLow2.value < priceLow1.value && histAtLow2 > histAtLow1) {
        const tf = timeframe === 'weekly' ? 'semanal' : 'diaria';
        return {
          type: 'bullish',
          indicator: 'macd',
          timeframe,
          description: `Divergencia alcista MACD ${tf}: precio cae pero histograma MACD sube — cambio de tendencia probable`,
        };
      }
    }
  }

  // Bearish: price higher high, histogram lower high
  const priceHighs = findSwingHighs(priceWindow, 2);

  if (priceHighs.length >= 2) {
    const [priceHigh1, priceHigh2] = priceHighs.slice(-2);
    const histAtHigh1 = histWindow[priceHigh1.index] ?? null;
    const histAtHigh2 = histWindow[priceHigh2.index] ?? null;

    if (histAtHigh1 != null && histAtHigh2 != null) {
      if (priceHigh2.value > priceHigh1.value && histAtHigh2 < histAtHigh1) {
        const tf = timeframe === 'weekly' ? 'semanal' : 'diaria';
        return {
          type: 'bearish',
          indicator: 'macd',
          timeframe,
          description: `Divergencia bajista MACD ${tf}: precio sube pero MACD pierde impulso — posible techo`,
        };
      }
    }
  }

  return null;
}

/**
 * Compute weekly technical analysis with divergence detection.
 */
async function computeWeeklyAnalysis(symbol: string): Promise<WeeklyAnalysis | null> {
  try {
    const history = await getCachedWeeklyHistory(symbol);
    if (history.length < 50) return null;

    const closes = history.map(h => h.close);

    const rsi14 = calculateRSI(closes, 14);
    const ema12 = calculateEMA(closes, 12);
    const ema26 = calculateEMA(closes, 26);
    const macd = computeMACDFromEMAs(ema12, ema26);
    const sma20 = calculateSMA(closes, 20);
    const sma50 = calculateSMA(closes, 50);

    // Trend from SMA20 vs SMA50
    const trend: 'up' | 'down' | 'sideways' =
      sma20 != null && sma50 != null
        ? sma20 > sma50 * 1.01 ? 'up' : sma20 < sma50 * 0.99 ? 'down' : 'sideways'
        : 'sideways';

    // Detect divergences on weekly timeframe
    const divergences: DivergenceSignal[] = [];
    const rsiDiv = detectRSIDivergence(closes, 14, 20, 'weekly');
    if (rsiDiv) divergences.push(rsiDiv);
    const macdDiv = detectMACDDivergence(closes, 20, 'weekly');
    if (macdDiv) divergences.push(macdDiv);

    return { rsi14, macd, sma20, sma50, trend, divergences };
  } catch {
    return null;
  }
}

// =====================================================
// INDICATOR CALCULATIONS
// =====================================================

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

/**
 * Calculate RSI for the last N bars (for trend detection).
 */
function calculateRSISeries(closes: number[], period: number = 14, lastN: number = 10): number[] {
  if (closes.length < period + 1 + lastN) return [];

  const results: number[] = [];
  for (let end = closes.length - lastN; end <= closes.length; end++) {
    const slice = closes.slice(0, end);
    const rsi = calculateRSI(slice, period);
    if (rsi != null) results.push(rsi);
  }
  return results;
}

/**
 * MACD from pre-computed EMAs (avoids recalculating EMA12/EMA26).
 */
function computeMACDFromEMAs(
  ema12: number[],
  ema26: number[],
): { macdLine: number; signalLine: number; histogram: number } | null {
  if (ema12.length === 0 || ema26.length === 0) return null;

  const offset = 26 - 12;
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

/**
 * Compute MACD line series for last N bars (for cross detection).
 */
function computeMACDSeries(
  ema12: number[],
  ema26: number[],
  lastN: number = 10,
): { macdLine: number; signalLine: number }[] {
  if (ema12.length === 0 || ema26.length === 0) return [];

  const offset = 26 - 12;
  const macdLine: number[] = [];
  for (let i = 0; i < ema26.length; i++) {
    macdLine.push(ema12[i + offset] - ema26[i]);
  }

  if (macdLine.length < 9) return [];

  const signalEma = calculateEMA(macdLine, 9);
  if (signalEma.length === 0) return [];

  const results: { macdLine: number; signalLine: number }[] = [];
  const signalOffset = macdLine.length - signalEma.length;
  const start = Math.max(0, signalEma.length - lastN);

  for (let i = start; i < signalEma.length; i++) {
    results.push({
      macdLine: macdLine[i + signalOffset],
      signalLine: signalEma[i],
    });
  }

  return results;
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

// =====================================================
// NEW INDICATORS
// =====================================================

/**
 * Stochastic Oscillator (14,3,3).
 * %K = SMA3 of raw %K, %D = SMA3 of %K
 */
function calculateStochastic(
  history: OHLC[],
  period: number = 14,
  smoothK: number = 3,
  smoothD: number = 3,
): { k: number; d: number } | null {
  if (history.length < period + smoothK + smoothD) return null;

  // Raw %K values
  const rawK: number[] = [];
  for (let i = period - 1; i < history.length; i++) {
    const window = history.slice(i - period + 1, i + 1);
    const lowestLow = Math.min(...window.map((h) => h.low));
    const highestHigh = Math.max(...window.map((h) => h.high));
    const range = highestHigh - lowestLow;
    rawK.push(range === 0 ? 50 : ((history[i].close - lowestLow) / range) * 100);
  }

  // Smooth %K with SMA
  if (rawK.length < smoothK) return null;
  const smoothedK: number[] = [];
  for (let i = smoothK - 1; i < rawK.length; i++) {
    const slice = rawK.slice(i - smoothK + 1, i + 1);
    smoothedK.push(slice.reduce((s, v) => s + v, 0) / smoothK);
  }

  // %D = SMA of smoothed %K
  if (smoothedK.length < smoothD) return null;
  const dValues: number[] = [];
  for (let i = smoothD - 1; i < smoothedK.length; i++) {
    const slice = smoothedK.slice(i - smoothD + 1, i + 1);
    dValues.push(slice.reduce((s, v) => s + v, 0) / smoothD);
  }

  return {
    k: Math.round(smoothedK[smoothedK.length - 1] * 100) / 100,
    d: Math.round(dValues[dValues.length - 1] * 100) / 100,
  };
}

/**
 * ATR (Average True Range) — Wilder's smoothing.
 */
function calculateATR(history: OHLC[], period: number = 14): number | null {
  if (history.length < period + 1) return null;

  // True Range series
  const tr: number[] = [];
  for (let i = 1; i < history.length; i++) {
    const h = history[i].high;
    const l = history[i].low;
    const pc = history[i - 1].close;
    tr.push(Math.max(h - l, Math.abs(h - pc), Math.abs(l - pc)));
  }

  if (tr.length < period) return null;

  // Wilder's smoothing (same as RSI)
  let atr = tr.slice(0, period).reduce((s, v) => s + v, 0) / period;
  for (let i = period; i < tr.length; i++) {
    atr = (atr * (period - 1) + tr[i]) / period;
  }

  return Math.round(atr * 1000) / 1000;
}

/**
 * OBV (On-Balance Volume) + trend and divergence detection.
 */
function calculateOBV(history: OHLC[]): {
  trend: 'rising' | 'falling' | 'flat';
  divergence: boolean;
} {
  if (history.length < 20) return { trend: 'flat', divergence: false };

  // Compute OBV series
  const obv: number[] = [0];
  for (let i = 1; i < history.length; i++) {
    if (history[i].close > history[i - 1].close) {
      obv.push(obv[obv.length - 1] + history[i].volume);
    } else if (history[i].close < history[i - 1].close) {
      obv.push(obv[obv.length - 1] - history[i].volume);
    } else {
      obv.push(obv[obv.length - 1]);
    }
  }

  // OBV trend: compare last 10 days vs 10 days before
  const lookback = 10;
  const recentOBV = obv.slice(-lookback);
  const prevOBV = obv.slice(-lookback * 2, -lookback);

  if (recentOBV.length < lookback || prevOBV.length < lookback) {
    return { trend: 'flat', divergence: false };
  }

  const recentAvg = recentOBV.reduce((s, v) => s + v, 0) / lookback;
  const prevAvg = prevOBV.reduce((s, v) => s + v, 0) / lookback;
  const obvChange = (recentAvg - prevAvg) / (Math.abs(prevAvg) || 1);

  const trend: 'rising' | 'falling' | 'flat' =
    obvChange > 0.05 ? 'rising' : obvChange < -0.05 ? 'falling' : 'flat';

  // Divergence: price going one way, OBV going the other
  const recentCloses = history.slice(-lookback).map((h) => h.close);
  const priceChange =
    (recentCloses[recentCloses.length - 1] - recentCloses[0]) / recentCloses[0];

  const priceTrend = priceChange > 0.02 ? 'up' : priceChange < -0.02 ? 'down' : 'flat';
  const divergence =
    (priceTrend === 'up' && trend === 'falling') || (priceTrend === 'down' && trend === 'rising');

  return { trend, divergence };
}

// =====================================================
// SUPPORT & RESISTANCE
// =====================================================

/**
 * Find support and resistance levels from swing highs/lows.
 */
function calculateSupportResistance(
  history: OHLC[],
  currentPrice: number,
  lookback: number = 120,
): { supports: SRLevel[]; resistances: SRLevel[] } {
  const data = history.slice(-lookback);
  if (data.length < 10) return { supports: [], resistances: [] };

  const windowSize = 5;
  const swingHighs: { price: number; index: number }[] = [];
  const swingLows: { price: number; index: number }[] = [];

  for (let i = windowSize; i < data.length - windowSize; i++) {
    const isSwingHigh = data
      .slice(i - windowSize, i)
      .every((d) => d.high <= data[i].high) &&
      data.slice(i + 1, i + windowSize + 1).every((d) => d.high <= data[i].high);

    const isSwingLow = data
      .slice(i - windowSize, i)
      .every((d) => d.low >= data[i].low) &&
      data.slice(i + 1, i + windowSize + 1).every((d) => d.low >= data[i].low);

    if (isSwingHigh) swingHighs.push({ price: data[i].high, index: i });
    if (isSwingLow) swingLows.push({ price: data[i].low, index: i });
  }

  // Cluster nearby levels (within 1.5% of price)
  const clusterThreshold = currentPrice * 0.015;

  function clusterLevels(points: { price: number; index: number }[]): SRLevel[] {
    if (points.length === 0) return [];

    const sorted = [...points].sort((a, b) => a.price - b.price);
    const clusters: { prices: number[]; indices: number[] }[] = [];

    let current = { prices: [sorted[0].price], indices: [sorted[0].index] };
    for (let i = 1; i < sorted.length; i++) {
      if (sorted[i].price - current.prices[current.prices.length - 1] <= clusterThreshold) {
        current.prices.push(sorted[i].price);
        current.indices.push(sorted[i].index);
      } else {
        clusters.push(current);
        current = { prices: [sorted[i].price], indices: [sorted[i].index] };
      }
    }
    clusters.push(current);

    return clusters.map((c) => {
      const avgPrice = c.prices.reduce((s, v) => s + v, 0) / c.prices.length;
      const recencyWeight = c.indices.reduce((s, idx) => s + idx / data.length, 0) / c.indices.length;
      return {
        price: Math.round(avgPrice * 100) / 100,
        strength: Math.round(c.prices.length * (0.5 + recencyWeight * 0.5) * 100) / 100,
        touches: c.prices.length,
      };
    }).sort((a, b) => b.strength - a.strength);
  }

  const allSupports = clusterLevels(swingLows).filter((s) => s.price < currentPrice);
  const allResistances = clusterLevels(swingHighs).filter((r) => r.price > currentPrice);

  return {
    supports: allSupports.slice(0, 3),
    resistances: allResistances.slice(0, 3),
  };
}

// =====================================================
// SMA CROSSOVER DETECTION
// =====================================================

/**
 * Detect SMA crossovers and estimate days to next cross.
 */
function detectCrossovers(
  closes: number[],
): TechnicalIndicators['crossovers'] {
  if (closes.length < 210) return null;

  // Calculate SMA50 and SMA200 for the last 10 days
  const sma50Series: number[] = [];
  const sma200Series: number[] = [];
  const sma20Series: number[] = [];
  const days = 10;

  for (let offset = days - 1; offset >= 0; offset--) {
    const end = closes.length - offset;
    const s50 = calculateSMA(closes.slice(0, end), 50);
    const s200 = calculateSMA(closes.slice(0, end), 200);
    const s20 = calculateSMA(closes.slice(0, end), 20);
    if (s50 != null) sma50Series.push(s50);
    if (s200 != null) sma200Series.push(s200);
    if (s20 != null) sma20Series.push(s20);
  }

  if (sma50Series.length < days || sma200Series.length < days) return null;

  const currentSma50 = sma50Series[sma50Series.length - 1];
  const currentSma200 = sma200Series[sma200Series.length - 1];
  const currentSma20 = sma20Series.length > 0 ? sma20Series[sma20Series.length - 1] : 0;
  const currentSma50ForCompare = sma50Series.length > 0 ? sma50Series[sma50Series.length - 1] : 0;

  // Detect recent cross (within last 5 days)
  let goldenCross = false;
  let deathCross = false;
  for (let i = Math.max(1, sma50Series.length - 5); i < sma50Series.length; i++) {
    const prevAbove = sma50Series[i - 1] > sma200Series[i - 1];
    const curAbove = sma50Series[i] > sma200Series[i];
    if (!prevAbove && curAbove) goldenCross = true;
    if (prevAbove && !curAbove) deathCross = true;
  }

  // Estimate days to next cross
  let estimatedDaysToCross: number | null = null;
  let crossDirection: 'golden' | 'death' | null = null;

  const gap = currentSma50 - currentSma200;
  const gapPrev = sma50Series[0] - sma200Series[0];
  const convergenceRate = (gap - gapPrev) / (days - 1);

  if (Math.abs(convergenceRate) > 0.001) {
    const daysToTouch = -gap / convergenceRate;
    if (daysToTouch > 0 && daysToTouch < 30) {
      estimatedDaysToCross = Math.round(daysToTouch);
      crossDirection = gap < 0 ? 'golden' : 'death';
    }
  }

  return {
    goldenCross,
    deathCross,
    sma20Above50: currentSma20 > currentSma50ForCompare,
    estimatedDaysToCross,
    crossDirection,
  };
}

// =====================================================
// BOLLINGER SQUEEZE DETECTION
// =====================================================

/**
 * Detect Bollinger Band squeeze (low volatility preceding breakout).
 */
function detectBBSqueeze(
  closes: number[],
  period: number = 20,
): { squeeze: boolean; intensity: number | null } {
  if (closes.length < period + 20) return { squeeze: false, intensity: null };

  // Calculate BB width for last 20 days
  const widths: number[] = [];
  for (let offset = 19; offset >= 0; offset--) {
    const end = closes.length - offset;
    const slice = closes.slice(end - period, end);
    if (slice.length < period) continue;
    const mean = slice.reduce((s, v) => s + v, 0) / period;
    const variance = slice.reduce((s, v) => s + (v - mean) ** 2, 0) / period;
    const stdDev = Math.sqrt(variance);
    widths.push((2 * 2 * stdDev) / mean); // (upper - lower) / middle as ratio
  }

  if (widths.length < 10) return { squeeze: false, intensity: null };

  const currentWidth = widths[widths.length - 1];
  const maxWidth = Math.max(...widths);
  const minWidth = Math.min(...widths);
  const range = maxWidth - minWidth;

  if (range === 0) return { squeeze: false, intensity: null };

  // Intensity = how close current width is to the minimum (0-100)
  const intensity = Math.round((1 - (currentWidth - minWidth) / range) * 100);

  // Squeeze if current width is in the bottom 25% AND decreasing
  const recentTrend = widths[widths.length - 1] < widths[widths.length - 4];
  const squeeze = intensity > 70 && recentTrend;

  return { squeeze, intensity };
}

// =====================================================
// AGGREGATE INDICATORS (optimized)
// =====================================================

export function computeIndicators(history: OHLC[]): TechnicalIndicators {
  const closes = history.map((h) => h.close);
  const volumes = history.map((h) => h.volume);
  const currentPrice = closes[closes.length - 1] ?? 0;

  // --- Memoized EMAs for MACD ---
  const ema12 = calculateEMA(closes, 12);
  const ema26 = calculateEMA(closes, 26);

  // --- Existing indicators ---
  const rawSma20 = calculateSMA(closes, 20);
  const rawSma50 = calculateSMA(closes, 50);
  const rawSma200 = calculateSMA(closes, 200);
  // Guard against split-poisoned MAs (unadjusted pre-split closes). Implausible SMAs are nulled.
  const { sma20, sma50, sma200, flags: smaFlags } = sanitizeMovingAverages(
    { sma20: rawSma20, sma50: rawSma50, sma200: rawSma200 }, currentPrice,
  );
  if (smaFlags.length > 0) {
    console.warn(`[technical] SMA sanity: nulled ${smaFlags.join(',')} (price ${currentPrice}, raw sma200 ${rawSma200})`);
  }
  const macd = computeMACDFromEMAs(ema12, ema26);
  const bollingerBands = calculateBollingerBands(closes, 20, 2);

  // --- New indicators ---
  const stochastic = calculateStochastic(history);
  const atr14 = calculateATR(history);
  const obv = calculateOBV(history);
  const { supports, resistances } = calculateSupportResistance(history, currentPrice);
  const crossovers = detectCrossovers(closes);
  const { squeeze: bbSqueeze, intensity: bbSqueezeIntensity } = detectBBSqueeze(closes);

  // Nearest support/resistance as % distance
  let nearestSupport: number | null = null;
  if (supports.length > 0) {
    nearestSupport = Math.round(((currentPrice - supports[0].price) / currentPrice) * 10000) / 100;
  }

  let nearestResistance: number | null = null;
  if (resistances.length > 0) {
    nearestResistance = Math.round(((resistances[0].price - currentPrice) / currentPrice) * 10000) / 100;
  }

  return {
    // Existing
    rsi14: calculateRSI(closes, 14),
    macd,
    sma20: sma20 ? Math.round(sma20 * 100) / 100 : null,
    sma50: sma50 ? Math.round(sma50 * 100) / 100 : null,
    sma200: sma200 ? Math.round(sma200 * 100) / 100 : null,
    bollingerBands,
    currentPrice,
    priceVsSma20: sma20 ? Math.round(((currentPrice - sma20) / sma20) * 10000) / 100 : 0,
    priceVsSma50: sma50 ? Math.round(((currentPrice - sma50) / sma50) * 10000) / 100 : 0,
    priceVsSma200: sma200 ? Math.round(((currentPrice - sma200) / sma200) * 10000) / 100 : 0,
    volumeRatio: calculateVolumeRatio(volumes, 20),

    // New
    stochastic,
    atr14,
    atrPercent: atr14 && currentPrice > 0
      ? Math.round((atr14 / currentPrice) * 10000) / 100
      : null,
    obvTrend: obv.trend,
    obvDivergence: obv.divergence,
    supports,
    resistances,
    nearestSupport,
    nearestResistance,
    crossovers,
    bbSqueeze,
    bbSqueezeIntensity,
  };
}

// =====================================================
// SCORING — Gradual (replaces binary scoring)
// =====================================================

export function scoreTechnical(ind: TechnicalIndicators): { signal: TASignal; score: number } {
  let score = 0;

  // RSI — gradual curve
  if (ind.rsi14 != null) {
    if (ind.rsi14 < 30) score += 15 + Math.round((30 - ind.rsi14) * 0.5);
    else if (ind.rsi14 < 45) score += Math.round((45 - ind.rsi14) * 0.5);
    else if (ind.rsi14 > 70) score -= 15 + Math.round((ind.rsi14 - 70) * 0.5);
    else if (ind.rsi14 > 55) score -= Math.round((ind.rsi14 - 55) * 0.5);
  }

  // MACD — proportional histogram normalized by ATR
  if (ind.macd && ind.atr14 && ind.atr14 > 0) {
    const normalizedHist = ind.macd.histogram / ind.atr14;
    score += Math.round(Math.max(-15, Math.min(15, normalizedHist * 50)));
  } else if (ind.macd) {
    score += ind.macd.histogram > 0 ? 10 : -10;
  }

  // SMAs — gradual by distance
  if (ind.sma200 != null) {
    score += Math.round(Math.max(-15, Math.min(15, ind.priceVsSma200 * 0.3)));
  }
  if (ind.sma50 != null) {
    score += Math.round(Math.max(-12, Math.min(12, ind.priceVsSma50 * 0.4)));
  }

  // Stochastic — RSI confirmation
  if (ind.stochastic) {
    if (ind.stochastic.k < 20 && ind.stochastic.k > ind.stochastic.d) score += 10;
    else if (ind.stochastic.k > 80 && ind.stochastic.k < ind.stochastic.d) score -= 10;
  }

  // OBV divergence — strong signal
  if (ind.obvDivergence) {
    score += ind.obvTrend === 'rising' ? 18 : -18;
  }

  // Support/Resistance proximity
  if (ind.nearestSupport != null && ind.nearestSupport < 3) {
    score += 8;
  }
  if (ind.nearestResistance != null && ind.nearestResistance < 3) {
    score -= 8;
  }

  // SMA Crossovers
  if (ind.crossovers?.goldenCross) score += 8;
  if (ind.crossovers?.deathCross) score -= 8;

  // BB Squeeze bonus (additive, not multiplicative)
  if (ind.bbSqueeze && ind.bbSqueezeIntensity != null && ind.bbSqueezeIntensity > 70) {
    score += score > 0 ? 6 : -6;
  }

  // Bollinger position (keep existing logic)
  if (ind.bollingerBands) {
    const { upper, lower } = ind.bollingerBands;
    const range = upper - lower;
    if (range > 0) {
      const pos = (ind.currentPrice - lower) / range;
      if (pos < 0.2) score += 8;
      else if (pos > 0.8) score -= 8;
    }
  }

  // Volume amplifier — gradual (capped at 20%)
  if (ind.volumeRatio > 1.5) {
    const amplifier = 1 + Math.min(0.20, (ind.volumeRatio - 1.5) * 0.15);
    score = Math.round(score * amplifier);
  }

  score = Math.max(-100, Math.min(100, score));

  const signal: TASignal = score > 20 ? 'bullish' : score < -20 ? 'bearish' : 'neutral';
  return { signal, score };
}

// =====================================================
// PUBLIC API
// =====================================================

export async function getTechnicalSummary(symbol: string): Promise<TechnicalSummary> {
  try {
    const history = await getCachedHistory(symbol);
    const indicators = computeIndicators(history);
    const { signal, score } = scoreTechnical(indicators);
    const timing = analyzeTimingSignals(history, indicators);

    // Daily divergences
    const closes = history.map(h => h.close);
    const dailyDivergences: DivergenceSignal[] = [];
    const rsiDivDaily = detectRSIDivergence(closes, 14, 30, 'daily');
    if (rsiDivDaily) dailyDivergences.push(rsiDivDaily);
    const macdDivDaily = detectMACDDivergence(closes, 30, 'daily');
    if (macdDivDaily) dailyDivergences.push(macdDivDaily);
    // OBV divergence (already computed) — add to divergences list
    if (indicators.obvDivergence) {
      dailyDivergences.push({
        type: indicators.obvTrend === 'rising' ? 'bullish' : 'bearish',
        indicator: 'obv',
        timeframe: 'daily',
        description: indicators.obvTrend === 'rising'
          ? 'Divergencia alcista OBV diaria: precio baja pero volumen acumula'
          : 'Divergencia bajista OBV diaria: precio sube pero volumen distribuye',
      });
    }

    // Weekly analysis (parallel, non-blocking)
    const weekly = await computeWeeklyAnalysis(symbol);
    const weeklyDivergences = weekly?.divergences ?? [];

    const allDivergences = [...weeklyDivergences, ...dailyDivergences];

    // Add divergence triggers to timing
    for (const div of allDivergences) {
      if (div.indicator === 'obv') continue; // OBV already in timing
      const triggerType = div.indicator === 'rsi' ? 'rsi_divergence' as const : 'macd_divergence' as const;
      timing?.triggers.push({
        type: triggerType,
        description: div.description,
        direction: div.type === 'bullish' ? 'bullish' : 'bearish',
        estimatedDays: div.timeframe === 'weekly' ? 5 : 3,
        impact: div.timeframe === 'weekly' ? 'high' : 'medium',
      });
    }

    // Divergence scoring boost
    let adjustedScore = score;
    for (const div of allDivergences) {
      const weight = div.timeframe === 'weekly' ? 1 : 0.6; // Weekly divergences weight more
      if (div.indicator === 'rsi') {
        adjustedScore += div.type === 'bullish' ? Math.round(15 * weight) : Math.round(-15 * weight);
      } else if (div.indicator === 'macd') {
        adjustedScore += div.type === 'bullish' ? Math.round(12 * weight) : Math.round(-12 * weight);
      }
      // OBV already scored in scoreTechnical, skip
    }
    adjustedScore = Math.max(-100, Math.min(100, adjustedScore));

    const adjustedSignal: TASignal = adjustedScore > 20 ? 'bullish' : adjustedScore < -20 ? 'bearish' : 'neutral';

    reportOk('Analisis Tecnico');
    return { symbol, indicators, signal: adjustedSignal, score: adjustedScore, timing, weekly: weekly ?? undefined, divergences: allDivergences.length > 0 ? allDivergences : undefined };
  } catch (err) {
    reportError('Analisis Tecnico', `Fallo para ${symbol}: ${(err as Error).message.slice(0, 100)}`);
    console.warn(`[TA] Failed for ${symbol}:`, (err as Error).message);
    return {
      symbol,
      indicators: {
        rsi14: null, macd: null, sma20: null, sma50: null, sma200: null, bollingerBands: null,
        currentPrice: 0, priceVsSma20: 0, priceVsSma50: 0, priceVsSma200: 0, volumeRatio: 1,
        stochastic: null, atr14: null, atrPercent: null, obvTrend: null, obvDivergence: false,
        supports: [], resistances: [], nearestSupport: null, nearestResistance: null,
        crossovers: null, bbSqueeze: false, bbSqueezeIntensity: null,
      },
      signal: 'neutral',
      score: 0,
      timing: null,
    };
  }
}

export async function getAllTechnicalSummaries(): Promise<TechnicalSummary[]> {
  const results = await Promise.allSettled(getActiveSymbolList().map(getTechnicalSummary));
  return results
    .filter((r): r is PromiseFulfilledResult<TechnicalSummary> => r.status === 'fulfilled')
    .map((r) => r.value);
}

export { getCachedHistory, calculateRSISeries, computeMACDSeries, calculateSMA };

export function invalidateTechnicalCache(): void {
  // Cache is now in BD — invalidation happens via TTL expiration
}
