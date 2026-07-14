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

/** Filtra BUY/WATCH no tenidos, ordena por score desc y corta el top N. Devuelve las mismas filas que recibe. */
export function selectTodayProposals<T extends ProposalCandidate>(
  opps: T[],
  heldSet: Set<string>,
  limit: number = TODAY_PROPOSAL_LIMIT,
): T[] {
  return opps
    .filter((o) => !heldSet.has(o.symbol.toUpperCase()) && (o.action === 'BUY' || o.action === 'WATCH'))
    .sort((a, b) => b.opportunityScore - a.opportunityScore)
    .slice(0, limit);
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
