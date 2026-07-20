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
import { registerNovelTickers, getDiscoveredTickers } from './discovery-registry.js';
import { getPortfolioPositions, getLiveWatchlistItems } from '../db/repository.js';

// El import con `with { type: 'json' }` rompe el proyecto composite de tsc
// (TS6307: el JSON no está listado en el file list del tsconfig). readFileSync
// + JSON.parse evita el problema y sigue resolviendo relativo a este módulo.
const universe = JSON.parse(
  readFileSync(new URL('./sweep-universe.json', import.meta.url), 'utf-8'),
) as string[];

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
  const cap = envNumber('SWEEP_MAX_CANDIDATES', 15);

  // Excluir lo que el sistema ya mira: portfolio, descubiertos activos, watchlist viva.
  const already = new Set<string>([
    ...getPortfolioPositions().map((p) => p.symbol),
    ...getDiscoveredTickers().map((s) => s.symbol),
    ...getLiveWatchlistItems().map((i) => i.symbol),
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
