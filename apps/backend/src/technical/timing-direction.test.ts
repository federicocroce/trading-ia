import { describe, it, expect, vi } from 'vitest';
import { analyzeTimingSignals } from './timing-analysis.service.js';
import { getTechnicalSummary } from './technical-analysis.service.js';
import { getHistoricalFromCache } from '../db/repository.js';
import type { OHLC, TechnicalIndicators } from '@trading/shared';

// Mocks SOLO de la frontera de I/O (BD y Yahoo) para poder ejercitar
// getTechnicalSummary sin red ni SQLite. Todo el pipeline de cálculo
// (computeIndicators, detectores de divergencias, analyzeTimingSignals y el
// passthrough divergencia → TimingTrigger) corre con código real.
vi.mock('../db/repository.js', () => ({
  getActiveSymbolList: vi.fn(() => []),
  getHistoricalFromCache: vi.fn(() => null),
  upsertHistoricalCache: vi.fn(),
}));
vi.mock('../shared/yahoo.js', () => ({
  getQuote: vi.fn(async () => { throw new Error('sin red en tests'); }),
  getHistoricalQuotes: vi.fn(async () => []),
}));

function baseIndicators(overrides: Partial<TechnicalIndicators> = {}): TechnicalIndicators {
  return {
    rsi14: 50, macd: null, sma20: 100, sma50: 100, sma200: 100,
    bollingerBands: null, currentPrice: 100,
    priceVsSma20: 0, priceVsSma50: 0, priceVsSma200: 0, volumeRatio: 1,
    stochastic: null, atr14: null, atrPercent: null,
    obvTrend: null, obvDivergence: false,
    supports: [], resistances: [], nearestSupport: null, nearestResistance: null,
    crossovers: null, bbSqueeze: false, bbSqueezeIntensity: null,
    ...overrides,
  };
}

function toOHLC(closes: number[]): OHLC[] {
  return closes.map((close, i) => ({
    date: `d${i}`, open: close, high: close, low: close, close, volume: 1000,
  }));
}

function flatHistory(days = 60, close = 100): OHLC[] {
  return toOHLC(Array.from({ length: days }, () => close));
}

/**
 * Historia para macd_cross: en tendencia lineal el gap MACD-signal es 0,
 * así que se necesita una tendencia ACELERADA (el gap se abre) seguida de un
 * giro (el gap converge hacia el cruce sin haber cruzado todavía).
 * sign=1 → caída acelerada + giro alcista (gap negativo cerrándose → bullish).
 * sign=-1 → subida acelerada + giro bajista (gap positivo cerrándose → bearish).
 */
function macdConvergingHistory(sign: 1 | -1): OHLC[] {
  const closes: number[] = [];
  let p = 100;
  for (let i = 0; i < 35; i++) closes.push(p); // base plana: MACD ≈ signal
  for (let i = 1; i <= 10; i++) { p -= sign * 0.15 * i; closes.push(p); } // tendencia acelerada: el gap se abre
  for (let i = 0; i < 5; i++) { p += sign * 0.2; closes.push(p); } // giro: el gap converge hacia el cruce
  return toOHLC(closes);
}

/**
 * Historia con divergencia RSI diaria:
 * warmup oscilante (RSI con textura), movimiento brusco al extremo 1 (RSI se
 * hunde/dispara), rebote, deriva suave a un extremo 2 apenas más allá (RSI no
 * confirma) y giro final que forma el swing del extremo 2.
 * sign=1 → divergencia bullish (precio hace lower low, RSI higher low).
 * sign=-1 → divergencia bearish (precio hace higher high, RSI lower high).
 */
function divergenceHistory(sign: 1 | -1): OHLC[] {
  const closes: number[] = [];
  let p = 100;
  for (let i = 0; i < 40; i++) { p += sign * (i % 3 === 2 ? 0.4 : -0.5); closes.push(p); }
  for (const d of [-1.8, -1.8, 0.2, -1.8, -1.8, -1.8, -1.8]) { p += sign * d; closes.push(p); }
  for (let i = 0; i < 7; i++) { p += sign * 1.1; closes.push(p); }
  for (const d of [-1, -1, -1, 0.3, -1, -1, -1, 0.3, -1, -1, -1, 0.3]) { p += sign * d; closes.push(p); }
  for (let i = 0; i < 3; i++) { p += sign * 0.5; closes.push(p); }
  return toOHLC(closes);
}

describe('TimingTrigger.direction', () => {
  it('golden cross inminente → direction bullish', () => {
    const ind = baseIndicators({
      crossovers: { goldenCross: false, deathCross: false, sma20Above50: true, estimatedDaysToCross: 4, crossDirection: 'golden' },
    });
    const result = analyzeTimingSignals(flatHistory(), ind);
    const t = result.triggers.find(t => t.type === 'sma_cross');
    expect(t?.direction).toBe('bullish');
  });

  it('death cross confirmado → direction bearish', () => {
    const ind = baseIndicators({
      crossovers: { goldenCross: false, deathCross: true, sma20Above50: false, estimatedDaysToCross: null, crossDirection: 'death' },
    });
    const result = analyzeTimingSignals(flatHistory(), ind);
    const t = result.triggers.find(t => t.type === 'sma_cross');
    expect(t?.direction).toBe('bearish');
  });

  it('RSI sobreventa → direction bullish; sobrecompra → bearish', () => {
    const oversold = analyzeTimingSignals(flatHistory(), baseIndicators({ rsi14: 25 }));
    expect(oversold.triggers.find(t => t.type === 'rsi_zone')?.direction).toBe('bullish');
    const overbought = analyzeTimingSignals(flatHistory(), baseIndicators({ rsi14: 75 }));
    expect(overbought.triggers.find(t => t.type === 'rsi_zone')?.direction).toBe('bearish');
  });

  it('bb_squeeze: dirección sigue priceVsSma20', () => {
    const bull = analyzeTimingSignals(flatHistory(), baseIndicators({ bbSqueeze: true, bbSqueezeIntensity: 90, priceVsSma20: 2 }));
    expect(bull.triggers.find(t => t.type === 'bb_squeeze')?.direction).toBe('bullish');
    const bear = analyzeTimingSignals(flatHistory(), baseIndicators({ bbSqueeze: true, bbSqueezeIntensity: 90, priceVsSma20: -2 }));
    expect(bear.triggers.find(t => t.type === 'bb_squeeze')?.direction).toBe('bearish');
  });

  it('OBV divergence: rising → bullish, falling → bearish', () => {
    const bull = analyzeTimingSignals(flatHistory(), baseIndicators({ obvDivergence: true, obvTrend: 'rising' }));
    expect(bull.triggers.find(t => t.type === 'obv_divergence')?.direction).toBe('bullish');
    const bear = analyzeTimingSignals(flatHistory(), baseIndicators({ obvDivergence: true, obvTrend: 'falling' }));
    expect(bear.triggers.find(t => t.type === 'obv_divergence')?.direction).toBe('bearish');
  });

  it('macd_cross: gap negativo convergiendo al cruce → bullish; gap positivo → bearish', () => {
    // requiere indicators.macd non-null; la serie MACD se recalcula desde los closes
    const macd = { macdLine: -0.5, signalLine: -0.1, histogram: -0.4 };

    const bull = analyzeTimingSignals(macdConvergingHistory(1), baseIndicators({ macd }));
    const tBull = bull.triggers.find(t => t.type === 'macd_cross');
    expect(tBull?.direction).toBe('bullish');
    expect(tBull?.estimatedDays).toBeLessThanOrEqual(10);

    const bear = analyzeTimingSignals(macdConvergingHistory(-1), baseIndicators({ macd }));
    const tBear = bear.triggers.find(t => t.type === 'macd_cross');
    expect(tBear?.direction).toBe('bearish');
    expect(tBear?.estimatedDays).toBeLessThanOrEqual(10);
  });

  it('support_bounce → bullish, resistance_break → bearish (anticipan rebote/rechazo)', () => {
    // support_bounce: precio cayendo hacia soporte
    const falling: OHLC[] = toOHLC(Array.from({ length: 60 }, (_, i) => 110 - i * 0.5)); // cae $0.5/día
    const indDown = baseIndicators({
      currentPrice: falling[falling.length - 1].close,
      supports: [{ price: falling[falling.length - 1].close - 3, strength: 2, touches: 3 }],
    });
    const resultDown = analyzeTimingSignals(falling, indDown);
    expect(resultDown.triggers.find(t => t.type === 'support_bounce')?.direction).toBe('bullish');

    // resistance_break: precio subiendo hacia resistencia
    const rising: OHLC[] = toOHLC(Array.from({ length: 60 }, (_, i) => 80 + i * 0.5)); // sube $0.5/día
    const indUp = baseIndicators({
      currentPrice: rising[rising.length - 1].close,
      resistances: [{ price: rising[rising.length - 1].close + 3, strength: 2, touches: 3 }],
    });
    const resultUp = analyzeTimingSignals(rising, indUp);
    expect(resultUp.triggers.find(t => t.type === 'resistance_break')?.direction).toBe('bearish');
  });
});

describe('divergencias → TimingTrigger passthrough (getTechnicalSummary)', () => {
  function seedDailyHistory(history: OHLC[]): void {
    vi.mocked(getHistoricalFromCache).mockImplementation((_symbol, interval) =>
      interval === 'daily' ? JSON.stringify(history) : null);
  }

  it('divergencia RSI bullish diaria → trigger rsi_divergence con direction bullish', async () => {
    seedDailyHistory(divergenceHistory(1));
    const summary = await getTechnicalSummary('TEST');

    const div = summary.divergences?.find(d => d.indicator === 'rsi' && d.timeframe === 'daily');
    expect(div?.type).toBe('bullish');

    const trigger = summary.timing?.triggers.find(t => t.type === 'rsi_divergence');
    expect(trigger?.direction).toBe('bullish');
    expect(trigger?.estimatedDays).toBe(3); // daily → 3 días
    expect(trigger?.impact).toBe('medium'); // daily → medium
  });

  it('divergencia RSI bearish diaria → trigger rsi_divergence con direction bearish', async () => {
    seedDailyHistory(divergenceHistory(-1));
    const summary = await getTechnicalSummary('TEST');

    const div = summary.divergences?.find(d => d.indicator === 'rsi' && d.timeframe === 'daily');
    expect(div?.type).toBe('bearish');

    const trigger = summary.timing?.triggers.find(t => t.type === 'rsi_divergence');
    expect(trigger?.direction).toBe('bearish');
  });
});
