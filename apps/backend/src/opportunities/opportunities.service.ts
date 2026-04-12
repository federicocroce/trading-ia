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
  OPPORTUNITY_ENRICHMENT_PROMPT,
  OPPORTUNITY_UNIVERSE,
} from '@trading/shared';
import { callAI } from '../shared/ai-router.js';
import { getTechnicalSummary } from '../technical/technical-analysis.service.js';
import { getFundamentalSummary } from '../fundamental/fundamental-analysis.service.js';
import { getIntelligence, getIntelligenceFromDB, getAnalyzedNews } from '../news/news-intelligence.service.js';
import { analyzeSecondOrderEffects } from '../analysis/sector-correlation.service.js';
import { persistDailyReport } from '../intelligence/daily-report.service.js';
import { recordSignals, resolveExpiredSignals, recordMissedOpportunities } from './signal-tracking.service.js';
import { generateSymbolNarratives, generateDailyDigest } from '../intelligence/market-digest.service.js';
import { getFullSymbolUniverse, getSectorForSymbolDynamic, getSectorLabelDynamic, getDiscoveredTickers, pruneExpiredDiscoveries, getClassificationForSymbol } from '../discovery/discovery-registry.js';
import { classifyAssets } from '../discovery/asset-classifier.js';
import { getSourceStats } from '../news/news.service.js';
import { getTriangulationStats } from '../news/triangulation.service.js';
import {
  getActiveSymbolList,
  getPortfolioPositions,
  insertOpportunityScan,
  insertOpportunitySnapshots,
  getLatestOpportunityScan,
  getOpportunityScans,
  getOpportunityScanById,
  getSymbolHistory,
  getNewsCacheAge,
  getFundamentalCacheAge,
} from '../db/repository.js';
import {
  buildAlgorithmicOpportunity,
  filterSymbolsByPositiveSectors,
  applyAntiHypeFilters,
  type SentimentInput,
  type AntiHypeFilterResult,
} from './scoring.js';

// --- In-memory cache (survives within same process, backed by DB) ---
let cachedResult: OpportunityScanResult | null = null;
let cachedMarketDigest: import('@trading/shared').MarketDigest | null = null;
// Cuando se fuerza un refresh, no cargar el scan viejo de DB hasta que el nuevo termine
let dbCacheInvalidated = false;

export function getMarketDigest() {
  return cachedMarketDigest;
}

function todayDateStr(): string {
  return new Date().toISOString().slice(0, 10);
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
  delayMs: number = 1000,
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

// --- LLM Enrichment (Fase 3) ---

function extractJSON(text: string): string {
  const fenceMatch = text.match(/```(?:json)?\s*([\s\S]*?)```/);
  if (fenceMatch) return fenceMatch[1].trim();
  const braceStart = text.indexOf('{');
  const braceEnd = text.lastIndexOf('}');
  if (braceStart !== -1 && braceEnd > braceStart) {
    return text.slice(braceStart, braceEnd + 1);
  }
  return text;
}

interface Enrichment {
  reasoning: string;
  catalysts: string[];
  risks: string[];
}

function buildEnrichmentMessage(
  opportunities: Opportunity[],
  _techMap: Map<string, TechnicalSummary>,
  _fundMap: Map<string, FundamentalSummary>,
  sentimentMap: Map<string, SentimentInput>,
): string {
  const lines: string[] = [];

  for (const opp of opportunities) {
    const sent = sentimentMap.get(opp.symbol);
    const sector = getSectorForSymbolDynamic(opp.symbol);
    const sectorLabel = sector ? getSectorLabelDynamic(opp.symbol, sector) : 'Otros';

    // Line 1: Symbol, sector, score, action
    lines.push(`=== ${opp.symbol} (${sectorLabel}) — Score: ${opp.opportunityScore}/100, Action: ${opp.action} ===`);

    // Line 2: Top 3 confluence signals (already processed by algorithmic scoring)
    const conf = opp.confluenceDetail;
    if (conf) {
      const topSignals = opp.action === 'SELL'
        ? conf.bearishSignals.slice(0, 3)
        : conf.bullishSignals.slice(0, 3);
      if (topSignals.length > 0) {
        lines.push(`  Top signals: ${topSignals.join(', ')}`);
      }
    }

    // Line 3: Sentiment score + 1 top headline
    if (sent) {
      const topHeadline = sent.headlines.length > 0 ? ` Top: "${sent.headlines[0]}"` : '';
      lines.push(`  Sentiment: ${sent.score >= 0 ? '+' : ''}${sent.score.toFixed(1)}, ${sent.headlines.length} headlines.${topHeadline}`);
    }

    // Line 4: Signal conflicts (1-line summary) if any
    if (opp.signalConflicts && opp.signalConflicts.length > 0) {
      const conflictSummary = opp.signalConflicts
        .slice(0, 2)
        .map(c => `${c.signalA} vs ${c.signalB} (${c.implication})`)
        .join('; ');
      lines.push(`  Conflicts: ${conflictSummary}`);
    }

    lines.push('');
  }

  return lines.join('\n');
}

async function enrichWithLLM(
  topOpportunities: Opportunity[],
  techMap: Map<string, TechnicalSummary>,
  fundMap: Map<string, FundamentalSummary>,
  sentimentMap: Map<string, SentimentInput>,
): Promise<Map<string, Enrichment>> {
  const result = new Map<string, Enrichment>();

  try {
    const userMessage = buildEnrichmentMessage(topOpportunities, techMap, fundMap, sentimentMap);
    console.log(`[opportunities] Fase 3: enriqueciendo ${topOpportunities.length} símbolos con LM Studio (${userMessage.length} chars)`);

    const raw = await callAI('classification', userMessage, OPPORTUNITY_ENRICHMENT_PROMPT, 4096);
    const jsonStr = extractJSON(raw);
    const parsed = JSON.parse(jsonStr);

    if (parsed.enrichments && Array.isArray(parsed.enrichments)) {
      for (const e of parsed.enrichments) {
        if (e.symbol && e.reasoning) {
          result.set(e.symbol, {
            reasoning: e.reasoning,
            catalysts: e.catalysts ?? [],
            risks: e.risks ?? [],
          });
        }
      }
    }

    console.log(`[opportunities] LM Studio enriqueció ${result.size}/${topOpportunities.length} símbolos`);
  } catch (err) {
    console.warn(`[opportunities] LM Studio enrichment failed: ${(err as Error).message.slice(0, 150)}`);
    console.warn(`[opportunities] Usando reasoning algoritmico para todos los símbolos`);
  }

  return result;
}

// --- Main pipeline ---

const TOP_N_FOR_LLM = 10;

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
  estimatedTotalSeconds: 90,
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

async function runLiveScan(sectors?: OpportunitySector[]): Promise<OpportunityScanResult> {
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

  const dbSymbols = getActiveSymbolList(); // portfolio + watchlist
  const discovered = getDiscoveredTickers().map(t => t.symbol);
  const allSymbols = [...new Set([...dbSymbols, ...discovered])];

  console.log(`[opportunities] Paso 2: ${allSymbols.length} simbolos (${dbSymbols.length} watchlist + ${discovered.length} descubiertos por noticias)`);

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

  const filteredSymbols = filterSymbolsByPositiveSectors(allSymbols, plazaSentiments, activeSymbols);

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
  updateProgress('Enriqueciendo con IA (LM Studio)', 5);

  // FASE 3: Enriquecimiento LLM (solo top N que pasaron anti-hype)
  // ============================================================
  const topForLLM = opportunities
    .filter((o) => o.passedAntiHype !== false)
    .slice(0, TOP_N_FOR_LLM);
  let engineDetail = 'Hibrido (algoritmico)';
  let usedEngine: AnalysisEngine = 'hybrid';

  if (topForLLM.length > 0) {
    const enrichments = await enrichWithLLM(topForLLM, techMap, fundMap, sentimentMap);

    if (enrichments.size > 0) {
      for (const opp of opportunities) {
        const enrichment = enrichments.get(opp.symbol);
        if (enrichment) {
          opp.reasoning = enrichment.reasoning;
          if (enrichment.catalysts.length > 0) opp.catalysts = enrichment.catalysts.slice(0, 3);
          if (enrichment.risks.length > 0) opp.risks = enrichment.risks.slice(0, 2);
        }
      }
      engineDetail = `Hibrido — scoring algoritmico + LM Studio (${process.env.LMSTUDIO_MODEL ?? 'local-model'}) para reasoning`;
    } else {
      engineDetail = 'Hibrido (algoritmico, LM Studio no disponible)';
    }
  }

  console.log(`[opportunities] Analysis engine: ${engineDetail}`);

  // ============================================================
  updateProgress('Detectando conflictos y generando narrativas', 6);

  // FASE 3.5: Conflictos ya calculados en scoreOpportunity con contexto completo
  // (timingTriggers, baseAction, weeklyDivergences, etc.)
  const conflictCount = opportunities.filter(o => o.signalConflicts && o.signalConflicts.length > 0).length;
  console.log(`[opportunities] Fase 3.5: ${conflictCount} oportunidades con conflictos de senales detectados`);

  // ============================================================
  // FASE 3.7: Narrativas por símbolo (1 llamada LLM batch)
  // ============================================================
  try {
    const topForNarrative = opportunities
      .filter(o => o.action === 'BUY' || o.action === 'SELL')
      .filter(o => o.passedAntiHype !== false)
      .slice(0, 8);

    if (topForNarrative.length > 0) {
      const narratives = await generateSymbolNarratives(topForNarrative, techMap, fundMap, sentimentMap);
      for (const opp of opportunities) {
        const narrative = narratives.get(opp.symbol);
        if (narrative) opp.narrativeDigest = narrative;
      }
      console.log(`[opportunities] Fase 3.7: ${narratives.size} narrativas generadas`);
    }
  } catch (err) {
    console.warn('[opportunities] Fase 3.7: narrativas fallaron:', err);
  }

  // ============================================================
  // DEEP ANALYSIS: análisis profundo por activo (DeepSeek R1 para portfolio + top BUY/SELL)
  // ============================================================
  try {
    const { generateDeepAnalyses } = await import('../intelligence/market-digest.service.js');
    const deepAnalyses = await generateDeepAnalyses(opportunities, techMap, fundMap, sentimentMap);
    for (const opp of opportunities) {
      const deep = deepAnalyses.get(opp.symbol);
      if (deep) opp.deepAnalysis = deep;
    }
  } catch (err) {
    console.warn('[opportunities] Deep analysis failed (non-critical):', (err as Error).message?.slice(0, 100));
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

  // Get triangulation stats from BD (no LLM re-analysis)
  const { getNewsFromDB } = await import('../news/news.service.js');
  const { triangulateNews } = await import('../news/triangulation.service.js');
  const dbNews = getNewsFromDB();
  const triangulated = triangulateNews(dbNews);
  const triangulationStats = getTriangulationStats(triangulated as any);

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

  // ============================================================
  updateProgress('Generando market digest con IA', 8);

  // FASE 5: Market Digest (1 llamada LLM)
  // ============================================================
  try {
    const topHeadlines = dbNews.slice(0, 8).map((n: any) => n.title);
    const digest = await generateDailyDigest(
      opportunities,
      secondOrderEffects,
      { totalNewsCount: intelligence.totalNewsCount, topHeadlines },
      cachedResult.sectorSummary,
    );
    if (digest) {
      cachedMarketDigest = digest;
      console.log(`[opportunities] Fase 5: market digest generado (mood: ${digest.marketMood})`);
    }
  } catch (err) {
    console.warn('[opportunities] Fase 5: market digest fallo:', err);
  }

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
  const { runSectorAnalysis } = await import('../intelligence/sector-report.service.js');

  console.log('[Process A] Actualizando noticias...');

  // 1. Fetch + analyze news
  const intelligence = await getIntelligence();

  // 2. Extract headlines
  const headlines = intelligence.plazas
    .flatMap(p => (p.symbolTrends as SymbolTrend[]).flatMap(t => t.topHeadlines))
    .slice(0, 30);

  // 3. Run sector analysis (identify impacts + generate reports + persist)
  const sectorReports = await runSectorAnalysis(headlines);

  // 4. Register tickers from sector reports as discovered
  const { registerNovelTickers } = await import('../discovery/discovery-registry.js');
  const suggestedTickers = sectorReports.flatMap(r => r.suggestedTickers);
  if (suggestedTickers.length > 0) {
    try {
      const registered = await registerNovelTickers(suggestedTickers, 'llm');
      console.log(`[Process A] ${registered} tickers registrados de sector reports`);
    } catch { /* non-critical */ }
  }

  processTimestamps.newsLastRun = Date.now();
  console.log(`[Process A] Completado: ${intelligence.totalNewsCount} noticias, ${sectorReports.length} sectores`);

  return { newsCount: intelligence.totalNewsCount, sectorsFound: sectorReports.length };
}

/**
 * Proceso B: Actualizar fundamentales
 * ~60s. Se corre 1 vez por semana o manual.
 */
export async function refreshFundamentalsProcess(): Promise<{ refreshed: number }> {
  const { forceRefreshFundamentals } = await import('../fundamental/fundamental-analysis.service.js');
  const { getTickersFromSectorReports } = await import('../intelligence/sector-report.service.js');

  console.log('[Process B] Actualizando fundamentales...');

  // All symbols: watchlist + discovered + sector-suggested
  const dbSymbols = getActiveSymbolList();
  const discovered = getDiscoveredTickers().map(t => t.symbol);
  const sectorTickers = getTickersFromSectorReports();
  const allSymbols = [...new Set([...dbSymbols, ...discovered, ...sectorTickers])];

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
export async function runAnalysisBlocking(): Promise<OpportunityScanResult> {
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
    const result = await runLiveScan();
    cachedResult = result;
    processTimestamps.analysisLastRun = Date.now();
    return result;
  } finally {
    scanProgress.isScanning = false;
    scanProgress.percentComplete = 100;
    scanProgress.currentStep = 'Completado';
  }
}

export async function refreshOpportunities(sectors?: OpportunitySector[]): Promise<OpportunityScanResult> {
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
