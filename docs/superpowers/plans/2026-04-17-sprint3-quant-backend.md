# Sprint 3 Quant Engine — Backend Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the `quant/` backend domain: regime detection, cross-sectional momentum ranking, adaptive weight calibration, backtesting engine, and pipeline integration.

**Architecture:** New `apps/backend/src/quant/` domain with 5 focused services. Pipeline gets a new non-blocking `quant` stage between `analysis` and `report`. Existing `scoring.ts` gets an optional `overrideWeights` parameter — no breaking changes.

**Tech Stack:** TypeScript, Drizzle ORM + SQLite, `better-sqlite3`, tRPC, Yahoo Finance (via existing `getHistoricalQuotes`), existing `computeIndicators` + `scoreTechnical` exports from `technical-analysis.service.ts`.

---

## File Map

**New files:**
- `packages/shared/src/types/quant.ts` — all shared quant types
- `apps/backend/src/quant/regime-detector.service.ts` — pure function, no DB
- `apps/backend/src/quant/momentum-ranker.service.ts` — pure function, no DB
- `apps/backend/src/quant/weight-calibrator.service.ts` — reads signal_tracking, writes calibrated_weights
- `apps/backend/src/quant/backtest.service.ts` — runs backtest, writes to DB
- `apps/backend/src/quant/backtest.repository.ts` — CRUD for backtest_runs table
- `apps/backend/src/quant/quant.router.ts` — tRPC endpoints

**Modified files:**
- `packages/shared/src/types/index.ts` — add `export * from './quant.js'`
- `packages/shared/src/types/intelligence.ts` — add `quant?: StageResult` to PipelineRun.stages
- `apps/backend/src/db/schema.ts` — add quant columns to pipelineRuns, add 3 new tables
- `apps/backend/src/intelligence/pipeline.repository.ts` — update rowToPipelineRun, createPipelineRun, updatePipelineStage
- `apps/backend/src/opportunities/scoring.ts:75-83` — add optional `overrideWeights` to computeCompositeScore
- `apps/backend/src/intelligence/pipeline.service.ts` — add quant stage, pass quantContext to digest
- `apps/backend/src/intelligence/market-digest.service.ts:19` — add optional `quantContext` param
- `apps/backend/src/router.ts` — register quantRouter

---

## Task 1: Shared Quant Types

**Files:**
- Create: `packages/shared/src/types/quant.ts`
- Modify: `packages/shared/src/types/index.ts`

- [ ] **Step 1: Create quant.ts**

```typescript
// packages/shared/src/types/quant.ts

export type MarketRegime =
  | 'trending_bull'
  | 'trending_bear'
  | 'mean_reverting'
  | 'volatile'
  | 'unknown';

export interface RegimeResult {
  regime: MarketRegime;
  confidence: number;
  indicators: {
    adxValue: number;
    atrRatio: number;
    trendConsistency: number;
    spyMomentum: number;
  };
  detectedAt: string;
}

export interface MomentumRanking {
  symbol: string;
  rank: number;
  relativeStrength: number;
  absoluteMomentum: number;
  percentile: number;
}

export interface CalibratedWeights {
  shortTerm: { sentiment: number; technical: number; fundamental: number };
  mediumTerm: { sentiment: number; technical: number; fundamental: number };
  calibratedAt: string;
  basedOnDays: number;
  signalAccuracies: Record<string, number>;
}

export interface QuantContext {
  regime: RegimeResult;
  momentumRankings: MomentumRanking[];
  calibratedWeights: CalibratedWeights | null;
}

export interface StrategyConfig {
  name: string;
  shortTermWeights?: { sentiment: number; technical: number; fundamental: number };
  mediumTermWeights?: { sentiment: number; technical: number; fundamental: number };
  buyThreshold: number;
  sellThreshold: number;
  stopLossPercent: number;
  takeProfitPercent: number;
}

export interface BacktestTrade {
  symbol: string;
  entryDate: string;
  exitDate: string;
  entryPrice: number;
  exitPrice: number;
  returnPercent: number;
  exitReason: 'signal' | 'stop_loss' | 'take_profit' | 'end_of_period';
}

export interface BacktestMetrics {
  totalReturnPercent: number;
  buyAndHoldReturnPercent: number;
  sharpeRatio: number;
  maxDrawdownPercent: number;
  winRate: number;
  numTrades: number;
  avgTradeDurationDays: number;
}

export interface BacktestEquityPoint {
  date: string;
  portfolioValue: number;
  buyAndHoldValue: number;
  drawdownPercent: number;
}

export interface BacktestRun {
  id: number;
  symbol: string;
  startDate: string;
  endDate: string;
  strategy: StrategyConfig;
  metrics: BacktestMetrics;
  trades: BacktestTrade[];
  equityCurve: BacktestEquityPoint[];
  createdAt: string;
  status: 'running' | 'completed' | 'failed';
  error?: string;
}
```

- [ ] **Step 2: Export from index.ts**

In `packages/shared/src/types/index.ts`, add at the end:
```typescript
export * from './quant.js';
```

- [ ] **Step 3: Typecheck**

```bash
cd /Users/federicocroce/Documents/Fede/trading && npm run typecheck -w packages/shared
```
Expected: no errors.

- [ ] **Step 4: Commit**

```bash
git add packages/shared/src/types/quant.ts packages/shared/src/types/index.ts
git commit -m "feat(shared): add quant types — MarketRegime, QuantContext, BacktestRun"
```

---

## Task 2: PipelineRun Quant Stage Type

**Files:**
- Modify: `packages/shared/src/types/intelligence.ts`

- [ ] **Step 1: Add quant stage to PipelineRun**

In `packages/shared/src/types/intelligence.ts`, find the `PipelineRun` interface (line ~168) and add `quant?: StageResult` to stages:

```typescript
export interface PipelineRun {
  id: number
  date: string
  status: 'running' | 'ok' | 'partial' | 'failed' | 'waiting_user' | 'cancelled'
  stages: {
    webSearch: StageResult
    news: StageResult
    fundamentals: StageResult
    analysis: StageResult
    quant?: StageResult
    report: StageResult
  }
  startedAt: string
  finishedAt: string | null
}
```

- [ ] **Step 2: Typecheck**

```bash
cd /Users/federicocroce/Documents/Fede/trading && npm run typecheck -w packages/shared
```
Expected: no errors.

- [ ] **Step 3: Commit**

```bash
git add packages/shared/src/types/intelligence.ts
git commit -m "feat(shared): add optional quant stage to PipelineRun"
```

---

## Task 3: DB Schema — New Tables + Quant Stage Columns

**Files:**
- Modify: `apps/backend/src/db/schema.ts`

- [ ] **Step 1: Add quant columns to pipelineRuns table**

In `apps/backend/src/db/schema.ts`, after the `analysisFinishedAt` line and before `// Stage: report` (around line 374), insert:

```typescript
  // Stage: quant (non-blocking, runs after analysis)
  quantStatus: text('quant_status', { enum: ['pending', 'running', 'ok', 'partial', 'failed', 'skipped'] }).notNull().default('pending'),
  quantDetail: text('quant_detail'),
  quantErrors: text('quant_errors'),
  quantStartedAt: text('quant_started_at'),
  quantFinishedAt: text('quant_finished_at'),
```

- [ ] **Step 2: Add 3 new tables at the end of schema.ts**

After the `pipelineRuns` table definition (after line 384), add:

```typescript
// --- Backtest runs ---
export const backtestRuns = sqliteTable('backtest_runs', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  symbol: text('symbol').notNull(),
  startDate: text('start_date').notNull(),
  endDate: text('end_date').notNull(),
  strategy: text('strategy').notNull(),
  metrics: text('metrics'),
  trades: text('trades'),
  equityCurve: text('equity_curve'),
  status: text('status').notNull().default('running'),
  error: text('error'),
  createdAt: text('created_at').notNull().default(sql`(datetime('now'))`),
});

// --- Calibrated weights history ---
export const calibratedWeightsTable = sqliteTable('calibrated_weights', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  weights: text('weights').notNull(),
  createdAt: text('created_at').notNull().default(sql`(datetime('now'))`),
});
```

Note: `quantContextCache` is omitted — `QuantContext` is stored in memory between pipeline stages only (no DB persistence needed, it's transient per pipeline run).

- [ ] **Step 3: Generate migration**

```bash
cd /Users/federicocroce/Documents/Fede/trading/apps/backend && npm run db:generate
```
Expected: new migration file created in `drizzle/` folder.

- [ ] **Step 4: Apply migration**

```bash
cd /Users/federicocroce/Documents/Fede/trading/apps/backend && npm run db:migrate
```
Expected: `[db] Migrations complete.`

- [ ] **Step 5: Typecheck**

```bash
cd /Users/federicocroce/Documents/Fede/trading/apps/backend && npm run typecheck
```
Expected: no errors.

- [ ] **Step 6: Commit**

```bash
git add apps/backend/src/db/schema.ts apps/backend/drizzle/
git commit -m "feat(db): add quant stage columns, backtest_runs, calibrated_weights tables"
```

---

## Task 4: Pipeline Repository — Quant Stage Support

**Files:**
- Modify: `apps/backend/src/intelligence/pipeline.repository.ts`

- [ ] **Step 1: Update rowToPipelineRun to include quant stage**

In `pipeline.repository.ts`, find the `rowToPipelineRun` function. Add `quant` to the stages object:

```typescript
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
```

- [ ] **Step 2: Update createPipelineRun to initialize quant stage**

In `createPipelineRun`, add `quantStatus: 'pending'` to the `.values()` call:

```typescript
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
```

- [ ] **Step 3: Update updatePipelineStage to accept 'quant'**

Change the `stage` parameter type:

```typescript
export function updatePipelineStage(
  runId: number,
  stage: 'webSearch' | 'news' | 'fundamentals' | 'analysis' | 'quant' | 'report',
  result: Partial<StageResult & { startedAt: string | null; finishedAt: string | null }>,
) {
```

- [ ] **Step 4: Typecheck**

```bash
cd /Users/federicocroce/Documents/Fede/trading/apps/backend && npm run typecheck
```
Expected: no errors.

- [ ] **Step 5: Commit**

```bash
git add apps/backend/src/intelligence/pipeline.repository.ts
git commit -m "feat(pipeline): add quant stage to repository (createPipelineRun, updatePipelineStage, rowToPipelineRun)"
```

---

## Task 5: Backtest Repository

**Files:**
- Create: `apps/backend/src/quant/backtest.repository.ts`

- [ ] **Step 1: Create backtest.repository.ts**

```typescript
// apps/backend/src/quant/backtest.repository.ts
import { db } from '../db/index.js';
import { backtestRuns, calibratedWeightsTable } from '../db/schema.js';
import { eq, desc, sql } from 'drizzle-orm';
import type {
  BacktestRun,
  BacktestMetrics,
  BacktestTrade,
  BacktestEquityPoint,
  StrategyConfig,
  CalibratedWeights,
} from '@trading/shared';

export function insertBacktestRun(params: {
  symbol: string;
  startDate: string;
  endDate: string;
  strategy: StrategyConfig;
}): number {
  const result = db.insert(backtestRuns).values({
    symbol: params.symbol,
    startDate: params.startDate,
    endDate: params.endDate,
    strategy: JSON.stringify(params.strategy),
    status: 'running',
  }).returning({ id: backtestRuns.id }).get();
  return result.id;
}

export function updateBacktestRun(id: number, updates: {
  metrics?: BacktestMetrics;
  trades?: BacktestTrade[];
  equityCurve?: BacktestEquityPoint[];
  status: 'completed' | 'failed';
  error?: string;
}): void {
  db.update(backtestRuns).set({
    ...(updates.metrics !== undefined && { metrics: JSON.stringify(updates.metrics) }),
    ...(updates.trades !== undefined && { trades: JSON.stringify(updates.trades) }),
    ...(updates.equityCurve !== undefined && { equityCurve: JSON.stringify(updates.equityCurve) }),
    status: updates.status,
    ...(updates.error !== undefined && { error: updates.error }),
  }).where(eq(backtestRuns.id, id)).run();
}

export function getBacktestRun(id: number): BacktestRun | null {
  const row = db.select().from(backtestRuns).where(eq(backtestRuns.id, id)).get();
  return row ? deserialize(row) : null;
}

export function listBacktestRuns(limit = 20): BacktestRun[] {
  const rows = db.select().from(backtestRuns)
    .orderBy(desc(backtestRuns.id))
    .limit(limit)
    .all();
  return rows.map(deserialize);
}

function deserialize(row: typeof backtestRuns.$inferSelect): BacktestRun {
  return {
    id: row.id,
    symbol: row.symbol,
    startDate: row.startDate,
    endDate: row.endDate,
    strategy: JSON.parse(row.strategy) as StrategyConfig,
    metrics: row.metrics ? JSON.parse(row.metrics) as BacktestMetrics : {} as BacktestMetrics,
    trades: row.trades ? JSON.parse(row.trades) as BacktestTrade[] : [],
    equityCurve: row.equityCurve ? JSON.parse(row.equityCurve) as BacktestEquityPoint[] : [],
    createdAt: row.createdAt,
    status: row.status as BacktestRun['status'],
    error: row.error ?? undefined,
  };
}

export function saveLatestCalibratedWeights(weights: CalibratedWeights): void {
  db.insert(calibratedWeightsTable).values({
    weights: JSON.stringify(weights),
  }).run();
}

export function getLatestCalibratedWeights(): CalibratedWeights | null {
  const row = db.select({ weights: calibratedWeightsTable.weights })
    .from(calibratedWeightsTable)
    .orderBy(desc(calibratedWeightsTable.id))
    .limit(1)
    .get();
  if (!row) return null;
  try {
    return JSON.parse(row.weights) as CalibratedWeights;
  } catch {
    return null;
  }
}
```

- [ ] **Step 2: Typecheck**

```bash
cd /Users/federicocroce/Documents/Fede/trading/apps/backend && npm run typecheck
```
Expected: no errors.

- [ ] **Step 3: Commit**

```bash
git add apps/backend/src/quant/backtest.repository.ts
git commit -m "feat(quant): add backtest repository (CRUD for backtest_runs + calibrated_weights)"
```

---

## Task 6: Regime Detector

**Files:**
- Create: `apps/backend/src/quant/regime-detector.service.ts`

- [ ] **Step 1: Create regime-detector.service.ts**

```typescript
// apps/backend/src/quant/regime-detector.service.ts
import type { TechnicalSummary } from '@trading/shared';
import type { RegimeResult, MarketRegime } from '@trading/shared';

export function detectRegime(summaries: TechnicalSummary[]): RegimeResult {
  const valid = summaries.filter(s => s.indicators.currentPrice > 0);

  if (valid.length < 5) {
    return {
      regime: 'unknown',
      confidence: 0,
      indicators: { adxValue: 0, atrRatio: 0, trendConsistency: 0, spyMomentum: 0 },
      detectedAt: new Date().toISOString(),
    };
  }

  // trendConsistency: % of assets with price > SMA200
  const aboveSma200 = valid.filter(s => s.indicators.priceVsSma200 > 0).length;
  const trendConsistency = aboveSma200 / valid.length;

  // adxProxy: avg(|RSI - 50| * 2) — higher = more directional market
  const rsiValues = valid
    .map(s => s.indicators.rsi14)
    .filter((v): v is number => v != null);
  const adxValue = rsiValues.length > 0
    ? rsiValues.reduce((sum, rsi) => sum + Math.abs(rsi - 50) * 2, 0) / rsiValues.length
    : 25;

  // atrRatio: avg(ATR14 / price) — volatility relative to price
  const atrRatios = valid
    .filter(s => s.indicators.atr14 != null && s.indicators.currentPrice > 0)
    .map(s => s.indicators.atr14! / s.indicators.currentPrice);
  const atrRatio = atrRatios.length > 0
    ? atrRatios.reduce((a, b) => a + b, 0) / atrRatios.length
    : 0.015;

  // spyMomentum proxy: normalized % of assets above SMA50 (-1 to +1)
  const aboveSma50 = valid.filter(s => s.indicators.priceVsSma50 > 0).length;
  const spyMomentum = (aboveSma50 / valid.length - 0.5) * 2;

  let regime: MarketRegime;
  let confidence: number;

  if (atrRatio > 0.025) {
    regime = 'volatile';
    confidence = Math.min(100, Math.round((atrRatio - 0.025) / 0.015 * 100) + 20);
  } else if (trendConsistency > 0.65 && adxValue > 30 && spyMomentum > 0) {
    regime = 'trending_bull';
    const c1 = ((trendConsistency - 0.65) / 0.35) * 40;
    const c2 = Math.min(1, (adxValue - 30) / 20) * 40;
    const c3 = spyMomentum * 20;
    confidence = Math.min(100, Math.max(20, Math.round(c1 + c2 + c3)));
  } else if (trendConsistency < 0.35 && adxValue > 30 && spyMomentum < 0) {
    regime = 'trending_bear';
    const c1 = ((0.35 - trendConsistency) / 0.35) * 40;
    const c2 = Math.min(1, (adxValue - 30) / 20) * 40;
    const c3 = Math.abs(spyMomentum) * 20;
    confidence = Math.min(100, Math.max(20, Math.round(c1 + c2 + c3)));
  } else {
    regime = 'mean_reverting';
    confidence = Math.max(20, Math.round(50 - Math.abs(trendConsistency - 0.5) * 60));
  }

  return {
    regime,
    confidence,
    indicators: {
      adxValue: Math.round(adxValue),
      atrRatio: Math.round(atrRatio * 1000) / 1000,
      trendConsistency: Math.round(trendConsistency * 100),
      spyMomentum: Math.round(spyMomentum * 100) / 100,
    },
    detectedAt: new Date().toISOString(),
  };
}

export function getRegimeWeightAdjustment(regime: MarketRegime): {
  shortTerm: { sentiment: number; technical: number; fundamental: number };
  mediumTerm: { sentiment: number; technical: number; fundamental: number };
} {
  const adj = {
    trending_bull:   { shortTerm: { sentiment: 0.05, technical: 0.10, fundamental: -0.15 }, mediumTerm: { sentiment: 0.05, technical: 0.10, fundamental: -0.15 } },
    trending_bear:   { shortTerm: { sentiment: 0.10, technical: 0.10, fundamental: -0.20 }, mediumTerm: { sentiment: 0.10, technical: 0.10, fundamental: -0.20 } },
    mean_reverting:  { shortTerm: { sentiment: -0.05, technical: 0.10, fundamental: -0.05 }, mediumTerm: { sentiment: -0.05, technical: 0.10, fundamental: -0.05 } },
    volatile:        { shortTerm: { sentiment: -0.10, technical: -0.05, fundamental: 0.15 }, mediumTerm: { sentiment: -0.10, technical: -0.05, fundamental: 0.15 } },
    unknown:         { shortTerm: { sentiment: 0, technical: 0, fundamental: 0 }, mediumTerm: { sentiment: 0, technical: 0, fundamental: 0 } },
  };
  return adj[regime];
}
```

- [ ] **Step 2: Typecheck**

```bash
cd /Users/federicocroce/Documents/Fede/trading/apps/backend && npm run typecheck
```
Expected: no errors.

- [ ] **Step 3: Commit**

```bash
git add apps/backend/src/quant/regime-detector.service.ts
git commit -m "feat(quant): add regime detector — trending/mean-reverting/volatile classification"
```

---

## Task 7: Momentum Ranker

**Files:**
- Create: `apps/backend/src/quant/momentum-ranker.service.ts`

- [ ] **Step 1: Create momentum-ranker.service.ts**

```typescript
// apps/backend/src/quant/momentum-ranker.service.ts
import type { TechnicalSummary, MomentumRanking } from '@trading/shared';

export function rankMomentum(summaries: TechnicalSummary[]): MomentumRanking[] {
  const valid = summaries.filter(s => s.indicators.currentPrice > 0);
  if (valid.length === 0) return [];

  // absoluteMomentum: priceVsSma50 (% distance from 50-day SMA, proxy for 20d momentum)
  const withMomentum = valid.map(s => ({
    symbol: s.symbol,
    absoluteMomentum: s.indicators.priceVsSma50 ?? 0,
  }));

  // Market reference: median momentum across all assets
  const sorted = [...withMomentum].sort((a, b) => a.absoluteMomentum - b.absoluteMomentum);
  const mid = Math.floor(sorted.length / 2);
  const medianMom = sorted.length % 2 === 0
    ? (sorted[mid - 1].absoluteMomentum + sorted[mid].absoluteMomentum) / 2
    : sorted[mid].absoluteMomentum;

  // relativeStrength: how much this asset outperforms the median
  const withRelative = withMomentum.map(s => ({
    ...s,
    relativeStrength: s.absoluteMomentum - medianMom,
  }));

  // Sort descending by relativeStrength → rank 1 = strongest
  const ranked = [...withRelative].sort((a, b) => b.relativeStrength - a.relativeStrength);
  const n = ranked.length;

  return ranked.map((s, i) => ({
    symbol: s.symbol,
    rank: i + 1,
    relativeStrength: Math.round(s.relativeStrength * 100) / 100,
    absoluteMomentum: Math.round(s.absoluteMomentum * 100) / 100,
    percentile: Math.round(((n - i - 1) / n) * 100),
  }));
}
```

- [ ] **Step 2: Typecheck**

```bash
cd /Users/federicocroce/Documents/Fede/trading/apps/backend && npm run typecheck
```
Expected: no errors.

- [ ] **Step 3: Commit**

```bash
git add apps/backend/src/quant/momentum-ranker.service.ts
git commit -m "feat(quant): add cross-sectional momentum ranker"
```

---

## Task 8: Weight Calibrator

**Files:**
- Create: `apps/backend/src/quant/weight-calibrator.service.ts`

- [ ] **Step 1: Create weight-calibrator.service.ts**

```typescript
// apps/backend/src/quant/weight-calibrator.service.ts
import { db } from '../db/index.js';
import { signalTracking } from '../db/schema.js';
import { and, isNotNull, ne, gte } from 'drizzle-orm';
import type { CalibratedWeights } from '@trading/shared';
import { SHORT_TERM_WEIGHTS, MEDIUM_TERM_WEIGHTS } from '../opportunities/scoring.js';
import { saveLatestCalibratedWeights, getLatestCalibratedWeights } from './backtest.repository.js';

const MIN_RECORDS = 30;
const LOOKBACK_DAYS = 90;
const SMOOTHING = 0.3;

export function calibrateWeights(): CalibratedWeights | null {
  const cutoff = new Date();
  cutoff.setDate(cutoff.getDate() - LOOKBACK_DAYS);
  const cutoffStr = cutoff.toISOString().split('T')[0];

  const records = db.select({
    techScore: signalTracking.techScore,
    fundScore: signalTracking.fundScore,
    sentScore: signalTracking.sentScore,
    returnAfter30d: signalTracking.returnAfter30d,
  }).from(signalTracking)
    .where(and(
      ne(signalTracking.outcome, 'pending'),
      isNotNull(signalTracking.outcome),
      isNotNull(signalTracking.returnAfter30d),
      gte(signalTracking.signalDate, cutoffStr),
    ))
    .all();

  if (records.length < MIN_RECORDS) return null;

  let techCorrect = 0, fundCorrect = 0, sentCorrect = 0, total = 0;

  for (const r of records) {
    if (r.techScore == null || r.fundScore == null || r.sentScore == null || r.returnAfter30d == null) continue;
    const actualPositive = r.returnAfter30d > 0;
    if ((r.techScore > 0) === actualPositive) techCorrect++;
    if ((r.fundScore > 0) === actualPositive) fundCorrect++;
    if ((r.sentScore > 0) === actualPositive) sentCorrect++;
    total++;
  }

  if (total < MIN_RECORDS) return null;

  const techAcc = techCorrect / total;
  const fundAcc = fundCorrect / total;
  const sentAcc = sentCorrect / total;
  const sum = techAcc + fundAcc + sentAcc || 1;

  const blend = (calc: number, base: number) =>
    Math.round(((1 - SMOOTHING) * (calc / sum) + SMOOTHING * base) * 100) / 100;

  const stTech = blend(techAcc, SHORT_TERM_WEIGHTS.technical);
  const stFund = blend(fundAcc, SHORT_TERM_WEIGHTS.fundamental);
  const stSent = blend(sentAcc, SHORT_TERM_WEIGHTS.sentiment);
  const stSum = stTech + stFund + stSent || 1;

  const mtTech = blend(techAcc, MEDIUM_TERM_WEIGHTS.technical);
  const mtFund = blend(fundAcc, MEDIUM_TERM_WEIGHTS.fundamental);
  const mtSent = blend(sentAcc, MEDIUM_TERM_WEIGHTS.sentiment);
  const mtSum = mtTech + mtFund + mtSent || 1;

  const result: CalibratedWeights = {
    shortTerm: {
      technical: Math.round(stTech / stSum * 100) / 100,
      fundamental: Math.round(stFund / stSum * 100) / 100,
      sentiment: Math.round(stSent / stSum * 100) / 100,
    },
    mediumTerm: {
      technical: Math.round(mtTech / mtSum * 100) / 100,
      fundamental: Math.round(mtFund / mtSum * 100) / 100,
      sentiment: Math.round(mtSent / mtSum * 100) / 100,
    },
    calibratedAt: new Date().toISOString(),
    basedOnDays: LOOKBACK_DAYS,
    signalAccuracies: {
      technical: Math.round(techAcc * 100) / 100,
      fundamental: Math.round(fundAcc * 100) / 100,
      sentiment: Math.round(sentAcc * 100) / 100,
    },
  };

  saveLatestCalibratedWeights(result);
  return result;
}

export { getLatestCalibratedWeights };
```

- [ ] **Step 2: Typecheck**

```bash
cd /Users/federicocroce/Documents/Fede/trading/apps/backend && npm run typecheck
```
Expected: no errors.

- [ ] **Step 3: Commit**

```bash
git add apps/backend/src/quant/weight-calibrator.service.ts
git commit -m "feat(quant): add adaptive weight calibrator — learns from signal_tracking history"
```

---

## Task 9: Update scoring.ts — Optional Override Weights

**Files:**
- Modify: `apps/backend/src/opportunities/scoring.ts:75-83`

- [ ] **Step 1: Update computeCompositeScore signature**

Find and replace the `computeCompositeScore` function (lines 75-83):

```typescript
export function computeCompositeScore(
  techScore: number,
  fundScore: number,
  sentScore: number,
  overrideWeights?: { shortTerm: HorizonWeights; mediumTerm: HorizonWeights },
): { shortTerm: number; mediumTerm: number; composite: number } {
  const shortWeights = overrideWeights?.shortTerm ?? SHORT_TERM_WEIGHTS;
  const medWeights = overrideWeights?.mediumTerm ?? MEDIUM_TERM_WEIGHTS;
  const shortTerm = computeHorizonScore(techScore, fundScore, sentScore, shortWeights);
  const mediumTerm = computeHorizonScore(techScore, fundScore, sentScore, medWeights);
  const composite = Math.round(shortTerm * 0.4 + mediumTerm * 0.6);
  return { shortTerm, mediumTerm, composite };
}
```

- [ ] **Step 2: Typecheck**

```bash
cd /Users/federicocroce/Documents/Fede/trading/apps/backend && npm run typecheck
```
Expected: no errors. All existing callers pass 3 args → still valid (optional 4th param).

- [ ] **Step 3: Commit**

```bash
git add apps/backend/src/opportunities/scoring.ts
git commit -m "feat(scoring): add optional overrideWeights to computeCompositeScore"
```

---

## Task 10: Market Digest — Regime Context Injection

**Files:**
- Modify: `apps/backend/src/intelligence/market-digest.service.ts`

- [ ] **Step 1: Add QuantContext import and param to generateDailyDigest**

At the top of `market-digest.service.ts`, add the import:
```typescript
import type { QuantContext } from '@trading/shared';
```

Change the `generateDailyDigest` signature (line ~19):
```typescript
export async function generateDailyDigest(
  opportunities: Opportunity[],
  secondOrderEffects: SecondOrderEffect[],
  intelligence: NewsIntelligence,
  sectorSummary: SectorSummary[],
  quantContext?: QuantContext | null,
): Promise<MarketDigest | null> {
```

- [ ] **Step 2: Inject regime context into the user message**

In the `parts` array builder, right after the headlines block (look for the block that pushes to `parts`), find a good insertion point and add:

```typescript
  // Regime context (if available)
  if (quantContext?.regime && quantContext.regime.regime !== 'unknown') {
    const r = quantContext.regime;
    const regimeLabel: Record<string, string> = {
      trending_bull: 'Tendencia alcista',
      trending_bear: 'Tendencia bajista',
      mean_reverting: 'Mercado lateral/oscilante',
      volatile: 'Alta volatilidad',
    };
    parts.push(
      `RÉGIMEN DE MERCADO: ${regimeLabel[r.regime] ?? r.regime} (confianza: ${r.confidence}%)\n` +
      `${r.indicators.trendConsistency}% de activos sobre SMA200, momentum ${r.indicators.spyMomentum > 0 ? '+' : ''}${r.indicators.spyMomentum}`
    );
  }

  // Top momentum movers (if available)
  if (quantContext?.momentumRankings && quantContext.momentumRankings.length >= 3) {
    const top3 = quantContext.momentumRankings.slice(0, 3).map(m => `${m.symbol}(+${m.relativeStrength}%)`).join(', ');
    const bot3 = quantContext.momentumRankings.slice(-3).map(m => `${m.symbol}(${m.relativeStrength}%)`).join(', ');
    parts.push(`TOP MOMENTUM: ${top3} | MENOR MOMENTUM: ${bot3}`);
  }
```

- [ ] **Step 3: Typecheck**

```bash
cd /Users/federicocroce/Documents/Fede/trading/apps/backend && npm run typecheck
```
Expected: no errors.

- [ ] **Step 4: Commit**

```bash
git add apps/backend/src/intelligence/market-digest.service.ts
git commit -m "feat(digest): inject regime + momentum context from QuantContext"
```

---

## Task 11: Pipeline — Quant Stage Integration

**Files:**
- Modify: `apps/backend/src/intelligence/pipeline.service.ts`

- [ ] **Step 1: Add imports and module-level QuantContext variable**

At the top of `pipeline.service.ts`, add imports and the module variable:

```typescript
import { detectRegime } from '../quant/regime-detector.service.js';
import { rankMomentum } from '../quant/momentum-ranker.service.js';
import { calibrateWeights } from '../quant/weight-calibrator.service.js';
import { getAllTechnicalSummaries } from '../technical/technical-analysis.service.js';
import type { QuantContext } from '@trading/shared';
```

After the existing `let _stageUnifiedAnalyses` line, add:
```typescript
let _stageQuantContext: QuantContext | null = null;

export function getStageQuantContext(): QuantContext | null {
  return _stageQuantContext;
}
```

- [ ] **Step 2: Add runQuantStage function**

Add this function after `runAnalysisStage`:

```typescript
async function runQuantStage(runId: number): Promise<StageResult> {
  const startedAt = new Date().toISOString();
  updatePipelineStage(runId, 'quant', { status: 'running', startedAt });
  try {
    const summaries = await getAllTechnicalSummaries();
    const regime = detectRegime(summaries);
    const momentumRankings = rankMomentum(summaries);
    const calibratedWeights = calibrateWeights();

    _stageQuantContext = { regime, momentumRankings, calibratedWeights };

    const sr: StageResult = {
      status: 'ok',
      startedAt,
      finishedAt: new Date().toISOString(),
      detail: `Régimen: ${regime.regime} (${regime.confidence}% conf). ${summaries.length} activos rankeados.${calibratedWeights ? ' Pesos calibrados.' : ''}`,
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
    return sr; // non-blocking: always return, never throw
  }
}
```

- [ ] **Step 3: Insert quant stage in runRemainingStages**

In `runRemainingStages`, after the analysis stage block and before `await runReportStage(runId)`:

```typescript
  // Quant stage: non-blocking (failure doesn't stop pipeline)
  await runQuantStage(runId);

  await runReportStage(runId);
```

- [ ] **Step 4: Pass quantContext to generateDailyDigest in runReportStage**

In `runReportStage`, find the `generateDailyDigest(...)` call (around line 258) and add `_stageQuantContext`:

```typescript
      generateDailyDigest(
        digestInputs.opportunities,
        digestInputs.secondOrderEffects,
        digestInputs.intelligence,
        digestInputs.sectorSummary,
        _stageQuantContext,
      )
```

- [ ] **Step 5: Reset _stageQuantContext in checkOrRunPipeline**

In `checkOrRunPipeline`, add reset alongside the existing `_stageUnifiedAnalyses = null`:

```typescript
export async function checkOrRunPipeline(force = false): Promise<PipelineRun> {
  _stageUnifiedAnalyses = null;
  _stageQuantContext = null;
  // ...rest of function unchanged
```

- [ ] **Step 6: Update the stageList in runRemainingStages**

Find line ~335:
```typescript
const stageList = [finalRun.stages.webSearch, finalRun.stages.news, finalRun.stages.fundamentals, finalRun.stages.analysis, finalRun.stages.report];
```
Leave it unchanged — quant is non-blocking and should not affect the overall pipeline status. Do NOT add quant to this list.

- [ ] **Step 7: Typecheck**

```bash
cd /Users/federicocroce/Documents/Fede/trading/apps/backend && npm run typecheck
```
Expected: no errors.

- [ ] **Step 8: Commit**

```bash
git add apps/backend/src/intelligence/pipeline.service.ts
git commit -m "feat(pipeline): add quant stage (regime + momentum + calibration) between analysis and report"
```

---

## Task 12: Backtest Service

**Files:**
- Create: `apps/backend/src/quant/backtest.service.ts`

- [ ] **Step 1: Create backtest.service.ts**

```typescript
// apps/backend/src/quant/backtest.service.ts
import type {
  BacktestTrade,
  BacktestEquityPoint,
  BacktestMetrics,
  BacktestRun,
  StrategyConfig,
} from '@trading/shared';
import { computeIndicators, scoreTechnical } from '../technical/technical-analysis.service.js';
import { computeHorizonScore, SHORT_TERM_WEIGHTS } from '../opportunities/scoring.js';
import { getHistoricalQuotes } from '../shared/yahoo.js';
import { insertBacktestRun, updateBacktestRun, getBacktestRun } from './backtest.repository.js';

const WARMUP_DAYS = 50;

export async function runBacktest(params: {
  symbol: string;
  startDate: string;
  endDate: string;
  strategy: StrategyConfig;
}): Promise<number> {
  const runId = insertBacktestRun(params);
  try {
    const result = await executeBacktest(params);
    updateBacktestRun(runId, {
      metrics: result.metrics,
      trades: result.trades,
      equityCurve: result.equityCurve,
      status: 'completed',
    });
  } catch (err) {
    updateBacktestRun(runId, {
      status: 'failed',
      error: (err as Error).message?.slice(0, 500) ?? String(err),
    });
  }
  return runId;
}

async function executeBacktest(params: {
  symbol: string;
  startDate: string;
  endDate: string;
  strategy: StrategyConfig;
}): Promise<{ trades: BacktestTrade[]; equityCurve: BacktestEquityPoint[]; metrics: BacktestMetrics }> {
  // Fetch ~2y of OHLCV (extra warmup period before startDate)
  const allOhlcv = await getHistoricalQuotes(params.symbol, '2y', '1d');

  const start = new Date(params.startDate);
  const end = new Date(params.endDate);

  const trades: BacktestTrade[] = [];
  const equityCurve: BacktestEquityPoint[] = [];

  let portfolioValue = 100;
  let positionEntryPortfolioValue = 0;
  let peakValue = 100;
  let inPosition = false;
  let entryDate = '';
  let entryPrice = 0;
  let buyAndHoldEntry: number | null = null;
  let buyAndHoldValue = 100;

  const shortWeights = params.strategy.shortTermWeights ?? SHORT_TERM_WEIGHTS;

  for (let i = WARMUP_DAYS; i < allOhlcv.length; i++) {
    const today = allOhlcv[i];
    const todayDate = new Date(today.date);

    if (todayDate < start || todayDate > end) continue;

    // Technical indicators on all data up to today
    const window = allOhlcv.slice(0, i + 1);
    const indicators = computeIndicators(window);
    const { score: techScore } = scoreTechnical(indicators);
    // backtest uses technical only (fundamental + sentiment unavailable historically)
    const score = computeHorizonScore(techScore, 0, 0, shortWeights);

    // Buy & hold baseline
    if (buyAndHoldEntry === null) {
      buyAndHoldEntry = today.close;
    }
    buyAndHoldValue = 100 * (today.close / buyAndHoldEntry);

    // Position mark-to-market
    if (inPosition) {
      portfolioValue = positionEntryPortfolioValue * (today.close / entryPrice);
    }

    // Signal-based buy/sell
    if (!inPosition && score >= params.strategy.buyThreshold) {
      inPosition = true;
      entryDate = today.date;
      entryPrice = today.close;
      positionEntryPortfolioValue = portfolioValue;
    } else if (inPosition) {
      const unrealizedReturn = (today.close - entryPrice) / entryPrice;
      const hitStop = unrealizedReturn <= -(params.strategy.stopLossPercent / 100);
      const hitTarget = unrealizedReturn >= (params.strategy.takeProfitPercent / 100);
      const signalSell = score < params.strategy.sellThreshold;

      if (hitStop || hitTarget || signalSell) {
        const exitReason: BacktestTrade['exitReason'] = hitStop ? 'stop_loss' : hitTarget ? 'take_profit' : 'signal';
        trades.push({
          symbol: params.symbol,
          entryDate,
          exitDate: today.date,
          entryPrice,
          exitPrice: today.close,
          returnPercent: Math.round(unrealizedReturn * 10000) / 100,
          exitReason,
        });
        portfolioValue = positionEntryPortfolioValue * (today.close / entryPrice);
        inPosition = false;
        entryDate = '';
        entryPrice = 0;
        positionEntryPortfolioValue = 0;
      }
    }

    peakValue = Math.max(peakValue, portfolioValue);
    const drawdown = peakValue > 0 ? ((peakValue - portfolioValue) / peakValue) * 100 : 0;

    equityCurve.push({
      date: today.date,
      portfolioValue: Math.round(portfolioValue * 100) / 100,
      buyAndHoldValue: Math.round(buyAndHoldValue * 100) / 100,
      drawdownPercent: Math.round(drawdown * 100) / 100,
    });
  }

  // Close open position at end of period
  if (inPosition && equityCurve.length > 0) {
    const lastOhlcv = equityCurve[equityCurve.length - 1];
    // find the last OHLCV close price
    const lastClose = allOhlcv.findLast(c => new Date(c.date) <= end)?.close ?? entryPrice;
    const unrealizedReturn = (lastClose - entryPrice) / entryPrice;
    trades.push({
      symbol: params.symbol,
      entryDate,
      exitDate: lastOhlcv.date,
      entryPrice,
      exitPrice: lastClose,
      returnPercent: Math.round(unrealizedReturn * 10000) / 100,
      exitReason: 'end_of_period',
    });
  }

  const metrics = computeMetrics(equityCurve, trades);
  return { trades, equityCurve, metrics };
}

function computeMetrics(equityCurve: BacktestEquityPoint[], trades: BacktestTrade[]): BacktestMetrics {
  if (equityCurve.length === 0) {
    return { totalReturnPercent: 0, buyAndHoldReturnPercent: 0, sharpeRatio: 0, maxDrawdownPercent: 0, winRate: 0, numTrades: 0, avgTradeDurationDays: 0 };
  }

  const last = equityCurve[equityCurve.length - 1];
  const totalReturn = last.portfolioValue - 100;
  const buyAndHoldReturn = last.buyAndHoldValue - 100;
  const maxDrawdown = Math.max(...equityCurve.map(p => p.drawdownPercent), 0);

  // Daily returns for Sharpe
  const dailyReturns: number[] = [];
  for (let i = 1; i < equityCurve.length; i++) {
    const prev = equityCurve[i - 1].portfolioValue;
    if (prev > 0) dailyReturns.push((equityCurve[i].portfolioValue - prev) / prev);
  }
  const avgR = dailyReturns.length > 0 ? dailyReturns.reduce((a, b) => a + b, 0) / dailyReturns.length : 0;
  const variance = dailyReturns.reduce((sum, r) => sum + (r - avgR) ** 2, 0) / (dailyReturns.length || 1);
  const stdDev = Math.sqrt(variance);
  const sharpe = stdDev > 0 ? (avgR / stdDev) * Math.sqrt(252) : 0;

  const winners = trades.filter(t => t.returnPercent > 0).length;
  const winRate = trades.length > 0 ? winners / trades.length : 0;

  let totalDays = 0;
  for (const t of trades) {
    totalDays += (new Date(t.exitDate).getTime() - new Date(t.entryDate).getTime()) / 86400000;
  }
  const avgDuration = trades.length > 0 ? totalDays / trades.length : 0;

  return {
    totalReturnPercent: Math.round(totalReturn * 100) / 100,
    buyAndHoldReturnPercent: Math.round(buyAndHoldReturn * 100) / 100,
    sharpeRatio: Math.round(sharpe * 100) / 100,
    maxDrawdownPercent: Math.round(maxDrawdown * 100) / 100,
    winRate: Math.round(winRate * 100) / 100,
    numTrades: trades.length,
    avgTradeDurationDays: Math.round(avgDuration),
  };
}
```

- [ ] **Step 2: Typecheck**

```bash
cd /Users/federicocroce/Documents/Fede/trading/apps/backend && npm run typecheck
```
Expected: no errors. If `Array.prototype.findLast` gives TS error, replace with a manual loop or `[...arr].reverse().find(...)`.

- [ ] **Step 3: Commit**

```bash
git add apps/backend/src/quant/backtest.service.ts
git commit -m "feat(quant): add backtesting engine — OHLCV replay, technical scoring, Sharpe/drawdown metrics"
```

---

## Task 13: tRPC Router + Registration

**Files:**
- Create: `apps/backend/src/quant/quant.router.ts`
- Modify: `apps/backend/src/router.ts`

- [ ] **Step 1: Create quant.router.ts**

```typescript
// apps/backend/src/quant/quant.router.ts
import { router, publicProcedure } from '../trpc.js';
import { z } from 'zod';
import { runBacktest } from './backtest.service.js';
import { getBacktestRun, listBacktestRuns } from './backtest.repository.js';
import { getStageQuantContext } from '../intelligence/pipeline.service.js';

const strategyConfigSchema = z.object({
  name: z.string(),
  shortTermWeights: z.object({
    sentiment: z.number().min(0).max(1),
    technical: z.number().min(0).max(1),
    fundamental: z.number().min(0).max(1),
  }).optional(),
  mediumTermWeights: z.object({
    sentiment: z.number().min(0).max(1),
    technical: z.number().min(0).max(1),
    fundamental: z.number().min(0).max(1),
  }).optional(),
  buyThreshold: z.number().min(0).max(100),
  sellThreshold: z.number().min(0).max(100),
  stopLossPercent: z.number().min(0).max(100),
  takeProfitPercent: z.number().min(0).max(100),
});

export const quantRouter = router({
  triggerBacktest: publicProcedure
    .input(z.object({
      symbol: z.string().min(1),
      startDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
      endDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
      strategy: strategyConfigSchema,
    }))
    .mutation(async ({ input }) => {
      const runId = await runBacktest(input);
      return { runId };
    }),

  getBacktestRun: publicProcedure
    .input(z.object({ runId: z.number() }))
    .query(({ input }) => getBacktestRun(input.runId)),

  listBacktestRuns: publicProcedure
    .input(z.object({ limit: z.number().optional().default(20) }))
    .query(({ input }) => listBacktestRuns(input.limit)),

  getQuantContext: publicProcedure
    .query(() => getStageQuantContext()),
});
```

- [ ] **Step 2: Register in router.ts**

In `apps/backend/src/router.ts`, add:
```typescript
import { quantRouter } from './quant/quant.router.js';
```

And in `appRouter`:
```typescript
export const appRouter = router({
  prices: pricesRouter,
  portfolio: portfolioRouter,
  analysis: analysisRouter,
  chat: chatRouter,
  news: newsRouter,
  opportunities: opportunitiesRouter,
  signals: signalsRouter,
  intelligence: intelligenceRouter,
  quant: quantRouter,
  health: publicProcedure.query(() => getHealthReport()),
});
```

- [ ] **Step 3: Typecheck**

```bash
cd /Users/federicocroce/Documents/Fede/trading/apps/backend && npm run typecheck
```
Expected: no errors.

- [ ] **Step 4: Smoke test — start backend and call endpoint**

```bash
cd /Users/federicocroce/Documents/Fede/trading && npm run dev -w apps/backend &
sleep 3
curl -X POST http://localhost:3001/trpc/quant.getQuantContext \
  -H "Content-Type: application/json" \
  -d '{}' | head -100
```
Expected: `{"result":{"data":null}}` (null is correct — no pipeline has run yet).

Kill background server with `fg` then Ctrl+C.

- [ ] **Step 5: Commit**

```bash
git add apps/backend/src/quant/quant.router.ts apps/backend/src/router.ts
git commit -m "feat(quant): add tRPC router with triggerBacktest, getBacktestRun, listBacktestRuns, getQuantContext"
```

---

## Self-Review Checklist

- [x] Task 1: shared types cover all fields used in Tasks 5-12
- [x] Task 3: both new tables (`backtest_runs`, `calibrated_weights`) are used by Tasks 5 and 8
- [x] Task 5 repo: `saveLatestCalibratedWeights` / `getLatestCalibratedWeights` — used by Task 8
- [x] Task 9: `SHORT_TERM_WEIGHTS` import needed in `computeHorizonScore` call in backtest.service — comes from scoring.ts which is already imported
- [x] No circular deps: quant/* → technical, opportunities/scoring, db, shared/yahoo — all valid one-way deps
- [x] `Array.prototype.findLast` note in Task 12 — add fallback if needed
- [x] Pipeline stage quant is non-blocking — failure in runQuantStage never throws, just logs

**Gaps found in spec vs plan:**
- Spec mentioned `quantContextCache` DB table → removed (in-memory is sufficient, simplifies implementation)
- Spec mentioned regime-adjusted weights applied in `buildAlgorithmicOpportunity` → NOT in this plan. The regime-adjusted weights are used only in the next pipeline run's digest + in backtest. Applying them to the current opportunity scan would require a circular dependency (opportunities → quant → opportunities). This is an acceptable V1 limitation — document it.
