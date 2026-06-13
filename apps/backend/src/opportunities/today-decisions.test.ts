import { describe, it, expect } from 'vitest';
import { computeTrailingStop, decidePositionVerb, type Candle } from './today-decisions.js';

function c(date: string, high: number, low: number, close: number): Candle {
  return { date, high, low, close };
}

describe('computeTrailingStop (chandelier: highestHigh − mult×ATR)', () => {
  it('computes highestHigh(period) − mult×ATR(period)', () => {
    const candles = [
      c('2020-01-01', 10, 8, 9),
      c('2020-01-02', 12, 9, 11),
      c('2020-01-03', 13, 10, 12),
      c('2020-01-04', 14, 11, 13),
    ];
    // highestHigh(last 3) = 14; ATR(3) = 3 ⇒ stop = 14 − 1×3 = 11
    expect(computeTrailingStop(candles, { period: 3, atrMult: 1 })).toBe(11);
  });

  it('returns null when there are not enough candles', () => {
    expect(computeTrailingStop([c('2020-01-01', 10, 8, 9)], { period: 3, atrMult: 1 })).toBeNull();
  });

  it('trails UP: a higher recent high lifts the stop', () => {
    const base = [c('d1', 10, 8, 9), c('d2', 12, 9, 11), c('d3', 13, 10, 12), c('d4', 14, 11, 13)];
    const lower = computeTrailingStop(base, { period: 3, atrMult: 1 })!;
    const higher = computeTrailingStop([...base, c('d5', 20, 12, 19)], { period: 3, atrMult: 1 })!;
    expect(higher).toBeGreaterThan(lower);
  });
});

describe('decidePositionVerb (let winners run, sell on real reversal)', () => {
  it('MANTENER while price is above the trailing stop', () => {
    const r = decidePositionVerb({ avgCost: 100, currentPrice: 120, trailingStop: 110 });
    expect(r.verb).toBe('MANTENER');
    expect(r.stop).toBe(110);
    expect(r.gainPct).toBe(20);
  });

  it('VENDER only when price actually hits the trailing stop', () => {
    const r = decidePositionVerb({ avgCost: 100, currentPrice: 108, trailingStop: 110 });
    expect(r.verb).toBe('VENDER');
  });

  it('a model SELL does NOT force a sell on a winner — only warns', () => {
    // TSM: +12%, above its trailing stop, engine sees bearish divergence
    const r = decidePositionVerb({ avgCost: 376, currentPrice: 424, trailingStop: 400, engineWarnsSell: true });
    expect(r.verb).toBe('MANTENER');
    expect(r.warning).toBeTruthy();
  });

  it('falls back to MANTENER (no stop) when the trailing stop cannot be computed', () => {
    const r = decidePositionVerb({ avgCost: 100, currentPrice: 105, trailingStop: null });
    expect(r.verb).toBe('MANTENER');
    expect(r.stop).toBeNull();
  });
});
