/**
 * Orquestador I/O del backtest de alertas anticipatorias. Replica, barra por barra y
 * point-in-time, la MISMA detección que corre en vivo (computeIndicators + analyzeTimingSignals
 * + detectDailyDivergences + el gate de confluencia), y mide el resultado forward con la misma
 * definición que el outcome-resolver (target/stop a horizonte fijo).
 *
 * Honestidad: usa bandas ATR uniformes (1.5/2.5) para alertas Y baseline, aislando el valor
 * predictivo de la confluencia. Omite el veto de SELL del composite (usa fundamentals/sentiment,
 * no reconstruibles) → mide la alerta TÉCNICA pura, que es lo backtesteable.
 */
import type { OHLC, TimingView } from '@trading/shared';
import { getHistoricalQuotes } from '../shared/yahoo.js';
import { computeIndicators, detectDailyDivergences } from '../technical/technical-analysis.service.js';
import { analyzeTimingSignals } from '../technical/timing-analysis.service.js';
import { extractBullishSignals, hasBearishConflict } from '../opportunities/anticipatory-alerts.js';
import { resolveAlertOutcome } from '../intelligence/outcome-resolver.js';
import { summarizeAlertEdge, type BarSample, type AlertEdgeSummary, type GroupStats } from './alert-backtest.js';
import { resolveBacktestUniverse } from './ma-trend.service.js';
import type { MaTrendGroup } from '@trading/shared';

const DEFAULTS = {
  years: 5,
  horizonDays: 14,
  atrStopMult: 1.5,
  atrTargetMult: 2.5,
  warmup: 220, // SMA200 + margen para que la detección sea estable
};

export interface AlertBacktestSymbolResult extends AlertEdgeSummary {
  symbol: string;
  group: MaTrendGroup;
  bars: number;       // barras evaluadas (baseline)
  alertBars: number;  // barras donde disparó la alerta
  error?: string;
}

export interface AlertBacktestUniverseResult {
  params: { years: number; horizonDays: number; atrStopMult: number; atrTargetMult: number };
  perSymbol: AlertBacktestSymbolResult[];
  overall: AlertEdgeSummary;
}

export async function runAlertBacktestForSymbol(
  symbol: string,
  group: MaTrendGroup,
  opts: Partial<typeof DEFAULTS> = {},
): Promise<AlertBacktestSymbolResult> {
  const { years, horizonDays, atrStopMult, atrTargetMult, warmup } = { ...DEFAULTS, ...opts };
  const empty = summarizeAlertEdge([]);
  try {
    const candles = await getHistoricalQuotes(symbol, `${years}y`, '1d');
    if (candles.length < warmup + horizonDays + 5) {
      return { symbol, group, ...empty, bars: 0, alertBars: 0, error: `Historia insuficiente: ${candles.length} velas` };
    }

    const samples: BarSample[] = [];
    for (let i = warmup; i < candles.length - horizonDays; i++) {
      const window = candles.slice(0, i + 1);
      const indicators = computeIndicators(window);
      const atr = indicators.atr14;
      if (atr == null || atr <= 0) continue;

      const entry = candles[i].close;
      const timing = analyzeTimingSignals(window, indicators);
      const divergences = detectDailyDivergences(window, indicators);

      // Replay del gate de alerta: ≥2 categorías bullish, sin conflicto bajista.
      const opp = { symbol, currentPrice: entry, opportunityScore: 0, divergences, timingView: timing as TimingView };
      let fired = false;
      if (!hasBearishConflict(opp)) {
        const categories = new Set(extractBullishSignals(opp).map((s) => s.category));
        fired = categories.size >= 2;
      }

      // Forward con la MISMA definición de outcome que el resolver en vivo (bandas ATR uniformes).
      const fwd = candles.slice(i + 1, i + 1 + horizonDays);
      const res = resolveAlertOutcome(
        {
          entryPrice: entry,
          takeProfit: entry + atrTargetMult * atr,
          stopLoss: entry - atrStopMult * atr,
          firstSeenDate: candles[i].date,
        },
        fwd,
        fwd[fwd.length - 1].date,
        { horizonDays },
      );
      if (res.outcome === 'pending') continue;
      samples.push({ fired, outcome: res.outcome, returnPct: res.resolutionReturn ?? 0 });
    }

    const summary = summarizeAlertEdge(samples);
    return { symbol, group, ...summary, bars: summary.baseline.n, alertBars: summary.alerts.n };
  } catch (err) {
    return { symbol, group, ...empty, bars: 0, alertBars: 0, error: (err as Error).message?.slice(0, 120) ?? 'error' };
  }
}

async function mapLimited<T, R>(items: T[], limit: number, fn: (item: T) => Promise<R>): Promise<R[]> {
  const out: R[] = new Array(items.length);
  let next = 0;
  const worker = async () => {
    while (next < items.length) {
      const i = next++;
      out[i] = await fn(items[i]);
    }
  };
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker));
  return out;
}

/** Funde GroupStats de varios símbolos (suma conteos, pondera retornos por n). */
function mergeGroups(groups: GroupStats[]): GroupStats {
  const triggered = groups.reduce((a, g) => a + g.triggered, 0);
  const missed = groups.reduce((a, g) => a + g.missed, 0);
  const expired = groups.reduce((a, g) => a + g.expired, 0);
  const n = groups.reduce((a, g) => a + g.n, 0);
  const conclusive = triggered + missed;
  const weightedReturn = groups.reduce((a, g) => a + g.avgReturn * g.n, 0);
  return {
    n, triggered, missed, expired,
    winRate: conclusive > 0 ? Math.round((triggered / conclusive) * 100) : 0,
    avgReturn: n > 0 ? Math.round((weightedReturn / n) * 100) / 100 : 0,
  };
}

export async function runAlertBacktestUniverse(
  opts: Partial<typeof DEFAULTS> & { symbols?: Array<{ symbol: string; group: MaTrendGroup }> } = {},
): Promise<AlertBacktestUniverseResult> {
  const merged = { ...DEFAULTS, ...opts };
  const universe = opts.symbols ?? resolveBacktestUniverse();
  const perSymbol = await mapLimited(universe, 4, (u) => runAlertBacktestForSymbol(u.symbol, u.group, merged));

  const ok = perSymbol.filter((r) => r.error == null && r.bars > 0);
  const alerts = mergeGroups(ok.map((r) => r.alerts));
  const baseline = mergeGroups(ok.map((r) => r.baseline));
  const overall: AlertEdgeSummary = {
    alerts,
    baseline,
    edgeWinRate: alerts.winRate - baseline.winRate,
    edgeReturn: Math.round((alerts.avgReturn - baseline.avgReturn) * 100) / 100,
  };

  return {
    params: { years: merged.years, horizonDays: merged.horizonDays, atrStopMult: merged.atrStopMult, atrTargetMult: merged.atrTargetMult },
    perSymbol,
    overall,
  };
}
