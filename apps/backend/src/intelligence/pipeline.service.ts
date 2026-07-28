// apps/backend/src/intelligence/pipeline.service.ts
import {
  createPipelineRun,
  getPipelineRunByDate,
  getActivePipelineRun,
  getWaitingUserRun,
  updatePipelineStage,
  finishPipelineRun,
  markRunAsRunning,
  pauseRunWaitingUser,
  markOrphanedRunsFailed,
  getPipelineHistory,
} from './pipeline.repository.js';
import { setRunAiMode } from '../shared/ai-router.js';
import { saveStageArtifact } from './pipeline-artifacts.repository.js';
import { generateMarketReport, type DigestInputs } from './market-report.service.js';
import { runMacroIntelligence } from './macro-intelligence.service.js';
import { runSectorIntelligence } from './sector-report.service.js';
import { getEarningsContext } from './earnings-calendar.service.js';
import { trackPipelineRecommendations } from './pipeline-tracking.service.js';
import { getStoredDailyReport } from './daily-report.service.js';
import { getNewsArticlesForToday, getNewsArticlesSince, getTodayOpportunityScan, getFundamentalCacheAge, insertWebSearchArticles, getWebSearchArticlesForDate, saveCausalMap, getCausalMapByDate, clearCausalMapForDate } from '../db/repository.js';
import { refreshNewsProcess, runAnalysisBlocking, refreshFundamentalsProcess, getLastUnifiedAnalyses, setMarketDigest } from '../opportunities/opportunities.service.js';
import { getLastUnifiedAnalysisStats } from './unified-analysis.service.js';
import { getLastAggregationStats } from '../news/news.service.js';
import { getLastTriangulationStats } from '../news/triangulation.service.js';
import { getIntelligenceFromDB, prepareDeepAnalysisNews } from '../news/news-intelligence.service.js';
import { generateNewsRadar } from '../news/news-radar.service.js';
import { envNumber } from '../shared/env-number.js';
import { takeStageTokens } from '../shared/ai-router.js';
import { runWebSearch } from '../web-search/web-search.service.js';
import { generateWeightProposal, shouldGenerateProposal } from './weight-adjustment.service.js';
import type { PipelineRun, StageResult, QuantContext, OpportunitySector } from '@trading/shared';
import { getToday } from '../shared/date-utils.js';
import { hasWebSearchKeys } from '../shared/env.js';
import { detectRegime } from '../quant/regime-detector.service.js';
import { rankMomentum } from '../quant/momentum-ranker.service.js';
import { calibrateWeights } from '../quant/weight-calibrator.service.js';
import { getAllTechnicalSummaries } from '../technical/technical-analysis.service.js';
import { runMarketScreener } from '../discovery/market-screener.service.js';
import { runCycleRadar } from '../radar/cycle-radar.service.js';

let _stageUnifiedAnalyses: Map<string, import('@trading/shared').UnifiedAssetAnalysis> | null = null;

let _stageQuantContext: QuantContext | null = null;

let _stageSectors: OpportunitySector[] | undefined = undefined;

export function getStageQuantContext(): QuantContext | null {
  return _stageQuantContext;
}

export function initPipeline() {
  markOrphanedRunsFailed();
}


function isNewsStageValid(): boolean {
  const today = getToday();
  const todayArticles = getNewsArticlesForToday();
  if (todayArticles.length < 5) return false;
  const run = getPipelineRunByDate(today);
  if (!run) return false;
  return run.stages.news.status === 'ok' || run.stages.news.status === 'partial';
}

function isAnalysisStageValid(): boolean {
  const scan = getTodayOpportunityScan();
  if (!scan) return false;
  const today = getToday();
  const run = getPipelineRunByDate(today);
  if (!run) return false;
  return run.stages.analysis.status === 'ok' || run.stages.analysis.status === 'partial';
}

function isMacroIntelligenceStageValid(): boolean {
  const today = getToday();
  const run = getPipelineRunByDate(today);
  if (!run) return false;
  const existing = getCausalMapByDate(today);
  return existing.length > 0 &&
    (run.stages.macroIntelligence.status === 'ok' || run.stages.macroIntelligence.status === 'partial');
}

function getFundamentalsDaysOld(): number {
  try {
    const age = getFundamentalCacheAge?.();
    if (!age) return 999;
    return (Date.now() - new Date(age).getTime()) / (1000 * 60 * 60 * 24);
  } catch {
    return 999;
  }
}

function recordStageArtifact(runId: number, stage: 'webSearch' | 'news' | 'fundamentals' | 'analysis' | 'report' | 'digest', sr: StageResult): void {
  try {
    const durationMs = (sr.startedAt && sr.finishedAt)
      ? new Date(sr.finishedAt).getTime() - new Date(sr.startedAt).getTime()
      : undefined;
    // Consumo de LLM de esta etapa (piso: los proveedores que no reportan uso suman 0).
    const tokens = takeStageTokens();
    saveStageArtifact({
      pipelineRunId: runId,
      stage,
      output: { status: sr.status, detail: sr.detail, errors: sr.errors, criticalError: sr.criticalError },
      durationMs,
      errorCount: sr.errors.length,
      tokensUsed: tokens.total > 0 ? tokens.total : undefined,
    });
    if (tokens.total > 0) {
      console.log(`[pipeline] ${stage}: ${tokens.total} tokens (in ${tokens.input} / out ${tokens.output})`);
    }
  } catch (err) {
    console.warn('[pipeline] Failed to save stage artifact:', (err as Error).message);
  }
}

async function runWebSearchStage(runId: number): Promise<StageResult> {
  const today = getToday();
  const startedAt = new Date().toISOString();
  updatePipelineStage(runId, 'webSearch', { status: 'running', startedAt });

  // Sin NINGUNA key de búsqueda web configurada, no tiene sentido llamar a los providers:
  // ambos van a tirar "API_KEY not set" (ver web-search/tavily.ts, exa.ts). Antes esto
  // terminaba en status 'failed' → pausaba el run entero en waiting_user (línea ~625):
  // sin keys, el stage generaba errores en cada corrida — skip explícito es más honesto
  // que failed+retry. Sin keys es una config esperada, no una falla: se salta el stage
  // explícitamente y se sigue con el resto del pipeline. hasWebSearchKeys (env.ts) es la
  // misma fuente de verdad que usa el log de startup.
  if (!hasWebSearchKeys()) {
    const sr: StageResult = {
      status: 'skipped',
      startedAt,
      finishedAt: new Date().toISOString(),
      detail: 'sin API keys de búsqueda web — configurá TAVILY_API_KEY en .env',
      errors: [],
    };
    updatePipelineStage(runId, 'webSearch', sr);
    return sr;
  }

  try {
    const result = await runWebSearch(today);

    if (result.allFailed) {
      const sr: StageResult = {
        status: 'failed',
        startedAt,
        finishedAt: new Date().toISOString(),
        detail: 'Tavily y Exa fallaron para todas las búsquedas del portfolio.',
        errors: result.errors,
        criticalError: 'Todos los providers de web search fallaron',
      };
      updatePipelineStage(runId, 'webSearch', sr);
      return sr;
    }

    insertWebSearchArticles(result.articles);
    const portfolioCount = result.articles.filter((a) => a.layer === 'portfolio').length;
    const discoveryCount = result.articles.filter((a) => a.layer === 'discovery').length;
    const sr: StageResult = {
      status: result.errors.length > 0 ? 'partial' : 'ok',
      startedAt,
      finishedAt: new Date().toISOString(),
      detail: `${portfolioCount} artículos portfolio, ${discoveryCount} discovery.`,
      errors: result.errors,
    };
    updatePipelineStage(runId, 'webSearch', sr);
    return sr;
  } catch (err) {
    const errMsg = (err as Error).message ?? String(err);
    console.error('[pipeline] runWebSearchStage error:', errMsg);
    const sr: StageResult = {
      status: 'failed',
      startedAt,
      finishedAt: new Date().toISOString(),
      detail: 'Error en web search.',
      errors: [],
      criticalError: errMsg.slice(0, 200),
    };
    updatePipelineStage(runId, 'webSearch', sr);
    return sr;
  }
}

async function runNewsStage(runId: number): Promise<StageResult> {
  const startedAt = new Date().toISOString();
  updatePipelineStage(runId, 'news', { status: 'running', startedAt });
  try {
    const result = await refreshNewsProcess();
    const articleCount = result.newsCount ?? 0;
    if (articleCount === 0) {
      // 0 articulos HOY es normal en feriados. Si la DB tiene articulos recientes
      // (ventana de 3 dias), seguimos con sentiment degradado en vez de matar el run.
      const recentInDb = getNewsArticlesSince(new Date(Date.now() - 3 * 86_400_000).toISOString()).length;
      const sr: StageResult = {
        status: recentInDb > 0 ? 'partial' : 'failed',
        startedAt,
        finishedAt: new Date().toISOString(),
        detail: recentInDb > 0
          ? `PARCIAL: 0 artículos nuevos hoy — continuando con ${recentInDb} artículos recientes de la DB (sentiment degradado).`
          : 'Sin artículos obtenidos ni recientes en DB.',
        errors: recentInDb > 0 ? ['0 artículos nuevos — usando ventana de 3 días'] : [],
        ...(recentInDb === 0 ? { criticalError: '0 artículos — fuentes no disponibles' } : {}),
      };
      updatePipelineStage(runId, 'news', sr);
      return sr;
    }
    const aggStats = getLastAggregationStats();
    const triStats = getLastTriangulationStats();
    const deduplicationRate = aggStats.totalRaw > 0
      ? ((aggStats.duplicatesRemoved / aggStats.totalRaw) * 100).toFixed(1)
      : '0.0';
    const detailPayload = {
      text: `${articleCount} artículos procesados.`,
      totalRaw: aggStats.totalRaw,
      duplicatesRemoved: aggStats.duplicatesRemoved,
      deduplicationRate: `${deduplicationRate}%`,
      sourceStats: aggStats.sourceStats,
      clusterStats: triStats,
    };
    const sr: StageResult = {
      status: 'ok',
      startedAt,
      finishedAt: new Date().toISOString(),
      detail: JSON.stringify(detailPayload),
      errors: [],
    };
    updatePipelineStage(runId, 'news', sr);
    return sr;
  } catch (err) {
    const errMsg = (err as Error).message ?? String(err);
    console.error('[pipeline] runNewsStage error:', errMsg);
    const sr: StageResult = {
      status: 'failed',
      startedAt,
      finishedAt: new Date().toISOString(),
      detail: 'Error en actualización de noticias.',
      errors: [],
      criticalError: errMsg.slice(0, 200),
    };
    updatePipelineStage(runId, 'news', sr);
    return sr;
  }
}

async function runMacroIntelligenceStage(runId: number): Promise<StageResult> {
  const startedAt = new Date().toISOString();
  updatePipelineStage(runId, 'macroIntelligence', { status: 'running', startedAt });
  const today = getToday();
  try {
    // Gather all today's headlines: web search + news articles
    const newsArticles = getNewsArticlesForToday('medium');
    const webArticles = getWebSearchArticlesForDate(today);
    const headlines = [
      ...webArticles.map((a) => a.title),
      ...newsArticles.map((a) => a.title),
    ].filter(Boolean);

    const events = await runMacroIntelligence(headlines);

    if (events.length === 0) {
      const sr: StageResult = {
        status: 'failed',
        startedAt,
        finishedAt: new Date().toISOString(),
        detail: 'LLM no generó eventos macro.',
        errors: [],
        criticalError: 'Sin eventos — sin noticias suficientes',
      };
      updatePipelineStage(runId, 'macroIntelligence', sr);
      return sr;
    }

    saveCausalMap(today, events);
    const totalTickers = new Set(events.flatMap(e => e.chains.map(c => c.ticker))).size;
    const sr: StageResult = {
      status: 'ok',
      startedAt,
      finishedAt: new Date().toISOString(),
      detail: `${events.length} eventos macro, ${totalTickers} tickers en cadenas causales.`,
      errors: [],
    };
    updatePipelineStage(runId, 'macroIntelligence', sr);
    return sr;
  } catch (err) {
    const errMsg = (err as Error).message ?? String(err);
    console.error('[pipeline] runMacroIntelligenceStage error:', errMsg);
    const sr: StageResult = {
      status: 'failed',
      startedAt,
      finishedAt: new Date().toISOString(),
      detail: 'Error en macro intelligence.',
      errors: [],
      criticalError: errMsg.slice(0, 200),
    };
    updatePipelineStage(runId, 'macroIntelligence', sr);
    return sr;
  }
}

async function runSectorIntelligenceStage(runId: number): Promise<StageResult> {
  const startedAt = new Date().toISOString();
  updatePipelineStage(runId, 'sectorIntelligence', { status: 'running', startedAt });
  try {
    const { reports, articleCount } = await runSectorIntelligence();
    if (articleCount === 0) {
      const sr: StageResult = {
        status: 'skipped',
        startedAt,
        finishedAt: new Date().toISOString(),
        detail: 'Sin artículos con confianza alta/media disponibles todavía.',
        errors: [],
      };
      updatePipelineStage(runId, 'sectorIntelligence', sr);
      return sr;
    }
    const sr: StageResult = {
      status: 'ok',
      startedAt,
      finishedAt: new Date().toISOString(),
      detail: `${reports.length} sectores sintetizados desde ${articleCount} artículos.`,
      errors: [],
    };
    updatePipelineStage(runId, 'sectorIntelligence', sr);
    return sr;
  } catch (err) {
    const errMsg = (err as Error).message ?? String(err);
    console.error('[pipeline] runSectorIntelligenceStage error:', errMsg);
    const sr: StageResult = {
      status: 'failed',
      startedAt,
      finishedAt: new Date().toISOString(),
      detail: 'Error en sector intelligence.',
      errors: [],
      criticalError: errMsg.slice(0, 200),
    };
    updatePipelineStage(runId, 'sectorIntelligence', sr);
    return sr;
  }
}

async function runFundamentalsStage(runId: number): Promise<StageResult> {
  const startedAt = new Date().toISOString();
  const daysOld = getFundamentalsDaysOld();

  if (daysOld < 3) {
    const sr: StageResult = {
      status: 'skipped',
      startedAt,
      finishedAt: new Date().toISOString(),
      detail: `Cache válido (${daysOld.toFixed(1)} días). Próxima actualización en ${(3 - daysOld).toFixed(1)} días.`,
      errors: [],
    };
    updatePipelineStage(runId, 'fundamentals', sr);
    return sr;
  }

  updatePipelineStage(runId, 'fundamentals', { status: 'running', startedAt, detail: '', errors: [] });
  try {
    const result = await refreshFundamentalsProcess();
    const sr: StageResult = {
      status: 'ok',
      startedAt,
      finishedAt: new Date().toISOString(),
      detail: `${result.refreshed} fundamentales actualizados.`,
      errors: [],
    };
    updatePipelineStage(runId, 'fundamentals', sr);
    return sr;
  } catch (err) {
    const errMsg = (err as Error).message ?? String(err);
    console.error('[pipeline] runFundamentalsStage error:', errMsg);
    const sr: StageResult = {
      status: 'failed',
      startedAt,
      finishedAt: new Date().toISOString(),
      detail: 'Error actualizando fundamentales.',
      errors: [],
      criticalError: errMsg.slice(0, 200),
    };
    updatePipelineStage(runId, 'fundamentals', sr);
    return sr;
  }
}

async function runAnalysisStage(runId: number): Promise<StageResult> {
  const sectorsSnapshot = _stageSectors;   // capture before clearing
  _stageSectors = undefined;              // clear immediately — consumed
  const startedAt = new Date().toISOString();
  updatePipelineStage(runId, 'analysis', { status: 'running', startedAt });
  try {
    const result = await runAnalysisBlocking(runId, sectorsSnapshot);
    const symbolCount = result.totalSymbolsScanned ?? 0;
    _stageUnifiedAnalyses = getLastUnifiedAnalyses();
    const stats = getLastUnifiedAnalysisStats();
    const partial = Boolean(stats && (stats.abortedByQuota || stats.analyzed < stats.targets));
    const sr: StageResult = {
      status: partial ? 'partial' : 'ok',
      startedAt,
      finishedAt: new Date().toISOString(),
      detail: partial && stats
        ? `PARCIAL: ${stats.analyzed}/${stats.targets} símbolos con análisis IA${stats.abortedByQuota ? ' (quota agotada a mitad de run)' : ''}. ${symbolCount} escaneados.`
        : `${symbolCount} símbolos analizados, ${_stageUnifiedAnalyses?.size ?? 0} con análisis IA.`,
      errors: partial && stats ? [`Análisis IA cubrió ${stats.analyzed}/${stats.targets} targets`] : [],
    };
    updatePipelineStage(runId, 'analysis', sr);
    return sr;
  } catch (err) {
    _stageUnifiedAnalyses = null;
    const errMsg = (err as Error).message ?? String(err);
    console.error('[pipeline] runAnalysisStage error:', errMsg);
    const sr: StageResult = {
      status: 'failed',
      startedAt,
      finishedAt: new Date().toISOString(),
      detail: 'Error en análisis.',
      errors: [],
      criticalError: errMsg.slice(0, 200),
    };
    updatePipelineStage(runId, 'analysis', sr);
    return sr;
  }
}

async function runQuantStage(runId: number): Promise<StageResult> {
  const startedAt = new Date().toISOString();
  updatePipelineStage(runId, 'quant', { status: 'running', startedAt });
  try {
    const summaries = await getAllTechnicalSummaries();
    const regime = detectRegime(summaries);
    const momentumRankings = rankMomentum(summaries);
    const calibratedWeightsResult = calibrateWeights();

    _stageQuantContext = { regime, momentumRankings, calibratedWeights: calibratedWeightsResult };

    const sr: StageResult = {
      status: 'ok',
      startedAt,
      finishedAt: new Date().toISOString(),
      detail: `Régimen: ${regime.regime} (${regime.confidence}% conf). ${summaries.length} activos rankeados.${calibratedWeightsResult ? ' Pesos calibrados.' : ''}`,
      errors: [],
    };
    updatePipelineStage(runId, 'quant', sr);
    return sr;
  } catch (err) {
    const errMsg = (err as Error).message ?? String(err);
    console.error('[pipeline] runQuantStage error:', errMsg);
    _stageQuantContext = null;
    const sr: StageResult = {
      status: 'failed',
      startedAt,
      finishedAt: new Date().toISOString(),
      detail: 'Error en quant stage (no bloqueante).',
      errors: [],
      criticalError: errMsg.slice(0, 200),
    };
    updatePipelineStage(runId, 'quant', sr);
    return sr;
  }
}

async function runReportStage(runId: number): Promise<StageResult> {
  const startedAt = new Date().toISOString();
  updatePipelineStage(runId, 'report', { status: 'running', startedAt });
  try {
    const precomputed = _stageUnifiedAnalyses ?? getLastUnifiedAnalyses() ?? new Map();
    _stageUnifiedAnalyses = null;

    if (precomputed.size === 0) {
      throw new Error('No hay análisis de Stage 3 disponibles. Corré el pipeline completo primero.');
    }

    // Build digest inputs from today's scan
    let digestInputs: DigestInputs | undefined;
    const scan = getTodayOpportunityScan();
    const earningsCtx = await getEarningsContext(10);
    if (scan) {
      const intelligence = await getIntelligenceFromDB();
      const causalMap = getCausalMapByDate(getToday());
      digestInputs = {
        opportunities: JSON.parse(scan.opportunities),
        secondOrderEffects: getStoredDailyReport()?.secondOrderEffects ?? [],
        intelligence,
        sectorSummary: JSON.parse(scan.sectorSummary ?? '[]'),
        quantContext: _stageQuantContext,
        earningsContext: earningsCtx.formattedBlock,
        causalMap: causalMap.length > 0 ? causalMap : undefined,
      };
    }

    const { report, digest } = await generateMarketReport(precomputed, digestInputs);
    if (digest) setMarketDigest(digest);

    const themeCount = report.themes?.length ?? 0;
    const reportErrors: string[] = report.errors ?? [];
    const sr: StageResult = {
      status: reportErrors.length > 0 ? 'partial' : 'ok',
      startedAt,
      finishedAt: new Date().toISOString(),
      detail: `Reporte generado con ${themeCount} temas.`,
      errors: reportErrors,
    };
    updatePipelineStage(runId, 'report', sr);
    return sr;
  } catch (err) {
    const errMsg = (err as Error).message ?? String(err);
    console.error('[pipeline] runReportStage error:', errMsg);
    const sr: StageResult = {
      status: 'failed',
      startedAt,
      finishedAt: new Date().toISOString(),
      detail: 'Error generando reporte.',
      errors: [],
      criticalError: errMsg.slice(0, 200),
    };
    updatePipelineStage(runId, 'report', sr);
    return sr;
  }
}

/**
 * Corre una etapa con techo de tiempo. Si vence, devuelve un StageResult 'failed' en vez de
 * colgar la corrida para siempre — el trabajo interno puede seguir en background y terminar
 * solo; lo que se acota es cuánto espera el pipeline.
 */
async function withStageTimeout(
  promesa: Promise<StageResult>,
  ms: number,
  stage: string,
): Promise<StageResult> {
  let timer: NodeJS.Timeout | undefined;
  const vencimiento = new Promise<StageResult>((resolve) => {
    timer = setTimeout(() => {
      console.warn(`[pipeline] ${stage}: timeout a los ${Math.round(ms / 1000)}s — se sigue sin esperarlo`);
      resolve({
        status: 'failed',
        startedAt: null,
        finishedAt: new Date().toISOString(),
        detail: `Timeout: la etapa superó ${Math.round(ms / 1000)}s.`,
        errors: [],
        criticalError: `stage-timeout:${stage}`,
      });
    }, ms);
  });
  try {
    return await Promise.race([promesa, vencimiento]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}

async function runRemainingStages(runId: number): Promise<void> {
  const today = getToday();

  if (!isNewsStageValid()) {
    // ⚠️ CAMBIO 2026-07-28 — el stage de noticias deja de poder tumbar el pipeline.
    //
    // Medido sobre 123 corridas: el pipeline fallaba el 35.8% de las veces, y **21 de los 44
    // fallos se colgaban acá**. Además el stage consume 17.8 de los 22.7 min de una corrida
    // exitosa (78%). Y el scan —que produce las decisiones— NO depende de noticias: su
    // universo sale de `discovered_symbols` + `symbols`. O sea: la etapa más lenta y más
    // frágil cancelaba la etapa que realmente importa, sin necesitarla.
    //
    // Dos arreglos, ninguno destructivo (no se apaga nada: macro_events, cadenas causales,
    // radar de noticias y digest siguen produciéndose cuando el stage anda):
    //   1. TIMEOUT DURO: colgarse deja de ser infinito.
    //   2. NO-BLOQUEANTE: su fallo degrada la corrida a 'partial', no la mata.
    const newsResult = await withStageTimeout(
      runNewsStage(runId),
      envNumber('NEWS_STAGE_TIMEOUT_MS', 300_000),
      'news',
    );
    recordStageArtifact(runId, 'news', newsResult);
    if (newsResult.status === 'failed') {
      console.warn('[pipeline] News falló o venció su timeout — el scan sigue igual (no depende de noticias)');
    } else if (newsResult.status === 'partial') {
      console.warn('[pipeline] News parcial — continuando con datos degradados');
    }
    // Fire-and-forget: news radar v2 (cause+impacts) runs after news succeeds.
    // Non-blocking: failure logs but doesn't affect downstream stages. Persists
    // to news_radar_snapshots table; UI reads via radarLatest endpoint.
    void (async () => {
      try {
        const filtered = await prepareDeepAnalysisNews();
        if (filtered.length > 0) {
          await generateNewsRadar(filtered, { pipelineRunId: runId, persist: true });
        } else {
          console.log('[pipeline] news-radar: 0 articles after filters, skipping');
        }
      } catch (err) {
        console.warn('[pipeline] news-radar failed (non-blocking):', (err as Error).message?.slice(0, 100));
      }
    })();
  } else {
    updatePipelineStage(runId, 'news', {
      status: 'skipped', startedAt: new Date().toISOString(), finishedAt: new Date().toISOString(),
      detail: 'Noticias del día ya disponibles.', errors: [],
    });
  }

  // macroIntelligence stage
  if (!isMacroIntelligenceStageValid()) {
    const macroResult = await runMacroIntelligenceStage(runId);
    if (macroResult.status === 'failed') {
      console.warn('[pipeline] macroIntelligence falló — continuando con portfolio-only symbols');
    }
  } else {
    updatePipelineStage(runId, 'macroIntelligence', {
      status: 'skipped',
      startedAt: new Date().toISOString(),
      finishedAt: new Date().toISOString(),
      detail: 'CausalMap del día ya disponible.',
      errors: [],
    });
  }

  // sectorIntelligence stage — non-blocking (failure doesn't stop pipeline)
  await runSectorIntelligenceStage(runId);

  const fundResult = await runFundamentalsStage(runId);
  recordStageArtifact(runId, 'fundamentals', fundResult);

  // Market screener: candidatos operables de TODO el mercado (no solo watchlist/prensa)
  // entran al universo de scan via discovered_symbols (source='screener'). No-bloqueante:
  // sin stage propio en pipelineRuns — si falla, el scan sigue con el universo de siempre.
  try {
    await runMarketScreener();
  } catch (err) {
    console.warn('[pipeline] runMarketScreener failed (non-blocking):', (err as Error).message);
  }

  // Radar de ciclos: contexto cuantitativo diario (no señal). Fire-and-forget:
  // un fallo de Yahoo acá no puede tocar el estado de la corrida del pipeline.
  void (async () => {
    try {
      const radar = await runCycleRadar();
      console.log(`[pipeline] cycle radar: ${radar.persisted} canastas persistidas (${radar.date})`);
    } catch (err) {
      console.warn('[pipeline] runCycleRadar failed (non-blocking):', (err as Error).message);
    }
  })();

  if (!isAnalysisStageValid()) {
    const analysisResult = await runAnalysisStage(runId);
    recordStageArtifact(runId, 'analysis', analysisResult);
    if (analysisResult.status === 'failed') {
      updatePipelineStage(runId, 'report', { status: 'skipped', detail: 'Saltado: análisis falló.', errors: [], startedAt: null, finishedAt: null });
      finishPipelineRun(runId, 'failed');
      return;
    }
  } else {
    updatePipelineStage(runId, 'analysis', {
      status: 'skipped', startedAt: new Date().toISOString(), finishedAt: new Date().toISOString(),
      detail: 'Análisis del día ya disponible.', errors: [],
    });
  }

  // Quant stage: non-blocking (failure doesn't stop pipeline)
  await runQuantStage(runId);

  const reportResult = await runReportStage(runId);
  recordStageArtifact(runId, 'report', reportResult);

  // Track Top 8 pipeline recommendations to signal_tracking (non-critical)
  if (reportResult.status === 'ok') {
    try {
      await trackPipelineRecommendations();
    } catch (err) {
      console.warn('[pipeline] trackPipelineRecommendations failed (non-critical):', (err as Error).message);
    }
  }

  const finalRun = getPipelineRunByDate(today)!;
  const stageList = [finalRun.stages.webSearch, finalRun.stages.news, finalRun.stages.macroIntelligence, finalRun.stages.fundamentals, finalRun.stages.analysis, finalRun.stages.report];

  // ⚠️ Solo `analysis` puede marcar la corrida como FALLIDA: es la etapa que produce las
  // decisiones (el scan con niveles y veredictos). Que fallen noticias, web search, macro o
  // el reporte degrada a 'partial' — hay menos contexto narrativo, pero las decisiones del
  // día existen igual. Antes CUALQUIER etapa fallida marcaba 'failed', y por eso el 35.8% de
  // las corridas figuraba como fallida cuando en la mayoría el scan había salido bien.
  const critico = finalRun.stages.analysis.status === 'failed';
  const anyFailed = stageList.some((s) => s.status === 'failed');
  const allOk = stageList.every((s) => s.status === 'ok' || s.status === 'skipped');
  finishPipelineRun(runId, critico ? 'failed' : (allOk && !anyFailed) ? 'ok' : 'partial');

  // Auto-generate weight proposal if enough resolved signals available
  if (shouldGenerateProposal()) {
    const proposal = generateWeightProposal();
    if (proposal) {
      console.log(`[pipeline] Weight adjustment proposal #${proposal.id} generated — pending user approval`);
    }
  }
}

export async function checkOrRunPipeline(force = false, sectors?: OpportunitySector[], aiMode: 'cloud' | 'local' = 'cloud'): Promise<PipelineRun> {
  setRunAiMode(aiMode);
  _stageUnifiedAnalyses = null;
  _stageQuantContext = null;
  _stageSectors = sectors;
  const today = getToday();

  const activeRun = getActivePipelineRun();
  if (activeRun) return activeRun;

  // If there's a waiting_user run for today, return it — user must resolve first
  const waitingRun = getWaitingUserRun(today);
  if (waitingRun) return waitingRun;

  // Reuse existing completed run so isNewsStageValid / isAnalysisStageValid can
  // skip already-processed stages instead of re-running everything from scratch.
  if (force) {
    clearCausalMapForDate(today);
  }
  const existingRun = !force ? getPipelineRunByDate(today) : null;
  const reuseRun = existingRun?.status === 'ok' || existingRun?.status === 'partial';
  const run = reuseRun ? existingRun! : createPipelineRun(today);
  const runId = run.id;
  if (reuseRun) markRunAsRunning(runId);

  try {
    const webSearchResult = await runWebSearchStage(runId);
    recordStageArtifact(runId, 'webSearch', webSearchResult);

    if (webSearchResult.status === 'failed') {
      pauseRunWaitingUser(runId);
      return getPipelineRunByDate(today)!;
    }

    await runRemainingStages(runId);
    return getPipelineRunByDate(today)!;
  } catch (err) {
    finishPipelineRun(runId, 'failed');
    throw err;
  }
}

export async function resolveWebSearch(action: 'retry' | 'skip' | 'cancel'): Promise<PipelineRun> {
  const today = getToday();
  const waitingRun = getWaitingUserRun(today);
  if (!waitingRun) throw new Error('No hay run en estado waiting_user para hoy');

  const runId = waitingRun.id;
  _stageUnifiedAnalyses = null;
  _stageQuantContext = null;

  if (action === 'cancel') {
    finishPipelineRun(runId, 'cancelled');
    return getPipelineRunByDate(today)!;
  }

  markRunAsRunning(runId);

  if (action === 'retry') {
    const webSearchResult = await runWebSearchStage(runId);
    recordStageArtifact(runId, 'webSearch', webSearchResult);
    if (webSearchResult.status === 'failed') {
      pauseRunWaitingUser(runId);
      return getPipelineRunByDate(today)!;
    }
  } else {
    // skip
    updatePipelineStage(runId, 'webSearch', {
      status: 'skipped',
      startedAt: new Date().toISOString(),
      finishedAt: new Date().toISOString(),
      detail: 'Saltado por el usuario.',
      errors: [],
    });
  }

  await runRemainingStages(runId);
  return getPipelineRunByDate(today)!;
}

export async function rerunPipelineStage(
  // macroIntelligence is not individually rerunnable; use force=true on checkOrRunPipeline instead
  stage: 'webSearch' | 'news' | 'fundamentals' | 'analysis' | 'report',
  aiMode: 'cloud' | 'local' = 'cloud',
): Promise<PipelineRun> {
  setRunAiMode(aiMode);
  const today = getToday();
  const activeRun = getActivePipelineRun();
  if (activeRun) return activeRun;

  const existingRun = getPipelineRunByDate(today);
  const run = existingRun ?? createPipelineRun(today);
  const runId = run.id;
  _stageUnifiedAnalyses = stage === 'report' ? (getLastUnifiedAnalyses() ?? null) : null;
  markRunAsRunning(runId);

  if (stage === 'webSearch') {
    for (const s of ['news', 'fundamentals', 'analysis', 'report'] as const) {
      updatePipelineStage(runId, s, { status: 'pending', detail: 'Pendiente re-run.', errors: [], startedAt: null, finishedAt: null });
    }
    const webSearchResult = await runWebSearchStage(runId);
    recordStageArtifact(runId, 'webSearch', webSearchResult);
    if (webSearchResult.status === 'failed') {
      pauseRunWaitingUser(runId);
      return getPipelineRunByDate(today)!;
    }
    await runRemainingStages(runId);
  } else if (stage === 'news') {
    for (const s of ['sectorIntelligence', 'fundamentals', 'analysis', 'report'] as const) {
      updatePipelineStage(runId, s, { status: 'pending', detail: 'Pendiente re-run de noticias.', errors: [], startedAt: null, finishedAt: null });
    }
    const newsRerunResult = await runNewsStage(runId);
    recordStageArtifact(runId, 'news', newsRerunResult);
    await runSectorIntelligenceStage(runId);
    const fundRerunResult = await runFundamentalsStage(runId);
    recordStageArtifact(runId, 'fundamentals', fundRerunResult);
    const analysisRerunResult = await runAnalysisStage(runId);
    recordStageArtifact(runId, 'analysis', analysisRerunResult);
    const reportRerunResult = await runReportStage(runId);
    recordStageArtifact(runId, 'report', reportRerunResult);
  } else if (stage === 'fundamentals') {
    for (const s of ['analysis', 'report'] as const) {
      updatePipelineStage(runId, s, { status: 'pending', detail: 'Pendiente re-run de fundamentales.', errors: [], startedAt: null, finishedAt: null });
    }
    const fundRerunResult = await runFundamentalsStage(runId);
    recordStageArtifact(runId, 'fundamentals', fundRerunResult);
    const analysisRerunResult = await runAnalysisStage(runId);
    recordStageArtifact(runId, 'analysis', analysisRerunResult);
    const reportRerunResult = await runReportStage(runId);
    recordStageArtifact(runId, 'report', reportRerunResult);
  } else if (stage === 'analysis') {
    updatePipelineStage(runId, 'report', { status: 'pending', detail: 'Pendiente re-run de análisis.', errors: [], startedAt: null, finishedAt: null });
    const analysisRerunResult = await runAnalysisStage(runId);
    recordStageArtifact(runId, 'analysis', analysisRerunResult);
    const reportRerunResult = await runReportStage(runId);
    recordStageArtifact(runId, 'report', reportRerunResult);
  } else {
    const reportRerunResult = await runReportStage(runId);
    recordStageArtifact(runId, 'report', reportRerunResult);
    if (reportRerunResult.status === 'ok') {
      try {
        await trackPipelineRecommendations();
      } catch (err) {
        console.warn('[pipeline] trackPipelineRecommendations failed (non-critical):', (err as Error).message);
      }
    }
  }

  const finalRun = getPipelineRunByDate(today)!;
  const stageList = [finalRun.stages.webSearch, finalRun.stages.news, finalRun.stages.macroIntelligence, finalRun.stages.fundamentals, finalRun.stages.analysis, finalRun.stages.report];

  // ⚠️ Solo `analysis` puede marcar la corrida como FALLIDA: es la etapa que produce las
  // decisiones (el scan con niveles y veredictos). Que fallen noticias, web search, macro o
  // el reporte degrada a 'partial' — hay menos contexto narrativo, pero las decisiones del
  // día existen igual. Antes CUALQUIER etapa fallida marcaba 'failed', y por eso el 35.8% de
  // las corridas figuraba como fallida cuando en la mayoría el scan había salido bien.
  const critico = finalRun.stages.analysis.status === 'failed';
  const anyFailed = stageList.some((s) => s.status === 'failed');
  const allOk = stageList.every((s) => s.status === 'ok' || s.status === 'skipped');
  finishPipelineRun(runId, critico ? 'failed' : (allOk && !anyFailed) ? 'ok' : 'partial');

  if (shouldGenerateProposal()) {
    const proposal = generateWeightProposal();
    if (proposal) {
      console.log(`[pipeline] Weight adjustment proposal #${proposal.id} generated — pending user approval`);
    }
  }

  return getPipelineRunByDate(today)!;
}

export { getPipelineRunByDate, getActivePipelineRun, getPipelineHistory };
