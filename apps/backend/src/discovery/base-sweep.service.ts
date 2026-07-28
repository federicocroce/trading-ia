/**
 * Barrido semanal de bases: recorre el S&P500 estático buscando acciones
 * haciendo piso silencioso (detectBase) que noticias y screener de movers no
 * ven. Los hallazgos entran como source='base_sweep' — caño medible en
 * signal_tracking. Corre sábados (mercado cerrado, cola Yahoo libre).
 */
import { readFileSync } from 'node:fs';
import { getHistoricalQuotes } from '../shared/yahoo.js';
import { envNumber } from '../shared/env-number.js';
import { detectBase, type BaseDetection } from './base-detector.js';
import { readUniverse, universeAgeDays } from './sweep-universe.js';
import { registerNovelTickers, getDiscoveredTickers } from './discovery-registry.js';
import { getPortfolioPositions, getLiveWatchlistItems, getActiveSymbolList } from '../db/repository.js';

// El import con `with { type: 'json' }` rompe el proyecto composite de tsc
// (TS6307: el JSON no está listado en el file list del tsconfig). readFileSync
// + JSON.parse evita el problema y sigue resolviendo relativo a este módulo.
// `readUniverse` acepta el formato nuevo ({capturedAt, symbols}) y el viejo (array plano).
const universeFile = readUniverse(
  JSON.parse(readFileSync(new URL('./sweep-universe.json', import.meta.url), 'utf-8')),
);
const universe = universeFile?.symbols ?? [];
const universeCapturedAt = universeFile?.capturedAt ?? null;

/**
 * A partir de acá el universo se considera podrido y hay que regenerarlo
 * (`npm run db:refresh-universe`). El S&P rota ~20-25 componentes al año: a los 180 días
 * ya hay ~10 símbolos que no pertenecen y otros tantos faltando. No aborta el barrido —
 * un universo viejo sigue sirviendo— pero deja de pudrirse en silencio, que era el problema.
 */
const UNIVERSE_STALE_DAYS = 180;

/** Selección pura: bases rankeadas por strength, cap de candidatos. */
export function selectSweepCandidates(
  results: Array<{ symbol: string; detection: BaseDetection }>,
  cap: number,
): string[] {
  return results
    .filter((r) => r.detection.isBase)
    .sort((a, b) => b.detection.strength - a.detection.strength)
    .slice(0, cap)
    .map((r) => r.symbol);
}

export async function runBaseSweep(): Promise<{
  scanned: number; failures: number; candidates: string[]; registered: number; aborted: boolean;
}> {
  // 15 → 30 el 2026-07-27: en la única corrida real del barrido registró 11 de 15, o sea
  // el cap ataba. Con la nominación por prensa apagada quedan slots libres en el cap global
  // de descubiertos (estaba en 133 activos sobre 120), así que el sweep puede aportar más.
  const cap = envNumber('SWEEP_MAX_CANDIDATES', 30);

  // Antigüedad del universo a la vista en cada corrida (ver UNIVERSE_STALE_DAYS).
  const edad = universeAgeDays(universeCapturedAt, new Date());
  if (edad == null) {
    console.warn('[BaseSweep] ⚠️ el universo no declara fecha de captura — correr: npm run db:refresh-universe');
  } else if (edad > UNIVERSE_STALE_DAYS) {
    console.warn(`[BaseSweep] ⚠️ universo capturado hace ${edad} días (>${UNIVERSE_STALE_DAYS}) — regenerar: npm run db:refresh-universe`);
  } else {
    console.log(`[BaseSweep] universo: ${universe.length} símbolos, capturado hace ${edad} días`);
  }

  // Excluir lo que el sistema ya mira: portfolio, descubiertos activos, watchlist viva,
  // y la tabla symbols completa (mismo getter que registerNovelTickers usa para su
  // known-check) — sin esto, candidatos ya conocidos consumían slots del cap y se
  // descartaban recién en el registro (corrida real: 13 registrados de 15).
  const already = new Set<string>([
    ...getPortfolioPositions().map((p) => p.symbol),
    ...getDiscoveredTickers().map((s) => s.symbol),
    ...getLiveWatchlistItems().map((i) => i.symbol),
    ...getActiveSymbolList(),
  ]);
  const targets = universe.filter((s) => !already.has(s));

  // SPY primero: sin benchmark no hay RS → sin barrido (fail-closed).
  const spy = await getHistoricalQuotes('SPY', '1y', '1d');
  if (spy.length < 220) {
    console.warn('[BaseSweep] SPY insuficiente — abortando barrido');
    return { scanned: 0, failures: 0, candidates: [], registered: 0, aborted: true };
  }
  const spyCloses = spy.map((c) => c.close);

  const results: Array<{ symbol: string; detection: BaseDetection }> = [];
  let failures = 0;
  // Secuencial a propósito: ~500 fetches respetando la cola global de Yahoo.
  for (const symbol of targets) {
    try {
      const bars = await getHistoricalQuotes(symbol, '1y', '1d');
      results.push({ symbol, detection: detectBase(bars, spyCloses) });
    } catch {
      failures++;
    }
  }

  // Fail-closed: si falló más de la mitad, los "hallazgos" son sesgo de qué
  // respondió Yahoo, no del mercado — no registrar nada.
  if (failures > targets.length / 2) {
    console.warn(`[BaseSweep] ${failures}/${targets.length} fetches fallaron — abortando sin registrar`);
    return { scanned: results.length, failures, candidates: [], registered: 0, aborted: true };
  }

  const candidates = selectSweepCandidates(results, cap);
  const registered = candidates.length > 0 ? await registerNovelTickers(candidates, 'base_sweep') : 0;
  console.log(`[BaseSweep] ${results.length} escaneados, ${failures} fallos → ${candidates.length} bases → ${registered} registrados: ${candidates.join(', ')}`);
  return { scanned: results.length, failures, candidates, registered, aborted: false };
}
