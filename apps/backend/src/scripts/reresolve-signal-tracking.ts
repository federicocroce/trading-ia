/**
 * Backfill one-shot: re-resuelve TODO signal_tracking con la lógica correcta
 * (resolveTrackedSignal). Necesario porque la lógica anterior evaluaba WATCH/HOLD
 * como shorts → ~2.300 wins falsos que además contaminaron el calibrador de pesos.
 *
 * Idempotente: re-corridas sanean filas afectadas por outages transitorios de Yahoo.
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
  type SignalOutcome,
} from '../intelligence/outcome-resolver.js';

/** Fecha YYYY-MM-DD `days` días después de `ymd` (UTC). Copiado de signal-tracking.service.ts. */
function isoDaysAfter(ymd: string, days: number): string {
  const d = new Date(`${ymd}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().split('T')[0];
}

/** Fetch de velas con 1 reintento (2s de espera) — fallo transitorio ≠ deslistado. */
async function fetchCandles(symbol: string): Promise<PriceCandle[] | null> {
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      const ohlc = await getHistoricalQuotes(symbol, '1y', '1d');
      return ohlc
        .map((c) => ({ date: c.date, high: c.high, low: c.low, close: c.close }))
        // No asumir el orden en que Yahoo devuelve las velas.
        .sort((a, b) => a.date.localeCompare(b.date));
    } catch {
      if (attempt === 0) await new Promise((r) => setTimeout(r, 2000));
    }
  }
  return null; // símbolo deslistado o sin datos tras 2 intentos
}

async function main() {
  const all = db.select().from(schema.signalTracking).all();
  console.log(`[Backfill] ${all.length} señales en signal_tracking`);

  const candleCache = new Map<string, PriceCandle[] | null>();
  const asOfDate = new Date().toISOString().split('T')[0];
  const counts: Record<string, number> = {};
  let processed = 0;

  for (const signal of all) {
    try {
      let candles = candleCache.get(signal.symbol);
      if (candles === undefined) {
        candles = await fetchCandles(signal.symbol);
        candleCache.set(signal.symbol, candles);
      }

      let outcome: SignalOutcome;
      let update: Record<string, unknown>;
      if (!candles) {
        // Sin datos: limpiar TODOS los campos de resolución — nunca retener basura pre-backfill.
        outcome = 'invalid';
        update = {
          hitTarget: null,
          hitStop: null,
          returnAfter30d: null,
          priceAfter30d: null,
          priceAfter7d: null,
          returnAfter7d: null,
          resolvedAt: new Date().toISOString(),
        };
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
        // Si el outcome es 'invalid' la serie está corrupta: los 7d quedan null.
        let priceAfter7d: number | null = null;
        let returnAfter7d: number | null = null;
        if (outcome !== 'invalid') {
          const day7 = isoDaysAfter(signal.signalDate, 7);
          const candle7 = candles.find((c) => c.date >= day7) ?? null;
          priceAfter7d = candle7?.close ?? null;
          returnAfter7d = candle7 ? ((candle7.close - signal.entryPrice) / signal.entryPrice) * 100 : null;
        }

        // resolvedAt estable: solo re-timestampear si el outcome CAMBIÓ (weight-adjustment
        // usa resolvedAt >= since; una re-corrida no debe disparar propuestas artificiales).
        const changed = outcome !== signal.outcome;
        update = {
          hitTarget: res.hitTarget,
          hitStop: res.hitStop,
          returnAfter30d: rawReturn,
          priceAfter30d: res.resolutionPrice,
          priceAfter7d,
          returnAfter7d,
          resolvedAt: outcome === 'pending'
            ? null
            : (changed ? new Date().toISOString() : (signal.resolvedAt ?? new Date().toISOString())),
          // Al re-resolver cambia la FECHA de resolución, y con ella la ventana contra la que
          // se midió el benchmark. Un alpha calculado sobre la ventana vieja quedaría mintiendo
          // en silencio, así que se limpia: `db:backfill-benchmark` (idempotente) lo recalcula.
          // Fail-closed: preferimos el hueco visible al número plausible y equivocado.
          resolutionDate: null,
          benchmarkSymbol: null,
          benchmarkReturn: null,
          alphaVsBenchmark: null,
        };
      }

      db.update(schema.signalTracking)
        .set({ outcome, ...update })
        .where(eq(schema.signalTracking.id, signal.id))
        .run();
      counts[outcome] = (counts[outcome] ?? 0) + 1;
    } catch (err) {
      // Una fila rota no debe matar el proceso entero.
      counts['error'] = (counts['error'] ?? 0) + 1;
      console.error(`[Backfill] error en señal id=${signal.id} (${signal.symbol}):`, err);
    }

    processed++;
    if (processed % 25 === 0) {
      console.log(`[Backfill] progreso: ${processed}/${all.length}`);
    }
  }

  console.log('[Backfill] Resultado:', counts);
  console.log(
    '[Backfill] ⚠️ Las columnas de benchmark (resolution_date / benchmark_* / alpha_vs_benchmark)\n' +
    '           quedaron en NULL para las filas tocadas: la ventana de medición cambió.\n' +
    '           Corré ahora: npm run db:backfill-benchmark --workspace=apps/backend',
  );

  // Las propuestas de pesos pendientes se calcularon con outcomes corruptos: descartarlas.
  const stale = db.delete(schema.scoringWeightProposals)
    .where(eq(schema.scoringWeightProposals.status, 'pending'))
    .run();
  console.log(`[Backfill] Propuestas de pesos pendientes descartadas: ${stale.changes}`);
}

main().then(() => process.exit(0)).catch((err) => { console.error(err); process.exit(1); });
