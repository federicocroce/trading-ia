import type { Opportunity } from '@trading/shared';
import {
  insertSignalTracking,
  getPendingSignals,
  resolveSignal,
  getSignalTrackingHistory,
  getSignalAccuracyStats,
  insertMissedOpportunity,
} from '../db/repository.js';
import { getQuote } from '../shared/yahoo.js';

/**
 * Registra señales BUY/SELL de un scan para tracking posterior.
 * Solo graba señales actionables (BUY o SELL) con confidence > 0.
 */
export function recordSignals(opportunities: Opportunity[]): number {
  const today = new Date().toISOString().split('T')[0];
  let recorded = 0;

  for (const opp of opportunities) {
    if (opp.action !== 'BUY' && opp.action !== 'SELL') continue;
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
 * Resuelve señales pendientes comparando el precio actual vs el precio de entrada.
 * Se ejecuta periódicamente (ej: al arrancar el scan diario).
 */
export async function resolveExpiredSignals(): Promise<number> {
  const pending = getPendingSignals();
  const now = new Date();
  let resolved = 0;

  for (const signal of pending) {
    const signalDate = new Date(signal.signalDate);
    const daysSince = Math.floor((now.getTime() - signalDate.getTime()) / (1000 * 60 * 60 * 24));

    // Necesitamos al menos 7 días para evaluar
    if (daysSince < 7) continue;

    try {
      const quote = await getQuote(signal.symbol);
      if (!quote || quote.current <= 0) continue;

      const currentPrice = quote.current;
      const entryPrice = signal.entryPrice;
      const returnPct = ((currentPrice - entryPrice) / entryPrice) * 100;

      const isBuy = signal.action === 'BUY';
      const returnForAction = isBuy ? returnPct : -returnPct; // SELL gana si baja

      // Check target/stop hits
      let hitTarget = false;
      let hitStop = false;

      if (isBuy) {
        if (signal.targetPrice && currentPrice >= signal.targetPrice) hitTarget = true;
        if (signal.stopLoss && currentPrice <= signal.stopLoss) hitStop = true;
      } else {
        if (signal.targetPrice && currentPrice <= signal.targetPrice) hitTarget = true;
        if (signal.stopLoss && currentPrice >= signal.stopLoss) hitStop = true;
      }

      // Determine outcome
      let outcome: string;
      if (hitTarget) outcome = 'win';
      else if (hitStop) outcome = 'loss';
      else if (returnForAction > 2) outcome = 'win';
      else if (returnForAction < -2) outcome = 'loss';
      else outcome = 'neutral';

      // Si pasaron 30+ días, resolver definitivamente
      const is30d = daysSince >= 30;

      resolveSignal(signal.id, {
        priceAfter7d: daysSince >= 7 && daysSince < 30 ? currentPrice : signal.priceAfter7d,
        priceAfter30d: is30d ? currentPrice : null,
        returnAfter7d: daysSince >= 7 && daysSince < 30 ? returnPct : signal.returnAfter7d,
        returnAfter30d: is30d ? returnPct : null,
        hitTarget,
        hitStop,
        outcome: is30d || hitTarget || hitStop ? outcome : 'pending',
      });

      if (is30d || hitTarget || hitStop) resolved++;
    } catch {
      // Skip on error, retry next time
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
