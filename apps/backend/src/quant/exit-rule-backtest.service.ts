/**
 * Corre el head-to-head sobre el universo: misma entrada (precio > SMA50) y mismo trailing stop
 * para las dos reglas; A ('sell_on_warning') además sale ante divergencia bajista, B ('let_it_run')
 * la ignora. Mide cuál hizo más plata / menos drawdown — los números deciden, no la opinión.
 *
 * Conectado: reutiliza computeIndicators + detectDailyDivergences + computeTrailingStop del motor
 * real, point-in-time (sin lookahead), con costos.
 */
import type { OHLC } from '@trading/shared';
import { getHistoricalQuotes } from '../shared/yahoo.js';
import { computeIndicators, detectDailyDivergences } from '../technical/technical-analysis.service.js';
import { computeTrailingStop } from '../opportunities/today-decisions.js';
import { resolveBacktestUniverse } from './ma-trend.service.js';
import { shouldExit, strategyMetrics, buyHoldMetrics, type ExitRule, type StrategyMetrics, type BuyHoldMetrics } from './exit-rule-backtest.js';

const DEFAULTS = { years: 7, warmup: 220, commissionPct: 0.1, slippagePct: 0.05 };

interface BarSignal { close: number; date: string; sma50: number | null; trailingStop: number | null; hasBearishDiv: boolean }

function precomputeSignals(candles: OHLC[], warmup: number): BarSignal[] {
  const out: BarSignal[] = [];
  for (let i = 0; i < candles.length; i++) {
    if (i < warmup) { out.push({ close: candles[i].close, date: candles[i].date, sma50: null, trailingStop: null, hasBearishDiv: false }); continue; }
    const window = candles.slice(0, i + 1);
    const ind = computeIndicators(window);
    const divs = detectDailyDivergences(window, ind);
    out.push({
      close: candles[i].close,
      date: candles[i].date,
      sma50: ind.sma50,
      trailingStop: computeTrailingStop(window),
      hasBearishDiv: divs.some((d) => d.type === 'bearish'),
    });
  }
  return out;
}

function simulate(signals: BarSignal[], rule: ExitRule, commissionPct: number, slippagePct: number): { equity: number[]; trades: number[] } {
  const slip = slippagePct / 100;
  const comm = commissionPct / 100;
  let equity = 100;
  let inPos = false;
  let entryFill = 0;
  let posEntryEquity = 0;
  const eqCurve: number[] = [];
  const trades: number[] = [];

  for (const s of signals) {
    if (inPos) equity = posEntryEquity * (s.close / entryFill); // mark-to-market

    if (!inPos) {
      if (s.sma50 != null && s.close > s.sma50) { // entrada (igual para ambas)
        entryFill = s.close * (1 + slip);
        equity *= 1 - comm;
        posEntryEquity = equity;
        inPos = true;
      }
    } else if (shouldExit(rule, { price: s.close, trailingStop: s.trailingStop, hasBearishDiv: s.hasBearishDiv })) {
      const sellFill = s.close * (1 - slip);
      equity = posEntryEquity * (sellFill / entryFill) * (1 - comm);
      trades.push(Math.round((sellFill / entryFill - 1) * 10000) / 100);
      inPos = false;
    }
    eqCurve.push(Math.round(equity * 100) / 100);
  }
  return { equity: eqCurve, trades };
}

export interface ExitRuleSymbolResult {
  symbol: string;
  sellOnWarning: StrategyMetrics;
  letItRun: StrategyMetrics;
  /** Comprar y no hacer nada en la MISMA ventana operable. null = no se pudo calcular. */
  buyHold: BuyHoldMetrics | null;
  /** null cuando buyHold es null: "no se sabe" nunca se colapsa a false. */
  letItRunBeatsBuyHold: boolean | null;
}

export interface ExitRuleStudy {
  params: { years: number };
  perSymbol: ExitRuleSymbolResult[];
  aggregate: {
    evaluated: number;
    letItRunWinsReturn: number;   // en cuántos símbolos B (Hoy) terminó con más retorno que A
    avgReturnSellOnWarning: number;
    avgReturnLetItRun: number;
    avgMaxDdSellOnWarning: number;
    avgMaxDdLetItRun: number;
    avgProfitFactorSellOnWarning: number;
    avgProfitFactorLetItRun: number;
    /**
     * AD-014 (auditoría 2026-07-29): hasta hoy el estudio solo decía cuál de las dos reglas
     * activas ganaba. Faltaba la pregunta que decide: ¿alguna le gana a comprar y no hacer nada?
     * Los agregados de buy&hold se promedian SOLO sobre los símbolos donde se pudo calcular
     * (`evaluatedBuyHold`); imputar 0 en los que faltan inventaría un benchmark plano.
     */
    evaluatedBuyHold: number;
    letItRunBeatsBuyHold: number;
    sellOnWarningBeatsBuyHold: number;
    avgReturnBuyHold: number | null;
    avgMaxDdBuyHold: number | null;
  };
}

const avg = (xs: number[]) => (xs.length ? Math.round((xs.reduce((a, b) => a + b, 0) / xs.length) * 100) / 100 : 0);

export async function runExitRuleBacktest(
  opts: Partial<typeof DEFAULTS> & { symbols?: string[]; scope?: 'portfolio' | 'universe' } = {},
): Promise<ExitRuleStudy> {
  const { years, warmup, commissionPct, slippagePct } = { ...DEFAULTS, ...opts };
  // Default 'portfolio' (tus posiciones + benchmarks): rápido y es lo que te importa validar.
  const universe = opts.symbols ?? (
    opts.scope === 'universe'
      ? resolveBacktestUniverse().map((u) => u.symbol)
      : resolveBacktestUniverse().filter((u) => u.group === 'portfolio' || u.group === 'benchmark').map((u) => u.symbol)
  );

  const perSymbol: ExitRuleSymbolResult[] = [];
  for (const symbol of universe) {
    let candles;
    try { candles = await getHistoricalQuotes(symbol, `${years}y`, '1d'); } catch { continue; }
    if (candles.length < warmup + 60) continue;

    const signals = precomputeSignals(candles, warmup);
    const a = simulate(signals, 'sell_on_warning', commissionPct, slippagePct);
    const b = simulate(signals, 'let_it_run', commissionPct, slippagePct);
    // Buy&hold sobre la MISMA ventana operable: las velas de warmup no se pueden operar, así que
    // incluirlas le regalaría (o le sacaría) retorno al benchmark y la comparación no sería pareja.
    const buyHold = buyHoldMetrics(signals.slice(warmup).map((s) => s.close));
    const letItRun = strategyMetrics(b.equity, b.trades);
    const sellOnWarning = strategyMetrics(a.equity, a.trades);
    perSymbol.push({
      symbol,
      sellOnWarning,
      letItRun,
      buyHold,
      letItRunBeatsBuyHold: buyHold ? letItRun.totalReturn > buyHold.totalReturn : null,
    });
  }

  const ok = perSymbol;
  const conBuyHold = ok.filter((r) => r.buyHold != null);
  return {
    params: { years },
    perSymbol,
    aggregate: {
      evaluated: ok.length,
      letItRunWinsReturn: ok.filter((r) => r.letItRun.totalReturn > r.sellOnWarning.totalReturn).length,
      avgReturnSellOnWarning: avg(ok.map((r) => r.sellOnWarning.totalReturn)),
      avgReturnLetItRun: avg(ok.map((r) => r.letItRun.totalReturn)),
      avgMaxDdSellOnWarning: avg(ok.map((r) => r.sellOnWarning.maxDrawdown)),
      avgMaxDdLetItRun: avg(ok.map((r) => r.letItRun.maxDrawdown)),
      avgProfitFactorSellOnWarning: avg(ok.map((r) => r.sellOnWarning.profitFactor)),
      avgProfitFactorLetItRun: avg(ok.map((r) => r.letItRun.profitFactor)),
      evaluatedBuyHold: conBuyHold.length,
      letItRunBeatsBuyHold: conBuyHold.filter((r) => r.letItRun.totalReturn > r.buyHold!.totalReturn).length,
      sellOnWarningBeatsBuyHold: conBuyHold.filter((r) => r.sellOnWarning.totalReturn > r.buyHold!.totalReturn).length,
      avgReturnBuyHold: conBuyHold.length ? avg(conBuyHold.map((r) => r.buyHold!.totalReturn)) : null,
      avgMaxDdBuyHold: conBuyHold.length ? avg(conBuyHold.map((r) => r.buyHold!.maxDrawdown)) : null,
    },
  };
}
