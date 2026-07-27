import type { Opportunity } from '@trading/shared';
import {
  insertSignalTracking,
  getPendingSignals,
  resolveSignal,
  getSignalTrackingHistory,
  getSignalAccuracyStats,
  insertMissedOpportunity,
} from '../db/repository.js';
import { getHistoricalQuotes } from '../shared/yahoo.js';
import {
  resolveTrackedSignal,
  computeRMultiple,
  computeBenchmarkReturn,
  computeAlpha,
  type TrackedSignalInput,
  type PriceCandle,
} from '../intelligence/outcome-resolver.js';
import { envString } from '../shared/env-number.js';

/**
 * Símbolo contra el que se mide el costo de oportunidad de cada señal.
 * Lazy (ver regla de envNumber): leerlo a nivel módulo lo dejaría inerte.
 */
function benchmarkSymbol(): string {
  return envString('BENCHMARK_SYMBOL', 'SPY');
}

/** Subconjunto de Opportunity que necesita el criterio de tracking (testeable sin fixture completo). */
export type TrackableOpportunity = Pick<Opportunity, 'action' | 'timingView' | 'tradeLevels'>;

/**
 * Decide si una oportunidad se registra para medir accuracy después.
 * - BUY/SELL: siempre (señales actionables).
 * - WATCH con timing activo (now/soon) y 2+ triggers: señales de anticipación.
 * - WATCH con setup inválido (BUY degradado por el clamp de riesgo del P1): se trackea para
 *   poder medir si el filtro salvó plata o costó upside — antes de esto quedaban fuera y el
 *   filtro no era medible.
 */
export function shouldTrackSignal(opp: TrackableOpportunity): boolean {
  if (opp.action === 'BUY' || opp.action === 'SELL') return true;
  if (opp.action !== 'WATCH') return false;

  const tv = opp.timingView;
  const isWatchWithTiming = Boolean(
    tv && (tv.timing === 'now' || tv.timing === 'soon') && tv.triggers.length >= 2,
  );
  const isDegradedSetup = opp.tradeLevels?.setupQuality === 'invalid';
  return isWatchWithTiming || isDegradedSetup;
}

/**
 * Registra señales de un scan para tracking posterior (ver `shouldTrackSignal` para el criterio).
 */
export function recordSignals(opportunities: Opportunity[]): number {
  const today = new Date().toISOString().split('T')[0];
  let recorded = 0;

  for (const opp of opportunities) {
    if (!shouldTrackSignal(opp)) continue;
    if (opp.currentPrice <= 0) continue;

    try {
      insertSignalTracking({
        symbol: opp.symbol,
        signalDate: today,
        action: opp.action,
        entryPrice: opp.currentPrice,
        targetPrice: opp.tradeLevels?.takeProfit ?? null,
        stopLoss: opp.tradeLevels?.stopLoss ?? null,
        confidence: opp.confidence,
        opportunityScore: opp.opportunityScore,
        // Dimension scores for accuracy analysis
        sector: opp.sector ?? null,
        techScore: opp.breakdown?.technical?.score ?? null,
        fundScore: opp.breakdown?.fundamental?.score ?? null,
        sentScore: opp.breakdown?.sentiment?.score != null ? opp.breakdown.sentiment.score / 100 : null,
        hadDivergences: opp.divergences && opp.divergences.length > 0 ? true : null,
        enrichedByLlm: opp.scoringMethod === 'hybrid' ? true : false,
        shortTermScore: opp.horizonScores?.shortTerm ?? null,
        mediumTermScore: opp.horizonScores?.mediumTerm ?? null,
        rsiAtSignal: null, // Would need to be passed from technical data
        predictedReturnMid: opp.shortTerm?.midPercent ?? null,
        setupInvalid: opp.tradeLevels?.setupQuality === 'invalid',
      });
      recorded++;
    } catch {
      // Skip duplicates or errors silently
    }
  }

  return recorded;
}

/** Fecha YYYY-MM-DD `days` días después de `ymd` (UTC). */
function isoDaysAfter(ymd: string, days: number): string {
  const d = new Date(`${ymd}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().split('T')[0];
}

/**
 * Resuelve señales pendientes caminando las velas diarias posteriores a la señal
 * (path-aware: un stop tocado en el camino es loss aunque después rebote).
 * Cachea el histórico por símbolo dentro de la corrida para no repetir fetches.
 */
export async function resolveExpiredSignals(): Promise<number> {
  const pending = getPendingSignals();
  const asOfDate = new Date().toISOString().split('T')[0];
  const candleCache = new Map<string, PriceCandle[] | null>();
  let resolved = 0;

  // Serie del benchmark, una sola vez por corrida. Si Yahoo la niega, el alpha
  // queda null en todas las filas de esta corrida (fail-closed) — jamás 0, que
  // se leería como "el índice no se movió" y regalaría alpha inexistente.
  const bench = benchmarkSymbol();
  let benchCandles: PriceCandle[] | null = null;
  try {
    const ohlc = await getHistoricalQuotes(bench, '2y', '1d');
    benchCandles = ohlc.map((c) => ({ date: c.date, high: c.high, low: c.low, close: c.close }));
  } catch {
    console.warn(`[signal-tracking] sin serie de ${bench}: alpha queda null en esta corrida`);
  }

  for (const signal of pending) {
    try {
      let candles = candleCache.get(signal.symbol);
      if (candles === undefined) {
        try {
          const ohlc = await getHistoricalQuotes(signal.symbol, '1y', '1d');
          candles = ohlc.map((c) => ({ date: c.date, high: c.high, low: c.low, close: c.close }));
        } catch {
          candles = null; // símbolo sin datos: no reintentar en esta corrida
        }
        candleCache.set(signal.symbol, candles);
      }
      if (!candles) continue;

      const input: TrackedSignalInput = {
        action: signal.action as TrackedSignalInput['action'],
        entryPrice: signal.entryPrice,
        targetPrice: signal.targetPrice,
        stopLoss: signal.stopLoss,
        signalDate: signal.signalDate,
      };
      const res = resolveTrackedSignal(input, candles, asOfDate);
      if (res.outcome === 'pending') continue;

      const isShort = signal.action === 'SELL';
      // resolutionReturn viene "a favor de la señal"; en DB guardamos retorno crudo del precio.
      const rawReturn = res.resolutionReturn == null ? null : (isShort ? -res.resolutionReturn : res.resolutionReturn);

      // Checkpoint real a 7 días desde las velas (si la señal cerró antes del día 7, queda null).
      // Si el outcome es 'invalid' la serie está corrupta (p.ej. split roto): los 7d quedan
      // null — mismo criterio que el backfill (reresolve-signal-tracking.ts).
      let priceAfter7d: number | null = null;
      let returnAfter7d: number | null = null;
      if (res.outcome !== 'invalid') {
        const day7 = isoDaysAfter(signal.signalDate, 7);
        const candle7 = candles.find((c) => c.date >= day7) ?? null;
        priceAfter7d = candle7?.close ?? null;
        returnAfter7d = candle7 ? ((candle7.close - signal.entryPrice) / signal.entryPrice) * 100 : null;
      }

      // Benchmark en la MISMA ventana [signalDate, resolvedDate]. El alpha usa el
      // retorno DIRECCIONAL (res.resolutionReturn), no el crudo: el capital estuvo
      // desplegado en la señal en vez de en el índice.
      const benchmarkReturn =
        benchCandles != null && res.resolvedDate != null && res.outcome !== 'invalid'
          ? computeBenchmarkReturn(signal.signalDate, res.resolvedDate, benchCandles)
          : null;

      resolveSignal(signal.id, {
        priceAfter7d,
        priceAfter30d: res.resolutionPrice,
        returnAfter7d,
        returnAfter30d: rawReturn,
        hitTarget: res.hitTarget,
        hitStop: res.hitStop,
        outcome: res.outcome,
        rMultiple: res.resolutionPrice != null && res.outcome !== 'invalid'
          ? computeRMultiple(signal.action as any, signal.entryPrice, signal.stopLoss, res.resolutionPrice)
          : null,
        resolutionDate: res.outcome !== 'invalid' ? res.resolvedDate : null,
        benchmarkSymbol: benchmarkReturn != null ? bench : null,
        benchmarkReturn,
        alphaVsBenchmark: computeAlpha(res.resolutionReturn, benchmarkReturn),
      });
      if (res.outcome !== 'invalid') resolved++;
    } catch {
      // Sin histórico disponible: se reintenta en la próxima corrida del cron.
    }
  }

  return resolved;
}

export function getTrackingHistory(limit = 100) {
  return getSignalTrackingHistory(limit);
}

export function getAccuracyStats() {
  return getSignalAccuracyStats();
}

/**
 * Check non-BUY/SELL opportunities from a scan and track if they were missed opportunities.
 * Called after signals are resolved (7+ days later) to compare WATCH/HOLD symbols' actual performance.
 */
export function recordMissedOpportunities(opportunities: Opportunity[]): number {
  const today = new Date().toISOString().split('T')[0];
  let recorded = 0;

  for (const opp of opportunities) {
    // Only track WATCH and HOLD that had decent scores
    if (opp.action !== 'WATCH' && opp.action !== 'HOLD') continue;
    if (opp.opportunityScore < 45) continue; // ignore low-score ones

    try {
      insertMissedOpportunity({
        symbol: opp.symbol,
        scanDate: today,
        actionGiven: opp.action,
        opportunityScore: opp.opportunityScore,
        actualReturn7d: null, // filled later by resolution
        actualReturn30d: null,
        wouldHaveBeen: null,
      });
      recorded++;
    } catch {
      // Skip
    }
  }

  return recorded;
}
