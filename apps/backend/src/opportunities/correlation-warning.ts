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

  // Decisión explícita para el caso multi-sector (ej. 3 BUY Energía + 3 BUY Tech a la vez):
  // reportar TODOS los sectores que alcanzan el umbral, no solo "el peor". Quedarse con uno
  // solo escondería un segundo riesgo real de concentración igual de grave. Se listan todos
  // en un único string (en vez de un warning por sector) para no inflar el array `warnings`
  // del digest, que ya tiene un límite de items mostrados.
  // Orden: conteo descendente; en empate, orden de aparición del sector dentro de `buys`
  // (Map conserva el orden de inserción) — es solo para que el output sea determinístico
  // dado un array de entrada fijo, NO representa ningún criterio de "sector más importante".
  const concentrated = [...countBySector.entries()]
    .filter(([, count]) => count >= MIN_CONCENTRATION)
    .sort((a, b) => b[1] - a[1]);

  if (concentrated.length === 0) return null;

  // Caso de un solo sector concentrado: se mantiene el string original (contrato existente
  // consumido río abajo / testeado desde hace rato).
  if (concentrated.length === 1) {
    const [sector, count] = concentrated[0];
    return `⚠ Concentración: ${count} de tus ${totalBuys} recomendaciones BUY son el mismo trade (sector ${sector}) — diversificá o tomá una sola.`;
  }

  const sectorList = concentrated.map(([sector, count]) => `${sector} (${count})`).join(', ');
  return `⚠ Concentración: tus ${totalBuys} recomendaciones BUY repiten el mismo trade en varios sectores — ${sectorList} — diversificá o tomá una sola por sector.`;
}
