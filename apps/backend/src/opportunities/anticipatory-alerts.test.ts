import { describe, it, expect } from 'vitest';
import { extractBullishSignals, buildAlertsFromScan, type AlertSource } from './anticipatory-alerts.js';

function makeOpp(overrides: Partial<AlertSource> = {}): AlertSource {
  return {
    symbol: 'GGAL',
    currentPrice: 50,
    opportunityScore: 55,
    divergences: [],
    timingView: undefined,
    tradeLevels: undefined,
    ...overrides,
  };
}

const trigger = (type: string, direction: 'bullish' | 'bearish' | 'neutral', estimatedDays: number | null) => ({
  type, direction, estimatedDays, description: `${type} ${direction} ~${estimatedDays}d`, impact: 'high' as const,
});

describe('extractBullishSignals', () => {
  it('divergencia alcista → categoria divergence', () => {
    const signals = extractBullishSignals(makeOpp({
      divergences: [{ type: 'bullish', indicator: 'macd', timeframe: 'weekly', description: 'Divergencia alcista MACD semanal' }],
    }));
    expect(signals).toHaveLength(1);
    expect(signals[0].category).toBe('divergence');
    expect(signals[0].timeframe).toBe('weekly');
  });

  it('gate de anticipacion: sma_cross con estimatedDays 0 (ya ocurrio) NO cuenta; >=1 si', () => {
    const confirmado = extractBullishSignals(makeOpp({
      timingView: { action: 'BUY', timing: 'now', confidence: 80, triggers: [trigger('sma_cross', 'bullish', 0)] },
    }));
    expect(confirmado).toHaveLength(0);

    const inminente = extractBullishSignals(makeOpp({
      timingView: { action: 'BUY', timing: 'soon', confidence: 80, triggers: [trigger('sma_cross', 'bullish', 4)] },
    }));
    expect(inminente).toHaveLength(1);
    expect(inminente[0].category).toBe('golden_cross');
  });

  it('excepcion rsi_zone: oversold-now (estimatedDays 0) SI cuenta — el rebote es lo anticipado', () => {
    const signals = extractBullishSignals(makeOpp({
      timingView: { action: 'BUY', timing: 'now', confidence: 70, triggers: [trigger('rsi_zone', 'bullish', 0)] },
    }));
    expect(signals).toHaveLength(1);
    expect(signals[0].category).toBe('oversold_bounce');
  });

  it('dedup: *_divergence triggers mapean a divergence — misma divergencia en ambos lados = 1 categoria', () => {
    const signals = extractBullishSignals(makeOpp({
      divergences: [{ type: 'bullish', indicator: 'rsi', timeframe: 'daily', description: 'Div alcista RSI' }],
      timingView: { action: 'BUY', timing: 'soon', confidence: 70, triggers: [trigger('rsi_divergence', 'bullish', 3)] },
    }));
    const categories = new Set(signals.map(s => s.category));
    expect(categories.size).toBe(1);
    expect([...categories][0]).toBe('divergence');
  });

  it('señales bearish nunca cuentan', () => {
    const signals = extractBullishSignals(makeOpp({
      divergences: [{ type: 'bearish', indicator: 'rsi', timeframe: 'daily', description: 'Div bajista' }],
      timingView: { action: 'SELL', timing: 'soon', confidence: 70, triggers: [trigger('macd_cross', 'bearish', 2)] },
    }));
    expect(signals).toHaveLength(0);
  });

  it('stoch_cross y triggers fuera de taxonomia se ignoran', () => {
    const signals = extractBullishSignals(makeOpp({
      timingView: { action: 'BUY', timing: 'now', confidence: 70, triggers: [trigger('stoch_cross', 'bullish', 0), trigger('resistance_break', 'bearish', 3)] },
    }));
    expect(signals).toHaveLength(0);
  });
});

describe('buildAlertsFromScan', () => {
  const SCAN_DATE = '2026-06-11';

  it('<2 categorias → sin alerta', () => {
    const alerts = buildAlertsFromScan([makeOpp({
      divergences: [{ type: 'bullish', indicator: 'macd', timeframe: 'weekly', description: 'Div alcista MACD semanal' }],
    })], SCAN_DATE);
    expect(alerts).toHaveLength(0);
  });

  it('>=2 categorias distintas → alerta con id estable y ambas señales', () => {
    const alerts = buildAlertsFromScan([makeOpp({
      divergences: [{ type: 'bullish', indicator: 'macd', timeframe: 'weekly', description: 'Div alcista MACD semanal' }],
      timingView: { action: 'BUY', timing: 'soon', confidence: 80, triggers: [trigger('macd_cross', 'bullish', 3)] },
    })], SCAN_DATE);
    expect(alerts).toHaveLength(1);
    expect(alerts[0].id).toBe('GGAL:divergence+macd_cross');
    expect(alerts[0].signals).toHaveLength(2);
    expect(alerts[0].status).toBe('active');
    expect(alerts[0].firstSeenDate).toBe(SCAN_DATE);
    expect(alerts[0].seen).toBe(false);
    expect(alerts[0].kind).toBe('anticipatory');
  });

  it('entry/stop/target desde tradeLevels; fallback a currentPrice', () => {
    const conLevels = buildAlertsFromScan([makeOpp({
      divergences: [{ type: 'bullish', indicator: 'rsi', timeframe: 'daily', description: 'd' }],
      timingView: { action: 'BUY', timing: 'soon', confidence: 80, triggers: [trigger('bb_squeeze', 'bullish', 1)] },
      tradeLevels: { entryPrice: 49, stopLoss: 46, takeProfit: 58 },
    })], SCAN_DATE)[0];
    expect(conLevels.entryPrice).toBe(49);
    expect(conLevels.stopLoss).toBe(46);
    expect(conLevels.takeProfit).toBe(58);

    const sinLevels = buildAlertsFromScan([makeOpp({
      divergences: [{ type: 'bullish', indicator: 'rsi', timeframe: 'daily', description: 'd' }],
      timingView: { action: 'BUY', timing: 'soon', confidence: 80, triggers: [trigger('bb_squeeze', 'bullish', 1)] },
    })], SCAN_DATE)[0];
    expect(sinLevels.entryPrice).toBe(50);
    expect(sinLevels.stopLoss).toBeUndefined();
  });

  it('regla de conflicto: divergencia bajista presente → sin alerta aunque haya confluencia bullish', () => {
    const alerts = buildAlertsFromScan([makeOpp({
      divergences: [
        { type: 'bullish', indicator: 'macd', timeframe: 'weekly', description: 'd' },
        { type: 'bearish', indicator: 'rsi', timeframe: 'daily', description: 'd' },
      ],
      timingView: { action: 'BUY', timing: 'soon', confidence: 80, triggers: [trigger('macd_cross', 'bullish', 3)] },
    })], SCAN_DATE);
    expect(alerts).toHaveLength(0);
  });

  it('regla de conflicto: timingView.action SELL → sin alerta', () => {
    const alerts = buildAlertsFromScan([makeOpp({
      divergences: [{ type: 'bullish', indicator: 'macd', timeframe: 'weekly', description: 'd' }],
      timingView: { action: 'SELL', timing: 'soon', confidence: 80, triggers: [trigger('macd_cross', 'bullish', 3)] },
    })], SCAN_DATE);
    expect(alerts).toHaveLength(0);
  });
});
