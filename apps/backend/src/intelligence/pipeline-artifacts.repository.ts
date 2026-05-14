import type { UnifiedAssetAnalysis } from '@trading/shared';
import { db } from '../db/index.js';
import { pipelineStageArtifacts, unifiedAnalysisBatches, unifiedAnalysisResults } from '../db/schema.js';
import { eq, desc } from 'drizzle-orm';

const MAX_SNAPSHOT_BYTES = 500 * 1024; // 500KB — covers full market reports without truncation

function truncateSnapshot(data: unknown): string {
  const str = JSON.stringify(data);
  if (str.length <= MAX_SNAPSHOT_BYTES) return str;
  return JSON.stringify({ _truncated: true, _originalSize: str.length, preview: str.slice(0, 1000) });
}

export function saveStageArtifact(params: {
  pipelineRunId: number;
  stage: 'webSearch' | 'news' | 'fundamentals' | 'analysis' | 'report' | 'digest';
  input?: unknown;
  output?: unknown;
  tokensUsed?: number;
  modelUsed?: string;
  symbolsProcessed?: string[];
  durationMs?: number;
  errorCount?: number;
}): void {
  db.insert(pipelineStageArtifacts).values({
    pipelineRunId: params.pipelineRunId,
    stage: params.stage,
    inputSnapshot: params.input !== undefined ? truncateSnapshot(params.input) : null,
    outputSnapshot: params.output !== undefined ? truncateSnapshot(params.output) : null,
    tokensUsed: params.tokensUsed ?? null,
    modelUsed: params.modelUsed ?? null,
    symbolsProcessed: params.symbolsProcessed ? JSON.stringify(params.symbolsProcessed) : null,
    durationMs: params.durationMs ?? null,
    errorCount: params.errorCount ?? 0,
  }).run();
}

export function saveUnifiedAnalysisBatch(params: {
  pipelineRunId: number;
  batchIndex: number;
  assetsInput: string[];
  modelUsed: string;
  tokensInput?: number;
  tokensOutput?: number;
  durationMs?: number;
  parsedOk: boolean;
  errorMsg?: string;
  rawResponse?: string;
}): void {
  db.insert(unifiedAnalysisBatches).values({
    pipelineRunId: params.pipelineRunId,
    batchIndex: params.batchIndex,
    assetsInput: JSON.stringify(params.assetsInput),
    modelUsed: params.modelUsed,
    tokensInput: params.tokensInput ?? null,
    tokensOutput: params.tokensOutput ?? null,
    durationMs: params.durationMs ?? null,
    parsedOk: params.parsedOk,
    errorMsg: params.errorMsg ?? null,
    rawResponse: params.rawResponse ?? null,
  }).run();
}

export function getStageArtifactsByRun(pipelineRunId: number) {
  return db.select()
    .from(pipelineStageArtifacts)
    .where(eq(pipelineStageArtifacts.pipelineRunId, pipelineRunId))
    .orderBy(pipelineStageArtifacts.createdAt)
    .all();
}

export function getUnifiedBatchesByRun(pipelineRunId: number) {
  return db.select()
    .from(unifiedAnalysisBatches)
    .where(eq(unifiedAnalysisBatches.pipelineRunId, pipelineRunId))
    .orderBy(unifiedAnalysisBatches.batchIndex)
    .all();
}

export function saveUnifiedAnalysisResults(params: {
  pipelineRunId?: number;
  results: Map<string, UnifiedAssetAnalysis>;
  portfolioSymbols: Set<string>;
  scoreBySymbol?: Map<string, number>;
}): void {
  if (params.results.size === 0) return;
  const today = new Date().toISOString().slice(0, 10);
  for (const [symbol, a] of params.results) {
    // Dedupe key: per pipeline run OR per day if manual (no pipelineRunId).
    // ON CONFLICT updates the existing row instead of inserting a duplicate.
    const dedupeKey = params.pipelineRunId != null
      ? `run-${params.pipelineRunId}-${symbol}`
      : `manual-${today}-${symbol}`;
    db.insert(unifiedAnalysisResults).values({
      pipelineRunId: params.pipelineRunId ?? null,
      symbol,
      action: a.action,
      inPortfolio: params.portfolioSymbols.has(symbol),
      thesis: a.thesis,
      catalysts: JSON.stringify(a.catalysts ?? []),
      risks: JSON.stringify(a.risks ?? []),
      wouldDo: JSON.stringify(a.wouldDo ?? []),
      wouldNotDo: JSON.stringify(a.wouldNotDo ?? []),
      narrative: a.narrative,
      macroTheme: a.macroTheme ?? null,
      generatedBy: a.generatedBy,
      opportunityScore: params.scoreBySymbol?.get(symbol) ?? null,
      dedupeKey,
    }).onConflictDoUpdate({
      target: unifiedAnalysisResults.dedupeKey,
      set: {
        action: a.action,
        thesis: a.thesis,
        catalysts: JSON.stringify(a.catalysts ?? []),
        risks: JSON.stringify(a.risks ?? []),
        wouldDo: JSON.stringify(a.wouldDo ?? []),
        wouldNotDo: JSON.stringify(a.wouldNotDo ?? []),
        narrative: a.narrative,
        macroTheme: a.macroTheme ?? null,
        generatedBy: a.generatedBy,
        opportunityScore: params.scoreBySymbol?.get(symbol) ?? null,
        generatedAt: new Date().toISOString(),
      },
    }).run();
  }
}

export function getLatestUnifiedAnalysisForSymbol(symbol: string) {
  const row = db.select()
    .from(unifiedAnalysisResults)
    .where(eq(unifiedAnalysisResults.symbol, symbol))
    .orderBy(desc(unifiedAnalysisResults.generatedAt))
    .get();
  if (!row) return null;
  return {
    ...row,
    catalysts: JSON.parse(row.catalysts) as string[],
    risks: JSON.parse(row.risks) as string[],
    wouldDo: JSON.parse(row.wouldDo) as string[],
    wouldNotDo: JSON.parse(row.wouldNotDo) as string[],
  };
}

export function getUnifiedAnalysesByRun(pipelineRunId: number) {
  return db.select()
    .from(unifiedAnalysisResults)
    .where(eq(unifiedAnalysisResults.pipelineRunId, pipelineRunId))
    .all()
    .map(row => ({
      ...row,
      catalysts: JSON.parse(row.catalysts) as string[],
      risks: JSON.parse(row.risks) as string[],
      wouldDo: JSON.parse(row.wouldDo) as string[],
      wouldNotDo: JSON.parse(row.wouldNotDo) as string[],
    }));
}
