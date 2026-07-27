/**
 * Selección pura de los "Candidatos operables" de Hoy + reglas medidas de degradación.
 *
 * Compartida entre la vista (today-decisions.service), el registro post-scan
 * (opportunities.service → persistScanResult) y el backfill, para que lo guardado sea
 * EXACTAMENTE lo mostrado — fuente única, sin doble discurso.
 *
 * ────────────────────────────────────────────────────────────────────────────
 * CAMBIO 2026-07-27 — se apagó el ranking (test de atribución, prompt maestro §4).
 *
 * Medido contra sortear del MISMO universo que el sistema escanea, con horizonte fijo
 * y test pareado por fecha:
 *   top-6 por score vs azar : −0.79% (t=−1.50) a 7d ; −1.48% (t=−1.63) a 30d
 *   rankear dentro del piso : −0.75% (t=−2.22, SIGNIF) a 7d
 * O sea: ordenar por score es indistinguible del azar y se inclina a destruir valor.
 * Mostrar un "top-6 ordenado" comunicaba una jerarquía que no existe.
 *
 * Qué se apagó: el orden por score, el corte en 6, y el verbo COMPRAR (que sugería
 * una recomendación de fuerza que la medición no sostiene).
 * Qué se conservó: los FILTROS (quality bar, anti-hype, setup válido) y las dos reglas
 * de degradación que SÍ tienen medición propia (crónico y stop perforado, abajo).
 * El score se sigue calculando y persistiendo para poder re-medirlo; solo deja de
 * ordenar y de mostrarse.
 *
 * Qué NO se apagó y por qué: la separación BUY vs WATCH del motor. NO es un ranking de
 * fuerza — es un hecho verificable sobre el estado del papel HOY: BUY = tiene setup de
 * entrada válido (entrada/stop/target coherentes, RR≥2); WATCH = todavía no. Colapsarlas
 * fue un error de diseño que se probó y se revirtió el mismo día: el scan típico trae
 * ~5 BUY y ~99 WATCH, así que la vista mostraba 101 tarjetas rotuladas "operable" cuando
 * 99 no tenían punto de entrada — precisamente el humo que el objetivo #3 prohíbe.
 * ⚠️ Disclosure obligatoria en la UI: tener setup válido NO midió mejor retorno que no
 * tenerlo (COMPRAR +1.01% t=0.59 vs OBSERVAR +4.48% t=2.22 contra SPY). La separación es
 * de ACCIONABILIDAD, no de calidad esperada, y así hay que mostrarla.
 * ────────────────────────────────────────────────────────────────────────────
 *
 * Evidencia del residente crónico (signal_tracking × opportunity_scans, abr–jul 2026):
 *   1ª aparición:  win rate 53.6%, R prom +0.28 (n=110)
 *   2ª–3ª:         win rate 50.0%, R prom +0.31 (n=118)
 *   4ª o más:      win rate 40.4%, R prom −0.05 (n=260)
 * Desde el umbral, OPERABLE pasa a EN ESPERA. Solo degrada, jamás sube — misma
 * dirección que el gate del LLM (applyLlmAction).
 */
import { envNumber } from '../shared/env-number.js';

/**
 * Verbo del mercado. NO es una escala de fuerza esperada, es el ESTADO del papel hoy:
 *   - `OPERABLE`       — tiene setup de entrada válido ahora (motor: BUY).
 *   - `EN SEGUIMIENTO` — sin punto de entrada todavía (motor: WATCH).
 *   - `EN ESPERA`      — una regla MEDIDA lo marcó (crónico o stop perforado).
 * Entre dos del mismo estado NO hay preferencia: el sistema no sabe cuál es mejor y no
 * finge saberlo. Y tener setup válido tampoco midió mejor retorno (ver cabecera).
 */
export type MarketVerb = 'OPERABLE' | 'EN SEGUIMIENTO' | 'EN ESPERA';

export interface ProposalCandidate {
  symbol: string;
  action: string; // BUY | SELL | HOLD | WATCH
  opportunityScore: number;
}

/**
 * Filtra a BUY/WATCH no tenidos y devuelve TODO lo elegible en orden alfabético.
 *
 * Sin corte y sin orden por score, a propósito (ver cabecera): cualquier "top-N" es la
 * operación exactamente refutada por el test de atribución. El orden alfabético es
 * neutral por construcción — no admite lectura de preferencia.
 *
 * INVARIANTE (regla #4, coherencia): ningún BUY del motor queda fuera de Hoy — "Hoy" es
 * la ÚNICA superficie de decisión y no puede decir "nada para comprar" mientras
 * Oportunidades muestra un BUY. Ahora se cumple trivialmente: no hay corte que lo saque.
 */
export function selectTodayProposals<T extends ProposalCandidate>(
  opps: T[],
  heldSet: Set<string>,
): T[] {
  return opps
    .filter((o) => !heldSet.has(o.symbol.toUpperCase()) && (o.action === 'BUY' || o.action === 'WATCH'))
    .sort((a, b) => a.symbol.localeCompare(b.symbol));
}

/**
 * Estado base del candidato: si el motor le encontró setup de entrada válido hoy o no.
 * Es un HECHO sobre el papel, no una recomendación de fuerza — el verbo COMPRAR se apagó
 * justamente porque sugería lo segundo (prompt maestro §4).
 */
export function verbFor(action: string): MarketVerb {
  return action === 'BUY' ? 'OPERABLE' : 'EN SEGUIMIENTO';
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

/**
 * Arbitraje tesis vs scan cuando una tesis gatillada aparece en Hoy (regla #4, coherencia):
 * las voces pueden diferir, pero el ranking es explícito — el veredicto del scan MANDA,
 * la tesis es opinión. Solo hay conflicto real cuando apuntan en direcciones opuestas
 * (alcista vs VENDER/REVISAR; bajista vs OPERABLE). Neutralidad o ausencia ≠ conflicto.
 */
export function thesisConflictCaveat(direction: string, scanVerb: string | null): string | null {
  if (scanVerb == null) return null;
  const conflictoAlcista = direction === 'alcista' && (scanVerb === 'VENDER' || scanVerb === 'REVISAR');
  const conflictoBajista = direction === 'bajista' && scanVerb === 'OPERABLE';
  if (!conflictoAlcista && !conflictoBajista) return null;
  return (
    `La tesis (${direction}) contradice al scan técnico (${scanVerb}). Jerarquía del sistema: ` +
    `el scan manda — la tesis es opinión LLM y queda registrada para medir quién tenía razón.`
  );
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
 * discurso. OPERABLE pasa a EN ESPERA (jamás al revés) y cualquier verbo lleva caveat.
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
  const cierre = verb === 'OPERABLE' ? 'Pasa a EN ESPERA.' : 'Esperá a que arme setup nuevo por encima del stop.';
  return {
    verb: 'EN ESPERA',
    caveat:
      `Precio (${currentPrice.toFixed(2)}) por debajo del stop ${recentMaxStop.toFixed(2)} que el propio sistema ` +
      `fijó hace días. Comprar bajo un stop perforado midió 32% de aciertos y R −0.15 (n=91, abr–jul 2026) ` +
      `contra 41% / +0.04R del resto. ${cierre}`,
  };
}

/**
 * Regla del residente crónico: nthAppearance >= umbral ⇒ OPERABLE pasa a EN ESPERA
 * (jamás al revés) y cualquier verbo lleva caveat. nth null = dato faltante ⇒ no se
 * inventa nada (fail-closed).
 */
export function chronicAdjustment(
  verb: MarketVerb,
  nthAppearance: number | null,
  threshold: number = chronicThreshold(),
): ChronicAdjustment {
  if (nthAppearance == null || nthAppearance < threshold) return { verb };
  const cierre = verb === 'OPERABLE' ? 'Pasa a EN ESPERA.' : 'Sin apuro: si fuera a despegar, ya lo habría hecho.';
  return {
    verb: 'EN ESPERA',
    caveat:
      `${nthAppearance}ª aparición en Hoy. Los residentes crónicos (${threshold}ª o más) ` +
      `históricamente no tienen edge: 40% de aciertos y R −0.05 (n=260, abr–jul 2026), ` +
      `contra +0.3R de las apariciones frescas. ${cierre}`,
  };
}
