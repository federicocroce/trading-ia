/**
 * Embudo PURO de candidatos del screener de mercado: de "todo lo que Yahoo lista como activo"
 * a un puñado operable. Anti-humo: descarta micro-caps, penny stocks, y lo que ya voló >X% hoy
 * (perseguir un pump/dump intradía en curso es la forma más rápida de comprar el techo).
 *
 * PURO — sin I/O. El fetch vive en `shared/yahoo-screener.ts` (Task 1 I/O) y el orquestador con
 * técnicos es Task 2. Esta función solo transforma datos ya obtenidos.
 */

import { meetsQualityBar } from '../opportunities/tradeability.js';
import { envNumber } from '../shared/env-number.js';

export interface ScreenerQuote {
  symbol: string;
  name: string;
  marketCap: number | null;
  price: number;
  volume: number;
  changePct: number;
}

export function filterScreenerCandidates(
  quotes: ScreenerQuote[],
  opts?: { maxDayMovePct?: number; maxCandidates?: number },
): ScreenerQuote[] {
  const maxDayMovePct = opts?.maxDayMovePct ?? envNumber('SCREENER_MAX_DAY_MOVE_PCT', 15);
  const maxCandidates = opts?.maxCandidates ?? envNumber('SCREENER_MAX_CANDIDATES', 40);

  const seen = new Set<string>();
  const deduped: ScreenerQuote[] = [];
  for (const quote of quotes) {
    if (seen.has(quote.symbol)) continue;
    seen.add(quote.symbol);
    deduped.push(quote);
  }

  const filtered = deduped.filter((quote) => {
    if (!meetsQualityBar({ marketCap: quote.marketCap, currentPrice: quote.price, instrumentType: 'accion' })) {
      return false;
    }
    if (Math.abs(quote.changePct) > maxDayMovePct) return false;
    return true;
  });

  return filtered
    .sort((a, b) => b.volume - a.volume)
    .slice(0, maxCandidates);
}
