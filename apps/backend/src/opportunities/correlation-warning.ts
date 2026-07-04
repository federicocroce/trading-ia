import type { SignalAction } from '@trading/shared';

/**
 * Entrada mínima para detectar concentración de sector. Se define un tipo propio
 * (no `Opportunity`/`DigestRecommendation` completos) para que la función sea pura
 * y trivial de testear sin mocks — el caller cruza el campo `sector` legible
 * (p. ej. `sectorLabel` de `Opportunity`) al armar este array.
 *
 * `sector` es opcional: en runtime puede no haberse podido determinar. Fail-closed:
 * un candidato sin sector conocido NUNCA participa de un grupo (ni siquiera bajo una
 * clave "undefined" común) — evita inflar artificialmente la concentración detectada.
 */
export interface ConcentrationCandidate {
  symbol: string;
  sector?: string;
  action: SignalAction;
}

/** A partir de 3 BUYs del mismo sector, el digest está proponiendo el mismo trade repetido. */
const MIN_CONCENTRATION = 3;

/**
 * "No proponer 4 veces el mismo trade": si 3+ recomendaciones BUY del digest comparten
 * sector, el usuario está viendo el mismo riesgo repetido con distinto ticker (caso real:
 * PAM + YPF + VIST son todos "Argentina/Energía" aunque parezcan 3 ideas distintas).
 * Pura — sin I/O — solo observa el array ya armado, no decide qué recomendar.
 * Devuelve `null` si no hay concentración (nada que avisar).
 */
export function detectConcentrationWarning(recs: ConcentrationCandidate[]): string | null {
  const buys = recs.filter(r => r.action === 'BUY');
  const totalBuys = buys.length;

  const countBySector = new Map<string, number>();
  for (const r of buys) {
    if (!r.sector) continue; // fail-closed: sin sector conocido, no cuenta para ningún grupo
    countBySector.set(r.sector, (countBySector.get(r.sector) ?? 0) + 1);
  }

  // El sector más concentrado (si hay empate, cualquiera de los máximos sirve — el
  // mensaje es igual de válido para todos).
  let worstSector: string | null = null;
  let worstCount = 0;
  for (const [sector, count] of countBySector) {
    if (count > worstCount) {
      worstSector = sector;
      worstCount = count;
    }
  }

  if (!worstSector || worstCount < MIN_CONCENTRATION) return null;

  return `⚠ Concentración: ${worstCount} de tus ${totalBuys} recomendaciones BUY son el mismo trade (sector ${worstSector}) — diversificá o tomá una sola.`;
}
