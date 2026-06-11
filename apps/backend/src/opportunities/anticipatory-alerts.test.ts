import { describe, it, expect } from 'vitest';
import { extractBullishSignals, buildAlertsFromScan, reconcileAlerts, anticipatoryUpgrade, type AlertSource } from './anticipatory-alerts.js';
import type { AnticipatoryAlert } from '@trading/shared';

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

  it('dos triggers *_divergence sin opp.divergences → una sola señal divergence', () => {
    const signals = extractBullishSignals(makeOpp({
      timingView: { action: 'BUY', timing: 'soon', confidence: 70, triggers: [trigger('rsi_divergence', 'bullish', 3), trigger('obv_divergence', 'bullish', 2)] },
    }));
    expect(signals).toHaveLength(1);
    expect(signals[0].category).toBe('divergence');
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

function makeAlert(overrides: Partial<AnticipatoryAlert> = {}): AnticipatoryAlert {
  return {
    id: 'GGAL:divergence+macd_cross', kind: 'anticipatory', symbol: 'GGAL',
    signals: [{ category: 'divergence', description: 'd', estimatedDays: null }],
    currentPrice: 50, entryPrice: 50, score: 55, status: 'active',
    firstSeenDate: '2026-06-10', lastSeenDate: '2026-06-10', seen: false,
    ...overrides,
  };
}

describe('reconcileAlerts', () => {
  const TODAY = '2026-06-11';

  it('id nuevo → toInsert + newAlerts (esto dispara el push)', () => {
    const current = [makeAlert({ firstSeenDate: TODAY, lastSeenDate: TODAY })];
    const r = reconcileAlerts(current, [], TODAY);
    expect(r.toInsert).toHaveLength(1);
    expect(r.newAlerts).toHaveLength(1);
    expect(r.toUpdate).toHaveLength(0);
    expect(r.toExpire).toHaveLength(0);
  });

  it('id presente → toUpdate con lastSeen/precios nuevos, seen y firstSeenDate preservados, NO newAlert', () => {
    const stored = [makeAlert({ seen: true, currentPrice: 48 })];
    const current = [makeAlert({ firstSeenDate: TODAY, lastSeenDate: TODAY, currentPrice: 52, seen: false })];
    const r = reconcileAlerts(current, stored, TODAY);
    expect(r.newAlerts).toHaveLength(0);
    expect(r.toInsert).toHaveLength(0);
    expect(r.toUpdate).toHaveLength(1);
    expect(r.toUpdate[0].seen).toBe(true);            // preservado
    expect(r.toUpdate[0].firstSeenDate).toBe('2026-06-10'); // preservado
    expect(r.toUpdate[0].lastSeenDate).toBe(TODAY);
    expect(r.toUpdate[0].currentPrice).toBe(52);      // refrescado
  });

  it('id desaparecido hace <7 dias → se mantiene (sin expirar todavia)', () => {
    const stored = [makeAlert({ lastSeenDate: '2026-06-08' })];
    const r = reconcileAlerts([], stored, TODAY);
    expect(r.toExpire).toHaveLength(0);
  });

  it('id desaparecido hace >=7 dias → toExpire', () => {
    const stored = [makeAlert({ lastSeenDate: '2026-06-03' })];
    const r = reconcileAlerts([], stored, TODAY);
    expect(r.toExpire).toEqual(['GGAL:divergence+macd_cross']);
  });

  it('expiry exacto en el dia 7 → expira', () => {
    const stored = [makeAlert({ lastSeenDate: '2026-06-04' })];
    expect(reconcileAlerts([], stored, TODAY).toExpire).toEqual(['GGAL:divergence+macd_cross']);
  });

  it('confluencia que muta de categorias → alerta vieja expira inmediatamente (sin ghost twin)', () => {
    const stored = [makeAlert()]; // GGAL:divergence+macd_cross, active, lastSeen 2026-06-10
    const current = [makeAlert({ id: 'GGAL:bb_squeeze+divergence', firstSeenDate: TODAY, lastSeenDate: TODAY })];
    const r = reconcileAlerts(current, stored, TODAY);
    expect(r.toInsert).toHaveLength(1);
    expect(r.toExpire).toEqual(['GGAL:divergence+macd_cross']);
  });

  it('mismo id nunca produce un segundo new', () => {
    const stored = [makeAlert()];
    const current = [makeAlert({ firstSeenDate: TODAY, lastSeenDate: TODAY })];
    const r = reconcileAlerts(current, stored, TODAY);
    expect(r.newAlerts).toHaveLength(0);
  });

  it('stop_breach activo NO se expira por la regla superseded (solo aplica a kind anticipatory)', () => {
    // stop:GGAL activo + el scan trae una alerta anticipatoria nueva para GGAL
    const stored = [makeAlert({ id: 'stop:GGAL', kind: 'stop_breach', lastSeenDate: TODAY })];
    const current = [makeAlert({ id: 'GGAL:bb_squeeze+divergence', firstSeenDate: TODAY, lastSeenDate: TODAY })];
    const r = reconcileAlerts(current, stored, TODAY);
    expect(r.toExpire).toHaveLength(0);
    // pero el cleanup de 7 dias SI aplica a stop_breach (garbage collection intencional)
    const stale = [makeAlert({ id: 'stop:GGAL', kind: 'stop_breach', lastSeenDate: '2026-06-03' })];
    expect(reconcileAlerts([], stale, TODAY).toExpire).toEqual(['stop:GGAL']);
  });

  it('alertas expired/triggered en stored se ignoran (no reviven ni re-expiran)', () => {
    const stored = [makeAlert({ status: 'expired', lastSeenDate: '2026-05-01' })];
    const r = reconcileAlerts([], stored, TODAY);
    expect(r.toExpire).toHaveLength(0);
    // y si la confluencia reaparece, es un NEW (re-alerta legitima tras expirar)
    const r2 = reconcileAlerts([makeAlert({ firstSeenDate: TODAY, lastSeenDate: TODAY })], stored, TODAY);
    expect(r2.newAlerts).toHaveLength(1);
  });
});

describe('anticipatoryUpgrade', () => {
  const twoSignals = () => makeOpp({
    divergences: [{ type: 'bullish', indicator: 'macd', timeframe: 'weekly', description: 'Div alcista MACD semanal' }],
    timingView: { action: 'BUY', timing: 'soon', confidence: 80, triggers: [trigger('macd_cross', 'bullish', 3)] },
    tradeLevels: { entryPrice: 49, stopLoss: 46, takeProfit: 58 },
  });

  it('HOLD + confluencia >=2 + R/R>=1.5 → BUY (caso GGAL)', () => {
    const r = anticipatoryUpgrade('HOLD', 54, twoSignals(), 1.8, false);
    expect(r.action).toBe('BUY');
    expect(r.reason).toMatch(/confluencia/i); // la reason arranca con "Confluencia" (mayuscula inicial de oracion)
  });

  it('WATCH + confluencia + composite>=50 → BUY', () => {
    const r = anticipatoryUpgrade('WATCH', 52, twoSignals(), 1.2, false);
    expect(r.action).toBe('BUY');
  });

  it('WATCH + composite<50 → sin cambio', () => {
    expect(anticipatoryUpgrade('WATCH', 45, twoSignals(), 2, false).action).toBe('WATCH');
  });

  it('HOLD + R/R<1.5 → WATCH (señal visible pero sin gatillar compra)', () => {
    expect(anticipatoryUpgrade('HOLD', 54, twoSignals(), 1.1, false).action).toBe('WATCH');
  });

  it('veto activo → nunca upgradea', () => {
    expect(anticipatoryUpgrade('WATCH', 60, twoSignals(), 2, true).action).toBe('WATCH');
  });

  // Regresion (regla "tape contradictorio = sin upgrade"): este test cubre la mitad pura
  // (divergencia bearish / timingView SELL). La otra mitad — signalConflicts — se gatea en
  // el hook de scoring.ts (buildAlgorithmicOpportunity) porque AlertSource no ve conflictos;
  // no tiene unit test directo a proposito: el hook arrastra DB real + fixture tecnico
  // completo (mock-theater). Si se toca el gate del hook, revisar ese bloque en scoring.ts.
  it('conflicto bajista → nunca upgradea', () => {
    const conBearish = makeOpp({
      divergences: [
        { type: 'bullish', indicator: 'macd', timeframe: 'weekly', description: 'd' },
        { type: 'bearish', indicator: 'rsi', timeframe: 'daily', description: 'd' },
      ],
      timingView: { action: 'BUY', timing: 'soon', confidence: 80, triggers: [trigger('macd_cross', 'bullish', 3)] },
    });
    expect(anticipatoryUpgrade('HOLD', 60, conBearish, 2, false).action).toBe('HOLD');
  });

  it('<2 categorias → sin cambio', () => {
    const una = makeOpp({ divergences: [{ type: 'bullish', indicator: 'macd', timeframe: 'weekly', description: 'd' }] });
    expect(anticipatoryUpgrade('HOLD', 60, una, 2, false).action).toBe('HOLD');
  });

  it('SELL y BUY no se tocan', () => {
    expect(anticipatoryUpgrade('SELL', 60, twoSignals(), 2, false).action).toBe('SELL');
    expect(anticipatoryUpgrade('BUY', 60, twoSignals(), 2, false).action).toBe('BUY');
  });
});
