import { describe, it, expect } from 'vitest';
import { analyzeTimingSignals } from './timing-analysis.service.js';
import type { OHLC, TechnicalIndicators } from '@trading/shared';

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

function flatHistory(days = 60, close = 100): OHLC[] {
  return Array.from({ length: days }, (_, i) => ({
    date: `2026-01-${String((i % 28) + 1).padStart(2, '0')}`,
    open: close, high: close, low: close, close, volume: 1000,
  }));
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

  it('support_bounce → bullish, resistance_break → bearish (anticipan rebote/rechazo)', () => {
    // support_bounce: precio cayendo hacia soporte
    const falling: OHLC[] = Array.from({ length: 60 }, (_, i) => {
      const close = 110 - i * 0.5; // cae $0.5/día
      return { date: `d${i}`, open: close, high: close, low: close, close, volume: 1000 };
    });
    const ind = baseIndicators({
      currentPrice: falling[falling.length - 1].close,
      supports: [{ price: falling[falling.length - 1].close - 3, strength: 2, touches: 3 }],
    });
    const result = analyzeTimingSignals(falling, ind);
    expect(result.triggers.find(t => t.type === 'support_bounce')?.direction).toBe('bullish');
  });
});
