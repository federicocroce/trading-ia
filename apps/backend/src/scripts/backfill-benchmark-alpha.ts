/**
 * Backfill one-shot: completa `resolution_date`, `benchmark_return` y
 * `alpha_vs_benchmark` en las señales ya resueltas de signal_tracking.
 *
 * Por qué: hasta ahora el sistema medía cada señal contra CERO (¿ganó o perdió?)
 * y nunca contra la alternativa real (comprar el índice y no hacer nada). Una
 * señal con +0.5% en una ventana donde el S&P hizo +2% destruyó valor, y el
 * sistema la contaba como win. Sin esta columna el motor es ciego a su propio
 * costo de oportunidad.
 *
 * De paso completa `resolution_date` (la vela REAL que resolvió la señal), que
 * hasta ahora no se persistía: `resolved_at` es wall-clock del cron y llega días
 * o semanas tarde, así que ningún backtest de recencia podía usarla.
 *
 * SEGURIDAD: solo escribe las columnas nuevas. Jamás toca outcome, r_multiple ni
 * los retornos existentes — si la re-resolución difiere de lo persistido, lo
 * REPORTA y saltea la fila, nunca la corrige por su cuenta.
 *
 * Idempotente: re-corridas sanean filas que fallaron por outages de Yahoo.
 *
 * Uso: npm run db:backfill-benchmark --workspace=apps/backend
 */
import 'dotenv/config';
import { eq } from 'drizzle-orm';
import { db } from '../db/index.js';
import * as schema from '../db/schema.js';
import { getHistoricalQuotes } from '../shared/yahoo.js';
import { envString } from '../shared/env-number.js';
import {
  resolveTrackedSignal,
  computeBenchmarkReturn,
  computeAlpha,
  type TrackedSignalInput,
  type PriceCandle,
} from '../intelligence/outcome-resolver.js';

/** Fetch de velas con 1 reintento (2s) — fallo transitorio ≠ deslistado. */
async function fetchCandles(symbol: string, range = '2y'): Promise<PriceCandle[] | null> {
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      const ohlc = await getHistoricalQuotes(symbol, range, '1d');
      return ohlc
        .map((c) => ({ date: c.date, high: c.high, low: c.low, close: c.close }))
        .sort((a, b) => a.date.localeCompare(b.date));
    } catch {
      if (attempt === 0) await new Promise((r) => setTimeout(r, 2000));
    }
  }
  return null;
}

async function main() {
  const bench = envString('BENCHMARK_SYMBOL', 'SPY');

  const benchCandles = await fetchCandles(bench);
  if (!benchCandles || benchCandles.length === 0) {
    console.error(`[Backfill] FATAL: sin serie de ${bench}. Sin benchmark no hay nada que medir.`);
    process.exit(1);
  }
  console.log(
    `[Backfill] Benchmark ${bench}: ${benchCandles.length} velas ` +
    `(${benchCandles[0].date} → ${benchCandles.at(-1)!.date})`,
  );

  // Solo señales YA resueltas: las pending las completa el cron con la lógica viva.
  const all = db.select().from(schema.signalTracking).all()
    .filter((s) => s.outcome === 'win' || s.outcome === 'loss' || s.outcome === 'neutral');
  console.log(`[Backfill] ${all.length} señales resueltas a procesar`);

  const candleCache = new Map<string, PriceCandle[] | null>();
  const asOfDate = new Date().toISOString().split('T')[0];

  let updated = 0, sinVelas = 0, sinBenchmark = 0, discrepancias = 0, procesadas = 0;
  const alphas: number[] = [];

  for (const signal of all) {
    procesadas++;
    if (procesadas % 250 === 0) {
      console.log(`[Backfill] ${procesadas}/${all.length} — ${updated} actualizadas`);
    }

    let candles = candleCache.get(signal.symbol);
    if (candles === undefined) {
      candles = await fetchCandles(signal.symbol);
      candleCache.set(signal.symbol, candles);
    }
    if (!candles) { sinVelas++; continue; }

    const input: TrackedSignalInput = {
      action: signal.action as TrackedSignalInput['action'],
      entryPrice: signal.entryPrice,
      targetPrice: signal.targetPrice,
      stopLoss: signal.stopLoss,
      signalDate: signal.signalDate,
    };
    const res = resolveTrackedSignal(input, candles, asOfDate);

    // Guarda de consistencia: si la re-resolución no coincide con lo persistido,
    // los datos cambiaron bajo los pies (split, revisión de Yahoo). Se reporta y
    // se saltea — corregir outcomes es trabajo de reresolve-signal-tracking, no de acá.
    if (res.outcome !== signal.outcome) { discrepancias++; continue; }
    if (res.resolvedDate == null) { discrepancias++; continue; }

    const benchmarkReturn = computeBenchmarkReturn(signal.signalDate, res.resolvedDate, benchCandles);
    if (benchmarkReturn == null) sinBenchmark++;

    const alpha = computeAlpha(res.resolutionReturn, benchmarkReturn);
    if (alpha != null) alphas.push(alpha);

    db.update(schema.signalTracking)
      .set({
        resolutionDate: res.resolvedDate,
        benchmarkSymbol: benchmarkReturn != null ? bench : null,
        benchmarkReturn,
        alphaVsBenchmark: alpha,
      })
      .where(eq(schema.signalTracking.id, signal.id))
      .run();
    updated++;
  }

  const media = alphas.length ? alphas.reduce((a, b) => a + b, 0) / alphas.length : 0;
  console.log('\n[Backfill] ---- RESUMEN ----');
  console.log(`  Procesadas:            ${procesadas}`);
  console.log(`  Actualizadas:          ${updated}`);
  console.log(`  Sin velas (deslistadas): ${sinVelas}`);
  console.log(`  Sin cobertura benchmark: ${sinBenchmark}`);
  console.log(`  Discrepancias (salteadas): ${discrepancias}`);
  console.log(`  Alpha medio:           ${media.toFixed(4)}% (n=${alphas.length})`);
  process.exit(0);
}

main().catch((err) => {
  console.error('[Backfill] Error fatal:', err);
  process.exit(1);
});
