/**
 * Backfill one-shot: re-resuelve TODO signal_tracking con la lógica correcta
 * (resolveTrackedSignal). Necesario porque la lógica anterior evaluaba WATCH/HOLD
 * como shorts → ~2.300 wins falsos que además contaminaron el calibrador de pesos.
 *
 * Uso: npm run db:reresolve-signals --workspace=apps/backend
 */
import 'dotenv/config';
import { eq } from 'drizzle-orm';
import { db } from '../db/index.js';
import * as schema from '../db/schema.js';
import { getHistoricalQuotes } from '../shared/yahoo.js';
import {
  resolveTrackedSignal,
  type TrackedSignalInput,
  type PriceCandle,
} from '../intelligence/outcome-resolver.js';

/** Fecha YYYY-MM-DD `days` días después de `ymd` (UTC). Copiado de signal-tracking.service.ts. */
function isoDaysAfter(ymd: string, days: number): string {
  const d = new Date(`${ymd}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().split('T')[0];
}

async function main() {
  const all = db.select().from(schema.signalTracking).all();
  console.log(`[Backfill] ${all.length} señales en signal_tracking`);

  const candleCache = new Map<string, PriceCandle[] | null>();
  const asOfDate = new Date().toISOString().split('T')[0];
  const counts: Record<string, number> = {};
  let processed = 0;

  for (const signal of all) {
    let candles = candleCache.get(signal.symbol);
    if (candles === undefined) {
      try {
        const ohlc = await getHistoricalQuotes(signal.symbol, '1y', '1d');
        candles = ohlc
          .map((c) => ({ date: c.date, high: c.high, low: c.low, close: c.close }))
          // No asumir el orden en que Yahoo devuelve las velas.
          .sort((a, b) => a.date.localeCompare(b.date));
      } catch {
        candles = null; // símbolo deslistado o sin datos
      }
      candleCache.set(signal.symbol, candles);
    }

    let outcome: string;
    let update: Record<string, unknown> = {};
    if (!candles) {
      outcome = 'invalid';
    } else {
      const input: TrackedSignalInput = {
        action: signal.action as TrackedSignalInput['action'],
        entryPrice: signal.entryPrice,
        targetPrice: signal.targetPrice,
        stopLoss: signal.stopLoss,
        signalDate: signal.signalDate,
      };
      const res = resolveTrackedSignal(input, candles, asOfDate);
      outcome = res.outcome;
      const isShort = signal.action === 'SELL';
      const rawReturn = res.resolutionReturn == null ? null : (isShort ? -res.resolutionReturn : res.resolutionReturn);

      // Checkpoint real a 7 días desde las velas (mismo criterio que resolveExpiredSignals).
      let priceAfter7d: number | null = null;
      let returnAfter7d: number | null = null;
      if (outcome !== 'invalid') {
        const day7 = isoDaysAfter(signal.signalDate, 7);
        const candle7 = candles.find((c) => c.date >= day7) ?? null;
        priceAfter7d = candle7?.close ?? null;
        returnAfter7d = candle7 ? ((candle7.close - signal.entryPrice) / signal.entryPrice) * 100 : null;
      }

      update = {
        hitTarget: res.hitTarget,
        hitStop: res.hitStop,
        returnAfter30d: rawReturn,
        priceAfter30d: res.resolutionPrice,
        priceAfter7d,
        returnAfter7d,
        resolvedAt: outcome === 'pending' ? null : new Date().toISOString(),
      };
    }

    // Serie corrupta (deslistado o split sin ajustar) → nunca persistir checkpoints de 7d.
    if (outcome === 'invalid') {
      update.priceAfter7d = null;
      update.returnAfter7d = null;
    }

    db.update(schema.signalTracking)
      .set({ outcome, ...update })
      .where(eq(schema.signalTracking.id, signal.id))
      .run();
    counts[outcome] = (counts[outcome] ?? 0) + 1;

    processed++;
    if (processed % 25 === 0) {
      console.log(`[Backfill] progreso: ${processed}/${all.length}`);
    }
  }

  console.log('[Backfill] Resultado:', counts);

  // Las propuestas de pesos pendientes se calcularon con outcomes corruptos: descartarlas.
  const stale = db.delete(schema.scoringWeightProposals)
    .where(eq(schema.scoringWeightProposals.status, 'pending'))
    .run();
  console.log(`[Backfill] Propuestas de pesos pendientes descartadas: ${stale.changes}`);
}

main().then(() => process.exit(0)).catch((err) => { console.error(err); process.exit(1); });
