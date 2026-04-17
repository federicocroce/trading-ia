import { db } from '../db/index.js';
import { backtestRuns, calibratedWeightsTable } from '../db/schema.js';
import { eq, desc } from 'drizzle-orm';
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
  const setValues: Record<string, unknown> = { status: updates.status };
  if (updates.metrics !== undefined) setValues.metrics = JSON.stringify(updates.metrics);
  if (updates.trades !== undefined) setValues.trades = JSON.stringify(updates.trades);
  if (updates.equityCurve !== undefined) setValues.equityCurve = JSON.stringify(updates.equityCurve);
  if (updates.error !== undefined) setValues.error = updates.error;

  db.update(backtestRuns).set(setValues as any).where(eq(backtestRuns.id, id)).run();
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
    metrics: row.metrics ? JSON.parse(row.metrics) as BacktestMetrics : null,
    trades: row.trades ? JSON.parse(row.trades) as BacktestTrade[] : null,
    equityCurve: row.equityCurve ? JSON.parse(row.equityCurve) as BacktestEquityPoint[] : null,
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
