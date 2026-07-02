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
import { resolveWatchlistItems } from './watchlist-tracking.service.js';
import { isExcludedInstrument, isTradeable } from './tradeability.js';
import { runUnifiedAnalysis } from '../intelligence/unified-analysis.service.js';
import { getSectorForSymbolDynamic, getDiscoveredTickers, pruneExpiredDiscoveries } from '../discovery/discovery-registry.js';
import { classifyAssets } from '../discovery/asset-classifier.js';
import { getSourceStats } from '../news/news.service.js';
import {
  getActiveSymbolList,
  getEtfSymbols,
  getPortfolioPositions,
  getCausalTickersByDate,
  getCausalMapByDate,
  insertOpportunityScan,
  insertAntiHypeRejections,
  getLatestNewsRadarSnapshot,
  insertOpportunitySnapshots,
  getLatestOpportunityScan,
  getOpportunityScans,
  getOpportunityScanById,
  getSymbolHistory,
  getNewsCacheAge,
  getFundamentalCacheAge,
  getMarketDigestByDate,
  upsertMarketDigest,
  getHistoricalFromCache,
  getActiveAnticipatoryAlerts,
  upsertAnticipatoryAlerts,
  expireAnticipatoryAlerts,
} from '../db/repository.js';
import { buildAlertsFromScan, reconcileAlerts } from './anticipatory-alerts.js';
import {
  buildAlgorithmicOpportunity,
} from './scoring.js';
import { buildPortfolioContext, buildPortfolioDiagnostic, computePortfolioAdjustment } from './portfolio-risk.service.js';
import { factorsForSymbol } from './risk-factor-map.js';
import { toReturns } from './correlation.js';
import { getPortfolio } from '../portfolio/portfolio.service.js';
import type { OHLC, PortfolioDiagnostic } from '@trading/shared';

/** Daily returns for a symbol from the BD historical cache (no network). [] if absent. */
function returnsFromHistoricalCache(symbol: string): number[] {
  const cached = getHistoricalFromCache(symbol, 'daily');
  if (!cached) return [];
  try {
    const hist = JSON.parse(cached) as OHLC[];
    return toReturns(hist.map((b) => b.close).filter((c): c is number => typeof c === 'number'));
  } catch {
    return [];
  }
}
import { getEvidenceScoreMap } from '../evidence-signals/evidence-score.service.js';
import {
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

// LLM occasionally returns wouldDo/wouldNotDo as objects ({ticker, precioEntrada, stop, razon})
// instead of strings; coerce so the UI never tries to render an object as a React child.
function coerceTextItem(x: unknown): string {
  if (typeof x === 'string') return x;
  if (x && typeof x === 'object') {
    const o = x as Record<string, unknown>;
    const ticker = o.ticker ?? o.symbol;
    const entry = o.precioEntrada ?? o.entry ?? o.entryPrice ?? o.precio;
    const stop = o.stop ?? o.stopLoss;
    const target = o.target ?? o.takeProfit;
    const reason = o.razon ?? (o as Record<string, unknown>)['razón'] ?? o.reason ?? o.narrative ?? o.thesis;
    if (ticker) {
      const parts: string[] = [String(ticker)];
      if (entry != null) parts.push(`@ $${entry}`);
      if (stop != null) parts.push(`(stop $${stop})`);
      if (target != null) parts.push(`(target $${target})`);
      if (reason) parts.push(`— ${reason}`);
      return parts.join(' ');
    }
    try { return JSON.stringify(x); } catch { return ''; }
  }
  return x == null ? '' : String(x);
}

export function getCurrentBuyTickers(): Set<string> {
  const scan = cachedResult ?? tryLoadFromDB();
  if (!scan?.opportunities) return new Set();
  return new Set(
    scan.opportunities
      .filter((o: { action?: string }) => o.action === 'BUY')
      .map((o: { symbol: string }) => o.symbol.toUpperCase())
  );
}

export function filterItemsVsBuyTickers(items: string[], buyTickers: Set<string>): string[] {
  return items.filter(item => {
    // Drop bare-ticker entries (no concrete reason): require >= 4 words
    const wordCount = item.replace(/[-•*]/g, '').trim().split(/\s+/).filter(Boolean).length;
    if (wordCount < 4) return false;
    if (buyTickers.size === 0) return true;
    const upper = item.toUpperCase();
    for (const t of buyTickers) {
      const escaped = t.replace(/[-/\\^$*+?.()|[\]{}]/g, '\\$&');
      const re = new RegExp(`(^|[^A-Z0-9])${escaped}([^A-Z0-9]|$)`);
      if (re.test(upper)) return false;
    }
    return true;
  });
}

const VALID_DIGEST_ACTIONS = new Set(['BUY', 'SELL', 'HOLD', 'WATCH']);

function coerceRecommendations(v: unknown): import('@trading/shared').DigestRecommendation[] {
  if (!Array.isArray(v)) return [];
  const out: import('@trading/shared').DigestRecommendation[] = [];
  for (const raw of v as any[]) {
    if (!raw || typeof raw !== 'object') continue;
    if (typeof raw.symbol !== 'string' || !VALID_DIGEST_ACTIONS.has(raw.action)) continue;
    const rec: import('@trading/shared').DigestRecommendation = {
      symbol: String(raw.symbol),
      action: raw.action,
      reason: typeof raw.reason === 'string' ? raw.reason : '',
      currentPrice: Number(raw.currentPrice) || 0,
      score: Number(raw.score) || 0,
    };
    // Trade levels only survive on a real BUY — mirror the projection invariant.
    const tl = raw.tradeLevels;
    if (raw.action === 'BUY' && tl && typeof tl === 'object'
      && [tl.entryPrice, tl.stopLoss, tl.takeProfit].every((n: unknown) => typeof n === 'number')) {
      rec.tradeLevels = { entryPrice: tl.entryPrice, stopLoss: tl.stopLoss, takeProfit: tl.takeProfit };
    }
    out.push(rec);
  }
  return out;
}

function normalizeDigest(d: any): import('@trading/shared').MarketDigest {
  const arr = (v: unknown): string[] =>
    Array.isArray(v) ? (v as unknown[]).map(coerceTextItem).filter(s => s.length > 0) : [];

  // Drop legacy free-form string arrays (wouldDo/wouldNotDo + the 4 *WouldDo variants).
  // Old blobs can't be reconstructed into actions, so recommendations default to [] and
  // the UI shows a "regenerá" CTA; the next scan repopulates them from the projection.
  const {
    wouldDo: _w, wouldNotDo: _wn,
    portfolioWouldDo: _pwd, portfolioWouldNotDo: _pwnd,
    marketWouldDo: _mwd, marketWouldNotDo: _mwnd,
    ...rest
  } = d ?? {};

  return {
    ...rest,
    portfolioRecommendations: coerceRecommendations(d?.portfolioRecommendations),
    marketRecommendations: coerceRecommendations(d?.marketRecommendations),
    warnings: arr(d?.warnings),
  } as import('@trading/shared').MarketDigest;
}

export function getMarketDigest(): import('@trading/shared').MarketDigest | null {
  if (cachedMarketDigest) return cachedMarketDigest;
  // Try to load today's digest from DB
  const today = getToday();
  const raw = getMarketDigestByDate(today);
  if (raw) {
    try {
      cachedMarketDigest = normalizeDigest(JSON.parse(raw) as import('@trading/shared').MarketDigest);
      return cachedMarketDigest;
    } catch { /* ignore */ }
  }
  return null;
}

export function setMarketDigest(digest: import('@trading/shared').MarketDigest) {
  cachedMarketDigest = normalizeDigest(digest);
  // Persist to DB
  const today = getToday();
  try {
    upsertMarketDigest(today, JSON.stringify(cachedMarketDigest));
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

/**
 * Diagnóstico de cartera al vuelo: concentración por factor, hedge faltante y
 * candidatos que diversifican vs apilan, computado desde la cartera actual + el
 * último scan (los verdicts ya vienen en cada Opportunity.portfolioAdjustment).
 */
export async function getPortfolioDiagnostic(): Promise<PortfolioDiagnostic> {
  const portfolio = await getPortfolio();
  const ctx = buildPortfolioContext(
    portfolio.positions.map((p) => ({
      symbol: p.symbol,
      value: p.value,
      returns: returnsFromHistoricalCache(p.symbol),
      sector: getSectorForSymbolDynamic(p.symbol) ?? undefined,
    })),
  );

  const scan = getLatestOpportunityScan();
  let candidateVerdicts: Array<{ symbol: string; verdict: 'stacks' | 'diversifies' | 'neutral' }> = [];
  if (scan?.opportunities) {
    try {
      const opps = JSON.parse(scan.opportunities) as Opportunity[];
      // Recompute the verdict on the fly so the panel works even for scans stored
      // before this feature existed (stored portfolioAdjustment may be absent).
      // Use intensity 1 for classification only — this does not touch any score.
      candidateVerdicts = opps.map((o) => ({
        symbol: o.symbol,
        verdict: o.portfolioAdjustment?.verdict
          ?? computePortfolioAdjustment(o.symbol, factorsForSymbol(o.symbol, o.sector), returnsFromHistoricalCache(o.symbol), ctx, 1).verdict,
      }));
    } catch { /* ignore malformed scan blob */ }
  }

  return buildPortfolioDiagnostic(ctx, candidateVerdicts);
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
  // Filtra el ruido del descubrimiento por noticias: bonos / MLPs / preferidas / fondos de renta
  // no son swing trades. (La liquidez se filtra después, con el volumen ya calculado.)
  const discovered = getDiscoveredTickers()
    .filter(t => !isExcludedInstrument(t.classification?.name, t.classification?.instrumentType))
    .map(t => t.symbol);
  // Portfolio always included; news-derived tickers replace hardcoded watchlist
  const etfSymbols = getEtfSymbols();
  const allSymbols = [...new Set([...portfolioSymbolsList, ...causalTickers, ...discovered, ...etfSymbols])];
  console.log(`[opportunities] ${allSymbols.length} simbolos (${portfolioSymbolsList.length} portfolio + ${causalTickers.length} causal + ${discovered.length} descubiertos + ${etfSymbols.length} ETFs)`);

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

  // === PORTFOLIO CONTEXT: factores + retornos de las posiciones, una vez por scan ===
  // Reutiliza la caché histórica (BD) que el análisis técnico ya pobló — sin refetch.
  const portfolioCtx = buildPortfolioContext(
    positions.map((pos) => {
      const price = techMap.get(pos.symbol)?.indicators.currentPrice ?? 0;
      return {
        symbol: pos.symbol,
        value: pos.quantity * price,
        returns: returnsFromHistoricalCache(pos.symbol),
        sector: getSectorForSymbolDynamic(pos.symbol) ?? undefined,
      };
    }),
  );

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
  // FASE 1.6: Inyectar señales del News Radar v2 al sentimentMap
  // El radar produce signals agregados (cause+impacts) por sector/ticker desde
  // las noticias filtradas + LLM. Esos signals se traducen en boost al sentScore
  // de cada symbol afectado, antes del scoring algorítmico.
  // ============================================================
  const radarBoostMap = new Map<string, { bonus: number; sources: string[]; conflict?: string }>();
  const radarConflictNegative = new Set<string>();  // tickers/sectors que el radar marca como negativos high-conviction
  try {
    const radarSnapshotRow = getLatestNewsRadarSnapshot();
    if (radarSnapshotRow) {
      const radarAge = Date.now() - new Date(radarSnapshotRow.generatedAt).getTime();
      const RADAR_FRESH_MS = 6 * 60 * 60 * 1000;  // 6h freshness
      if (radarAge < RADAR_FRESH_MS) {
        const aggregatedSignals = JSON.parse(radarSnapshotRow.aggregatedSignals) as Array<{
          target: string;
          type: 'ticker' | 'sector';
          netScore: number;
          totalScore: number;
          positiveArticles: string[];
          negativeArticles: string[];
        }>;

        // Build direct ticker map
        const tickerSignals = new Map<string, { netScore: number; total: number }>();
        const sectorSignals = new Map<string, { netScore: number; total: number }>();
        for (const s of aggregatedSignals) {
          if (s.type === 'ticker') tickerSignals.set(s.target.toUpperCase(), { netScore: s.netScore, total: s.totalScore });
          else sectorSignals.set(s.target.toLowerCase(), { netScore: s.netScore, total: s.totalScore });
        }

        // Map symbol → boost by checking direct hit + sector parent
        const { TICKER_TO_SECTOR } = await import('@trading/shared');
        const SCALE = 12;          // sentiment bonus per unit of netScore
        const MAX_BONUS = 25;      // cap to avoid radar dominating scoring
        const SECTOR_DAMP = 0.5;   // sector-derived bonus halved (less precise than direct)
        const HIGH_CONVICTION = 1.5;  // |netScore| >= this counts as high-conviction signal

        for (const symbol of allSymbols) {
          const upper = symbol.toUpperCase();
          let bonus = 0;
          const sources: string[] = [];

          const direct = tickerSignals.get(upper);
          if (direct) {
            bonus += direct.netScore * SCALE;
            sources.push(`ticker:${upper}=${direct.netScore.toFixed(1)}`);
          }

          const parentSector = TICKER_TO_SECTOR[upper];
          if (parentSector) {
            const sectorSig = sectorSignals.get(parentSector.toLowerCase());
            if (sectorSig) {
              bonus += sectorSig.netScore * SCALE * SECTOR_DAMP;
              sources.push(`sector:${parentSector}=${sectorSig.netScore.toFixed(1)}`);
            }
          }

          if (bonus !== 0) {
            const clamped = Math.max(-MAX_BONUS, Math.min(MAX_BONUS, bonus));
            radarBoostMap.set(symbol, { bonus: clamped, sources });
          }

          // Track high-conviction NEGATIVE signals for anti-hype contradiction check
          const directNeg = direct && direct.netScore <= -HIGH_CONVICTION;
          const sectorNeg = parentSector && (() => {
            const ss = sectorSignals.get(parentSector.toLowerCase());
            return ss && ss.netScore <= -HIGH_CONVICTION;
          })();
          if (directNeg || sectorNeg) radarConflictNegative.add(symbol);
        }

        // Apply boost: scale to -1..+1 sentiment range and merge into sentimentMap.
        // We use the sent.score (-1..+1) field; radar bonus is added as -0.25..+0.25.
        for (const [symbol, { bonus, sources }] of radarBoostMap) {
          const radarDelta = bonus / 100;  // 25 points → 0.25 sentiment delta
          const existing = sentimentMap.get(symbol);
          if (existing) {
            const newScore = Math.max(-1, Math.min(1, existing.score + radarDelta));
            // Detect conflict: pre-radar score was strongly opposite
            let conflict: string | undefined;
            if (Math.sign(existing.score) !== 0 && Math.sign(existing.score) !== Math.sign(radarDelta) && Math.abs(existing.score) > 0.3 && Math.abs(radarDelta) > 0.1) {
              conflict = `base=${existing.score.toFixed(2)} vs radar=${radarDelta.toFixed(2)}`;
              radarBoostMap.set(symbol, { bonus, sources, conflict });
            }
            sentimentMap.set(symbol, {
              ...existing,
              score: newScore,
              headlines: [...existing.headlines, `[radar] ${sources.join(', ')}`],
            });
          } else {
            // Symbol had no sentimentMap entry — radar creates one
            sentimentMap.set(symbol, {
              score: Math.max(-1, Math.min(1, radarDelta)),
              sentiment: radarDelta > 0 ? 'positive' : 'negative',
              headlines: [`[radar] ${sources.join(', ')}`],
            });
          }
        }

        const conflicts = [...radarBoostMap.entries()].filter(([, v]) => v.conflict);
        console.log(
          `[opportunities] Fase 1.6: radar v2 aplicado a ${radarBoostMap.size} symbols, ${conflicts.length} conflictos detectados` +
          (conflicts.length > 0 ? ` (${conflicts.slice(0, 3).map(([s, v]) => `${s}: ${v.conflict}`).join('; ')})` : ''),
        );
      } else {
        console.log(`[opportunities] Fase 1.6: radar snapshot stale (${Math.round(radarAge / 60_000)}min) — skipping`);
      }
    } else {
      console.log('[opportunities] Fase 1.6: no radar snapshot available — skipping');
    }
  } catch (err) {
    console.warn('[opportunities] Fase 1.6: radar integration failed:', (err as Error).message?.slice(0, 100));
  }

  // ============================================================
  updateProgress('Aplicando filtros anti-hype y scoring', 6);

  // FASE 2: Filtros anti-hype ANTES del scoring (ahorra procesamiento)
  // ============================================================
  const portfolioSymbols = new Set(positionMap.keys());
  const includeVolume = process.env.ANTIHYPE_VOLUME !== 'off';

  // Build news-impact bypass set: symbols mentioned in HIGH-impact recent news
  // bypass anti-hype regardless of technical posture (e.g. bonds below SMA200
  // with Fed news catalyst should still reach the LLM).
  // EXCEPTION: if radar v2 marks the symbol as high-conviction NEGATIVE, do NOT
  // bypass — radar contradicts the surface-level positive sentiment.
  const newsImpactBypass = new Set<string>();
  let radarOverridesBypass = 0;
  for (const [symbol, sent] of sentimentMap) {
    const headlines = sent.headlines?.length ?? 0;
    if (headlines > 0 && Math.abs(sent.score ?? 0) >= 0.4) {
      if (radarConflictNegative.has(symbol)) {
        radarOverridesBypass++;
        continue;  // radar says negative high-conviction — don't bypass anti-hype
      }
      newsImpactBypass.add(symbol);
    }
  }
  if (radarOverridesBypass > 0) {
    console.log(`[opportunities] Anti-hype bypass overridden for ${radarOverridesBypass} symbols by radar negative conviction`);
  }

  const antiHypeResult = applyAntiHypeFilters(
    filteredSymbols,
    techMap,
    portfolioSymbols,
    { includeVolume, newsImpactBypass },
  );

  const antiHypeSet = new Set(antiHypeResult.filtered);

  // Capture rejections for persistence (audit trail). Stored on the scan result
  // and saved alongside the scan in persistScanResult().
  const antiHypeRejectedForAudit = antiHypeResult.rejected.map(r => ({ symbol: r.symbol, reasons: r.reasons }));
  const antiHypeModeForAudit = antiHypeResult.mode;

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

  // Cargar evidence map (PEAD, insider, options flow) — 4to eje del composite
  const evidenceMap = getEvidenceScoreMap(symbolsToScore);
  const evidenceWithDataCount = Array.from(evidenceMap.values()).filter(e => e.hasData).length;
  console.log(`[opportunities] Evidence loaded: ${evidenceWithDataCount}/${symbolsToScore.length} symbols con datos vigentes`);

  // Cargar causal chains del día para macro modifier (ajuste -15..+15 al composite)
  const todayForMacro = getToday();
  const macroEvents = getCausalMapByDate(todayForMacro);
  const flatChains = macroEvents.flatMap(evt =>
    evt.chains.map(c => ({
      eventId: c.eventId,
      event: evt.event,
      ticker: c.ticker,
      category: c.category,
      direction: c.direction,
      impact: c.impact,
    })),
  );
  console.log(`[opportunities] Causal chains loaded: ${flatChains.length} ticker-event pairs (${macroEvents.length} events)`);

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
        evidenceMap.get(symbol),
        flatChains,
        portfolioCtx,
        returnsFromHistoricalCache(symbol),
      ),
    )
    .filter((o): o is Opportunity => o !== null)
    // Filtro de tradeabilidad: descarta ilíquidos / renta fija / MLPs / preferidas — PERO nunca
    // saca lo que ya tenés en cartera (eso siempre se muestra para que decidas).
    .filter((o) =>
      positionMap.has(o.symbol) ||
      isTradeable({ name: o.classification?.name, instrumentType: o.classification?.instrumentType, avgDollarVolume: o.avgDollarVolume }),
    )
    .sort((a, b) => b.opportunityScore - a.opportunityScore);

  // Mark anti-hype status + radar audit trail per opportunity
  for (const opp of opportunities) {
    opp.passedAntiHype = antiHypeSet.has(opp.symbol);
    const radarInfo = radarBoostMap.get(opp.symbol);
    if (radarInfo) {
      opp.radarInfluence = {
        bonus: radarInfo.bonus,
        sources: radarInfo.sources,
        conflict: radarInfo.conflict,
      };
    }
  }

  console.log(`[opportunities] Fase 2.5: scoring completado — ${opportunities.length} oportunidades (radar afectó ${radarBoostMap.size})`);

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

    // Radar v2 signals as additional macro context. Top sectores by total volume.
    let radarContextStr = '';
    try {
      const radarRow = getLatestNewsRadarSnapshot();
      if (radarRow) {
        const age = Date.now() - new Date(radarRow.generatedAt).getTime();
        if (age < 6 * 60 * 60 * 1000) {
          const aggregated = JSON.parse(radarRow.aggregatedSignals) as Array<{
            target: string; type: 'ticker'|'sector'; netScore: number; totalScore: number;
            positiveArticles: string[]; negativeArticles: string[];
          }>;
          const topSectors = aggregated
            .filter(s => s.type === 'sector' && Math.abs(s.netScore) >= 0.5)
            .sort((a, b) => b.totalScore - a.totalScore)
            .slice(0, 8);
          const narratives = radarRow.emergingNarratives ? JSON.parse(radarRow.emergingNarratives) as string[] : [];
          const lines: string[] = [];
          if (topSectors.length > 0) {
            lines.push(...topSectors.map(s => `- ${s.target}: ${s.netScore > 0 ? '+' : ''}${s.netScore.toFixed(1)} (${s.positiveArticles.length}pos/${s.negativeArticles.length}neg articles)`));
          }
          if (narratives.length > 0) {
            lines.push('Narrativas:');
            lines.push(...narratives.slice(0, 3).map(n => `  - ${n}`));
          }
          if (lines.length > 0) {
            radarContextStr = `\n[RADAR v2 - sectores con señal cross-noticia]\n${lines.join('\n')}`;
          }
        }
      }
    } catch (err) {
      console.warn('[opportunities] Could not load radar context for unified analysis:', (err as Error).message?.slice(0, 80));
    }

    const macroContextStr = (macroHeadlines.length > 0
      ? `[CONTEXTO MACRO - noticias recientes]\n${macroHeadlines.map((h) => `- ${h}`).join('\n')}`
      : '') + radarContextStr;

    const discoveredSet = new Set(discovered);
    const unifiedAnalyses = await runUnifiedAnalysis(
      opportunities,
      techMap,
      fundMap,
      sentimentMap,
      12,
      pipelineRunId,
      macroContextStr,
      causalContextMap,
      discoveredSet,
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

      // Actualizar verdict chain con capa LLM (Stage 5b)
      if (opp.verdict) {
        opp.verdict.layers.llmAction = unified.action;
        opp.verdict.layers.llmReason = unified.thesis.slice(0, 120);
        // Si el LLM cambia la acción, agregar al trace y promover source
        if (unified.action !== opp.verdict.finalAction) {
          opp.verdict.trace.push(`llm:${unified.action} (${unified.thesis.slice(0, 60)})`);
          opp.verdict.finalAction = unified.action;
          opp.verdict.source = 'llm';
          // Sincronizar la acción del opp con el verdict final
          opp.action = unified.action;
        } else {
          opp.verdict.trace.push(`llm:confirma`);
        }
      } else {
        // Si por alguna razón no había verdict previo, lo creamos mínimo
        opp.action = unified.action;
      }

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
    antiHypeRejected: antiHypeRejectedForAudit,
    antiHypeMode: antiHypeModeForAudit,
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

  // Watchlist lifecycle: evaluar items 'live' y cerrar los que tocaron target/stop/horizonte
  try {
    const closed = await resolveWatchlistItems();
    if (closed > 0) console.log(`[Watchlist] ${closed} items cerrados (triggered/invalidated/expired)`);
  } catch (err) {
    console.warn('[Watchlist] Error resolviendo items:', err);
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

    // Persist anti-hype rejections (audit trail: "why didn't VIST appear?")
    if (result.antiHypeRejected && result.antiHypeRejected.length > 0) {
      insertAntiHypeRejections(
        result.antiHypeRejected.map(r => ({
          scanId,
          symbol: r.symbol,
          reasons: r.reasons,
          mode: result.antiHypeMode,
        })),
      );
      console.log(`[opportunities] Persisted ${result.antiHypeRejected.length} anti-hype rejections`);
    }

    // === ANTICIPATORY ALERTS: confluencia bullish del scan → reconciliar y persistir ===
    try {
      const scanDate = scannedAtISO.slice(0, 10); // YYYY-MM-DD
      const current = buildAlertsFromScan(result.opportunities, scanDate);
      // reconcileAlerts solo consume alertas active — pasarle exactamente ese set evita
      // zombies si una activa cayera fuera de un limite "recientes".
      const stored = getActiveAnticipatoryAlerts();
      const { toInsert, toUpdate, toExpire, newAlerts } = reconcileAlerts(current, stored, scanDate);
      upsertAnticipatoryAlerts(toInsert, toUpdate);
      expireAnticipatoryAlerts(toExpire);
      if (newAlerts.length > 0) {
        console.log(`[alerts] ${newAlerts.length} alertas anticipatorias NUEVAS: ${newAlerts.map(a => a.id).join(', ')}`);
      }
    } catch (err) {
      console.error('[alerts] Failed to reconcile anticipatory alerts:', (err as Error).message);
    }
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
export async function refreshNewsProcess(): Promise<{ newsCount: number }> {
  console.log('[Process A] Actualizando noticias...');

  // 1. Fetch + analyze news (legacy: sentiment/impact tagging via Groq Light)
  const intelligence = await getIntelligence();

  processTimestamps.newsLastRun = Date.now();
  console.log(`[Process A] Completado: ${intelligence.totalNewsCount} noticias`);

  // 2. NEW: News Radar v2 (cause+impacts) — fire-and-forget so we don't block the
  // user-facing news refresh response. Persists to news_radar_snapshots; UI reads
  // via radarLatest endpoint. Failure logged but doesn't propagate.
  void (async () => {
    try {
      const { prepareDeepAnalysisNews } = await import('../news/news-intelligence.service.js');
      const { generateNewsRadar } = await import('../news/news-radar.service.js');
      const filtered = await prepareDeepAnalysisNews();
      if (filtered.length > 0) {
        const snap = await generateNewsRadar(filtered, { persist: true });
        console.log(`[Process A] News radar v2: ${snap.perArticle.length} articles, ${snap.aggregatedSignals.length} signals`);
      } else {
        console.log('[Process A] News radar v2: 0 articles after filters, skipping');
      }
    } catch (err) {
      console.warn('[Process A] News radar v2 failed (non-blocking):', (err as Error).message?.slice(0, 100));
    }
  })();

  return { newsCount: intelligence.totalNewsCount };
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
