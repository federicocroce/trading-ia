import type { DigestRecommendation, SignalAction } from '@trading/shared';

/**
 * Projects the scan's opportunities into the digest's recommendation blocks. The engine
 * owns the action, the numbers and the motivo; the LLM never touches these. This is the
 * single source of truth that makes the digest agree with the scan by construction:
 * a HOLD/WATCH can no longer appear as a buy, and only a real BUY carries trade levels.
 *
 * The input is structurally a subset of `Opportunity`, so the full scan result satisfies it.
 */
export interface RecommendationSource {
  symbol: string;
  action: SignalAction;
  currentPrice: number;
  opportunityScore: number;
  inPortfolio: boolean;
  simpleReasoning?: string;
  reasoning?: string;
  catalysts?: string[];
  risks?: string[];
  tradeLevels?: { entryPrice: number; stopLoss: number; takeProfit: number };
}

// Portfolio: surface what needs attention first. SELL (get out) > BUY (add) > WATCH (caution) > HOLD (steady).
const PORTFOLIO_ORDER: Record<SignalAction, number> = { SELL: 0, BUY: 1, WATCH: 2, HOLD: 3 };
// Mercado (non-owned): opportunities first, then radar, then avoid. HOLD is meaningless here.
const MARKET_ORDER: Record<SignalAction, number> = { BUY: 0, WATCH: 1, SELL: 2, HOLD: 99 };

function pickReason(o: RecommendationSource): string {
  return (
    o.simpleReasoning?.trim() ||
    o.reasoning?.trim() ||
    o.catalysts?.find((c) => c?.trim())?.trim() ||
    o.risks?.find((r) => r?.trim())?.trim() ||
    ''
  );
}

function toRecommendation(o: RecommendationSource): DigestRecommendation {
  const rec: DigestRecommendation = {
    symbol: o.symbol,
    action: o.action,
    reason: pickReason(o),
    currentPrice: o.currentPrice,
    score: o.opportunityScore,
  };
  // Only a real BUY gets entry/stop/target — a hold/observar must never look like a setup.
  if (o.action === 'BUY' && o.tradeLevels) rec.tradeLevels = o.tradeLevels;
  return rec;
}

export function buildDigestRecommendations(
  opps: RecommendationSource[],
  opts: { portfolioLimit?: number; marketLimit?: number } = {},
): { portfolioRecommendations: DigestRecommendation[]; marketRecommendations: DigestRecommendation[] } {
  const { portfolioLimit = 12, marketLimit = 6 } = opts;

  const portfolioRecommendations = opps
    .filter((o) => o.inPortfolio)
    .sort((a, b) => (PORTFOLIO_ORDER[a.action] - PORTFOLIO_ORDER[b.action]) || (b.opportunityScore - a.opportunityScore))
    .slice(0, portfolioLimit)
    .map(toRecommendation);

  const marketRecommendations = opps
    .filter((o) => !o.inPortfolio && o.action !== 'HOLD')
    .sort((a, b) => (MARKET_ORDER[a.action] - MARKET_ORDER[b.action]) || (b.opportunityScore - a.opportunityScore))
    .slice(0, marketLimit)
    .map(toRecommendation);

  return { portfolioRecommendations, marketRecommendations };
}

/** Marca las filas cuyo símbolo tiene alerta anticipatoria activa — un solo discurso, chip ⚡. */
export function flagAlertedRecommendations(
  recs: DigestRecommendation[],
  alertedSymbols: Set<string>,
): DigestRecommendation[] {
  return recs.map(r => alertedSymbols.has(r.symbol.toUpperCase()) ? { ...r, anticipatoryAlert: true } : r);
}

/** Marca las filas cuyo símbolo re-armó su setup (ayer invalid → hoy operable) — badge "SETUP OPERABLE". */
export function flagRearmedRecommendations(
  recs: DigestRecommendation[],
  rearmedSymbols: Set<string>,
): DigestRecommendation[] {
  return recs.map(r => rearmedSymbols.has(r.symbol.toUpperCase()) ? { ...r, rearmAlert: true } : r);
}

/**
 * Un símbolo con alerta activa (anticipatoria o re-armado) jamás puede aparecer en avoidList —
 * sería el mismo doble discurso: "evitar X" al lado de "X volvió a ser operable".
 * `rearmedSymbols` es opcional/aditivo (default vacío) para no romper llamadas existentes.
 */
export function filterAvoidVsAlerts(
  items: string[],
  alertedSymbols: Set<string>,
  rearmedSymbols: Set<string> = new Set(),
): string[] {
  if (alertedSymbols.size === 0 && rearmedSymbols.size === 0) return items;
  const excluded = new Set([...alertedSymbols, ...rearmedSymbols]);
  return items.filter(item => {
    const upper = item.toUpperCase();
    for (const sym of excluded) {
      const escaped = sym.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      if (new RegExp(`\\b${escaped}\\b`).test(upper)) {
        console.warn(`[digest] avoidList descartó "${item.slice(0, 50)}" — ${sym} tiene alerta anticipatoria o de re-armado activa`);
        return false;
      }
    }
    return true;
  });
}
