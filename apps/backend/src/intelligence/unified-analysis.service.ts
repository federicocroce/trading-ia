// apps/backend/src/intelligence/unified-analysis.service.ts
/**
 * Unified Asset Analysis Service
 *
 * Reemplaza: enrichWithLLM + generateDeepAnalyses + generateSymbolNarratives
 *
 * Principios:
 * - Un análisis por activo, contexto completo
 * - Una sola cadena de modelos (callAI('reasoning'): Gemini Pro → OpenRouter free → Groq → Qwen)
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
import { saveUnifiedAnalysisBatch, saveUnifiedAnalysisResults } from './pipeline-artifacts.repository.js';
import { filterActionableTriggers, dropUnrealisticPriceTriggers } from './trigger-validation.js';

type PortfolioPosition = { symbol: string; quantity: number; avgCost: number };

const BATCH_SIZE = 4; // OpenRouter free tier: 4 en paralelo es seguro

let _lastRunStats: { analyzed: number; targets: number; abortedByQuota: boolean } | null = null;

export function getLastUnifiedAnalysisStats() {
  return _lastRunStats;
}

function modelNameToProvider(name: string): UnifiedAssetAnalysis['generatedBy'] {
  if (name.includes('Gemini') || name.includes('gemini')) return 'gemini';
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
  causalContext?: string,
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

  if (causalContext) {
    lines.push(`\nCONTEXTO CAUSAL HOY:\n${causalContext}`);
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
  pipelineRunId?: number,
  batchIndex = 0,
  macroContext = '',
  causalContextMap?: Map<string, string>,
): Promise<Map<string, UnifiedAssetAnalysis>> {
  const result = new Map<string, UnifiedAssetAnalysis>();

  const positions = getPortfolioPositions();
  const symbolCards = batch
    .map(o => buildCompactCard(o, positions, techMap.get(o.symbol), fundMap.get(o.symbol), sentimentMap.get(o.symbol), causalContextMap?.get(o.symbol)))
    .join('\n---\n');
  const cards = macroContext ? `${macroContext}\n===\n${symbolCards}` : symbolCards;

  const batchStart = Date.now();
  let parsedOk = true;
  let errorMsg: string | undefined;
  let rawResponse: string | undefined;
  let usedModel = 'reasoning';
  let tokensInput: number | undefined;
  let tokensOutput: number | undefined;

  try {
    const result2 = await callAIWithModel('reasoning', cards, UNIFIED_ASSET_ANALYSIS_PROMPT, 6144);
    rawResponse = result2.content;
    usedModel = result2.model ?? 'reasoning';
    tokensInput = result2.tokensInput;
    tokensOutput = result2.tokensOutput;
    const parsed = JSON.parse(result2.content);

    const generatedBy = modelNameToProvider(usedModel);

    // Precio actual por símbolo — para descartar triggers con precios alucinados.
    const priceBySymbol = new Map(batch.map((o) => [o.symbol, o.currentPrice]));
    const groundTriggers = (arr: unknown, sym: string, n: number): string[] =>
      Array.isArray(arr)
        ? dropUnrealisticPriceTriggers(filterActionableTriggers(arr.slice(0, n)), priceBySymbol.get(sym) ?? 0)
        : [];

    for (const a of (parsed.analyses ?? [])) {
      if (!a.symbol) continue;
      result.set(a.symbol, {
        action: ['BUY', 'SELL', 'HOLD', 'WATCH'].includes(a.action) ? a.action : 'HOLD',
        thesis: a.thesis ?? '',
        catalysts: Array.isArray(a.catalysts) ? a.catalysts.slice(0, 3) : [],
        risks: Array.isArray(a.risks) ? a.risks.slice(0, 2) : [],
        wouldDo: groundTriggers(a.wouldDo, a.symbol, 2),
        wouldNotDo: groundTriggers(a.wouldNotDo, a.symbol, 1),
        narrative: a.narrative ?? '',
        macroTheme: a.macroTheme ?? null,
        generatedBy,
      });
    }

    console.log(`[unified-analysis] Batch ${batch.map(o => o.symbol).join(',')}: ${result.size}/${batch.length} OK`);
  } catch (err) {
    parsedOk = false;
    errorMsg = (err as Error).message?.slice(0, 200);
    console.warn(`[unified-analysis] Batch failed: ${errorMsg}`);
    // Re-throw so the caller's circuit breaker can abort remaining batches
    if (errorMsg?.includes('All providers failed') || errorMsg?.includes('All providers quota-exhausted')) {
      throw err;
    }
  }

  const tokensLabel = tokensInput != null && tokensOutput != null
    ? `${tokensInput} in / ${tokensOutput} out tokens`
    : 'tokens n/a';
  console.log(`[Unified] batch ${batchIndex}: ${tokensLabel} (${usedModel})`);

  if (pipelineRunId) {
    try {
      saveUnifiedAnalysisBatch({
        pipelineRunId,
        batchIndex,
        assetsInput: batch.map(o => o.symbol),
        modelUsed: usedModel,
        tokensInput,
        tokensOutput,
        durationMs: Date.now() - batchStart,
        parsedOk,
        errorMsg,
        rawResponse,
      });
    } catch (saveErr) {
      console.warn('[unified-analysis] Failed to save batch artifact:', (saveErr as Error).message);
    }
  }

  return result;
}

/**
 * Main entry point: run unified analysis for top N opportunities.
 * Batches of BATCH_SIZE in parallel. Same model. Consistent outputs.
 *
 * @param opportunities - Sorted by opportunityScore desc, already filtered by anti-hype
 * @param maxAssets - Max assets to analyze (default 12)
 * @param pipelineRunId - Optional pipeline run ID for persisting batch artifacts
 */
export async function runUnifiedAnalysis(
  opportunities: Opportunity[],
  techMap: Map<string, TechnicalSummary>,
  fundMap: Map<string, FundamentalSummary>,
  sentimentMap: Map<string, SentimentInput>,
  maxAssets = 12,
  pipelineRunId?: number,
  macroContext = '',
  causalContextMap?: Map<string, string>,
  discoveredSet?: Set<string>,
): Promise<Map<string, UnifiedAssetAnalysis>> {
  // Reset so a previous run's stats can't leak if this run exits early.
  _lastRunStats = null;
  const result = new Map<string, UnifiedAssetAnalysis>();

  // News-context detector with multi-signal fallback (sentimentMap can be empty
  // for fresh discoveries if news LLM didn't tag affectedTickers).
  const hasNewsContext = (o: Opportunity): boolean => {
    // Signal 1: explicit sentimentMap entry with score
    const sent = sentimentMap.get(o.symbol);
    if (sent && (sent.headlines?.length ?? 0) > 0 && Math.abs(sent.score ?? 0) >= 0.25) return true;
    // Signal 2: causal context built from macro events
    if (causalContextMap?.has(o.symbol)) return true;
    // Signal 3: symbol came from news-driven discovery registry
    if (discoveredSet?.has(o.symbol)) return true;
    // Signal 4: opportunity has explicit news catalyst in catalysts array
    if (o.catalysts?.some(c => /noticia|news|catalyst|earnings|fed|tariff|aranceles/i.test(c))) return true;
    return false;
  };

  // Selection logic:
  // 1. Portfolio assets ALWAYS included (any action)
  // 2. Non-portfolio BUY/SELL: top by score (passed anti-hype)
  // 3. Non-portfolio HOLD/WATCH: include if has ANY news context (4 fallback signals)
  const portfolio = opportunities.filter(o => o.inPortfolio);
  const nonPortfolioBuySell = opportunities
    .filter(o => !o.inPortfolio && (o.action === 'BUY' || o.action === 'SELL') && o.passedAntiHype !== false)
    .sort((a, b) => b.opportunityScore - a.opportunityScore);
  const nonPortfolioHoldWithNews = opportunities
    .filter(o => !o.inPortfolio && (o.action === 'HOLD' || o.action === 'WATCH') && o.passedAntiHype !== false)
    .filter(hasNewsContext)
    .sort((a, b) => b.opportunityScore - a.opportunityScore);

  const slotsForNonPortfolio = Math.max(0, maxAssets - portfolio.length);
  // Reserve up to 70% for BUY/SELL, rest for newsworthy HOLD/WATCH
  const buySellSlots = Math.ceil(slotsForNonPortfolio * 0.7);
  const holdSlots = slotsForNonPortfolio - buySellSlots;
  const topBuySell = nonPortfolioBuySell.slice(0, buySellSlots);
  const topHoldNews = nonPortfolioHoldWithNews.slice(0, holdSlots);

  const targets = [...portfolio, ...topBuySell, ...topHoldNews];

  if (targets.length === 0) {
    console.log('[unified-analysis] No targets to analyze');
    return result;
  }

  console.log(`[unified-analysis] Analyzing ${targets.length} assets (${portfolio.length} portfolio + ${topBuySell.length} BUY/SELL + ${topHoldNews.length} HOLD-with-news) in batches of ${BATCH_SIZE}`);

  // Build batches
  const batches: Opportunity[][] = [];
  for (let i = 0; i < targets.length; i += BATCH_SIZE) {
    batches.push(targets.slice(i, i + BATCH_SIZE));
  }

  // Run batches sequentially so we can abort early if all AI providers are exhausted
  let abortedByQuota = false;
  for (let i = 0; i < batches.length; i++) {
    try {
      const batchResult = await analyzeBatch(batches[i], techMap, fundMap, sentimentMap, pipelineRunId, i, macroContext, causalContextMap);
      for (const [symbol, analysis] of batchResult) {
        result.set(symbol, analysis);
      }
    } catch (err) {
      const msg = (err as Error).message ?? '';
      if (msg.includes('All providers failed') || msg.includes('All providers quota-exhausted')) {
        console.warn(`[unified-analysis] Circuit breaker: todos los providers AI agotados. Abortando ${batches.length - i - 1} batches restantes.`);
        abortedByQuota = true;
        break;
      }
    }
  }
  _lastRunStats = { analyzed: result.size, targets: targets.length, abortedByQuota };

  console.log(`[unified-analysis] Complete: ${result.size}/${targets.length} assets analyzed`);

  // Persist parsed per-symbol results so each output is queryable from DB
  if (result.size > 0) {
    try {
      const portfolioSymbols = new Set(portfolio.map(o => o.symbol));
      const scoreBySymbol = new Map(targets.map(o => [o.symbol, o.opportunityScore]));
      saveUnifiedAnalysisResults({
        pipelineRunId,
        results: result,
        portfolioSymbols,
        scoreBySymbol,
      });
    } catch (err) {
      console.error('[Unified] persist failed:', (err as Error).message);
    }
  }

  return result;
}
