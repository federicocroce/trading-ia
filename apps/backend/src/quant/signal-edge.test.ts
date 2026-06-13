import { describe, it, expect } from 'vitest';
import { detectSignals, SIGNAL_KEYS, type SignalInput } from './signal-edge.js';

const base: SignalInput = { price: 100, rsi14: 50, sma50: 95, sma200: 90, macdHistogram: 0, goldenCross: false };

describe('detectSignals (ingredientes reales del motor, evaluados point-in-time)', () => {
  it('expone una bandera por cada señal conocida', () => {
    const r = detectSignals(base);
    for (const k of SIGNAL_KEYS) expect(k in r).toBe(true);
  });

  it('rsi_oversold: RSI < 30', () => {
    expect(detectSignals({ ...base, rsi14: 25 }).rsi_oversold).toBe(true);
    expect(detectSignals({ ...base, rsi14: 35 }).rsi_oversold).toBe(false);
    expect(detectSignals({ ...base, rsi14: null }).rsi_oversold).toBe(false);
  });

  it('above_sma200: precio por encima de la media de 200', () => {
    expect(detectSignals({ ...base, price: 110, sma200: 100 }).above_sma200).toBe(true);
    expect(detectSignals({ ...base, price: 90, sma200: 100 }).above_sma200).toBe(false);
    expect(detectSignals({ ...base, sma200: null }).above_sma200).toBe(false);
  });

  it('above_both_ma: por encima de SMA50 Y SMA200 (filtro de tendencia)', () => {
    expect(detectSignals({ ...base, price: 100, sma50: 95, sma200: 90 }).above_both_ma).toBe(true);
    expect(detectSignals({ ...base, price: 92, sma50: 95, sma200: 90 }).above_both_ma).toBe(false); // bajo SMA50
  });

  it('golden_cross: pasa el flag del cruce', () => {
    expect(detectSignals({ ...base, goldenCross: true }).golden_cross).toBe(true);
    expect(detectSignals({ ...base, goldenCross: false }).golden_cross).toBe(false);
  });

  it('macd_bullish: histograma > 0', () => {
    expect(detectSignals({ ...base, macdHistogram: 0.5 }).macd_bullish).toBe(true);
    expect(detectSignals({ ...base, macdHistogram: -0.5 }).macd_bullish).toBe(false);
    expect(detectSignals({ ...base, macdHistogram: null }).macd_bullish).toBe(false);
  });
});
