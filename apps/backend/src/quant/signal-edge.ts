/**
 * Estudio de aislamiento de señales: mide el edge REAL de cada ingrediente del motor por
 * separado (¿comprar cuando esta señal dispara predice mejor que entrar en una barra
 * cualquiera, con el mismo riesgo?). La lógica pura vive acá; la corrida sobre el universo
 * (I/O) en signal-edge.service.ts.
 *
 * Usa los MISMOS indicadores que computeIndicators del motor en vivo → mide lo que el motor
 * realmente usa, no una regla parecida.
 */

export const SIGNAL_KEYS = ['rsi_oversold', 'above_sma200', 'above_both_ma', 'golden_cross', 'macd_bullish'] as const;
export type SignalKey = typeof SIGNAL_KEYS[number];

export interface SignalInput {
  price: number;
  rsi14: number | null;
  sma50: number | null;
  sma200: number | null;
  macdHistogram: number | null;
  goldenCross: boolean;
}

/** Evalúa, point-in-time, cuáles señales disparan dado el estado de los indicadores. */
export function detectSignals(s: SignalInput): Record<SignalKey, boolean> {
  return {
    rsi_oversold: s.rsi14 != null && s.rsi14 < 30,
    above_sma200: s.sma200 != null && s.price > s.sma200,
    above_both_ma: s.sma50 != null && s.sma200 != null && s.price > s.sma50 && s.price > s.sma200,
    golden_cross: s.goldenCross,
    macd_bullish: s.macdHistogram != null && s.macdHistogram > 0,
  };
}

/**
 * Test z de dos proporciones: ¿la diferencia entre el win-rate de la señal y el base-rate
 * es estadísticamente distinguible de cero, o es ruido de muestra chica? |z| ≥ 1.96 ≈ 95%.
 */
export function twoProportionZ(successesA: number, nA: number, successesB: number, nB: number): number {
  if (nA <= 0 || nB <= 0) return 0;
  const pA = successesA / nA;
  const pB = successesB / nB;
  const pPool = (successesA + successesB) / (nA + nB);
  const se = Math.sqrt(pPool * (1 - pPool) * (1 / nA + 1 / nB));
  if (se === 0) return 0;
  return (pA - pB) / se;
}

/** El edge es "estable" si no cambia de signo entre períodos (los ceros no rompen). */
export function isStableEdge(periodEdges: number[]): boolean {
  const signs = periodEdges.filter((e) => e !== 0).map((e) => Math.sign(e));
  return signs.every((s) => s === signs[0]);
}
