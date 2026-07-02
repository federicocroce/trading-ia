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
  type TrackedSignalInput,
  type PriceCandle,
} from '../intelligence/outcome-resolver.js';

/**
 * Registra señales BUY/SELL de un scan para tracking posterior.
 * Solo graba señales actionables (BUY o SELL) con confidence > 0.
 */
export function recordSignals(opportunities: Opportunity[]): number {
  const today = new Date().toISOString().split('T')[0];
  let recorded = 0;

  for (const opp of opportunities) {
    const isActionable = opp.action === 'BUY' || opp.action === 'SELL';
    // También trackear WATCH con timing activo (now/soon) y 2+ triggers — señales de anticipación
    const tv = (opp as any).timingView as { timing?: string; triggers?: unknown[]; confidence?: number } | undefined;
    const isWatchWithTiming = opp.action === 'WATCH'
      && tv && (tv.timing === 'now' || tv.timing === 'soon')
      && Array.isArray(tv.triggers) && tv.triggers.length >= 2;

    if (!isActionable && !isWatchWithTiming) continue;
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
