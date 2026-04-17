import type {
  Opportunity,
  TechnicalSummary,
  FundamentalSummary,
  SecondOrderEffect,
  SectorSummary,
  MarketDigest,
  DeepAnalysis,
  QuantContext,
} from '@trading/shared';
import { NARRATIVE_DIGEST_PROMPT, DAILY_MARKET_DIGEST_PROMPT } from '@trading/shared';
import { callAI } from '../shared/ai-router.js';
import { getPortfolioPositions } from '../db/repository.js';
import type { SentimentInput } from '../opportunities/scoring.js';

// ============================================================
// DEEP ANALYSIS (per-asset, DeepSeek R1 for portfolio, Groq for rest)
// ============================================================

const DEEP_ANALYSIS_PROMPT = `IMPORTANTE: Responde EXCLUSIVAMENTE en español. Todos los textos (positives, concerns, recommendation, wouldDo, wouldNotDo) deben estar en español. Prohibido usar inglés.

Sos un analista de inversiones senior asesorando a un swing trader argentino con 4 anios de experiencia. Opera CEDEARs, acciones US, ETFs y crypto. Horizonte: semanas a meses. Busca anticiparse al mercado.

Te doy fichas tecnicas compactas de varios activos. Para CADA uno genera un analisis completo:

1. "positives": 3-5 puntos a favor con DATOS CONCRETOS (no genericos). Menciona numeros: RSI, P/E, %, $precios.
2. "concerns": 2-4 senales de alerta con DATOS CONCRETOS. Si hay divergencias, explicar que significan. Si hay Death Cross proximo, mencionarlo.
3. "recommendation": 3-4 oraciones con accion CLARA. Incluir CONDICIONES: "si el precio llega a $X → hacer Y". "si la divergencia se resuelve → hacer Z".
4. "wouldDo": 2-3 acciones concretas con precios. Ej: "Stop mental en $41.50 — si toca, salir sin pensar"
5. "wouldNotDo": 2-3 cosas a evitar con razon. Ej: "No comprar mas ahora — tecnico debil y viene Death Cross"

REGLAS:
- Cada analisis debe ser UNICO y ESPECIFICO al activo. No frases genericas.
- Si el activo esta en portfolio, mencionar la ganancia/perdida y si conviene protegerla.
- Si tiene divergencias bajistas, NUNCA recomendar comprar. Recomendar vender o esperar.
- Si tiene divergencias alcistas, destacar el potencial de rebote.
- Usar lenguaje coloquial pero profesional. Como un colega trader experimentado.
- Mencionar siempre entry, stop, target cuando aplique.

Responde SOLO con JSON:
{"analyses":[{"symbol":"GGAL","positives":["..."],"concerns":["..."],"recommendation":"...","wouldDo":["..."],"wouldNotDo":["..."]}]}`;

function buildAssetCard(opp: Opportunity, tech?: TechnicalSummary, fund?: FundamentalSummary, sent?: SentimentInput): string {
  const lines: string[] = [];
  const ind = tech?.indicators;
  const f = fund?.data;
  const w = tech?.weekly;
  const divs = opp.divergences ?? [];
  const levels = opp.tradeLevels;

  // Header
  const positions = getPortfolioPositions();
  const pos = positions.find(p => p.symbol === opp.symbol);
  let header = `${opp.symbol} | $${opp.currentPrice.toFixed(2)}`;
  if (pos) {
    const pnl = ((opp.currentPrice - pos.avgCost) / pos.avgCost * 100).toFixed(1);
    header += ` | Portfolio: ${pos.quantity.toFixed(0)} acc, costo $${pos.avgCost.toFixed(2)}, P&L ${pnl}%`;
  }
  lines.push(header);

  // Technical
  const techParts: string[] = [];
  if (ind?.rsi14 != null) techParts.push(`RSI_d=${ind.rsi14.toFixed(0)}`);
  if (w?.rsi14 != null) techParts.push(`RSI_w=${w.rsi14.toFixed(0)}`);
  if (ind?.macd) techParts.push(`MACD_d=${ind.macd.histogram.toFixed(2)}`);
  if (w?.macd) techParts.push(`MACD_w=${w.macd.histogram.toFixed(2)}`);
  if (w?.trend) techParts.push(`trend_w=${w.trend}`);
  if (techParts.length > 0) lines.push(`Tech: ${techParts.join(' ')}`);

  // Divergences
  if (divs.length > 0) {
    lines.push(`Divs: ${divs.map(d => `${d.type} ${d.indicator} ${d.timeframe}`).join(', ')}`);
  } else {
    lines.push('Divs: ninguna');
  }

  // Crossovers
  if (ind?.crossovers?.estimatedDaysToCross != null) {
    const dir = ind.crossovers.crossDirection === 'golden' ? 'GoldenCross' : 'DeathCross';
    lines.push(`${dir} ~${ind.crossovers.estimatedDaysToCross}d`);
  }

  // Fundamental
  const fundParts: string[] = [];
  if (f?.peRatio != null) fundParts.push(`PE=${f.peRatio.toFixed(1)}`);
  if (f?.forwardPE != null) fundParts.push(`FwdPE=${f.forwardPE.toFixed(1)}`);
  if (f?.dividendYield != null && f.dividendYield > 0.01) fundParts.push(`Div=${(f.dividendYield * 100).toFixed(1)}%`);
  if (f?.debtToEquity != null) fundParts.push(`D/E=${f.debtToEquity.toFixed(2)}`);
  if (f?.returnOnEquity != null) fundParts.push(`ROE=${f.returnOnEquity.toFixed(1)}%`);
  if (f?.revenueGrowth != null) fundParts.push(`RevGrow=${f.revenueGrowth.toFixed(1)}%`);
  if (fundParts.length > 0) lines.push(`Fund: ${fundParts.join(' ')}`);

  // Levels
  if (levels) {
    lines.push(`Levels: entry=$${levels.entryPrice.toFixed(2)} stop=$${levels.stopLoss.toFixed(2)} target=$${levels.takeProfit.toFixed(2)} RR=1:${levels.riskRewardRatio.toFixed(1)}`);
  }

  // Sentiment + score
  const sentScore = sent ? Math.round(sent.score * 100) : 0;
  lines.push(`Sent: ${sentScore} | Score: ${opp.opportunityScore} | Conf: ${opp.confidence}% | Action: ${opp.action}`);

  return lines.join('\n');
}

/**
 * Generate deep analysis for portfolio + top BUY/SELL opportunities.
 * Uses DeepSeek R1 for portfolio, Groq for the rest.
 */
export async function generateDeepAnalyses(
  opportunities: Opportunity[],
  techMap: Map<string, TechnicalSummary>,
  fundMap: Map<string, FundamentalSummary>,
  sentimentMap: Map<string, SentimentInput>,
): Promise<Map<string, DeepAnalysis>> {
  const result = new Map<string, DeepAnalysis>();

  // Split: portfolio vs top non-portfolio BUY/SELL
  const portfolio = opportunities.filter(o => o.inPortfolio);
  const topNonPortfolio = opportunities
    .filter(o => !o.inPortfolio && (o.action === 'BUY' || o.action === 'SELL'))
    .slice(0, 10);

  // Build cards
  const buildCards = (opps: Opportunity[]) =>
    opps.map(o => buildAssetCard(o, techMap.get(o.symbol), fundMap.get(o.symbol), sentimentMap.get(o.symbol))).join('\n---\n');

  // Batch 1: Portfolio (DeepSeek R1 — reasoning)
  if (portfolio.length > 0) {
    try {
      console.log(`[DeepAnalysis] Generating for ${portfolio.length} portfolio assets (DeepSeek R1)...`);
      const raw = await callAI('reasoning', buildCards(portfolio), DEEP_ANALYSIS_PROMPT, 6144);
      const parsed = JSON.parse(raw);
      for (const a of (parsed.analyses ?? [])) {
        if (a.symbol) {
          result.set(a.symbol, {
            positives: Array.isArray(a.positives) ? a.positives : [],
            concerns: Array.isArray(a.concerns) ? a.concerns : [],
            recommendation: a.recommendation ?? '',
            wouldDo: Array.isArray(a.wouldDo) ? a.wouldDo : [],
            wouldNotDo: Array.isArray(a.wouldNotDo) ? a.wouldNotDo : [],
            generatedBy: 'deepseek',
          });
        }
      }
      console.log(`[DeepAnalysis] Portfolio: ${result.size}/${portfolio.length} generated`);
    } catch (err) {
      console.warn('[DeepAnalysis] Portfolio batch failed:', (err as Error).message?.slice(0, 100));
    }
  }

  // Batch 2: Top non-portfolio BUY/SELL (DeepSeek R1)
  if (topNonPortfolio.length > 0) {
    try {
      console.log(`[DeepAnalysis] Generating for ${topNonPortfolio.length} top BUY/SELL (DeepSeek R1)...`);
      const raw = await callAI('reasoning', buildCards(topNonPortfolio), DEEP_ANALYSIS_PROMPT, 6144);
      const parsed = JSON.parse(raw);
      for (const a of (parsed.analyses ?? [])) {
        if (a.symbol && !result.has(a.symbol)) {
          result.set(a.symbol, {
            positives: Array.isArray(a.positives) ? a.positives : [],
            concerns: Array.isArray(a.concerns) ? a.concerns : [],
            recommendation: a.recommendation ?? '',
            wouldDo: Array.isArray(a.wouldDo) ? a.wouldDo : [],
            wouldNotDo: Array.isArray(a.wouldNotDo) ? a.wouldNotDo : [],
            generatedBy: 'deepseek',
          });
        }
      }
      console.log(`[DeepAnalysis] Non-portfolio: ${result.size - portfolio.length} generated`);
    } catch (err) {
      console.warn('[DeepAnalysis] Non-portfolio batch failed:', (err as Error).message?.slice(0, 100));
    }
  }

  console.log(`[DeepAnalysis] Total: ${result.size} analyses generated`);
  return result;
}

// --- Symbol Narratives (batch, 1 LLM call) ---

export async function generateSymbolNarratives(
  opportunities: Opportunity[],
  techMap: Map<string, TechnicalSummary>,
  fundMap: Map<string, FundamentalSummary>,
  sentimentMap: Map<string, SentimentInput>,
): Promise<Map<string, string>> {
  const result = new Map<string, string>();

  // Solo BUY/SELL con datos
  const targets = opportunities
    .filter(o => o.action === 'BUY' || o.action === 'SELL')
    .slice(0, 8);

  if (targets.length === 0) return result;

  // Build context per symbol
  const symbolContexts = targets.map(o => {
    const tech = techMap.get(o.symbol);
    const fund = fundMap.get(o.symbol);
    const sent = sentimentMap.get(o.symbol);
    const ind = tech?.indicators;

    const parts: string[] = [
      `Symbol: ${o.symbol} | Accion: ${o.action} | Score: ${o.opportunityScore}/100 | Confianza: ${o.confidence}%`,
    ];

    // Confluence
    if (o.confluenceDetail) {
      parts.push(`A favor (${o.confluenceDetail.bullishSignals.length}): ${o.confluenceDetail.bullishSignals.join(', ')}`);
      parts.push(`En contra (${o.confluenceDetail.bearishSignals.length}): ${o.confluenceDetail.bearishSignals.join(', ')}`);
    }

    // Signal conflicts
    if (o.signalConflicts && o.signalConflicts.length > 0) {
      parts.push(`CONFLICTOS: ${o.signalConflicts.map(c => `${c.signalA} vs ${c.signalB} (${c.implication})`).join('; ')}`);
    }

    // Technical summary
    if (ind) {
      parts.push(`RSI: ${ind.rsi14?.toFixed(0) ?? '?'}, MACD hist: ${ind.macd?.histogram.toFixed(3) ?? '?'}, Precio vs SMA200: ${ind.priceVsSma200.toFixed(1)}%`);
      if (ind.bbSqueeze) parts.push(`BB Squeeze activo (${ind.bbSqueezeIntensity?.toFixed(0)}%)`);
      if (ind.obvDivergence) parts.push(`OBV divergencia: ${ind.obvTrend}`);
    }

    // Fundamentals
    if (fund?.data.peRatio != null) {
      parts.push(`P/E: ${fund.data.peRatio.toFixed(1)}${fund.data.forwardPE ? `, Forward: ${fund.data.forwardPE.toFixed(1)}` : ''}`);
    }

    // Sentiment
    if (sent) {
      parts.push(`Sentimiento: ${sent.sentiment} (${(sent.score * 100).toFixed(0)}%)`);
      if (sent.headlines.length > 0) parts.push(`Headlines: ${sent.headlines.slice(0, 2).join(' | ')}`);
    }

    // Trade levels
    if (o.tradeLevels) {
      const tl = o.tradeLevels;
      let levelsStr = `Entry: $${tl.entryPrice.toFixed(2)}, Stop: $${tl.stopLoss.toFixed(2)}, Target: $${tl.takeProfit.toFixed(2)}, R/R: 1:${tl.riskRewardRatio.toFixed(1)}`;
      if (tl.suggestedQuantity) levelsStr += ` | Sugerido: ${tl.suggestedQuantity} acciones (~$${tl.suggestedAmount})`;
      parts.push(levelsStr);
    }

    return parts.join('\n');
  });

  const userMessage = symbolContexts.join('\n\n---\n\n');

  try {
    const response = await callAI('narrative', userMessage, NARRATIVE_DIGEST_PROMPT, 4096);
    const parsed = JSON.parse(response);

    if (parsed.narratives && Array.isArray(parsed.narratives)) {
      for (const n of parsed.narratives) {
        if (n.symbol && n.narrative) {
          result.set(n.symbol, n.narrative);
        }
      }
    }
  } catch (err) {
    console.warn('[MarketDigest] Narrativas LLM fallaron, usando fallback:', err);
    // Fallback: usar simpleReasoning + conflictos formateados
    for (const o of targets) {
      const parts: string[] = [];
      if (o.simpleReasoning) parts.push(o.simpleReasoning);
      if (o.signalConflicts && o.signalConflicts.length > 0) {
        for (const c of o.signalConflicts) {
          parts.push(c.explanation);
        }
      }
      if (parts.length > 0) result.set(o.symbol, parts.join(' '));
    }
  }

  return result;
}

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
    const response = await callAI('reasoning', userMessage, DAILY_MARKET_DIGEST_PROMPT, 4096);
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

// ============================================================
// DIVERGENCE VALIDATION (DeepSeek R1)
// ============================================================

export interface DivergenceValidation {
  symbol: string;
  confirmed: boolean;
  explanation: string;
}

/**
 * Validate detected divergences by crossing with news and fundamentals.
 * Only for assets that have divergences (not all).
 */
export async function validateDivergences(
  opportunities: Opportunity[],
  sentimentMap: Map<string, SentimentInput>,
): Promise<Map<string, DivergenceValidation>> {
  const result = new Map<string, DivergenceValidation>();

  const withDivs = opportunities.filter(o => o.divergences && o.divergences.length > 0);
  if (withDivs.length === 0) return result;

  const cards = withDivs.map(o => {
    const sent = sentimentMap.get(o.symbol);
    const divText = (o.divergences ?? []).map(d => `${d.type} ${d.indicator} ${d.timeframe}`).join(', ');
    const sentText = sent ? `Sentimiento: ${Math.round(sent.score * 100)}% (${sent.headlines.slice(0, 2).join('; ')})` : 'Sin noticias';
    const fundText = o.breakdown.fundamental.keyFactors.join(', ');
    return `${o.symbol} | Divergencias: ${divText} | ${sentText} | Fund: ${fundText} | Action: ${o.action}`;
  }).join('\n');

  const prompt = `Sos un analista tecnico senior. Te doy activos con divergencias tecnicas detectadas algoritmicamente.

Para cada activo, evalua si la divergencia es REAL o RUIDO cruzando con noticias y fundamentales:
- Si las noticias contradicen la divergencia (ej: div bajista pero sector con noticias positivas), puede ser ruido.
- Si las noticias confirman (ej: div bajista + noticias negativas), es mas confiable.
- Si no hay noticias, la divergencia tecnica tiene el peso completo.

Para cada activo responde:
- "symbol"
- "confirmed": true si la divergencia es creible, false si es probablemente ruido
- "explanation": 1-2 oraciones explicando por que

Responde SOLO con JSON:
{"validations":[{"symbol":"VIST","confirmed":true,"explanation":"La divergencia bajista se confirma..."}]}`;

  try {
    const raw = await callAI('reasoning', cards, prompt, 3072);
    const parsed = JSON.parse(raw);
    for (const v of (parsed.validations ?? [])) {
      if (v.symbol) {
        result.set(v.symbol, {
          symbol: v.symbol,
          confirmed: v.confirmed ?? true,
          explanation: v.explanation ?? '',
        });
      }
    }
    console.log(`[DivValidation] ${result.size} divergencias validadas`);
  } catch (err) {
    console.warn('[DivValidation] Failed:', (err as Error).message?.slice(0, 100));
  }

  return result;
}
