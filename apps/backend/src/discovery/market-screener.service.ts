/**
 * Orquestador del screener de mercado: fetch (Yahoo) → embudo barato (puro) → filtro de
 * tendencia (anti-hype) → validación técnica (setupQuality/RR) → registro en
 * discovered_symbols con source='screener'.
 *
 * Objetivo: el universo de scan no depende solo de watchlist + lo que menciona la prensa
 * (`discovery-registry.ts` con sources 'news'/'web_search'/'llm'; 'finnhub'/'yahoo' son legacy) — también entra lo que el
 * mercado entero está moviendo AHORA (most_actives/day_gainers/day_losers de Yahoo), filtrado
 * a candidatos con un setup técnico operable de verdad.
 *
 * Fail-closed en cada etapa: sin dato → afuera. Un símbolo cuyo `getTechnicalSummary` tira
 * (sin histórico, Yahoo caído, etc.) se descarta silenciosamente — no aborta el resto del
 * embudo. El loop es secuencial a propósito: son ≤`SCREENER_MAX_CANDIDATES` (default 40)
 * símbolos, ya acotados por el limiter global de Yahoo y el cache de históricos existente.
 */

import { fetchScreenerQuotes } from '../shared/yahoo-screener.js';
import { filterScreenerCandidates } from './market-screener.js';
import { getTechnicalSummary } from '../technical/technical-analysis.service.js';
import { computeTradeLevels } from '../opportunities/scoring.js';
import { registerNovelTickers } from './discovery-registry.js';
import { envNumber } from '../shared/env-number.js';

export interface MarketScreenerResult {
  candidates: number;
  /** Candidatos que pasaron el embudo completo (tendencia + setup técnico) — no implica que ya estén registrados. */
  operables: string[];
  /** Count real devuelto por registerNovelTickers — puede ser < operables.length (ya conocidos se filtran ahí). */
  registered: number;
}

export async function runMarketScreener(): Promise<MarketScreenerResult> {
  const minRR = envNumber('SCREENER_MIN_RR', 2);

  const quotes = await fetchScreenerQuotes();
  const cheap = filterScreenerCandidates(quotes);

  const operables: string[] = [];
  for (const c of cheap) {
    try {
      const tech = await getTechnicalSummary(c.symbol);
      // Alineado con el anti-hype strict: mismo chequeo de tendencia que el Filter 1 de
      // applyAntiHypeFilters (scoring.ts:696) — precio > SMA200. No reusamos esa función
      // directamente porque tolera 1 de 3 fallos (MAX_FAILURES) y acá no están los otros 2
      // filtros (RSI/volumen) para compensar un solo dato faltante — replicamos SOLO la
      // comparación de tendencia. Fail-closed: SMA200 ausente descarta (applyAntiHypeFilters,
      // en cambio, deja pasar el símbolo entero cuando no hay `tech`).
      const ind = tech.indicators;
      if (ind.sma200 == null || ind.currentPrice <= ind.sma200) continue;

      const levels = computeTradeLevels(tech, 'BUY');
      if (levels?.setupQuality === 'valid' && (levels.riskRewardRatio ?? 0) >= minRR) {
        operables.push(c.symbol);
      }
    } catch {
      // símbolo sin datos técnicos (histórico ausente, Yahoo caído): fuera, fail-closed.
    }
  }

  let registered = 0;
  if (operables.length > 0) {
    registered = await registerNovelTickers(operables, 'screener');
  }

  console.log(
    `[Screener] mercado: ${quotes.length} → embudo ${cheap.length} → operables ${operables.length} → registrados ${registered}: ${operables.slice(0, 10).join(', ')}`,
  );

  return { candidates: cheap.length, operables, registered };
}
