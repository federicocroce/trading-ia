/**
 * Orquestador I/O del backtest de regla de medias: baja historia larga (Yahoo), corre el
 * motor puro por ticker, y agrega el resultado sobre el universo elegido
 * (portfolio + watchlist + benchmarks) — sin sesgo de selección.
 */
import type {
  MaTrendStrategy,
  MaTrendTickerResult,
  MaTrendUniverseSummary,
  MaTrendGroup,
  BacktestEquityPoint,
} from '@trading/shared';
import { getHistoricalQuotes } from '../shared/yahoo.js';
import { getPortfolioPositions, getAllSymbols } from '../db/repository.js';
import { simulateMaTrend, type BacktestResult } from './ma-trend-backtest.js';

const BENCHMARKS = ['SPY', 'QQQ', 'BTC-USD'];
const DEFAULT_YEARS = 10;
const FETCH_CONCURRENCY = 4;

/** Max drawdown (%) de una serie de valores (peak-to-trough). */
function maxDrawdown(values: number[]): number {
  let peak = -Infinity;
  let maxDd = 0;
  for (const v of values) {
    peak = Math.max(peak, v);
    if (peak > 0) maxDd = Math.max(maxDd, ((peak - v) / peak) * 100);
  }
  return Math.round(maxDd * 100) / 100;
}

function bhMaxDrawdown(curve: BacktestEquityPoint[]): number {
  return maxDrawdown(curve.map((p) => p.buyAndHoldValue));
}

/**
 * Universo fijo, definido de antemano: tenencias actuales + watchlist (símbolos activos
 * trackeados) + benchmarks. Prioridad de grupo: portfolio > watchlist > benchmark.
 */
export function resolveBacktestUniverse(): Array<{ symbol: string; group: MaTrendGroup }> {
  // Prioridad de etiqueta: portfolio > benchmark > watchlist (la última escritura gana).
  const out = new Map<string, MaTrendGroup>();
  for (const s of getAllSymbols()) out.set(s.symbol.toUpperCase(), 'watchlist');
  for (const s of BENCHMARKS) out.set(s.toUpperCase(), 'benchmark');
  for (const p of getPortfolioPositions()) out.set(p.symbol.toUpperCase(), 'portfolio');
  return [...out.entries()].map(([symbol, group]) => ({ symbol, group }));
}

function toTickerResult(symbol: string, group: MaTrendGroup, res: BacktestResult): MaTrendTickerResult {
  const m = res.metrics;
  return {
    symbol,
    group,
    strategyReturnPct: m.totalReturnPercent,
    buyHoldReturnPct: m.buyAndHoldReturnPercent,
    strategyMaxDrawdownPct: m.maxDrawdownPercent,
    buyHoldMaxDrawdownPct: bhMaxDrawdown(res.equityCurve),
    numTrades: m.numTrades,
    winRate: m.winRate,
    sharpe: m.sharpeRatio,
    beatBuyHold: m.totalReturnPercent > m.buyAndHoldReturnPercent,
  };
}

export async function runMaTrendForSymbol(
  symbol: string,
  group: MaTrendGroup,
  strategy: MaTrendStrategy,
  years: number,
): Promise<MaTrendTickerResult> {
  try {
    const candles = await getHistoricalQuotes(symbol, `${years}y`, '1d');
    const longestMa = Math.max(strategy.exitMa, ...strategy.entryMas);
    if (candles.length < longestMa + 30) {
      return blankResult(symbol, group, `Historia insuficiente: ${candles.length} velas para SMA${longestMa}`);
    }
    const res = simulateMaTrend(symbol, candles, strategy);
    return toTickerResult(symbol, group, res);
  } catch (err) {
    return blankResult(symbol, group, (err as Error).message?.slice(0, 120) ?? 'error');
  }
}

function blankResult(symbol: string, group: MaTrendGroup, error: string): MaTrendTickerResult {
  return {
    symbol, group,
    strategyReturnPct: null, buyHoldReturnPct: null,
    strategyMaxDrawdownPct: null, buyHoldMaxDrawdownPct: null,
    numTrades: null, winRate: null, sharpe: null, beatBuyHold: null, error,
  };
}

async function mapLimited<T, R>(items: T[], limit: number, fn: (item: T) => Promise<R>): Promise<R[]> {
  const out: R[] = new Array(items.length);
  let next = 0;
  async function worker() {
    while (next < items.length) {
      const i = next++;
      out[i] = await fn(items[i]);
    }
  }
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker));
  return out;
}

function avg(nums: number[]): number {
  return nums.length > 0 ? Math.round((nums.reduce((a, b) => a + b, 0) / nums.length) * 100) / 100 : 0;
}

/** Resultado completo (trades + curva de equity) de un solo símbolo, para vista de detalle. */
export async function runMaTrendDetail(
  symbol: string,
  strategy: MaTrendStrategy,
  years = DEFAULT_YEARS,
): Promise<BacktestResult & { symbol: string }> {
  const candles = await getHistoricalQuotes(symbol, `${years}y`, '1d');
  const res = simulateMaTrend(symbol, candles, strategy);
  return { symbol, ...res };
}

/** Corre la regla sobre todo el universo y arma el resumen honesto (estrategia vs buy&hold). */
export async function runMaTrendUniverse(
  strategy: MaTrendStrategy,
  opts: { years?: number; symbols?: Array<{ symbol: string; group: MaTrendGroup }> } = {},
): Promise<MaTrendUniverseSummary> {
  const years = opts.years ?? DEFAULT_YEARS;
  const universe = opts.symbols ?? resolveBacktestUniverse();

  const tickers = await mapLimited(universe, FETCH_CONCURRENCY, (u) =>
    runMaTrendForSymbol(u.symbol, u.group, strategy, years),
  );

  const ok = tickers.filter((t) => t.error == null && t.strategyReturnPct != null);
  const aggregate = {
    evaluated: ok.length,
    beatBuyHold: ok.filter((t) => t.beatBuyHold).length,
    beatBuyHoldPct: ok.length > 0 ? Math.round((ok.filter((t) => t.beatBuyHold).length / ok.length) * 100) : 0,
    avgStrategyReturn: avg(ok.map((t) => t.strategyReturnPct!)),
    avgBuyHoldReturn: avg(ok.map((t) => t.buyHoldReturnPct!)),
    avgStrategyMaxDrawdown: avg(ok.map((t) => t.strategyMaxDrawdownPct!)),
    avgBuyHoldMaxDrawdown: avg(ok.map((t) => t.buyHoldMaxDrawdownPct!)),
    avgNumTrades: avg(ok.map((t) => t.numTrades!)),
    avgWinRate: avg(ok.map((t) => t.winRate!)),
  };

  return { strategy, years, tickers, aggregate };
}
