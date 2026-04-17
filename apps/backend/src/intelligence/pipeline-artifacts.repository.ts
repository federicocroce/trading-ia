import { db } from '../db/index.js';
import { pipelineStageArtifacts, unifiedAnalysisBatches } from '../db/schema.js';
import { eq } from 'drizzle-orm';

const MAX_SNAPSHOT_BYTES = 50 * 1024; // 50KB

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
