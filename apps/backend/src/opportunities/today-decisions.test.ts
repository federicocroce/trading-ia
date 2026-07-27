import { describe, it, expect } from 'vitest';
import { computeTrailingStop, decidePositionVerb, timingCaveatFor, type Candle } from './today-decisions.js';
import type { TimingView } from '@trading/shared';

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

  it('a model SELL on a winner no longer hides as MANTENER — surfaces as REVISAR', () => {
    // TSM: +12%, above its trailing stop, engine sees bearish divergence
    const r = decidePositionVerb({ avgCost: 376, currentPrice: 424, trailingStop: 400, engineWarnsSell: true });
    expect(r.verb).toBe('REVISAR');
    expect(r.reason).toContain('400');
  });

  it('falls back to MANTENER (no stop) when the trailing stop cannot be computed', () => {
    const r = decidePositionVerb({ avgCost: 100, currentPrice: 105, trailingStop: null });
    expect(r.verb).toBe('MANTENER');
    expect(r.stop).toBeNull();
  });
});

describe('decidePositionVerb — jerarquía de decisión (REVISAR)', () => {
  // mkInput: adapta el vocabulario del brief (engineAction) a la firma real de PositionInput,
  // que ya modela "el motor advierte SELL" como un booleano (engineWarnsSell).
  function mkInput(opts: {
    engineAction: 'BUY' | 'SELL' | 'HOLD';
    decisionPrice: number;
    trailingStop: number | null;
    avgCost?: number;
  }) {
    const { engineAction, decisionPrice, trailingStop, avgCost = 10 } = opts;
    return {
      avgCost,
      currentPrice: decisionPrice,
      trailingStop,
      engineWarnsSell: engineAction === 'SELL',
    };
  }

  it('motor SELL sin stop tocado ⇒ REVISAR (nunca MANTENER a secas)', () => {
    // precio ARRIBA del trailing stop, engine action SELL (caso MARA 2026-07-02)
    const d = decidePositionVerb(mkInput({ engineAction: 'SELL', decisionPrice: 13.37, trailingStop: 12.53 }));
    expect(d.verb).toBe('REVISAR');
    expect(d.reason).toContain('motor');
    expect(d.reason).toContain('12.53'); // el stop duro sigue visible
  });

  it('motor HOLD/BUY sin stop tocado sigue MANTENER', () => {
    const d = decidePositionVerb(mkInput({ engineAction: 'HOLD', decisionPrice: 100, trailingStop: 90 }));
    expect(d.verb).toBe('MANTENER');
  });

  it('REVISAR nombra ambas fuentes: el motivo del motor y el stop duro', () => {
    const d = decidePositionVerb({
      avgCost: 10,
      currentPrice: 13.37,
      trailingStop: 12.53,
      engineWarnsSell: true,
      engineSellReason: 'divergencia bajista semanal',
    });
    expect(d.verb).toBe('REVISAR');
    expect(d.reason).toContain('divergencia bajista semanal');
    expect(d.reason).toContain('12.53');
  });

  it('stop tocado Y motor SELL simultáneos ⇒ VENDER (nivel 1 pisa nivel 2)', () => {
    const d = decidePositionVerb(mkInput({ engineAction: 'SELL', decisionPrice: 10, trailingStop: 10.5 }));
    expect(d.verb).toBe('VENDER');
  });
});

describe('decidePositionVerb — veredicto por CIERRE, no por toque intradiario', () => {
  it('un toque intradiario NO vende: espera un cierre confirmado bajo el stop', () => {
    // spot cayó al stop en el día, pero el último cierre sigue arriba → provisional, no venta
    const r = decidePositionVerb({ avgCost: 100, currentPrice: 109, closePrice: 115, trailingStop: 110, intraday: true });
    expect(r.verb).toBe('MANTENER');
    expect(r.warning).toMatch(/intradiari|cierr/i);
  });

  it('VENDER cuando el cierre confirmado quedó en/bajo el stop', () => {
    const r = decidePositionVerb({ avgCost: 100, currentPrice: 108, closePrice: 108, trailingStop: 110, intraday: false });
    expect(r.verb).toBe('VENDER');
  });

  it('VENDER si ya cerró bajo el stop, aunque intradía rebote por encima', () => {
    const r = decidePositionVerb({ avgCost: 100, currentPrice: 112, closePrice: 108, trailingStop: 110, intraday: true });
    expect(r.verb).toBe('VENDER');
  });

  it('sin closePrice mantiene el comportamiento viejo (decide por currentPrice)', () => {
    const r = decidePositionVerb({ avgCost: 100, currentPrice: 108, trailingStop: 110 });
    expect(r.verb).toBe('VENDER');
  });

  it('el motivo dice "Tocó" en el camino spot y "Cerró" cuando decide por cierre', () => {
    const spot = decidePositionVerb({ avgCost: 100, currentPrice: 108, trailingStop: 110 });
    expect(spot.reason).toMatch(/Tocó/);
    const close = decidePositionVerb({ avgCost: 100, currentPrice: 108, closePrice: 108, trailingStop: 110 });
    expect(close.reason).toMatch(/Cerró/);
  });
});

describe('timingCaveatFor (coherencia: verbo OPERABLE vs vista de timing vendedora)', () => {
  const sellTiming: TimingView = {
    action: 'SELL',
    timing: 'now',
    confidence: 62,
    triggers: [
      { type: 'stoch_cross', description: 'Stochastic cruzó en sobrecompra', direction: 'bearish', estimatedDays: 0, impact: 'medium' },
      { type: 'macd_cross', description: 'MACD a punto de cruzar bajista en ~2 días', direction: 'bearish', estimatedDays: 2, impact: 'high' },
    ],
  };

  it('OPERABLE con timing SELL lleva caveat nombrando confianza y el trigger de mayor impacto', () => {
    const caveat = timingCaveatFor('OPERABLE', sellTiming);
    expect(caveat).toBeDefined();
    expect(caveat).toContain('62%');
    expect(caveat).toContain('MACD a punto de cruzar bajista en ~2 días');
  });

  it('OPERABLE sin timingView no inventa advertencia (fail-closed: ausencia = nada)', () => {
    expect(timingCaveatFor('OPERABLE', undefined)).toBeUndefined();
  });

  it('OPERABLE con timing BUY no lleva caveat (no hay contradicción)', () => {
    const buyTiming: TimingView = { action: 'BUY', timing: 'now', confidence: 70, triggers: [] };
    expect(timingCaveatFor('OPERABLE', buyTiming)).toBeUndefined();
  });

  it('EN ESPERA no lleva caveat aunque el timing diga SELL (ya está marcado)', () => {
    expect(timingCaveatFor('EN ESPERA', sellTiming)).toBeUndefined();
  });

  it('OPERABLE con timing SELL sin triggers bajistas igual advierte, sin inventar detalle', () => {
    const bare: TimingView = { action: 'SELL', timing: 'soon', confidence: 55, triggers: [] };
    const caveat = timingCaveatFor('OPERABLE', bare);
    expect(caveat).toBeDefined();
    expect(caveat).toContain('55%');
  });
});
