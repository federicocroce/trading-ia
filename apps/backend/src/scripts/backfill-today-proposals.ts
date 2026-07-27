/**
 * Backfill único de today_proposals: reconstruye el top-6 que "Hoy" habría mostrado para
 * cada scan histórico, con la MISMA función de selección que usa la vista.
 *
 * - "Tenido" histórico = flag `inPortfolio` guardado en el JSON del scan (fiel al momento).
 * - Verbo histórico = verbFor(action) SIN degradación crónica: la regla no existía entonces
 *   y el registro es de lo que efectivamente se mostró.
 * - NO pisa filas existentes (`onConflictDoNothing`): desde Task 3 el path vivo
 *   (persistScanResult) es la fuente de verdad y registra el verbo POST-degradación crónica.
 *   Si el backfill sobreescribiera, reemplazaría un verbo degradado real por el crudo —
 *   revisionismo. El backfill solo rellena los huecos históricos que faltan.
 * - Último scan del día: como con onConflictDoNothing gana el PRIMER insert, se deduplican
 *   los scans a "último de cada día" (mayor id por fecha) ANTES del loop, preservando la
 *   semántica original ("si hay varios scans en el día, gana el último — igual que la vista").
 * - Idempotente: re-correrlo no toca nada ya registrado, solo inserta lo que falte.
 *
 * ⚠️ CERRADO EL 2026-07-27 — NO RE-CORRER SIN LEER ESTO.
 * Ese día se apagó el ranking (prompt maestro §4): `selectTodayProposals` dejó de cortar
 * en 6 y de ordenar por score, y `verbFor` pasó a devolver siempre OPERABLE. Re-correr el
 * backfill ahora insertaría, para cualquier scan histórico sin filas, un conjunto MUCHO más
 * grande y con otro vocabulario de verbo — mezclando dos regímenes de selección en la misma
 * tabla sin ninguna marca que los distinga, y arruinando toda medición forward que compare
 * "lo que Hoy mostró" a lo largo del tiempo. El backfill ya cumplió su función (629 filas
 * históricas). Si algún día hay que rellenar huecos nuevos, primero hay que decidir cómo se
 * marca el régimen — no simplemente sacar este guard.
 *
 * Uso: npm run db:backfill-hoy --workspace=apps/backend (requiere BACKFILL_HOY_FORCE=1)
 */
import 'dotenv/config';
import { asc } from 'drizzle-orm';
import { db } from '../db/index.js';
import * as schema from '../db/schema.js';
import { type TodayProposalInsert } from '../db/repository.js';
import { selectTodayProposals, verbFor } from '../opportunities/today-proposals.js';

interface RawOpp {
  symbol: string;
  action: string;
  opportunityScore: number;
  inPortfolio?: boolean;
  tradeLevels?: { entryPrice?: number; stopLoss?: number; takeProfit?: number } | null;
}

function main(): void {
  // Guard de integridad: ver cabecera. El régimen de selección cambió el 2026-07-27.
  if (process.env.BACKFILL_HOY_FORCE !== '1') {
    console.error(
      '[Backfill Hoy] ABORTADO. Este backfill se cerró el 2026-07-27, cuando se apagó el\n' +
      'ranking: selectTodayProposals ya no corta en 6 ni ordena por score, y verbFor devuelve\n' +
      'siempre OPERABLE. Re-correrlo mezclaría dos regímenes de selección en today_proposals\n' +
      'sin marca que los distinga y arruinaría la medición forward.\n' +
      'Si REALMENTE sabés lo que hacés: BACKFILL_HOY_FORCE=1 npm run db:backfill-hoy --workspace=apps/backend',
    );
    process.exit(1);
  }

  const scans = db
    .select({
      id: schema.opportunityScans.id,
      scannedAt: schema.opportunityScans.scannedAt,
      opportunities: schema.opportunityScans.opportunities,
    })
    .from(schema.opportunityScans)
    .orderBy(asc(schema.opportunityScans.id))
    .all();

  // Último scan de cada día (mayor id por fecha): el recorrido viene asc por id,
  // así que el último del día pisa a los anteriores en el Map.
  const lastScanByDate = new Map<string, (typeof scans)[number]>();
  for (const scan of scans) {
    lastScanByDate.set(scan.scannedAt.slice(0, 10), scan);
  }
  const dailyScans = [...lastScanByDate.values()].sort((a, b) => a.id - b.id);

  console.log(
    `[Backfill today_proposals] ${scans.length} scans, ${dailyScans.length} días a procesar (último scan de cada día)`,
  );

  // Días distintos ya vistos por símbolo — se recorre en orden cronológico, así la
  // enésima aparición queda bien sin consultar la DB por fila.
  const daysSeen = new Map<string, Set<string>>();
  let inserted = 0;
  let skippedExisting = 0;
  let skippedParse = 0;

  for (const scan of dailyScans) {
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
    for (const row of rows) {
      // No pisar lo ya registrado: el path vivo (verbo post-degradación) es la fuente de verdad.
      const res = db.insert(schema.todayProposals).values(row).onConflictDoNothing().run();
      if (res.changes > 0) inserted++;
      else skippedExisting++;
    }
  }

  console.log(
    `[Backfill today_proposals] ${inserted} filas insertadas, ${skippedExisting} ya existentes (no tocadas), ${skippedParse} scans con JSON inválido`,
  );
}

main();
