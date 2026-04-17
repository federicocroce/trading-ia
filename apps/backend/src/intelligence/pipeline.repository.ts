import { eq, desc, gte, or } from 'drizzle-orm';
import { db, schema } from '../db/index.js';
import type { PipelineRun, StageResult, StageStatus } from '@trading/shared';

function stageResultFromRow(
  status: string,
  detail: string | null,
  errors: string | null,
  startedAt: string | null,
  finishedAt: string | null,
): StageResult {
  return {
    status: (status ?? 'pending') as StageStatus,
    detail: detail ?? '',
    errors: errors ? (JSON.parse(errors) as string[]) : [],
    startedAt: startedAt ?? null,
    finishedAt: finishedAt ?? null,
  };
}

function rowToPipelineRun(row: typeof schema.pipelineRuns.$inferSelect): PipelineRun {
  return {
    id: row.id,
    date: row.date,
    status: row.status as PipelineRun['status'],
    startedAt: row.startedAt,
    finishedAt: row.finishedAt ?? null,
    stages: {
      webSearch: stageResultFromRow(row.webSearchStatus, row.webSearchDetail, row.webSearchErrors, row.webSearchStartedAt, row.webSearchFinishedAt),
      news: stageResultFromRow(row.newsStatus, row.newsDetail, row.newsErrors, row.newsStartedAt, row.newsFinishedAt),
      fundamentals: stageResultFromRow(row.fundamentalsStatus, row.fundamentalsDetail, row.fundamentalsErrors, row.fundamentalsStartedAt, row.fundamentalsFinishedAt),
      analysis: stageResultFromRow(row.analysisStatus, row.analysisDetail, row.analysisErrors, row.analysisStartedAt, row.analysisFinishedAt),
      quant: stageResultFromRow(row.quantStatus, row.quantDetail, row.quantErrors, row.quantStartedAt, row.quantFinishedAt),
      report: stageResultFromRow(row.reportStatus, row.reportDetail, row.reportErrors, row.reportStartedAt, row.reportFinishedAt),
    },
  };
}

export function createPipelineRun(date: string): PipelineRun {
  const now = new Date().toISOString();
  const result = db.insert(schema.pipelineRuns).values({
    date,
    status: 'running',
    webSearchStatus: 'pending',
    newsStatus: 'pending',
    fundamentalsStatus: 'pending',
    analysisStatus: 'pending',
    quantStatus: 'pending',
    reportStatus: 'pending',
    startedAt: now,
  }).returning().get();
  return rowToPipelineRun(result);
}

export function getPipelineRunByDate(date: string): PipelineRun | null {
  const row = db.select().from(schema.pipelineRuns)
    .where(eq(schema.pipelineRuns.date, date))
    .orderBy(desc(schema.pipelineRuns.createdAt))
    .get();
  return row ? rowToPipelineRun(row) : null;
}

export function getActivePipelineRun(): PipelineRun | null {
  const row = db.select().from(schema.pipelineRuns)
    .where(eq(schema.pipelineRuns.status, 'running'))
    .orderBy(desc(schema.pipelineRuns.createdAt))
    .get();
  return row ? rowToPipelineRun(row) : null;
}

export function getWaitingUserRun(date: string): PipelineRun | null {
  const row = db.select().from(schema.pipelineRuns)
    .where(eq(schema.pipelineRuns.date, date))
    .orderBy(desc(schema.pipelineRuns.createdAt))
    .get();
  if (!row || row.status !== 'waiting_user') return null;
  return rowToPipelineRun(row);
}

export function getPipelineHistory(limit = 7): PipelineRun[] {
  const rows = db.select().from(schema.pipelineRuns)
    .orderBy(desc(schema.pipelineRuns.createdAt))
    .limit(limit)
    .all();
  return rows.map(rowToPipelineRun);
}

export function updatePipelineStage(
  runId: number,
  stage: 'webSearch' | 'news' | 'fundamentals' | 'analysis' | 'quant' | 'report',
  result: Partial<StageResult & { startedAt: string | null; finishedAt: string | null }>,
) {
  const updates: Record<string, unknown> = {};
  if (result.status !== undefined) updates[`${stage}Status`] = result.status;
  if (result.detail !== undefined) updates[`${stage}Detail`] = result.detail;
  if (result.errors !== undefined) updates[`${stage}Errors`] = JSON.stringify(result.errors);
  if ('startedAt' in result) updates[`${stage}StartedAt`] = result.startedAt;
  if ('finishedAt' in result) updates[`${stage}FinishedAt`] = result.finishedAt;
  db.update(schema.pipelineRuns).set(updates as any).where(eq(schema.pipelineRuns.id, runId)).run();
}

export function markRunAsRunning(runId: number) {
  db.update(schema.pipelineRuns).set({
    status: 'running',
    startedAt: new Date().toISOString(),
    finishedAt: null,
  }).where(eq(schema.pipelineRuns.id, runId)).run();
}

export function pauseRunWaitingUser(runId: number) {
  db.update(schema.pipelineRuns).set({
    status: 'waiting_user',
    finishedAt: null,
  }).where(eq(schema.pipelineRuns.id, runId)).run();
}

export function finishPipelineRun(runId: number, status: 'ok' | 'partial' | 'failed' | 'cancelled') {
  db.update(schema.pipelineRuns).set({
    status,
    finishedAt: new Date().toISOString(),
  }).where(eq(schema.pipelineRuns.id, runId)).run();
}

export function markOrphanedRunsFailed() {
  const orphans = db.select().from(schema.pipelineRuns)
    .where(or(
      eq(schema.pipelineRuns.status, 'running'),
      eq(schema.pipelineRuns.status, 'waiting_user'),
    ))
    .all();
  for (const o of orphans) {
    db.update(schema.pipelineRuns).set({
      status: 'failed',
      finishedAt: new Date().toISOString(),
    }).where(eq(schema.pipelineRuns.id, o.id)).run();
  }
}

// --- Market Reports ---

export function saveMarketReport(data: {
  status: 'ok' | 'partial' | 'failed';
  macroContext?: string;
  portfolioImpact?: string;
  themes?: unknown;
  topRecommendations?: unknown;
  alternatives?: unknown;
  scenarios?: unknown;
  avoidList?: unknown;
  engine?: string;
  errors?: string[];
}) {
  return db.insert(schema.marketReports).values({
    generatedAt: new Date().toISOString(),
    status: data.status,
    macroContext: data.macroContext ?? null,
    portfolioImpact: data.portfolioImpact ?? null,
    themes: data.themes ? JSON.stringify(data.themes) : null,
    topRecommendations: data.topRecommendations ? JSON.stringify(data.topRecommendations) : null,
    alternatives: data.alternatives ? JSON.stringify(data.alternatives) : null,
    scenarios: data.scenarios ? JSON.stringify(data.scenarios) : null,
    avoidList: data.avoidList ? JSON.stringify(data.avoidList) : null,
    engine: data.engine ?? null,
    errors: data.errors ? JSON.stringify(data.errors) : null,
  }).returning().get();
}

export function getTodayMarketReport() {
  const today = new Date().toISOString().split('T')[0];
  const row = db.select().from(schema.marketReports)
    .where(gte(schema.marketReports.generatedAt, today))
    .orderBy(desc(schema.marketReports.createdAt))
    .get();
  if (!row) return null;
  return {
    ...row,
    themes: row.themes ? JSON.parse(row.themes) : null,
    topRecommendations: row.topRecommendations ? JSON.parse(row.topRecommendations) : null,
    alternatives: row.alternatives ? JSON.parse(row.alternatives) : null,
    scenarios: row.scenarios ? JSON.parse(row.scenarios) : null,
    avoidList: row.avoidList ? JSON.parse(row.avoidList) : null,
    errors: row.errors ? JSON.parse(row.errors) : [],
  };
}

export function getLatestMarketReport() {
  const row = db.select().from(schema.marketReports)
    .orderBy(desc(schema.marketReports.createdAt))
    .get();
  if (!row) return null;
  return {
    ...row,
    themes: row.themes ? JSON.parse(row.themes) : null,
    topRecommendations: row.topRecommendations ? JSON.parse(row.topRecommendations) : null,
    alternatives: row.alternatives ? JSON.parse(row.alternatives) : null,
    scenarios: row.scenarios ? JSON.parse(row.scenarios) : null,
    avoidList: row.avoidList ? JSON.parse(row.avoidList) : null,
    errors: row.errors ? JSON.parse(row.errors) : [],
  };
}
