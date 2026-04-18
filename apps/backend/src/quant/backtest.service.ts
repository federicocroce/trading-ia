// apps/backend/src/quant/backtest.service.ts
import type {
  BacktestTrade,
  BacktestEquityPoint,
  BacktestMetrics,
  StrategyConfig,
} from '@trading/shared';
import { computeIndicators, scoreTechnical } from '../technical/technical-analysis.service.js';
import { computeHorizonScore, SHORT_TERM_WEIGHTS } from '../opportunities/scoring.js';
import { getHistoricalQuotes } from '../shared/yahoo.js';
import { insertBacktestRun, updateBacktestRun, getRecentBacktestForSymbol } from './backtest.repository.js';
import { getActiveSymbolList } from '../db/repository.js';
import { getPlazaForSymbol } from '@trading/shared';

const WARMUP_DAYS = 50;

const DEFAULT_BULK_STRATEGY: StrategyConfig = {
  name: 'default',
  buyThreshold: 58,
  sellThreshold: 52,
  stopLossPercent: 8,
  takeProfitPercent: 15,
};

export interface BulkBacktestResult {
  total: number;
  completed: number;
  skipped: number;
  failed: number;
}

let _bulkRunning = false;
let _bulkStatus: BulkBacktestResult = { total: 0, completed: 0, skipped: 0, failed: 0 };

export function getBulkBacktestStatus(): BulkBacktestResult & { running: boolean } {
  return { ..._bulkStatus, running: _bulkRunning };
}

export async function runBulkBacktest(): Promise<BulkBacktestResult> {
  if (_bulkRunning) return _bulkStatus;
  _bulkRunning = true;

  const symbols = getActiveSymbolList();
  const twoYearsAgo = new Date();
  twoYearsAgo.setFullYear(twoYearsAgo.getFullYear() - 2);
  const startDate = twoYearsAgo.toISOString().split('T')[0];
  const endDate = new Date().toISOString().split('T')[0];

  _bulkStatus = { total: symbols.length, completed: 0, skipped: 0, failed: 0 };

  for (const symbol of symbols) {
    try {
      const recent = getRecentBacktestForSymbol(symbol, 30);
      if (recent) {
        _bulkStatus.skipped++;
        continue;
      }
      const assetClass = getPlazaForSymbol(symbol) ?? 'unknown';
      await runBacktest({ symbol, startDate, endDate, strategy: DEFAULT_BULK_STRATEGY, assetClass });
      _bulkStatus.completed++;
    } catch {
      _bulkStatus.failed++;
    }
    await new Promise(resolve => setTimeout(resolve, 500));
  }

  _bulkRunning = false;
  console.log(`[backtest] Bulk run complete: ${_bulkStatus.completed} completed, ${_bulkStatus.skipped} skipped, ${_bulkStatus.failed} failed`);
  return _bulkStatus;
}

export async function runBacktest(params: {
  symbol: string;
  startDate: string;
  endDate: string;
  strategy: StrategyConfig;
  assetClass?: string;
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

    const window = allOhlcv.slice(0, i + 1);
    const indicators = computeIndicators(window);
    const { score: techScore } = scoreTechnical(indicators);
    const score = computeHorizonScore(techScore, 0, 0, shortWeights);

    if (buyAndHoldEntry === null) {
      buyAndHoldEntry = today.close;
    }
    buyAndHoldValue = 100 * (today.close / buyAndHoldEntry);

    if (inPosition) {
      portfolioValue = positionEntryPortfolioValue * (today.close / entryPrice);
    }

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

  if (inPosition && equityCurve.length > 0) {
    const lastEquity = equityCurve[equityCurve.length - 1];
    let lastClose = entryPrice;
    for (let i = allOhlcv.length - 1; i >= 0; i--) {
      if (new Date(allOhlcv[i].date) <= end) {
        lastClose = allOhlcv[i].close;
        break;
      }
    }
    const unrealizedReturn = (lastClose - entryPrice) / entryPrice;
    trades.push({
      symbol: params.symbol,
      entryDate,
      exitDate: lastEquity.date,
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
  const maxDrawdown = equityCurve.reduce((max, p) => Math.max(max, p.drawdownPercent), 0);

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
