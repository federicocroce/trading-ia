import type {
  Opportunity,
  OpportunityScanResult,
  OpportunitySector,
  AnalysisEngine,
  SectorSummary,
  TechnicalSummary,
  FundamentalSummary,
  SentimentType,
  SymbolTrend,
  MarketPlaza,
  SecondOrderEffect,
} from '@trading/shared';
import {
  OPPORTUNITY_UNIVERSE,
} from '@trading/shared';
import { getTechnicalSummary } from '../technical/technical-analysis.service.js';
import { getFundamentalSummary } from '../fundamental/fundamental-analysis.service.js';
import { getIntelligence, getIntelligenceFromDB } from '../news/news-intelligence.service.js';
import { analyzeSecondOrderEffects } from '../analysis/sector-correlation.service.js';
import { persistDailyReport } from '../intelligence/daily-report.service.js';
import { recordSignals, resolveExpiredSignals, recordMissedOpportunities } from './signal-tracking.service.js';
import { runUnifiedAnalysis } from '../intelligence/unified-analysis.service.js';
import { getSectorForSymbolDynamic, getDiscoveredTickers, pruneExpiredDiscoveries } from '../discovery/discovery-registry.js';
import { classifyAssets } from '../discovery/asset-classifier.js';
import { getSourceStats } from '../news/news.service.js';
import {
  getActiveSymbolList,
  getPortfolioPositions,
  getCausalTickersByDate,
  insertOpportunityScan,
  insertOpportunitySnapshots,
  getLatestOpportunityScan,
  getOpportunityScans,
  getOpportunityScanById,
  getSymbolHistory,
  getNewsCacheAge,
  getFundamentalCacheAge,
  getMarketDigestByDate,
  upsertMarketDigest,
} from '../db/repository.js';
import {
  buildAlgorithmicOpportunity,
  filterSymbolsByPositiveSectors,
  applyAntiHypeFilters,
  type SentimentInput,
  type AntiHypeFilterResult,
} from './scoring.js';
import { getToday } from '../shared/date-utils.js';
import { setRunAiMode } from '../shared/ai-router.js';

// --- In-memory cache (survives within same process, backed by DB) ---
let cachedResult: OpportunityScanResult | null = null;
let cachedMarketDigest: import('@trading/shared').MarketDigest | null = null;
// Cuando se fuerza un refresh, no cargar el scan viejo de DB hasta que el nuevo termine
let dbCacheInvalidated = false;

// Expone los últimos análisis unificados para que STAGE 4 (report) los consuma
let _lastUnifiedAnalyses: Map<string, import('@trading/shared').UnifiedAssetAnalysis> = new Map();

export function getLastUnifiedAnalyses(): Map<string, import('@trading/shared').UnifiedAssetAnalysis> {
  return new Map(_lastUnifiedAnalyses);
}

export function getCachedScanResult(): OpportunityScanResult | null {
  return cachedResult;
}

export function getMarketDigest(): import('@trading/shared').MarketDigest | null {
  if (cachedMarketDigest) return cachedMarketDigest;
  // Try to load today's digest from DB
  const today = getToday();
  const raw = getMarketDigestByDate(today);
  if (raw) {
    try {
      cachedMarketDigest = JSON.parse(raw) as import('@trading/shared').MarketDigest;
      return cachedMarketDigest;
    } catch { /* ignore */ }
  }
  return null;
}

export function setMarketDigest(digest: import('@trading/shared').MarketDigest) {
  cachedMarketDigest = digest;
  // Persist to DB
  const today = getToday();
  try {
    upsertMarketDigest(today, JSON.stringify(digest));
  } catch (e) {
    console.warn('[opportunities] Failed to persist market digest to DB:', (e as Error).message?.slice(0, 100));
  }
}


function tryLoadFromDB(): OpportunityScanResult | null {
  if (dbCacheInvalidated) return null; // refresh explícito en curso, ignorar DB
  const latest = getLatestOpportunityScan();
  if (!latest) return null;

  // Accept scans from the last 7 days (not just today)
  const scanDate = new Date(latest.scannedAt);
  const now = new Date();
  const daysSinceScan = Math.floor((now.getTime() - scanDate.getTime()) / (1000 * 60 * 60 * 24));
  if (daysSinceScan > 7) return null;

  try {
    const result: OpportunityScanResult = {
      scannedAt: new Date(latest.scannedAt).getTime(),
      totalSymbolsScanned: latest.totalSymbolsScanned,
      opportunities: JSON.parse(latest.opportunities) as Opportunity[],
      sectorSummary: JSON.parse(latest.sectorSummary) as SectorSummary[],
      analysisEngine: latest.engine as AnalysisEngine,
      analysisDetail: latest.engineDetail,
      source: 'db',
    };
    console.log(`[opportunities] Loaded scan from DB (${latest.scannedAt}, ${daysSinceScan}d ago, engine: ${latest.engine})`);
    return result;
  } catch {
    return null;
  }
}

// --- Batching ---

async function batchProcess<T>(
  symbols: string[],
  processor: (symbol: string) => Promise<T>,
  batchSize: number = 4,
  delayMs: number = 300,
): Promise<Map<string, T>> {
  const results = new Map<string, T>();

  for (let i = 0; i < symbols.length; i += batchSize) {
    const batch = symbols.slice(i, i + batchSize);
    const batchResults = await Promise.allSettled(
      batch.map(async (s) => ({ symbol: s, data: await processor(s) })),
    );

    for (const r of batchResults) {
      if (r.status === 'fulfilled') {
        results.set(r.value.symbol, r.value.data);
      } else {
        console.warn(`[opportunities] Failed to process symbol in batch:`, r.reason);
      }
    }

    if (i + batchSize < symbols.length) {
      await new Promise((resolve) => setTimeout(resolve, delayMs));
    }
  }

  return results;
}

// --- Main pipeline ---

// --- Scan Progress Tracking ---

interface ScanProgress {
  isScanning: boolean;
  currentStep: string;
  stepNumber: number;
  totalSteps: number;
  percentComplete: number;
  startedAt: number | null;
  estimatedTotalSeconds: number;
  stepsCompleted: string[];
}

const scanProgress: ScanProgress = {
  isScanning: false,
  currentStep: '',
  stepNumber: 0,
  totalSteps: 8,
  percentComplete: 0,
  startedAt: null,
  estimatedTotalSeconds: 45,
  stepsCompleted: [],
};

function updateProgress(step: string, stepNum: number) {
  scanProgress.currentStep = step;
  scanProgress.stepNumber = stepNum;
  scanProgress.percentComplete = Math.round((stepNum / scanProgress.totalSteps) * 100);
  if (stepNum > 0) scanProgress.stepsCompleted.push(step);
}

export function getScanStatus() {
  const elapsed = scanProgress.startedAt ? Math.round((Date.now() - scanProgress.startedAt) / 1000) : 0;
  return {
    ...scanProgress,
    elapsedSeconds: elapsed,
    estimatedRemainingSeconds: Math.max(0, scanProgress.estimatedTotalSeconds - elapsed),
  };
}

export async function scanOpportunities(sectors?: OpportunitySector[]): Promise<OpportunityScanResult> {
  // 1. Return cache if available
  if (cachedResult) {
    return cachedResult;
  }

  // 2. Try loading from DB (instant, non-blocking)
  const fromDB = tryLoadFromDB();
  if (fromDB) {
    cachedResult = fromDB;
    return cachedResult;
  }

  // 3. No data at all — return empty result immediately, trigger scan in background
  if (!scanProgress.isScanning) {
    scanProgress.isScanning = true;
    scanProgress.startedAt = Date.now();
    scanProgress.stepsCompleted = [];
    scanProgress.percentComplete = 0;
    runLiveScan(sectors)
      .then(result => { cachedResult = result; })
      .catch(err => console.error('[opportunities] Background scan failed:', err))
      .finally(() => {
        scanProgress.isScanning = false;
        scanProgress.percentComplete = 100;
        scanProgress.currentStep = 'Completado';
      });
  }

  // Return empty result so frontend is not blocked
  return {
    scannedAt: Date.now(),
    totalSymbolsScanned: 0,
    opportunities: [],
    sectorSummary: [],
    analysisEngine: 'algorithmic',
    analysisDetail: 'Escaneando en segundo plano...',
    source: 'live' as const,
  };
}

async function runLiveScan(sectors?: OpportunitySector[], pipelineRunId?: number): Promise<OpportunityScanResult> {
  // Prune expired discoveries before scan
  pruneExpiredDiscoveries();

  // ============================================================
  // PASO 1: Noticias primero — determina qué pasa en el mundo
  // ============================================================
  updateProgress('Leyendo noticias de BD', 1);

  // "Analizar" reads from DB only — never fetches APIs
  const intelligence = await getIntelligenceFromDB();

  console.log(`[opportunities] Paso 1: ${intelligence.totalNewsCount} noticias analizadas, ${intelligence.plazas.length} plazas`);

  // ============================================================
  // PASO 2: Construir universo dinámico (watchlist + descubiertos de noticias)
  // ============================================================
  updateProgress('Descubriendo activos relevantes', 2);

  const portfolioSymbolsList = getPortfolioPositions().map(p => p.symbol);
  const today = new Date().toISOString().slice(0, 10);
  const causalRows = getCausalTickersByDate(today);
  const causalTickers = causalRows.map(c => c.ticker);
  const causalContextMap = new Map(causalRows.map(c => [c.ticker, c.causalSummary]));
  const discovered = getDiscoveredTickers().map(t => t.symbol);
  // Portfolio always included; news-derived tickers replace hardcoded watchlist
  const allSymbols = [...new Set([...portfolioSymbolsList, ...causalTickers, ...discovered])];
  console.log(`[opportunities] ${allSymbols.length} simbolos (${portfolioSymbolsList.length} portfolio + ${causalTickers.length} causal + ${discovered.length} descubiertos)`);

  // ============================================================
  // PASO 3: Clasificar activos (tipo, sector, mercado)
  // ============================================================
  updateProgress('Clasificando activos', 3);

  try {
    await classifyAssets(allSymbols);
  } catch (err) {
    console.warn('[opportunities] Asset classification failed (non-critical):', err);
  }

  // ============================================================
  // PASO 4: Análisis técnico + fundamental (ya sabemos qué analizar)
  // ============================================================
  updateProgress('Analizando tecnico y fundamental', 4);

  const [techMap, fundMap] = await Promise.all([
    batchProcess(allSymbols, getTechnicalSummary),
    batchProcess(allSymbols, getFundamentalSummary),
  ]);

  // Extract sentiment from intelligence plazas
  const sentimentMap = new Map<string, SentimentInput>();
  for (const plaza of intelligence.plazas) {
    for (const trend of plaza.symbolTrends as SymbolTrend[]) {
      sentimentMap.set(trend.symbol, {
        score: trend.sentimentScore,
        sentiment: trend.sentiment,
        headlines: trend.topHeadlines,
        newsCount: trend.newsCount,
        positiveCount: trend.positiveCount,
        negativeCount: trend.negativeCount,
        neutralCount: trend.neutralCount,
      });
    }
  }

  // Portfolio
  const positions = getPortfolioPositions();
  const positionMap = new Map(positions.map((p) => [p.symbol, p.quantity]));
  const activeSymbols = new Set(getActiveSymbolList());

  // Portfolio value (para position sizing)
  let portfolioValue = 0;
  for (const pos of positions) {
    const tech = techMap.get(pos.symbol);
    const price = tech?.indicators.currentPrice ?? 0;
    portfolioValue += pos.quantity * price;
  }

  // ============================================================
  updateProgress('Filtrando por sector y sentimiento', 5);

  // FASE 1: Filtro por sector (funnel)
  // ============================================================
  const plazaSentiments = new Map<MarketPlaza, SentimentType>();
  for (const plaza of intelligence.plazas) {
    plazaSentiments.set(plaza.plaza as MarketPlaza, plaza.overallSentiment as SentimentType);
  }

  const portfolioPositionSymbols = new Set(positions.map((p) => p.symbol));
  const filteredSymbols = filterSymbolsByPositiveSectors(allSymbols, plazaSentiments, portfolioPositionSymbols);

  const negativeSectors = [...plazaSentiments.entries()]
    .filter(([, s]) => s === 'negative')
    .map(([p]) => p);

  console.log(
    `[opportunities] Fase 1: ${filteredSymbols.length}/${allSymbols.length} símbolos pasan el filtro de sector` +
    (negativeSectors.length > 0 ? ` (sectores negativos: ${negativeSectors.join(', ')})` : ' (ningún sector negativo)'),
  );

  // ============================================================
  // FASE 1.5: Análisis de segundo orden (efectos inter-sector)
  // ============================================================
  const topHeadlines = intelligence.plazas
    .flatMap((p) => p.symbolTrends.flatMap((t) => t.topHeadlines))
    .slice(0, 10);

  const secondOrderEffects = await analyzeSecondOrderEffects(intelligence.plazas, topHeadlines);

  // Apply second-order boosts to sentiment map
  // Accumulate all boosts first, then clamp once (avoids intermediate clamping)
  const boostAccum = new Map<string, { totalBoost: number; headlines: string[] }>();

  for (const effect of secondOrderEffects) {
    const boost = effect.impactDirection === 'positive' ? 0.15
      : effect.impactDirection === 'negative' ? -0.15
      : 0;

    if (boost === 0) continue;

    const confidenceMultiplier = effect.confidence === 'high' ? 1.0 : 0.6;
    const adjustedBoost = boost * confidenceMultiplier;

    for (const ticker of effect.affectedTickers) {
      const accum = boostAccum.get(ticker) ?? { totalBoost: 0, headlines: [] };
      accum.totalBoost += adjustedBoost;
      accum.headlines.push(`[2do orden] ${effect.triggerEvent}`);
      boostAccum.set(ticker, accum);
    }
  }

  // Apply accumulated boosts (clamp once at the end)
  for (const [ticker, { totalBoost, headlines }] of boostAccum) {
    const existing = sentimentMap.get(ticker);
    if (existing) {
      sentimentMap.set(ticker, {
        ...existing,
        score: Math.max(-1, Math.min(1, existing.score + totalBoost)),
        headlines: [...existing.headlines, ...headlines],
      });
    } else {
      sentimentMap.set(ticker, {
        score: Math.max(-1, Math.min(1, totalBoost)),
        sentiment: totalBoost > 0 ? 'positive' : 'negative',
        headlines,
      });
    }
  }

  console.log(`[opportunities] Fase 1.5: ${secondOrderEffects.length} efectos de segundo orden aplicados`);

  // ============================================================
  updateProgress('Aplicando filtros anti-hype y scoring', 6);

  // FASE 2: Filtros anti-hype ANTES del scoring (ahorra procesamiento)
  // ============================================================
  const portfolioSymbols = new Set(positionMap.keys());
  const includeVolume = process.env.ANTIHYPE_VOLUME !== 'off';
  const antiHypeResult = applyAntiHypeFilters(
    filteredSymbols,
    techMap,
    portfolioSymbols,
    { includeVolume },
  );

  const antiHypeSet = new Set(antiHypeResult.filtered);

  console.log(
    `[opportunities] Fase 2: ${antiHypeResult.passedAll}/${antiHypeResult.totalCandidates} pasan filtros anti-hype [${antiHypeResult.mode}, 2de3]` +
    (antiHypeResult.rejected.length > 0
      ? ` (rechazados: ${antiHypeResult.rejected.map((r) => r.symbol).join(', ')})`
      : ''),
  );

  // ============================================================
  // FASE 2.5: Scoring algorítmico (solo los que pasan anti-hype + portfolio)
  // ============================================================
  const symbolsToScore = filteredSymbols.filter(s => antiHypeSet.has(s) || positionMap.has(s));

  // Extract sector-level sentiment for signal conflict detection
  const sectorSentimentMap = new Map<string, number>();
  for (const plaza of intelligence.plazas) {
    sectorSentimentMap.set(plaza.plaza, plaza.sentimentScore);
  }

  const swingAlertMap = new Map<string, { direction: 'BUY' | 'SELL'; winRate: number; avgReturn: number }>();

  const opportunities: Opportunity[] = symbolsToScore
    .map((symbol) =>
      buildAlgorithmicOpportunity(
        symbol,
        techMap.get(symbol),
        fundMap.get(symbol),
        sentimentMap.get(symbol),
        positionMap.has(symbol),
        positionMap.get(symbol),
        portfolioValue,
        swingAlertMap.get(symbol) ?? null,
        sectorSentimentMap.get(getSectorForSymbolDynamic(symbol) ?? '') ?? null,
      ),
    )
    .filter((o): o is Opportunity => o !== null)
    .sort((a, b) => b.opportunityScore - a.opportunityScore);

  // Mark anti-hype status
  for (const opp of opportunities) {
    opp.passedAntiHype = antiHypeSet.has(opp.symbol);
  }

  console.log(`[opportunities] Fase 2.5: scoring completado — ${opportunities.length} oportunidades`);

  // Integrate intelligence alerts into opportunity risks
  for (const alert of intelligence.alerts) {
    if (alert.symbol && (alert.type === 'negative_pressure' || alert.type === 'unconfirmed_rumor')) {
      const opp = opportunities.find(o => o.symbol === alert.symbol);
      if (opp && !opp.risks.includes(alert.message)) {
        opp.risks = [...opp.risks.slice(0, 1), alert.message].slice(0, 3);
      }
    }
  }

  // ============================================================
  updateProgress('Análisis unificado con IA', 6);
  // FASE 3: Análisis unificado — un análisis por activo, mismo modelo
  // Reemplaza: enrichWithLLM + generateDeepAnalyses + generateSymbolNarratives
  // ============================================================
  let engineDetail = 'Hibrido (algoritmico)';
  let usedEngine: AnalysisEngine = 'hybrid';

  // FASE 3.5: Conflictos ya calculados en scoreOpportunity con contexto completo
  // (timingTriggers, baseAction, weeklyDivergences, etc.)
  const conflictCount = opportunities.filter(o => o.signalConflicts && o.signalConflicts.length > 0).length;
  console.log(`[opportunities] Fase 3.5: ${conflictCount} oportunidades con conflictos de senales detectados`);

  try {
    const macroHeadlines = intelligence.plazas
      .flatMap((p) => p.symbolTrends.flatMap((t) => t.topHeadlines))
      .filter((h, i, arr) => arr.indexOf(h) === i)
      .slice(0, 10);
    const macroContextStr = macroHeadlines.length > 0
      ? `[CONTEXTO MACRO - noticias recientes]\n${macroHeadlines.map((h) => `- ${h}`).join('\n')}`
      : '';

    const unifiedAnalyses = await runUnifiedAnalysis(
      opportunities,
      techMap,
      fundMap,
      sentimentMap,
      12,
      pipelineRunId,
      macroContextStr,
      causalContextMap,
    );

    for (const opp of opportunities) {
      const unified = unifiedAnalyses.get(opp.symbol);
      if (!unified) continue;

      // Poblar campos existentes desde unified analysis (retrocompatibilidad UI)
      opp.unifiedAnalysis = unified;
      opp.reasoning = unified.thesis;
      opp.catalysts = unified.catalysts;
      opp.risks = unified.risks;
      opp.narrativeDigest = unified.narrative;

      // deepAnalysis retrocompat (UI puede leerlo desde unifiedAnalysis.wouldDo)
      opp.deepAnalysis = {
        positives: unified.catalysts,
        concerns: unified.risks,
        recommendation: unified.thesis,
        wouldDo: unified.wouldDo,
        wouldNotDo: unified.wouldNotDo,
        generatedBy: unified.generatedBy as 'deepseek' | 'groq' | 'qwen' | 'algorithmic',
      };
    }

    // Exponer para STAGE 4 (market-report)
    _lastUnifiedAnalyses = unifiedAnalyses;

    usedEngine = 'hybrid';
    engineDetail = `Hibrido — scoring algoritmico + DeepSeek R1 análisis unificado (${unifiedAnalyses.size} activos)`;
    console.log(`[opportunities] Análisis unificado: ${unifiedAnalyses.size}/${opportunities.length} activos`);
  } catch (err) {
    console.warn('[opportunities] Unified analysis failed (non-critical):', (err as Error).message?.slice(0, 100));
    engineDetail = 'Algoritmico (análisis unificado no disponible)';
  }

  cachedResult = {
    scannedAt: Date.now(),
    totalSymbolsScanned: allSymbols.length,
    opportunities,
    sectorSummary: buildSectorSummary(allSymbols, opportunities),
    analysisEngine: usedEngine,
    analysisDetail: engineDetail,
    source: 'live',
  };

  updateProgress('Guardando resultados y generando reporte', 7);

  persistScanResult(cachedResult);

  // --- Persist daily intelligence report ---
  const passedAntiHype = opportunities.filter((o) => o.passedAntiHype !== false);
  const topRecommendations = passedAntiHype
    .sort((a, b) => b.opportunityScore - a.opportunityScore)
    .slice(0, 10);

  const triangulationStats: Record<'high' | 'medium' | 'low', number> = { high: 0, medium: 0, low: 0 };

  persistDailyReport({
    reportType: 'on-demand',
    newsSourceStats: getSourceStats(),
    totalNewsCount: intelligence.totalNewsCount,
    triangulationStats,
    secondOrderEffects,
    antiHypeResults: antiHypeResult,
    topRecommendations,
    sectorSummary: cachedResult.sectorSummary,
    totalSymbolsScanned: allSymbols.length,
    analysisEngine: usedEngine,
    analysisDetail: engineDetail,
  });

  // Signal tracking: registrar señales BUY/SELL y resolver pendientes
  try {
    const recorded = recordSignals(cachedResult.opportunities);
    if (recorded > 0) console.log(`[SignalTracking] ${recorded} señales registradas`);
    const resolved = await resolveExpiredSignals();
    if (resolved > 0) console.log(`[SignalTracking] ${resolved} señales resueltas`);
  } catch (err) {
    console.warn('[SignalTracking] Error:', err);
  }

  // Track missed opportunities (WATCH/HOLD) for retrospective analysis
  try {
    const missedCount = recordMissedOpportunities(opportunities);
    if (missedCount > 0) {
      console.log(`[opportunities] Registradas ${missedCount} oportunidades WATCH/HOLD para tracking`);
    }
  } catch (err) {
    console.warn('[opportunities] recordMissedOpportunities error:', err);
  }

  return cachedResult;
}

// --- Sector summary ---

function buildSectorSummary(
  symbols: string[],
  opportunities: Opportunity[],
): SectorSummary[] {
  // Build sectors from actual opportunities (dynamic)
  const sectors = new Set<OpportunitySector>();
  for (const s of symbols) {
    const sector = getSectorForSymbolDynamic(s);
    if (sector) sectors.add(sector);
  }

  return Array.from(sectors).map((sector) => {
    const sectorOpps = opportunities.filter((o) => o.sector === sector);
    const sectorSymbolCount = symbols.filter(s => getSectorForSymbolDynamic(s) === sector).length;
    const avgScore = sectorOpps.length > 0
      ? Math.round(sectorOpps.reduce((sum, o) => sum + o.opportunityScore, 0) / sectorOpps.length)
      : 0;
    const top = sectorOpps.length > 0 ? sectorOpps[0].symbol : null;
    const buyCount = sectorOpps.filter((o) => o.action === 'BUY').length;

    return {
      sector,
      label: OPPORTUNITY_UNIVERSE[sector]?.label ?? sector,
      symbolCount: sectorSymbolCount,
      avgScore,
      topOpportunity: top,
      sectorOutlook: `${buyCount} de ${sectorOpps.length} activos recomendados para compra`,
    };
  });
}

// --- Persistence ---

function persistScanResult(result: OpportunityScanResult): void {
  try {
    const scannedAtISO = new Date(result.scannedAt).toISOString();

    const scanRow = insertOpportunityScan({
      scannedAt: scannedAtISO,
      engine: result.analysisEngine,
      engineDetail: result.analysisDetail,
      totalSymbolsScanned: result.totalSymbolsScanned,
      opportunityCount: result.opportunities.length,
      opportunities: JSON.stringify(result.opportunities),
      sectorSummary: JSON.stringify(result.sectorSummary),
    });

    const scanId = Number(scanRow.lastInsertRowid);

    const snapshots = result.opportunities.map((o) => ({
      scanId,
      symbol: o.symbol,
      sector: o.sector,
      opportunityScore: o.opportunityScore,
      recommendation: o.action,
      currentPrice: o.currentPrice,
      shortTermMid: o.shortTerm.midPercent,
      mediumTermMid: o.mediumTerm.midPercent,
      confidence: o.confidence,
      reasoning: o.reasoning,
      data: JSON.stringify(o),
      scannedAt: scannedAtISO,
    }));

    insertOpportunitySnapshots(snapshots);
    console.log(`[opportunities] Persisted scan #${scanId}: ${snapshots.length} snapshots`);
  } catch (err) {
    console.error('[opportunities] Failed to persist scan result:', (err as Error).message);
  }
}

// --- History queries ---

export function getOpportunityScanHistory(limit: number = 20) {
  return getOpportunityScans(limit);
}

export function getOpportunityScanDetail(scanId: number) {
  const scan = getOpportunityScanById(scanId);
  if (!scan) return null;
  return {
    ...scan,
    opportunities: JSON.parse(scan.opportunities) as Opportunity[],
    sectorSummary: JSON.parse(scan.sectorSummary) as SectorSummary[],
  };
}

export function getSymbolScoreHistory(symbol: string, limit: number = 30) {
  return getSymbolHistory(symbol, limit);
}

// ============================================================
// 3 PROCESOS INDEPENDIENTES
// ============================================================

const processTimestamps = {
  newsLastRun: null as number | null,
  fundamentalsLastRun: null as number | null,
  analysisLastRun: null as number | null,
};

export function getProcessTimestamps() {
  // Read from BD if in-memory is empty (survives restarts)
  const newsFromBD = getNewsCacheAge();
  const fundFromBD = getFundamentalCacheAge();

  return {
    news: processTimestamps.newsLastRun ?? (newsFromBD ? new Date(newsFromBD).getTime() : null),
    fundamentals: processTimestamps.fundamentalsLastRun ?? (fundFromBD ? new Date(fundFromBD).getTime() : null),
    analysis: processTimestamps.analysisLastRun ?? (cachedResult?.scannedAt ?? null),
  };
}

/**
 * Proceso A: Actualizar noticias + identificar sectores + informes
 * ~30s. Se corre 1 vez al día o manual.
 */
export async function refreshNewsProcess(): Promise<{ newsCount: number; sectorsFound: number }> {
  console.log('[Process A] Actualizando noticias...');

  // 1. Fetch + analyze news
  const intelligence = await getIntelligence();

  processTimestamps.newsLastRun = Date.now();
  console.log(`[Process A] Completado: ${intelligence.totalNewsCount} noticias`);

  return { newsCount: intelligence.totalNewsCount, sectorsFound: 0 };
}

/**
 * Fetches fundamentals for symbols that don't have a cache entry yet.
 * Fire-and-forget — does not block the caller.
 */
function fetchFundamentalsForNewSymbols(candidates: string[]): void {
  if (candidates.length === 0) return;
  (async () => {
    const { getFundamentals } = await import('../shared/yahoo.js');
    const { getFundamentalFromCache: getCache, upsertFundamentalCache } = await import('../db/repository.js');
    const newSymbols = candidates.filter(s => !getCache(s));
    if (newSymbols.length === 0) return;
    console.log(`[Process A] Fetching fundamentals for ${newSymbols.length} new symbols: ${newSymbols.slice(0, 5).join(', ')}${newSymbols.length > 5 ? '...' : ''}`);
    for (const symbol of newSymbols) {
      try {
        const data = await getFundamentals(symbol);
        upsertFundamentalCache(symbol, JSON.stringify(data));
        console.log(`[Process A] Fundamentales cacheados: ${symbol}`);
      } catch {
        // Non-critical — skip silently
      }
      await new Promise(r => setTimeout(r, 500)); // throttle
    }
  })().catch(() => { /* non-critical */ });
}

/**
 * Proceso B: Actualizar fundamentales
 * ~60s. Se corre 1 vez por semana o manual.
 */
export async function refreshFundamentalsProcess(): Promise<{ refreshed: number }> {
  const { forceRefreshFundamentals } = await import('../fundamental/fundamental-analysis.service.js');
  const { getTickersFromSectorReports } = await import('../intelligence/sector-report.service.js');

  console.log('[Process B] Actualizando fundamentales...');

  // All symbols: watchlist + portfolio + discovered + sector-suggested
  const dbSymbols = getActiveSymbolList();
  const portfolioSymbols = getPortfolioPositions().map(p => p.symbol);
  const discovered = getDiscoveredTickers().map(t => t.symbol);
  const sectorTickers = getTickersFromSectorReports();
  const allSymbols = [...new Set([...dbSymbols, ...portfolioSymbols, ...discovered, ...sectorTickers])];

  const refreshed = await forceRefreshFundamentals(allSymbols);

  processTimestamps.fundamentalsLastRun = Date.now();
  console.log(`[Process B] Completado: ${refreshed}/${allSymbols.length} fundamentales actualizados`);

  return { refreshed };
}

/**
 * Proceso C: Analizar (usa data de BD, no fetch)
 * ~15s. Se corre cada vez que el usuario presiona "Analizar".
 */
export async function runAnalysis(): Promise<OpportunityScanResult> {
  if (scanProgress.isScanning) {
    return cachedResult ?? {
      scannedAt: Date.now(), totalSymbolsScanned: 0, opportunities: [],
      sectorSummary: [], analysisEngine: 'algorithmic',
      analysisDetail: 'Ya hay un analisis en curso...', source: 'live' as const,
    };
  }

  scanProgress.isScanning = true;
  scanProgress.startedAt = Date.now();
  scanProgress.stepsCompleted = [];
  scanProgress.percentComplete = 0;
  cachedResult = null;

  // Run in background
  runLiveScan()
    .then(result => { cachedResult = result; processTimestamps.analysisLastRun = Date.now(); })
    .catch(err => console.error('[Process C] Analysis failed:', err))
    .finally(() => {
      scanProgress.isScanning = false;
      scanProgress.percentComplete = 100;
      scanProgress.currentStep = 'Completado';
    });

  const fromDB = tryLoadFromDB();
  return fromDB ?? {
    scannedAt: Date.now(), totalSymbolsScanned: 0, opportunities: [],
    sectorSummary: [], analysisEngine: 'algorithmic',
    analysisDetail: 'Analizando en segundo plano...', source: 'live' as const,
  };
}

/**
 * Blocking variant — used by the unified pipeline.
 * Awaits runLiveScan() fully before returning.
 */
export async function runAnalysisBlocking(pipelineRunId?: number, sectors?: OpportunitySector[]): Promise<OpportunityScanResult> {
  if (scanProgress.isScanning) {
    return cachedResult ?? {
      scannedAt: Date.now(), totalSymbolsScanned: 0, opportunities: [],
      sectorSummary: [], analysisEngine: 'algorithmic',
      analysisDetail: 'Ya hay un análisis en curso.', source: 'live' as const,
    };
  }

  scanProgress.isScanning = true;
  scanProgress.startedAt = Date.now();
  scanProgress.stepsCompleted = [];
  scanProgress.percentComplete = 0;
  cachedResult = null;

  try {
    const result = await runLiveScan(sectors, pipelineRunId);
    cachedResult = result;
    processTimestamps.analysisLastRun = Date.now();
    return result;
  } finally {
    scanProgress.isScanning = false;
    scanProgress.percentComplete = 100;
    scanProgress.currentStep = 'Completado';
  }
}

export async function refreshOpportunities(sectors?: OpportunitySector[], aiMode: 'cloud' | 'local' = 'cloud'): Promise<OpportunityScanResult> {
  if (scanProgress.isScanning) {
    // Already scanning, return current data or empty
    return cachedResult ?? {
      scannedAt: Date.now(),
      totalSymbolsScanned: 0,
      opportunities: [],
      sectorSummary: [],
      analysisEngine: 'algorithmic',
      analysisDetail: 'Ya hay un escaneo en curso...',
      source: 'live' as const,
    };
  }

  scanProgress.isScanning = true;
  scanProgress.startedAt = Date.now();
  scanProgress.stepsCompleted = [];
  scanProgress.percentComplete = 0;
  cachedResult = null;
  dbCacheInvalidated = true; // bloquear carga de DB hasta que el nuevo scan esté listo

  setRunAiMode(aiMode);
  // Run in background — return immediately with status
  runLiveScan(sectors)
    .then(result => { cachedResult = result; dbCacheInvalidated = false; })
    .catch(err => console.error('[opportunities] Refresh scan failed:', err))
    .finally(() => {
      scanProgress.isScanning = false;
      scanProgress.percentComplete = 100;
      scanProgress.currentStep = 'Completado';
      dbCacheInvalidated = false;
    });

  // Return DB data while scanning, or empty
  const fromDB = tryLoadFromDB();
  return fromDB ?? {
    scannedAt: Date.now(),
    totalSymbolsScanned: 0,
    opportunities: [],
    sectorSummary: [],
    analysisEngine: 'algorithmic',
    analysisDetail: 'Actualizando analisis en segundo plano...',
    source: 'live' as const,
  };
}

/**
 * Full pipeline: Noticias → Fundamentales (si necesario) → Análisis.
 * Un solo botón que hace todo. Non-blocking.
 */
export async function runFullPipeline(): Promise<{ started: boolean; message: string }> {
  // Delegate to the unified tracked pipeline (avoids circular import via dynamic import)
  const { checkOrRunPipeline } = await import('../intelligence/pipeline.service.js');
  checkOrRunPipeline(false).catch(err => console.error('[runFullPipeline] pipeline error:', err));
  return { started: true, message: 'Pipeline unificado iniciado' };
}
