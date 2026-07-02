/**
 * Backfill barato: calcula r_multiple para filas de signal_tracking ya resueltas
 * (outcome win/loss/neutral) que no lo tienen. SIN fetches externos — usa
 * exclusivamente columnas ya persistidas (action, entry_price, stop_loss,
 * price_after_30d como resolutionPrice). Filas sin price_after_30d se saltean
 * (no hay con qué medir el resultado).
 *
 * Idempotente: solo toca filas con r_multiple IS NULL, así que re-correrlo tras
 * agregar más señales resueltas no reprocesa lo ya calculado.
 *
 * Uso: npm run db:backfill-r --workspace=apps/backend
 */
import 'dotenv/config';
import { and, inArray, isNull, isNotNull, eq } from 'drizzle-orm';
import { db } from '../db/index.js';
import * as schema from '../db/schema.js';
import { computeRMultiple, type TrackedSignalInput } from '../intelligence/outcome-resolver.js';

function main() {
  const rows = db.select().from(schema.signalTracking)
    .where(and(
      inArray(schema.signalTracking.outcome, ['win', 'loss', 'neutral']),
      isNull(schema.signalTracking.rMultiple),
      isNotNull(schema.signalTracking.priceAfter30d),
    ))
    .all();

  console.log(`[Backfill r_multiple] ${rows.length} señales candidatas (win/loss/neutral, r_multiple NULL, price_after_30d disponible)`);

  let updated = 0;
  let skippedNoRisk = 0;

  for (const row of rows) {
    const action = row.action as TrackedSignalInput['action'];
    const r = computeRMultiple(action, row.entryPrice, row.stopLoss, row.priceAfter30d as number);
    if (r == null) {
      skippedNoRisk++; // sin stop válido: no se puede medir riesgo, se deja NULL
      continue;
    }

    db.update(schema.signalTracking)
      .set({ rMultiple: r })
      .where(eq(schema.signalTracking.id, row.id))
      .run();
    updated++;
  }

  console.log(`[Backfill r_multiple] Actualizadas: ${updated}. Sin stop válido (saltadas): ${skippedNoRisk}.`);
}

main();
