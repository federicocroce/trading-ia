/**
 * Selección pura del top de "Oportunidades (no las tenés)" de Hoy + regla del residente crónico.
 *
 * Compartida entre la vista (today-decisions.service), el registro post-scan
 * (opportunities.service → persistScanResult) y el backfill, para que lo guardado sea
 * EXACTAMENTE lo mostrado — fuente única, sin doble discurso.
 *
 * Evidencia (signal_tracking × reconstrucción de opportunity_scans, abr–jul 2026, 165 scans):
 *   1ª aparición en el top:  win rate 53.6%, R prom +0.28 (n=110)
 *   2ª–3ª aparición:         win rate 50.0%, R prom +0.31 (n=118)
 *   4ª o más:                win rate 40.4%, R prom −0.05 (n=260)
 * El residente crónico no tiene edge medido → desde el umbral, COMPRAR degrada a OBSERVAR.
 * Solo degrada, jamás sube — misma dirección que el gate del LLM (applyLlmAction).
 */
import { envNumber } from '../shared/env-number.js';

export type MarketVerb = 'COMPRAR' | 'OBSERVAR';

export interface ProposalCandidate {
  symbol: string;
  action: string; // BUY | SELL | HOLD | WATCH
  opportunityScore: number;
}

export const TODAY_PROPOSAL_LIMIT = 6;

/**
 * Filtra BUY/WATCH no tenidos. INVARIANTE (regla #4, coherencia): ningún BUY del motor
 * queda fuera de Hoy — "Hoy" es la ÚNICA superficie de decisión y no puede decir "nada
 * para comprar" mientras Oportunidades muestra un BUY. BUYs primero (todos, por score;
 * si superan el límite, el límite cede), después los mejores WATCH hasta completar N.
 */
export function selectTodayProposals<T extends ProposalCandidate>(
  opps: T[],
  heldSet: Set<string>,
  limit: number = TODAY_PROPOSAL_LIMIT,
): T[] {
  const eligible = opps.filter(
    (o) => !heldSet.has(o.symbol.toUpperCase()) && (o.action === 'BUY' || o.action === 'WATCH'),
  );
  const byScore = (a: T, b: T) => b.opportunityScore - a.opportunityScore;
  const buys = eligible.filter((o) => o.action === 'BUY').sort(byScore);
  const watches = eligible.filter((o) => o.action === 'WATCH').sort(byScore);
  return [...buys, ...watches.slice(0, Math.max(0, limit - buys.length))];
}

export function verbFor(action: string): MarketVerb {
  return action === 'BUY' ? 'COMPRAR' : 'OBSERVAR';
}

/** Umbral configurable lazy (regla dura 3). HOY_CHRONIC_THRESHOLD=999 lo desactiva en la práctica. */
export function chronicThreshold(): number {
  return envNumber('HOY_CHRONIC_THRESHOLD', 4);
}

export interface ChronicAdjustment {
  verb: MarketVerb;
  /** Presente cuando la señal es crónica: viaja CON la card, citando la evidencia medida. */
  caveat?: string;
}

/** Lookback de stops recientes para la regla de perforación, configurable lazy (regla dura 3). */
export function stopBreachLookbackDays(): number {
  return envNumber('HOY_STOP_BREACH_LOOKBACK_DAYS', 30);
}

/**
 * Regla de stop perforado (patología NEM, medida 2026-07-22 con definición CAUSAL —
 * ambos datos observables al momento de la señal): BUY con precio por debajo del
 * stop_loss de una señal previa (≤30d) del mismo símbolo = 31.9% win / −0.153R (n=91)
 * vs 41.0% / +0.042R del resto (n=883). Además es coherencia pura (objetivo #4): el
 * sistema dijo "salida en X" hace días — recomendar compra por debajo de X es doble
 * discurso. COMPRAR degrada a OBSERVAR (jamás al revés) y cualquier verbo lleva caveat.
 * Sin stop reciente (null) = caso normal. Precio no finito ⇒ sin ajuste (la perforación
 * no puede verificarse; el dato faltante ya rechaza la señal aguas arriba).
 * NOTA de método: una primera medición dio −0.69R pero tenía lookahead bias (usaba
 * stops resueltos DESPUÉS de la señal) — ver prompt maestro sección 4.
 */
export function stopBreachAdjustment(
  verb: MarketVerb,
  currentPrice: number,
  recentMaxStop: number | null,
): ChronicAdjustment {
  if (recentMaxStop == null || !Number.isFinite(currentPrice)) return { verb };
  if (!(currentPrice < recentMaxStop)) return { verb };
  const cierre = verb === 'COMPRAR' ? 'Degradado a OBSERVAR.' : 'Esperá a que arme setup nuevo por encima del stop.';
  return {
    verb: verb === 'COMPRAR' ? 'OBSERVAR' : verb,
    caveat:
      `Precio (${currentPrice.toFixed(2)}) por debajo del stop ${recentMaxStop.toFixed(2)} que el propio sistema ` +
      `fijó hace días. Comprar bajo un stop perforado midió 32% de aciertos y R −0.15 (n=91, abr–jul 2026) ` +
      `contra 41% / +0.04R del resto. ${cierre}`,
  };
}

/**
 * Regla del residente crónico: nthAppearance >= umbral ⇒ COMPRAR degrada a OBSERVAR
 * (jamás al revés) y cualquier verbo lleva caveat. nth null = dato faltante ⇒ no se
 * inventa nada (fail-closed).
 */
export function chronicAdjustment(
  verb: MarketVerb,
  nthAppearance: number | null,
  threshold: number = chronicThreshold(),
): ChronicAdjustment {
  if (nthAppearance == null || nthAppearance < threshold) return { verb };
  const cierre = verb === 'COMPRAR' ? 'Degradado a OBSERVAR.' : 'Sin apuro: si fuera a despegar, ya lo habría hecho.';
  return {
    verb: verb === 'COMPRAR' ? 'OBSERVAR' : verb,
    caveat:
      `${nthAppearance}ª aparición en el top de Hoy. Los residentes crónicos (${threshold}ª o más) ` +
      `históricamente no tienen edge: 40% de aciertos y R −0.05 (n=260, abr–jul 2026), ` +
      `contra +0.3R de las apariciones frescas. ${cierre}`,
  };
}
