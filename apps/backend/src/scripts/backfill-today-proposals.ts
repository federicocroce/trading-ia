/**
 * Backfill único de today_proposals: reconstruye el top-6 que "Hoy" habría mostrado para
 * cada scan histórico, con la MISMA función de selección que usa la vista.
 *
 * - "Tenido" histórico = flag `inPortfolio` guardado en el JSON del scan (fiel al momento).
 * - Verbo histórico = verbFor(action) SIN degradación crónica: la regla no existía entonces
 *   y el registro es de lo que efectivamente se mostró.
 * - Idempotente: upsert por (scan_date, symbol); re-correrlo recalcula los mismos valores.
 *
 * Uso: npm run db:backfill-hoy --workspace=apps/backend
 */
import 'dotenv/config';
import { asc } from 'drizzle-orm';
import { db } from '../db/index.js';
import * as schema from '../db/schema.js';
import { upsertTodayProposals, type TodayProposalInsert } from '../db/repository.js';
import { selectTodayProposals, verbFor } from '../opportunities/today-proposals.js';

interface RawOpp {
  symbol: string;
  action: string;
  opportunityScore: number;
  inPortfolio?: boolean;
  tradeLevels?: { entryPrice?: number; stopLoss?: number; takeProfit?: number } | null;
}

function main(): void {
  const scans = db
    .select({
      id: schema.opportunityScans.id,
      scannedAt: schema.opportunityScans.scannedAt,
      opportunities: schema.opportunityScans.opportunities,
    })
    .from(schema.opportunityScans)
    .orderBy(asc(schema.opportunityScans.id))
    .all();

  console.log(`[Backfill today_proposals] ${scans.length} scans a procesar`);

  // Días distintos ya vistos por símbolo — se recorre en orden cronológico, así la
  // enésima aparición queda bien sin consultar la DB por fila.
  const daysSeen = new Map<string, Set<string>>();
  let inserted = 0;
  let skippedParse = 0;

  for (const scan of scans) {
    let opps: RawOpp[];
    try {
      opps = JSON.parse(scan.opportunities);
    } catch {
      skippedParse++;
      continue;
    }
    const scanDate = scan.scannedAt.slice(0, 10);
    const held = new Set(opps.filter((o) => o.inPortfolio).map((o) => o.symbol.toUpperCase()));
    const top = selectTodayProposals(opps, held);

    const rows: TodayProposalInsert[] = top.map((o) => {
      const days = daysSeen.get(o.symbol) ?? new Set<string>();
      days.add(scanDate);
      daysSeen.set(o.symbol, days);
      return {
        scanId: scan.id,
        scanDate,
        symbol: o.symbol,
        verb: verbFor(o.action),
        engineAction: o.action,
        score: Math.round(o.opportunityScore),
        entryPrice: o.tradeLevels?.entryPrice ?? null,
        stopLoss: o.tradeLevels?.stopLoss ?? null,
        targetPrice: o.tradeLevels?.takeProfit ?? null,
        nthAppearance: days.size,
      };
    });
    upsertTodayProposals(rows);
    inserted += rows.length;
  }

  console.log(`[Backfill today_proposals] ${inserted} filas upserted, ${skippedParse} scans con JSON inválido`);
}

main();
