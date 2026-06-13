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
import { detectSignals, SIGNAL_KEYS, twoProportionZ, isStableEdge, type SignalKey } from './signal-edge.js';

const DEFAULTS = { years: 5, horizonDays: 14, atrStopMult: 1.5, atrTargetMult: 2.5, warmup: 220 };
const PERIODS = 3; // walk-forward: ¿el edge se sostiene en 3 ventanas temporales?
const Z_SIGNIFICANT = 1.96; // 95%

interface DatedSample extends BarSample { date: string }

export interface SignalEdgeResult extends AlertEdgeSummary {
  signal: SignalKey;
  /** Barras donde la señal disparó (= alerts.n). */
  firedBars: number;
  /** |z| del test de dos proporciones (señal vs base). ≥1.96 = significativo. */
  zScore: number;
  significant: boolean;
  /** Edge de win-rate en cada ventana temporal (walk-forward). */
  edgeByPeriod: number[];
  /** El edge no cambia de signo entre ventanas. */
  stable: boolean;
  /** Resumen honesto: ¿confiable? (significativo + estable + muestra suficiente). */
  trustworthy: boolean;
}

export interface SignalEdgeStudy {
  params: { years: number; horizonDays: number; symbols: number; totalBars: number };
  signals: SignalEdgeResult[];
}

/** Edge de win-rate (alerts − baseline) sobre un subconjunto de samples. */
function edgeWinOf(samples: BarSample[]): number {
  return summarizeAlertEdge(samples).edgeWinRate;
}

/** Parte los samples (con fecha) en PERIODS ventanas cronológicas iguales y devuelve el edge de cada una. */
function edgePerPeriod(samples: DatedSample[]): number[] {
  if (samples.length === 0) return Array(PERIODS).fill(0);
  const dates = samples.map((s) => Date.parse(s.date));
  const min = Math.min(...dates);
  const span = Math.max(...dates) - min || 1;
  const buckets: DatedSample[][] = Array.from({ length: PERIODS }, () => []);
  for (const s of samples) {
    const idx = Math.min(PERIODS - 1, Math.floor(((Date.parse(s.date) - min) / span) * PERIODS));
    buckets[idx].push(s);
  }
  return buckets.map((b) => edgeWinOf(b));
}

export async function runSignalEdgeStudy(
  opts: Partial<typeof DEFAULTS> & { symbols?: string[] } = {},
): Promise<SignalEdgeStudy> {
  const { years, horizonDays, atrStopMult, atrTargetMult, warmup } = { ...DEFAULTS, ...opts };
  const universe = opts.symbols ?? resolveBacktestUniverse().map((u) => u.symbol);

  const perSignal: Record<SignalKey, DatedSample[]> = Object.fromEntries(
    SIGNAL_KEYS.map((k) => [k, [] as DatedSample[]]),
  ) as Record<SignalKey, DatedSample[]>;
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
        perSignal[key].push({ date: candles[i].date, fired: flags[key], outcome: res.outcome, returnPct: res.resolutionReturn ?? 0 });
      }
    }
  }

  const signals: SignalEdgeResult[] = SIGNAL_KEYS.map((key) => {
    const samples = perSignal[key];
    const summary = summarizeAlertEdge(samples);
    // Significancia: triggered vs (triggered+missed), señal vs base.
    const aConcl = summary.alerts.triggered + summary.alerts.missed;
    const bConcl = summary.baseline.triggered + summary.baseline.missed;
    const z = twoProportionZ(summary.alerts.triggered, aConcl, summary.baseline.triggered, bConcl);
    const zScore = Math.round(Math.abs(z) * 100) / 100;
    const significant = zScore >= Z_SIGNIFICANT;
    const edgeByPeriod = edgePerPeriod(samples);
    const stable = isStableEdge(edgeByPeriod);
    return {
      signal: key,
      firedBars: summary.alerts.n,
      ...summary,
      zScore,
      significant,
      edgeByPeriod,
      stable,
      // Confiable = el edge es positivo, significativo, estable y con muestra decente.
      trustworthy: summary.edgeWinRate > 0 && significant && stable && summary.alerts.n >= 100,
    };
  }).sort((a, b) => b.edgeWinRate - a.edgeWinRate);

  return { params: { years, horizonDays, symbols: universe.length, totalBars }, signals };
}
