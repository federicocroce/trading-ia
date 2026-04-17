import type {
  Opportunity,
  SecondOrderEffect,
  SectorSummary,
  MarketDigest,
  QuantContext,
} from '@trading/shared';
import { DAILY_MARKET_DIGEST_PROMPT } from '@trading/shared';
import { callAI } from '../shared/ai-router.js';
import { getPortfolioPositions } from '../db/repository.js';

// --- Daily Market Digest (1 LLM call) ---

interface NewsIntelligence {
  totalNewsCount: number;
  topHeadlines?: string[];
  plazaSummaries?: Array<{ plaza: string; sentiment: string; score: number }>;
}

export async function generateDailyDigest(
  opportunities: Opportunity[],
  secondOrderEffects: SecondOrderEffect[],
  intelligence: NewsIntelligence,
  sectorSummary: SectorSummary[],
  quantContext?: QuantContext | null,
): Promise<MarketDigest | null> {
  const topBuySell = opportunities
    .filter(o => o.action === 'BUY' || o.action === 'SELL')
    .slice(0, 5);

  // Portfolio positions in HOLD/WATCH — explicit context for portfolioImpact
  const positions = getPortfolioPositions();
  const portfolioSymbolSet = new Set(positions.map(p => p.symbol));
  const portfolioHold = opportunities.filter(
    o => portfolioSymbolSet.has(o.symbol) && (o.action === 'HOLD' || o.action === 'WATCH'),
  );

  // Build context
  const parts: string[] = [];

  // Headlines
  const headlines = intelligence.topHeadlines ?? [];
  if (headlines.length > 0) {
    parts.push(`NOTICIAS RECIENTES (${intelligence.totalNewsCount} total):\n${headlines.slice(0, 8).join('\n')}`);
  }

  // Second order effects
  if (secondOrderEffects.length > 0) {
    parts.push(`EFECTOS DE SEGUNDO ORDEN:\n${secondOrderEffects.map(e =>
      `- ${e.triggerEvent}: ${e.causalChain.join(' → ')} [${e.impactDirection}] (${e.affectedTickers.join(', ')})`
    ).join('\n')}`);
  }

  // Sector overview
  parts.push(`SECTORES:\n${sectorSummary.map(s =>
    `${s.label}: score ${s.avgScore}, ${s.symbolCount} activos, top: ${s.topOpportunity ?? 'ninguno'}`
  ).join('\n')}`);

  // Top opportunities with details
  if (topBuySell.length > 0) {
    parts.push(`TOP OPORTUNIDADES:\n${topBuySell.map(o => {
      let line = `${o.symbol} (${o.action}): score ${o.opportunityScore}, confianza ${o.confidence}%`;
      if (o.tradeLevels) {
        line += ` | Entry $${o.tradeLevels.entryPrice.toFixed(2)}, Stop $${o.tradeLevels.stopLoss.toFixed(2)}, Target $${o.tradeLevels.takeProfit.toFixed(2)}`;
        if (o.tradeLevels.suggestedQuantity) line += ` | ${o.tradeLevels.suggestedQuantity} acciones (~$${o.tradeLevels.suggestedAmount})`;
      }
      if (o.signalConflicts && o.signalConflicts.length > 0) {
        line += ` | CONFLICTOS: ${o.signalConflicts.map(c => `${c.signalA} vs ${c.signalB}`).join(', ')}`;
      }
      return line;
    }).join('\n')}`);
  }

  // Portfolio HOLD/WATCH — always include for portfolioImpact context
  if (portfolioHold.length > 0) {
    parts.push(`PORTFOLIO EN HOLD/WATCH:\n${portfolioHold.map(o => {
      const pos = positions.find(p => p.symbol === o.symbol);
      let line = `${o.symbol} (${o.action}): score ${o.opportunityScore}`;
      if (pos) {
        const pnl = ((o.currentPrice - pos.avgCost) / pos.avgCost * 100).toFixed(1);
        line += ` | ${pos.quantity.toFixed(0)} acc @$${pos.avgCost.toFixed(2)} P&L ${pnl}%`;
      }
      if (o.tradeLevels) {
        line += ` | Stop sugerido $${o.tradeLevels.stopLoss.toFixed(2)}`;
      }
      return line;
    }).join('\n')}`);
  }

  // Regime context (if available)
  if (quantContext?.regime && quantContext.regime.regime !== 'unknown') {
    const r = quantContext.regime;
    const regimeLabel: Record<string, string> = {
      trending_bull: 'Tendencia alcista',
      trending_bear: 'Tendencia bajista',
      mean_reverting: 'Mercado lateral/oscilante',
      volatile: 'Alta volatilidad',
    };
    parts.push(
      `RÉGIMEN DE MERCADO: ${regimeLabel[r.regime] ?? r.regime} (confianza: ${r.confidence}%)\n` +
      `${r.indicators.trendConsistency}% de activos sobre SMA200, momentum ${r.indicators.spyMomentum > 0 ? '+' : ''}${r.indicators.spyMomentum}`
    );
  }

  // Top momentum movers (if available)
  if (quantContext?.momentumRankings && quantContext.momentumRankings.length >= 3) {
    const top3 = quantContext.momentumRankings.slice(0, 3).map(m => `${m.symbol}(+${m.relativeStrength}%)`).join(', ');
    const bot3 = quantContext.momentumRankings.slice(-3).map(m => `${m.symbol}(${m.relativeStrength}%)`).join(', ');
    parts.push(`TOP MOMENTUM: ${top3} | MENOR MOMENTUM: ${bot3}`);
  }

  const userMessage = parts.join('\n\n');

  try {
    const response = await callAI('narrative', userMessage, DAILY_MARKET_DIGEST_PROMPT, 4096);
    const parsed = JSON.parse(response);

    return {
      generatedAt: Date.now(),
      overnightSummary: parsed.overnightSummary ?? '',
      portfolioImpact: parsed.portfolioImpact ?? '',
      topOpportunities: Array.isArray(parsed.topOpportunities)
        ? parsed.topOpportunities.slice(0, 5).map((o: any) => ({
            symbol: o.symbol ?? '',
            action: o.action ?? 'BUY',
            narrative: o.narrative ?? '',
          }))
        : [],
      warnings: Array.isArray(parsed.warnings) ? parsed.warnings.slice(0, 3) : [],
      marketMood: ['risk-on', 'risk-off', 'mixed'].includes(parsed.marketMood)
        ? parsed.marketMood
        : 'mixed',
      wouldDo: Array.isArray(parsed.wouldDo) ? parsed.wouldDo.slice(0, 5) : [],
      wouldNotDo: Array.isArray(parsed.wouldNotDo) ? parsed.wouldNotDo.slice(0, 5) : [],
    };
  } catch (err) {
    console.warn('[MarketDigest] Daily digest LLM fallo, usando fallback:', err);
    return buildFallbackDigest(opportunities, secondOrderEffects, headlines);
  }
}

function buildFallbackDigest(
  opportunities: Opportunity[],
  effects: SecondOrderEffect[],
  headlines: string[],
): MarketDigest {
  const topBuy = opportunities.filter(o => o.action === 'BUY').slice(0, 3);
  const buyCount = opportunities.filter(o => o.action === 'BUY').length;
  const sellCount = opportunities.filter(o => o.action === 'SELL').length;

  return {
    generatedAt: Date.now(),
    overnightSummary: headlines.length > 0
      ? headlines.slice(0, 3).join('. ') + '.'
      : 'Sin noticias relevantes recientes.',
    portfolioImpact: effects.length > 0
      ? effects.slice(0, 2).map(e => e.reasoning).join(' ')
      : 'Sin efectos de segundo orden identificados.',
    topOpportunities: topBuy.map(o => ({
      symbol: o.symbol,
      action: 'BUY' as const,
      narrative: o.simpleReasoning ?? o.reasoning,
    })),
    warnings: opportunities
      .filter(o => o.action === 'SELL')
      .slice(0, 2)
      .map(o => `${o.symbol}: ${o.risks[0] ?? 'senales negativas'}`),
    marketMood: buyCount > sellCount * 2 ? 'risk-on' : sellCount > buyCount ? 'risk-off' : 'mixed',
    wouldDo: topBuy.map(o => `Compraria ${o.symbol} — ${o.simpleReasoning ?? o.catalysts[0] ?? 'buena oportunidad'}`),
    wouldNotDo: opportunities
      .filter(o => o.action === 'SELL')
      .slice(0, 3)
      .map(o => `No mantendria ${o.symbol} — ${o.simpleReasoning ?? o.risks[0] ?? 'senales negativas'}`),
  };
}
