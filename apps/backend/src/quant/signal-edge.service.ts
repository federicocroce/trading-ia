/**
 * Corre el estudio de aislamiento de señales sobre el universo: para cada señal mide si
 * disparar predice mejor que el base-rate, con el mismo riesgo (bandas ATR uniformes,
 * horizonte fijo) y la misma definición de outcome que el resolver en vivo.
 *
 * Conectado, no paralelo: usa computeIndicators (el mismo del motor) + detectSignals + el
 * forward outcome y el agregador de edge ya testeados. Es research, no un veredicto nuevo.
 */
import { getHistoricalQuotes } from '../shared/yahoo.js';
import { computeIndicators } from '../technical/technical-analysis.service.js';
import { resolveAlertOutcome } from '../intelligence/outcome-resolver.js';
import { summarizeAlertEdge, type BarSample, type AlertEdgeSummary } from './alert-backtest.js';
import { resolveBacktestUniverse } from './ma-trend.service.js';
import { detectSignals, SIGNAL_KEYS, type SignalKey } from './signal-edge.js';

const DEFAULTS = { years: 5, horizonDays: 14, atrStopMult: 1.5, atrTargetMult: 2.5, warmup: 220 };

export interface SignalEdgeResult extends AlertEdgeSummary {
  signal: SignalKey;
  /** Barras donde la señal disparó (= alerts.n). */
  firedBars: number;
}

export interface SignalEdgeStudy {
  params: { years: number; horizonDays: number; symbols: number; totalBars: number };
  signals: SignalEdgeResult[];
}

export async function runSignalEdgeStudy(
  opts: Partial<typeof DEFAULTS> & { symbols?: string[] } = {},
): Promise<SignalEdgeStudy> {
  const { years, horizonDays, atrStopMult, atrTargetMult, warmup } = { ...DEFAULTS, ...opts };
  const universe = opts.symbols ?? resolveBacktestUniverse().map((u) => u.symbol);

  const perSignal: Record<SignalKey, BarSample[]> = Object.fromEntries(
    SIGNAL_KEYS.map((k) => [k, [] as BarSample[]]),
  ) as Record<SignalKey, BarSample[]>;
  let totalBars = 0;

  for (const symbol of universe) {
    let candles;
    try {
      candles = await getHistoricalQuotes(symbol, `${years}y`, '1d');
    } catch {
      continue;
    }
    if (candles.length < warmup + horizonDays + 5) continue;

    for (let i = warmup; i < candles.length - horizonDays; i++) {
      const window = candles.slice(0, i + 1);
      const ind = computeIndicators(window);
      const atr = ind.atr14;
      if (atr == null || atr <= 0) continue;
      const close = candles[i].close;

      const flags = detectSignals({
        price: close,
        rsi14: ind.rsi14,
        sma50: ind.sma50,
        sma200: ind.sma200,
        macdHistogram: ind.macd?.histogram ?? null,
        goldenCross: ind.crossovers?.goldenCross ?? false,
      });

      const fwd = candles.slice(i + 1, i + 1 + horizonDays);
      const res = resolveAlertOutcome(
        { entryPrice: close, takeProfit: close + atrTargetMult * atr, stopLoss: close - atrStopMult * atr, firstSeenDate: candles[i].date },
        fwd,
        fwd[fwd.length - 1].date,
        { horizonDays },
      );
      if (res.outcome === 'pending') continue;

      totalBars++;
      for (const key of SIGNAL_KEYS) {
        perSignal[key].push({ fired: flags[key], outcome: res.outcome, returnPct: res.resolutionReturn ?? 0 });
      }
    }
  }

  const signals: SignalEdgeResult[] = SIGNAL_KEYS.map((key) => {
    const summary = summarizeAlertEdge(perSignal[key]);
    return { signal: key, firedBars: summary.alerts.n, ...summary };
  }).sort((a, b) => b.edgeWinRate - a.edgeWinRate);

  return { params: { years, horizonDays, symbols: universe.length, totalBars }, signals };
}
