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
import { generateMarketReport } from './market-report.service.js';
import { generateDailyDigest } from './market-digest.service.js';
import { getStoredDailyReport } from './daily-report.service.js';
import { getNewsArticlesForToday, getTodayOpportunityScan, getFundamentalCacheAge, insertWebSearchArticles } from '../db/repository.js';
import { refreshNewsProcess, runAnalysisBlocking, refreshFundamentalsProcess, getLastUnifiedAnalyses, setMarketDigest } from '../opportunities/opportunities.service.js';
import { getIntelligenceFromDB } from '../news/news-intelligence.service.js';
import { runWebSearch } from '../web-search/web-search.service.js';
import type { PipelineRun, StageResult, QuantContext } from '@trading/shared';
import { detectRegime } from '../quant/regime-detector.service.js';
import { rankMomentum } from '../quant/momentum-ranker.service.js';
import { calibrateWeights } from '../quant/weight-calibrator.service.js';
import { getAllTechnicalSummaries } from '../technical/technical-analysis.service.js';

let _stageUnifiedAnalyses: Map<string, import('@trading/shared').UnifiedAssetAnalysis> | null = null;

let _stageQuantContext: QuantContext | null = null;

export function getStageQuantContext(): QuantContext | null {
  return _stageQuantContext;
}

export function initPipeline() {
  markOrphanedRunsFailed();
}

function getToday(): string {
  // Use Buenos Aires timezone (UTC-3) — avoids date shift after 21hs local time
  return new Date().toLocaleDateString('en-CA', { timeZone: 'America/Argentina/Buenos_Aires' });
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

function getFundamentalsDaysOld(): number {
  try {
    const age = getFundamentalCacheAge?.();
    if (!age) return 999;
    return (Date.now() - new Date(age).getTime()) / (1000 * 60 * 60 * 24);
  } catch {
    return 999;
  }
}

async function runWebSearchStage(runId: number): Promise<StageResult> {
  const today = getToday();
  const startedAt = new Date().toISOString();
  updatePipelineStage(runId, 'webSearch', { status: 'running', startedAt });
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
    const sr: StageResult = {
      status: 'failed',
      startedAt,
      finishedAt: new Date().toISOString(),
      detail: 'Error en web search.',
      errors: [],
      criticalError: (err as Error).message.slice(0, 200),
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
      const sr: StageResult = {
        status: 'failed',
        startedAt,
        finishedAt: new Date().toISOString(),
        detail: 'Sin artículos obtenidos.',
        errors: [],
        criticalError: '0 artículos — fuentes no disponibles',
      };
      updatePipelineStage(runId, 'news', sr);
      return sr;
    }
    const sr: StageResult = {
      status: 'ok',
      startedAt,
      finishedAt: new Date().toISOString(),
      detail: `${articleCount} artículos, ${result.sectorsFound} sectores identificados.`,
      errors: [],
    };
    updatePipelineStage(runId, 'news', sr);
    return sr;
  } catch (err) {
    const sr: StageResult = {
      status: 'failed',
      startedAt,
      finishedAt: new Date().toISOString(),
      detail: 'Error en actualización de noticias.',
      errors: [],
      criticalError: (err as Error).message.slice(0, 200),
    };
    updatePipelineStage(runId, 'news', sr);
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
    const sr: StageResult = {
      status: 'failed',
      startedAt,
      finishedAt: new Date().toISOString(),
      detail: 'Error actualizando fundamentales.',
      errors: [],
      criticalError: (err as Error).message.slice(0, 200),
    };
    updatePipelineStage(runId, 'fundamentals', sr);
    return sr;
  }
}

async function runAnalysisStage(runId: number): Promise<StageResult> {
  const startedAt = new Date().toISOString();
  updatePipelineStage(runId, 'analysis', { status: 'running', startedAt });
  try {
    const result = await runAnalysisBlocking();
    const symbolCount = result.totalSymbolsScanned ?? 0;
    _stageUnifiedAnalyses = getLastUnifiedAnalyses();
    const sr: StageResult = {
      status: 'ok',
      startedAt,
      finishedAt: new Date().toISOString(),
      detail: `${symbolCount} símbolos analizados, ${_stageUnifiedAnalyses?.size ?? 0} con análisis IA.`,
      errors: [],
    };
    updatePipelineStage(runId, 'analysis', sr);
    return sr;
  } catch (err) {
    _stageUnifiedAnalyses = null;
    const sr: StageResult = {
      status: 'failed',
      startedAt,
      finishedAt: new Date().toISOString(),
      detail: 'Error en análisis.',
      errors: [],
      criticalError: (err as Error).message.slice(0, 200),
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
    // Pass precomputed Stage 3 analyses so generateMarketReport skips the full thematic pipeline
    const precomputed = _stageUnifiedAnalyses ?? undefined;
    const report = await generateMarketReport(precomputed);
    _stageUnifiedAnalyses = null;

    try {
      const scan = getTodayOpportunityScan();
      const intelligence = await getIntelligenceFromDB();
      if (scan) {
        const opportunities = JSON.parse(scan.opportunities);
        const sectorSummary = JSON.parse(scan.sectorSummary ?? '[]');
        const secondOrderEffects = getStoredDailyReport()?.secondOrderEffects ?? [];
        const digest = await generateDailyDigest(
          opportunities,
          secondOrderEffects,
          intelligence,
          sectorSummary,
          _stageQuantContext,
        );
        if (digest) setMarketDigest(digest);
      }
    } catch (digestErr) {
      console.warn('[pipeline] Market digest generation failed (non-critical):', (digestErr as Error).message?.slice(0, 100));
    }

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
    const sr: StageResult = {
      status: 'failed',
      startedAt,
      finishedAt: new Date().toISOString(),
      detail: 'Error generando reporte.',
      errors: [],
      criticalError: (err as Error).message.slice(0, 200),
    };
    updatePipelineStage(runId, 'report', sr);
    return sr;
  }
}

async function runRemainingStages(runId: number): Promise<void> {
  const today = getToday();

  if (!isNewsStageValid()) {
    const newsResult = await runNewsStage(runId);
    if (newsResult.status === 'failed') {
      for (const s of ['fundamentals', 'analysis', 'report'] as const) {
        updatePipelineStage(runId, s, { status: 'skipped', detail: 'Saltado: noticias fallaron.', errors: [], startedAt: null, finishedAt: null });
      }
      finishPipelineRun(runId, 'failed');
      return;
    }
  } else {
    updatePipelineStage(runId, 'news', {
      status: 'skipped', startedAt: new Date().toISOString(), finishedAt: new Date().toISOString(),
      detail: 'Noticias del día ya disponibles.', errors: [],
    });
  }

  await runFundamentalsStage(runId);

  if (!isAnalysisStageValid()) {
    const analysisResult = await runAnalysisStage(runId);
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

  await runReportStage(runId);

  const finalRun = getPipelineRunByDate(today)!;
  const stageList = [finalRun.stages.webSearch, finalRun.stages.news, finalRun.stages.fundamentals, finalRun.stages.analysis, finalRun.stages.report];
  const anyFailed = stageList.some((s) => s.status === 'failed');
  const allOk = stageList.every((s) => s.status === 'ok' || s.status === 'skipped');
  finishPipelineRun(runId, anyFailed ? 'failed' : allOk ? 'ok' : 'partial');
}

export async function checkOrRunPipeline(force = false): Promise<PipelineRun> {
  _stageUnifiedAnalyses = null;
  _stageQuantContext = null;
  const today = getToday();

  const activeRun = getActivePipelineRun();
  if (activeRun) return activeRun;

  // If there's a waiting_user run for today, return it — user must resolve first
  const waitingRun = getWaitingUserRun(today);
  if (waitingRun) return waitingRun;

  const run = createPipelineRun(today);
  const runId = run.id;

  try {
    const webSearchResult = await runWebSearchStage(runId);

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

  if (action === 'cancel') {
    finishPipelineRun(runId, 'cancelled');
    return getPipelineRunByDate(today)!;
  }

  markRunAsRunning(runId);

  if (action === 'retry') {
    const webSearchResult = await runWebSearchStage(runId);
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
  stage: 'webSearch' | 'news' | 'fundamentals' | 'analysis' | 'report'
): Promise<PipelineRun> {
  const today = getToday();
  const activeRun = getActivePipelineRun();
  if (activeRun) return activeRun;

  const existingRun = getPipelineRunByDate(today);
  const run = existingRun ?? createPipelineRun(today);
  const runId = run.id;
  // For report-only re-runs, reuse analyses already in memory from Stage 3.
  // For any other stage re-run, reset so stale data doesn't leak forward.
  _stageUnifiedAnalyses = stage === 'report' ? (getLastUnifiedAnalyses() ?? null) : null;
  markRunAsRunning(runId);

  if (stage === 'webSearch') {
    for (const s of ['news', 'fundamentals', 'analysis', 'report'] as const) {
      updatePipelineStage(runId, s, { status: 'pending', detail: 'Pendiente re-run.', errors: [], startedAt: null, finishedAt: null });
    }
    const webSearchResult = await runWebSearchStage(runId);
    if (webSearchResult.status === 'failed') {
      pauseRunWaitingUser(runId);
      return getPipelineRunByDate(today)!;
    }
    await runRemainingStages(runId);
  } else if (stage === 'news') {
    for (const s of ['fundamentals', 'analysis', 'report'] as const) {
      updatePipelineStage(runId, s, { status: 'pending', detail: 'Pendiente re-run de noticias.', errors: [], startedAt: null, finishedAt: null });
    }
    await runNewsStage(runId);
    await runFundamentalsStage(runId);
    await runAnalysisStage(runId);
    await runReportStage(runId);
  } else if (stage === 'fundamentals') {
    for (const s of ['analysis', 'report'] as const) {
      updatePipelineStage(runId, s, { status: 'pending', detail: 'Pendiente re-run de fundamentales.', errors: [], startedAt: null, finishedAt: null });
    }
    await runFundamentalsStage(runId);
    await runAnalysisStage(runId);
    await runReportStage(runId);
  } else if (stage === 'analysis') {
    updatePipelineStage(runId, 'report', { status: 'pending', detail: 'Pendiente re-run de análisis.', errors: [], startedAt: null, finishedAt: null });
    await runAnalysisStage(runId);
    await runReportStage(runId);
  } else {
    await runReportStage(runId);
  }

  const finalRun = getPipelineRunByDate(today)!;
  const stageList = [finalRun.stages.webSearch, finalRun.stages.news, finalRun.stages.fundamentals, finalRun.stages.analysis, finalRun.stages.report];
  const anyFailed = stageList.some((s) => s.status === 'failed');
  const allOk = stageList.every((s) => s.status === 'ok' || s.status === 'skipped');
  finishPipelineRun(runId, anyFailed ? 'failed' : allOk ? 'ok' : 'partial');
  return getPipelineRunByDate(today)!;
}

export { getPipelineRunByDate, getActivePipelineRun, getPipelineHistory };
