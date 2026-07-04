import type { SignalAction } from '@trading/shared';
import { envNumber } from '../shared/env-number.js';

/**
 * Subset estructural de Opportunity que necesita el detector. El scan completo lo satisface
 * (mismo patrón que AlertSource en anticipatory-alerts.ts / RecommendationSource en digest-recommendations).
 */
export interface RearmSource {
  symbol: string;
  action?: SignalAction;
  opportunityScore: number;
  currentPrice: number;
  tradeLevels?: { entryPrice: number; stopLoss: number; takeProfit: number; setupQuality?: 'valid' | 'invalid' };
}

export interface RearmCandidate {
  symbol: string;
  entryPrice: number;
  stopLoss: number;
  takeProfit: number;
  score: number;
}

/**
 * Detecta símbolos cuyo setup de riesgo estaba invalid ayer (día del scan previo, no
 * necesariamente "ayer" literal — fines de semana/feriados saltan días) y hoy volvió a ser
 * operable (valid) con veredicto BUY/WATCH y score suficiente. Pura: sin I/O, testeable sin mocks.
 */
export function detectRearmedSetups(
  today: RearmSource[],
  yesterdayInvalid: Set<string>,
): RearmCandidate[] {
  const minScore = envNumber('REARM_MIN_SCORE', 55);
  const out: RearmCandidate[] = [];

  for (const opp of today) {
    if (!yesterdayInvalid.has(opp.symbol)) continue; // sin transición invalid→valid, no hay re-armado
    if (opp.tradeLevels?.setupQuality !== 'valid') continue; // hoy sigue invalid o sin tradeLevels
    if (opp.action !== 'BUY' && opp.action !== 'WATCH') continue;
    if (opp.opportunityScore < minScore) continue;

    out.push({
      symbol: opp.symbol,
      entryPrice: opp.tradeLevels.entryPrice,
      stopLoss: opp.tradeLevels.stopLoss,
      takeProfit: opp.tradeLevels.takeProfit,
      score: opp.opportunityScore,
    });
  }

  return out;
}
