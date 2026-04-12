// apps/backend/src/intelligence/pipeline.service.ts
import {
  createPipelineRun,
  getPipelineRunByDate,
  getActivePipelineRun,
  updatePipelineStage,
  finishPipelineRun,
  markOrphanedRunsFailed,
  getPipelineHistory,
} from './pipeline.repository.js';
import { generateMarketReport } from './market-report.service.js';
import { getNewsArticlesForToday, getTodayOpportunityScan, getFundamentalCacheAge } from '../db/repository.js';
import { refreshNewsProcess, runAnalysisBlocking, refreshFundamentalsProcess, getLastUnifiedAnalyses } from '../opportunities/opportunities.service.js';
import type { PipelineRun, StageResult } from '@trading/shared';

// State passed between stages within a single pipeline run
// Null between runs; populated by STAGE 3; consumed and cleared by STAGE 4
let _stageUnifiedAnalyses: Map<string, import('@trading/shared').UnifiedAssetAnalysis> | null = null;

export function initPipeline() {
  markOrphanedRunsFailed();
}

function getToday(): string {
  return new Date().toISOString().split('T')[0];
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
    return 999; // treat as stale if unknown
  }
}

async function runNewsStage(runId: number): Promise<StageResult> {
  const startedAt = new Date().toISOString();
  updatePipelineStage(runId, 'news', { status: 'running', startedAt });
  const errors: string[] = [];
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
      errors,
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

  if (daysOld < 7) {
    const sr: StageResult = {
      status: 'skipped',
      startedAt,
      finishedAt: new Date().toISOString(),
      detail: `Cache válido (${daysOld.toFixed(1)} días). Próxima actualización en ${(7 - daysOld).toFixed(1)} días.`,
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
    // Capturar análisis unificados para STAGE 4
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

async function runReportStage(runId: number): Promise<StageResult> {
  const startedAt = new Date().toISOString();
  updatePipelineStage(runId, 'report', { status: 'running', startedAt });
  try {
    const report = await generateMarketReport(_stageUnifiedAnalyses ?? undefined);
    _stageUnifiedAnalyses = null; // limpiar después de uso
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

export async function checkOrRunPipeline(force = false): Promise<PipelineRun> {
  _stageUnifiedAnalyses = null; // reset para este run
  const today = getToday();
  const activeRun = getActivePipelineRun();
  if (activeRun) return activeRun;

  const run = createPipelineRun(today);
  const runId = run.id;

  try {
    // Stage 1: News
    if (!force && isNewsStageValid()) {
      updatePipelineStage(runId, 'news', {
        status: 'skipped', startedAt: new Date().toISOString(), finishedAt: new Date().toISOString(),
        detail: 'Noticias del día ya disponibles.', errors: [],
      });
    } else {
      const newsResult = await runNewsStage(runId);
      if (newsResult.status === 'failed') {
        for (const s of ['fundamentals', 'analysis', 'report'] as const) {
          updatePipelineStage(runId, s, { status: 'skipped', detail: 'Saltado: noticias fallaron.', errors: [], startedAt: null, finishedAt: null });
        }
        finishPipelineRun(runId, 'failed');
        return getPipelineRunByDate(today)!;
      }
    }

    // Stage 2: Fundamentals (skip logic built-in)
    await runFundamentalsStage(runId);
    // Note: fundamentals failure is non-fatal — continue to analysis

    // Stage 3: Analysis
    if (!force && isAnalysisStageValid()) {
      updatePipelineStage(runId, 'analysis', {
        status: 'skipped', startedAt: new Date().toISOString(), finishedAt: new Date().toISOString(),
        detail: 'Análisis del día ya disponible.', errors: [],
      });
    } else {
      const analysisResult = await runAnalysisStage(runId);
      if (analysisResult.status === 'failed') {
        updatePipelineStage(runId, 'report', { status: 'skipped', detail: 'Saltado: análisis falló.', errors: [], startedAt: null, finishedAt: null });
        finishPipelineRun(runId, 'failed');
        return getPipelineRunByDate(today)!;
      }
    }

    // Stage 4: Report
    await runReportStage(runId);

    const finalRun = getPipelineRunByDate(today)!;
    const stageList = [finalRun.stages.news, finalRun.stages.fundamentals, finalRun.stages.analysis, finalRun.stages.report];
    const anyFailed = stageList.some(s => s.status === 'failed');
    const allOk = stageList.every(s => s.status === 'ok' || s.status === 'skipped');
    finishPipelineRun(runId, anyFailed ? 'failed' : allOk ? 'ok' : 'partial');
    return getPipelineRunByDate(today)!;
  } catch (err) {
    finishPipelineRun(runId, 'failed');
    throw err;
  }
}

export async function rerunPipelineStage(
  stage: 'news' | 'fundamentals' | 'analysis' | 'report'
): Promise<PipelineRun> {
  const today = getToday();
  const activeRun = getActivePipelineRun();
  if (activeRun) return activeRun;

  const existingRun = getPipelineRunByDate(today);
  const run = existingRun ?? createPipelineRun(today);
  const runId = run.id;

  if (stage === 'news') {
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
  const stageList = [finalRun.stages.news, finalRun.stages.fundamentals, finalRun.stages.analysis, finalRun.stages.report];
  const anyFailed = stageList.some(s => s.status === 'failed');
  const allOk = stageList.every(s => s.status === 'ok' || s.status === 'skipped');
  finishPipelineRun(runId, anyFailed ? 'failed' : allOk ? 'ok' : 'partial');
  return getPipelineRunByDate(today)!;
}

export { getPipelineRunByDate, getActivePipelineRun, getPipelineHistory };
