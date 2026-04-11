import { callAI } from '../shared/ai-router.js';
import { getLatestOpportunityScan } from '../db/repository.js';
import type { Opportunity } from '@trading/shared';

export interface ComparisonResult {
  winner: string;
  comparison: string;
  allocation: Record<string, number>;
  reasoning: string;
  perAsset: Array<{
    symbol: string;
    pros: string[];
    cons: string[];
  }>;
}

const COMPARE_PROMPT = `Sos un analista de inversiones comparando activos para un swing trader argentino.

Te doy fichas de 2-5 activos. Tu trabajo:
1. "winner": el ticker que MEJOR oportunidad tiene ahora para un swing trader (semanas a meses)
2. "comparison": 3-4 oraciones comparando los activos entre si. Cual tiene mejor R/R, cual tiene mas riesgo, cual tiene mejor momentum.
3. "allocation": objeto con % del presupuesto para cada ticker. Puede incluir "cash" si conviene esperar. Debe sumar 100.
4. "reasoning": 2-3 oraciones explicando POR QUE esa distribucion.
5. "perAsset": para cada activo, 2 pros y 2 cons concretos.

REGLAS:
- Si un activo tiene divergencias bajistas, NO puede ser el winner.
- Si un activo tiene divergencias alcistas + buen R/R, priorizarlo.
- Considerar: tecnico, fundamental, sentimiento, divergencias, R/R.
- Ser CONCRETO con numeros ($precios, %, ratios).

Responde SOLO con JSON:
{"winner":"...","comparison":"...","allocation":{"VIST":40,"YPF":60},"reasoning":"...","perAsset":[{"symbol":"VIST","pros":["..."],"cons":["..."]}]}`;

export async function compareAssets(symbols: string[], budget?: number): Promise<ComparisonResult> {
  // Load latest scan data
  const scanRow = getLatestOpportunityScan();
  if (!scanRow) throw new Error('No hay scan disponible. Ejecuta "Analizar" primero.');

  const opportunities: Opportunity[] = JSON.parse(scanRow.opportunities);

  // Build compact cards for requested symbols
  const cards: string[] = [];
  for (const symbol of symbols) {
    const opp = opportunities.find(o => o.symbol === symbol);
    if (!opp) {
      cards.push(`${symbol} | Sin datos — no fue analizado en el ultimo scan`);
      continue;
    }

    const parts = [`${symbol} | $${opp.currentPrice.toFixed(2)} | Action: ${opp.action} | Score: ${opp.opportunityScore} | Conf: ${opp.confidence}%`];

    if (opp.tradeLevels) {
      parts.push(`Levels: entry=$${opp.tradeLevels.entryPrice.toFixed(2)} stop=$${opp.tradeLevels.stopLoss.toFixed(2)} target=$${opp.tradeLevels.takeProfit.toFixed(2)} RR=1:${opp.tradeLevels.riskRewardRatio.toFixed(1)}`);
    }

    const divs = opp.divergences ?? [];
    if (divs.length > 0) {
      parts.push(`Divergencias: ${divs.map(d => `${d.type} ${d.indicator} ${d.timeframe}`).join(', ')}`);
    }

    if (opp.breakdown) {
      parts.push(`Tech: ${opp.breakdown.technical.score} | Fund: ${opp.breakdown.fundamental.score} | Sent: ${opp.breakdown.sentiment.score}`);
    }

    if (opp.inPortfolio) parts.push('EN PORTFOLIO');

    cards.push(parts.join('\n'));
  }

  const budgetNote = budget ? `\nPresupuesto: $${budget}` : '';
  const userMsg = cards.join('\n---\n') + budgetNote;

  const raw = await callAI('reasoning', userMsg, COMPARE_PROMPT, 4096);
  const parsed = JSON.parse(raw);

  return {
    winner: parsed.winner ?? symbols[0],
    comparison: parsed.comparison ?? '',
    allocation: parsed.allocation ?? {},
    reasoning: parsed.reasoning ?? '',
    perAsset: Array.isArray(parsed.perAsset) ? parsed.perAsset : [],
  };
}
