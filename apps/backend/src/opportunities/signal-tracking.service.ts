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

/**
 * Resuelve señales pendientes caminando las velas diarias posteriores a la señal
 * (path-aware: un stop tocado en el camino es loss aunque después rebote).
 * Cachea el histórico por símbolo dentro de la corrida para no repetir fetches.
 */
export async function resolveExpiredSignals(): Promise<number> {
  const pending = getPendingSignals();
  const asOfDate = new Date().toISOString().split('T')[0];
  const candleCache = new Map<string, PriceCandle[]>();
  let resolved = 0;

  for (const signal of pending) {
    try {
      let candles = candleCache.get(signal.symbol);
      if (!candles) {
        const ohlc = await getHistoricalQuotes(signal.symbol, '1y', '1d');
        candles = ohlc.map((c) => ({ date: c.date, high: c.high, low: c.low, close: c.close }));
        candleCache.set(signal.symbol, candles);
      }

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

      resolveSignal(signal.id, {
        priceAfter7d: signal.priceAfter7d ?? res.resolutionPrice,
        priceAfter30d: res.resolutionPrice,
        returnAfter7d: signal.returnAfter7d ?? rawReturn,
        returnAfter30d: rawReturn,
        hitTarget: res.hitTarget,
        hitStop: res.hitStop,
        outcome: res.outcome,
      });
      resolved++;
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
