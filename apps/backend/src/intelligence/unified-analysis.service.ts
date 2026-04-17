// apps/backend/src/intelligence/unified-analysis.service.ts
/**
 * Unified Asset Analysis Service
 *
 * Reemplaza: enrichWithLLM + generateDeepAnalyses + generateSymbolNarratives
 *
 * Principios:
 * - Un análisis por activo, contexto completo
 * - Un solo modelo (DeepSeek R1 via callAI('reasoning'))
 * - Batches de 4 en paralelo (respeta rate limits de OpenRouter)
 * - Output coherente y comparable entre activos
 */

import type {
  Opportunity,
  TechnicalSummary,
  FundamentalSummary,
  UnifiedAssetAnalysis,
} from '@trading/shared';
import { UNIFIED_ASSET_ANALYSIS_PROMPT } from '@trading/shared';
import { callAIWithModel } from '../shared/ai-router.js';
import { getPortfolioPositions } from '../db/repository.js';
import type { SentimentInput } from '../opportunities/scoring.js';

type PortfolioPosition = { symbol: string; quantity: number; avgCost: number };

const BATCH_SIZE = 4; // DeepSeek R1 vía OpenRouter: 4 en paralelo es seguro

function modelNameToProvider(name: string): UnifiedAssetAnalysis['generatedBy'] {
  if (name.includes('Gemini')) return 'claude'; // 'claude' slot reutilizado para Gemini (mismo tipo en shared)
  if (name.includes('DeepSeek')) return 'deepseek';
  if (name.includes('Groq')) return 'groq';
  if (name.includes('Qwen') || name.includes('local')) return 'qwen';
  return 'openrouter';
}

/**
 * Builds a compact asset card for LLM input.
 * One line per dimension. No redundant text.
 * Target: ~150-200 tokens per asset.
 */
function buildCompactCard(
  opp: Opportunity,
  positions: PortfolioPosition[],
  tech?: TechnicalSummary,
  fund?: FundamentalSummary,
  sent?: SentimentInput,
): string {
  const lines: string[] = [];
  const pos = positions.find(p => p.symbol === opp.symbol);
  const ind = tech?.indicators;
  const w = tech?.weekly;
  const f = fund?.data;

  // Header: símbolo, precio, acción algorítmica, score, portfolio
  let header = `${opp.symbol} $${opp.currentPrice.toFixed(2)} | algoAction=${opp.action} score=${opp.opportunityScore}/100`;
  if (pos) {
    const pnl = ((opp.currentPrice - pos.avgCost) / pos.avgCost * 100).toFixed(1);
    header += ` | portfolio ${pos.quantity.toFixed(0)}acc @$${pos.avgCost.toFixed(2)} P&L${pnl}%`;
  }
  lines.push(header);

  // Técnico diario
  const techParts: string[] = [];
  if (ind?.rsi14 != null) techParts.push(`RSI_d=${ind.rsi14.toFixed(0)}`);
  if (ind?.macd?.histogram != null) techParts.push(`MACD=${ind.macd.histogram.toFixed(3)}`);
  if (ind?.priceVsSma200 != null) techParts.push(`vsSMA200=${ind.priceVsSma200.toFixed(1)}%`);
  if (ind?.bbSqueeze) techParts.push(`BB_squeeze=${ind.bbSqueezeIntensity?.toFixed(0)}%`);
  if (techParts.length > 0) lines.push(`tech_d: ${techParts.join(' ')}`);

  // Técnico semanal
  const weekParts: string[] = [];
  if (w?.rsi14 != null) weekParts.push(`RSI_w=${w.rsi14.toFixed(0)}`);
  if (w?.macd?.histogram != null) weekParts.push(`MACD_w=${w.macd.histogram.toFixed(3)}`);
  if (w?.trend) weekParts.push(`trend_w=${w.trend}`);
  if (weekParts.length > 0) lines.push(`tech_w: ${weekParts.join(' ')}`);

  // Divergencias (críticas para decisión)
  const divs = opp.divergences ?? [];
  if (divs.length > 0) {
    lines.push(`divs: ${divs.map(d => `${d.type}_${d.indicator}_${d.timeframe}`).join(' ')}`);
  }

  // Crossovers inminentes
  if (ind?.crossovers?.estimatedDaysToCross != null) {
    const dir = ind.crossovers.crossDirection === 'golden' ? 'GC' : 'DC';
    lines.push(`cross: ${dir}_~${ind.crossovers.estimatedDaysToCross}d`);
  }

  // Fundamental (solo lo relevante)
  const fundParts: string[] = [];
  if (f?.peRatio != null) fundParts.push(`PE=${f.peRatio.toFixed(1)}`);
  if (f?.forwardPE != null) fundParts.push(`fwdPE=${f.forwardPE.toFixed(1)}`);
  if (f?.priceVs52wHigh != null) fundParts.push(`vs52wH=${f.priceVs52wHigh.toFixed(1)}%`);
  if (f?.revenueGrowth != null) fundParts.push(`revGrow=${f.revenueGrowth.toFixed(1)}%`);
  lines.push(`fund: ${fundParts.length > 0 ? fundParts.join(' ') : 'N/A (sin datos)'}`);

  // Sentiment + conflictos
  if (sent) {
    const sentScore = Math.round(sent.score * 100);
    const headlineStr = sent.headlines.slice(0, 3).filter(Boolean)
      .map(h => `"${h.slice(0, 50)}"`)
      .join('; ');
    lines.push(`sent: ${sentScore} ${sent.sentiment}${headlineStr ? ` ${headlineStr}` : ''}`);
  }

  // Conflictos de señales (importantes para la narrativa)
  if (opp.signalConflicts && opp.signalConflicts.length > 0) {
    const conflicts = opp.signalConflicts
      .slice(0, 2)
      .map(c => `${c.signalA}vs${c.signalB}(${c.implication})`)
      .join(' ');
    lines.push(`conflicts: ${conflicts}`);
  }

  // Niveles de trade algorítmicos
  if (opp.tradeLevels) {
    const tl = opp.tradeLevels;
    lines.push(`levels: entry=$${tl.entryPrice.toFixed(2)} stop=$${tl.stopLoss.toFixed(2)} target=$${tl.takeProfit.toFixed(2)} RR=1:${tl.riskRewardRatio.toFixed(1)}`);
  }

  return lines.join('\n');
}

/**
 * Run unified analysis for a batch of opportunities.
 * One LLM call per batch. Same model. Consistent outputs.
 */
async function analyzeBatch(
  batch: Opportunity[],
  techMap: Map<string, TechnicalSummary>,
  fundMap: Map<string, FundamentalSummary>,
  sentimentMap: Map<string, SentimentInput>,
  positions: PortfolioPosition[],
): Promise<Map<string, UnifiedAssetAnalysis>> {
  const result = new Map<string, UnifiedAssetAnalysis>();

  const cards = batch
    .map(o => buildCompactCard(o, positions, techMap.get(o.symbol), fundMap.get(o.symbol), sentimentMap.get(o.symbol)))
    .join('\n---\n');

  try {
    const { content: raw, model: usedModel } = await callAIWithModel('reasoning', cards, UNIFIED_ASSET_ANALYSIS_PROMPT, 6144);
    const parsed = JSON.parse(raw);

    const generatedBy = modelNameToProvider(usedModel);

    for (const a of (parsed.analyses ?? [])) {
      if (!a.symbol) continue;
      result.set(a.symbol, {
        action: ['BUY', 'SELL', 'HOLD', 'WATCH'].includes(a.action) ? a.action : 'HOLD',
        thesis: a.thesis ?? '',
        catalysts: Array.isArray(a.catalysts) ? a.catalysts.slice(0, 3) : [],
        risks: Array.isArray(a.risks) ? a.risks.slice(0, 2) : [],
        wouldDo: Array.isArray(a.wouldDo) ? a.wouldDo.slice(0, 2) : [],
        wouldNotDo: Array.isArray(a.wouldNotDo) ? a.wouldNotDo.slice(0, 1) : [],
        narrative: a.narrative ?? '',
        macroTheme: a.macroTheme ?? null,
        generatedBy,
      });
    }

    console.log(`[unified-analysis] Batch ${batch.map(o => o.symbol).join(',')}: ${result.size}/${batch.length} OK`);
  } catch (err) {
    console.warn(`[unified-analysis] Batch failed: ${(err as Error).message?.slice(0, 100)}`);
  }

  return result;
}

/**
 * Main entry point: run unified analysis for top N opportunities.
 * Batches of BATCH_SIZE in parallel. Same model. Consistent outputs.
 *
 * @param opportunities - Sorted by opportunityScore desc, already filtered by anti-hype
 * @param maxAssets - Max assets to analyze (default 12)
 */
export async function runUnifiedAnalysis(
  opportunities: Opportunity[],
  techMap: Map<string, TechnicalSummary>,
  fundMap: Map<string, FundamentalSummary>,
  sentimentMap: Map<string, SentimentInput>,
  maxAssets = 12,
): Promise<Map<string, UnifiedAssetAnalysis>> {
  const result = new Map<string, UnifiedAssetAnalysis>();

  // Portfolio assets always included, then top BUY/SELL by score
  const portfolio = opportunities.filter(o => o.inPortfolio);
  const topNonPortfolio = opportunities
    .filter(o => !o.inPortfolio && (o.action === 'BUY' || o.action === 'SELL') && o.passedAntiHype !== false)
    .slice(0, maxAssets - portfolio.length);

  const targets = [...portfolio, ...topNonPortfolio];

  if (targets.length === 0) {
    console.log('[unified-analysis] No targets to analyze');
    return result;
  }

  console.log(`[unified-analysis] Analyzing ${targets.length} assets (${portfolio.length} portfolio + ${topNonPortfolio.length} top) in batches of ${BATCH_SIZE}`);

  // Fetch positions once — passed to each batch to avoid N DB calls
  const positions = getPortfolioPositions();

  // Build batches
  const batches: Opportunity[][] = [];
  for (let i = 0; i < targets.length; i += BATCH_SIZE) {
    batches.push(targets.slice(i, i + BATCH_SIZE));
  }

  // Run batches in parallel
  const batchResults = await Promise.allSettled(
    batches.map(batch => analyzeBatch(batch, techMap, fundMap, sentimentMap, positions)),
  );

  for (const r of batchResults) {
    if (r.status === 'fulfilled') {
      for (const [symbol, analysis] of r.value) {
        result.set(symbol, analysis);
      }
    }
  }

  console.log(`[unified-analysis] Complete: ${result.size}/${targets.length} assets analyzed`);
  return result;
}
