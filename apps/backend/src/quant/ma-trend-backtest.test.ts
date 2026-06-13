import { describe, it, expect } from 'vitest';
import { simulateMaTrend, type Candle, type MaTrendConfig } from './ma-trend-backtest.js';

// fechas crecientes reales para que el orden por date sea correcto y determinista
function seq(closes: number[]): Candle[] {
  return closes.map((close, i) => {
    const d = new Date(Date.UTC(2020, 0, 1) + i * 86_400_000).toISOString().slice(0, 10);
    return { date: d, close };
  });
}

const cfg = (over: Partial<MaTrendConfig> = {}): MaTrendConfig => ({ entryMas: [3], exitMa: 3, ...over });

describe('simulateMaTrend', () => {
  it('enters once on an uptrend and holds to end of period', () => {
    const candles = seq([10, 10, 10, 11, 12, 13, 14]);
    const r = simulateMaTrend('TEST', candles, cfg());
    expect(r.metrics.numTrades).toBe(1);
    expect(r.trades[0].exitReason).toBe('end_of_period');
    expect(r.trades[0].entryPrice).toBe(11);
    expect(r.metrics.totalReturnPercent).toBeGreaterThan(0);
  });

  it('exits on the signal when price falls below the exit MA (captures the lag/whipsaw loss)', () => {
    const candles = seq([10, 10, 10, 12, 12, 9, 9]);
    const r = simulateMaTrend('TEST', candles, cfg());
    expect(r.metrics.numTrades).toBe(1);
    expect(r.trades[0].exitReason).toBe('signal');
    expect(r.trades[0].entryPrice).toBe(12);
    expect(r.trades[0].exitPrice).toBe(9);
    expect(r.trades[0].returnPercent).toBeLessThan(0); // entró tarde, salió tarde: pérdida
  });

  it('never enters in a downtrend (price stays below the MA)', () => {
    const candles = seq([14, 13, 12, 11, 10, 9]);
    const r = simulateMaTrend('TEST', candles, cfg());
    expect(r.metrics.numTrades).toBe(0);
  });

  it('requires price above ALL entry MAs to enter', () => {
    // Sube por encima de la media de 2 pero nunca de la de 3 → no debe entrar.
    const candles = seq([20, 18, 16, 17, 17, 17]);
    const withBoth = simulateMaTrend('TEST', candles, cfg({ entryMas: [2, 3], exitMa: 2 }));
    expect(withBoth.metrics.numTrades).toBe(0);
    // Control: con una sola media (la de 2) el mismo precio sí dispara una entrada.
    const withFastOnly = simulateMaTrend('TEST', candles, cfg({ entryMas: [2], exitMa: 2 }));
    expect(withFastOnly.metrics.numTrades).toBeGreaterThanOrEqual(1);
  });

  it('honors a hard stop-loss before the MA signal', () => {
    const candles = seq([10, 10, 10, 12, 10.5]);
    const r = simulateMaTrend('TEST', candles, cfg({ stopLossPct: 10 }));
    expect(r.metrics.numTrades).toBe(1);
    expect(r.trades[0].exitReason).toBe('stop_loss');
  });

  it('costs (commission + slippage) reduce the net return vs a frictionless run', () => {
    const candles = seq([10, 10, 10, 11, 12, 13, 14]);
    const clean = simulateMaTrend('TEST', candles, cfg());
    const withCosts = simulateMaTrend('TEST', candles, cfg({ commissionPct: 1, slippagePct: 0.5 }));
    expect(withCosts.metrics.totalReturnPercent).toBeLessThan(clean.metrics.totalReturnPercent);
  });

  it('reports buy & hold alongside the strategy for honest comparison', () => {
    const candles = seq([10, 10, 10, 11, 12, 13, 14]);
    const r = simulateMaTrend('TEST', candles, cfg());
    expect(r.metrics.buyAndHoldReturnPercent).toBeGreaterThan(0);
    expect(r.equityCurve.length).toBeGreaterThan(0);
    expect(r.equityCurve[0]).toHaveProperty('buyAndHoldValue');
  });
});
