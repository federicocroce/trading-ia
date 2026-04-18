import { db } from '../db/index.js';
import { backtestRuns, calibratedWeightsTable } from '../db/schema.js';
import { eq, desc, and } from 'drizzle-orm';
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
  assetClass?: string;
}): number {
  const result = db.insert(backtestRuns).values({
    symbol: params.symbol,
    startDate: params.startDate,
    endDate: params.endDate,
    strategy: JSON.stringify(params.strategy),
    status: 'running',
    assetClass: params.assetClass ?? null,
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

export function getLatestBacktestForSymbol(symbol: string): BacktestRun | null {
  const row = db.select().from(backtestRuns)
    .where(and(eq(backtestRuns.symbol, symbol), eq(backtestRuns.status, 'completed')))
    .orderBy(desc(backtestRuns.createdAt))
    .limit(1)
    .get();
  return row ? deserialize(row) : null;
}

export interface BacktestClassSummary {
  assetClass: string;
  symbolCount: number;
  winRate: number;
  sharpeRatio: number;
  maxDrawdownPercent: number;
  numTrades: number;
}

export function getBacktestSummaryByClass(): BacktestClassSummary[] {
  const rows = db.select().from(backtestRuns)
    .where(eq(backtestRuns.status, 'completed'))
    .all();

  const byClass = new Map<string, { winRates: number[]; sharpes: number[]; drawdowns: number[]; trades: number[] }>();

  for (const row of rows) {
    const cls = row.assetClass ?? 'unknown';
    if (!row.metrics) continue;
    const m = JSON.parse(row.metrics) as BacktestMetrics;
    if (!byClass.has(cls)) byClass.set(cls, { winRates: [], sharpes: [], drawdowns: [], trades: [] });
    const entry = byClass.get(cls)!;
    entry.winRates.push(m.winRate);
    entry.sharpes.push(m.sharpeRatio);
    entry.drawdowns.push(m.maxDrawdownPercent);
    entry.trades.push(m.numTrades);
  }

  return Array.from(byClass.entries()).map(([assetClass, data]) => {
    const avg = (arr: number[]) => arr.length > 0 ? arr.reduce((a, b) => a + b, 0) / arr.length : 0;
    return {
      assetClass,
      symbolCount: data.winRates.length,
      winRate: Math.round(avg(data.winRates) * 100) / 100,
      sharpeRatio: Math.round(avg(data.sharpes) * 100) / 100,
      maxDrawdownPercent: Math.round(avg(data.drawdowns) * 100) / 100,
      numTrades: Math.round(avg(data.trades)),
    };
  }).sort((a, b) => b.symbolCount - a.symbolCount);
}

export function getRecentBacktestForSymbol(symbol: string, withinDays: number): BacktestRun | null {
  const cutoff = new Date();
  cutoff.setDate(cutoff.getDate() - withinDays);
  const cutoffStr = cutoff.toISOString();
  const rows = db.select().from(backtestRuns)
    .where(and(eq(backtestRuns.symbol, symbol), eq(backtestRuns.status, 'completed')))
    .orderBy(desc(backtestRuns.createdAt))
    .limit(1)
    .all();
  const row = rows[0];
  if (!row || row.createdAt < cutoffStr) return null;
  return deserialize(row);
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
    assetClass: row.assetClass ?? null,
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
