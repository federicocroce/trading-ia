import { describe, it, expect } from 'vitest';
import { computeTrailingStop, concentrationCaveatFor, decidePositionVerb, resolvePositionPrice, sizingCaveatFor, timingCaveatFor, type Candle } from './today-decisions.js';
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

// AD-015 (auditoría 2026-07-29): si getQuotes falla, el guardián caía al precio del último scan
// —que puede tener días— y decidía VENDER/MANTENER sin decirlo. Un stop es una comparación contra
// el precio de HOY: con un precio viejo no se sabe si se perforó, y "no sé" es la única respuesta
// honesta (regla dura #1). Antes se elegía entre inventar una venta o dejar pasar en silencio.
describe('decidePositionVerb con precio viejo (fail-closed)', () => {
  const base = { avgCost: 100, trailingStop: 90, target: 130 };

  it('precio viejo BAJO el stop: no inventa un VENDER, pide revisar y nombra la fecha', () => {
    const v = decidePositionVerb({ ...base, currentPrice: 85, priceIsStale: true, priceAsOf: '2026-07-24' });
    expect(v.verb).toBe('REVISAR');
    expect(v.warning).toContain('2026-07-24');
    expect(v.stop).toBe(90);
  });

  it('precio viejo ARRIBA del stop: tampoco pasa en silencio a MANTENER', () => {
    const v = decidePositionVerb({ ...base, currentPrice: 120, priceIsStale: true, priceAsOf: '2026-07-24' });
    expect(v.verb).toBe('REVISAR');
    expect(v.warning).toContain('2026-07-24');
  });

  it('precio viejo sin fecha conocida: sigue siendo REVISAR y lo dice', () => {
    const v = decidePositionVerb({ ...base, currentPrice: 120, priceIsStale: true });
    expect(v.verb).toBe('REVISAR');
    expect(v.warning).toMatch(/no pude confirmar|desconocida/i);
  });

  it('el precio viejo gana sobre el stop faltante: no se reporta "faltan datos de precio" a secas', () => {
    const v = decidePositionVerb({ ...base, trailingStop: null, currentPrice: 120, priceIsStale: true, priceAsOf: '2026-07-24' });
    expect(v.verb).toBe('REVISAR');
    expect(v.warning).toContain('2026-07-24');
  });

  it('REGRESIÓN: sin priceIsStale el comportamiento vigente queda intacto', () => {
    const vende = decidePositionVerb({ ...base, currentPrice: 85, closePrice: 85 });
    expect(vende.verb).toBe('VENDER');
    const mantiene = decidePositionVerb({ ...base, currentPrice: 120 });
    expect(mantiene.verb).toBe('MANTENER');
  });
});

// AD-015: la elección de qué precio usar era una cadena de `??` enterrada en el servicio, sin
// test posible y sin dejar rastro de que había caído al fallback. Extraída y explícita.
describe('resolvePositionPrice (de dónde salió el precio, y decirlo)', () => {
  it('cotización viva: precio vivo, no viejo', () => {
    const r = resolvePositionPrice({ current: 120 }, { currentPrice: 100 }, '2026-07-24');
    expect(r).toEqual({ price: 120, isStale: false, asOf: null });
  });

  it('sin cotización pero con scan: cae al scan y lo marca viejo con su fecha', () => {
    const r = resolvePositionPrice(undefined, { currentPrice: 100 }, '2026-07-24');
    expect(r).toEqual({ price: 100, isStale: true, asOf: '2026-07-24' });
  });

  it('cotización en cero o negativa NO es cotización: cae al scan', () => {
    expect(resolvePositionPrice({ current: 0 }, { currentPrice: 100 }, '2026-07-24')?.isStale).toBe(true);
    expect(resolvePositionPrice({ current: -3 }, { currentPrice: 100 }, '2026-07-24')?.isStale).toBe(true);
  });

  it('FAIL-CLOSED: sin cotización y sin scan devuelve null — el llamador debe reportarlo, no saltearlo', () => {
    expect(resolvePositionPrice(undefined, undefined, '2026-07-24')).toBeNull();
    expect(resolvePositionPrice(undefined, { currentPrice: 0 }, '2026-07-24')).toBeNull();
  });

  it('scan sin fecha: sigue siendo viejo, con asOf null', () => {
    expect(resolvePositionPrice(undefined, { currentPrice: 100 }, null)).toEqual({ price: 100, isStale: true, asOf: null });
  });
});

// AD-017 (auditoría 2026-07-29): un split desincroniza `avgCost` (carga manual, pre-split) de las
// velas de Yahoo (ajustadas, post-split). Este test FIJA el radio de daño: la PROTECCIÓN sale
// intacta porque el verbo se decide comparando precio contra stop —ambos post-split— y no toca
// avgCost. Lo que sí queda mal es el resultado mostrado. Si alguien hace depender el verbo de
// avgCost, este test se rompe y avisa que rompió la protección.
describe('split no ajustado: el verbo aguanta, el resultado miente', () => {
  const postSplit = { currentPrice: 12, trailingStop: 10, target: 20 };

  it('avgCost pre-split (10×) NO convierte un MANTENER en VENDER', () => {
    const v = decidePositionVerb({ ...postSplit, avgCost: 100 });
    expect(v.verb).toBe('MANTENER');
    expect(v.stop).toBe(10);
  });

  it('avgCost pre-split (10×) tampoco evita un VENDER legítimo', () => {
    const v = decidePositionVerb({ ...postSplit, currentPrice: 9, closePrice: 9, avgCost: 100 });
    expect(v.verb).toBe('VENDER');
  });

  it('el daño conocido es el resultado: gainPct sale disparatado y nadie lo detecta', () => {
    expect(decidePositionVerb({ ...postSplit, avgCost: 100 }).gainPct).toBe(-88);
  });
});

// Hallazgo del review del propio branch (2026-07-29): AD-015 hizo VISIBLE la posición
// descartada, pero `portfolioValue` sigue sumando solo las evaluadas y de ahí sale el sizing
// de TODA posición nueva. Con una posición sin precio, el sizing se calcula sobre una cartera
// más chica que la real y sale sistemáticamente menor, en silencio. Un tamaño que sabés que
// está mal es peor que no dar tamaño (regla dura #1).
describe('sizingCaveatFor (no dar un tamaño calculado sobre una cartera incompleta)', () => {
  it('cartera completa: sin caveat, el sizing es confiable', () => {
    expect(sizingCaveatFor([])).toBeNull();
  });

  it('con posiciones descartadas: nombra cuáles y por qué el tamaño no se puede dar', () => {
    const c = sizingCaveatFor(['GGAL', 'NEM']);
    expect(c).not.toBeNull();
    expect(c).toContain('GGAL');
    expect(c).toContain('NEM');
  });

  it('una sola descartada ya invalida la base', () => {
    expect(sizingCaveatFor(['TSM'])).toContain('TSM');
  });
});

// AD-016 (auditoría 2026-07-29): la concentración se medía, se pintaba y no cambiaba NADA.
// El §4 la llama "riesgo del objetivo #1 y más grande que cualquier stop individual" — pero
// ningún camino de decisión la miraba. Se cablea como DEGRADACIÓN: puede frenar que sumes,
// jamás sugerir que sumes. Un límite de riesgo es una restricción, no una predicción: no
// necesita evidencia de expectancy, a diferencia de un cambio de scoring.
describe('concentrationCaveatFor (la cartera concentrada frena aportes, no los sugiere)', () => {
  it('cartera repartida: sin caveat', () => {
    expect(concentrationCaveatFor({ effectiveBets: 6.2, positions: 8, coverage: 1 }, 2.5)).toBeNull();
  });

  it('cartera concentrada: nombra las apuestas reales contra las posiciones', () => {
    const c = concentrationCaveatFor({ effectiveBets: 1.8, positions: 8, coverage: 1 }, 2.5);
    expect(c).toContain('1.8');
    expect(c).toContain('8');
  });

  it('FAIL-CLOSED: sin reporte no se afirma nada (null, no "está bien")', () => {
    expect(concentrationCaveatFor(null, 2.5)).toBeNull();
  });

  it('FAIL-CLOSED: con cobertura parcial lo dice en vez de sentenciar sobre media cartera', () => {
    const c = concentrationCaveatFor({ effectiveBets: 1.8, positions: 8, coverage: 0.6 }, 2.5);
    expect(c).toMatch(/60%|cobertura|parcial/i);
  });

  it('justo en el umbral no dispara (solo por debajo)', () => {
    expect(concentrationCaveatFor({ effectiveBets: 2.5, positions: 8, coverage: 1 }, 2.5)).toBeNull();
  });
});
