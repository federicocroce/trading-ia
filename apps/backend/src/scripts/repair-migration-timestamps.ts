/**
 * Repara timestamps futuros en drizzle/meta/_journal.json + en __drizzle_migrations.
 *
 * BUG: drizzle-kit generate estampa `when: Date.now()`. En algún momento se generaron
 * migraciones (idx 36-39 al momento de escribir este script, ago-2026) con el reloj
 * de la máquina adelantado, quedando timestamps en el futuro. El migrator runtime de
 * drizzle-orm (better-sqlite3, ver node_modules/drizzle-orm/sqlite-core/dialect.js
 * SQLiteSyncDialect.migrate) hace UNA sola lectura de
 * `SELECT ... FROM __drizzle_migrations ORDER BY created_at DESC LIMIT 1` al arrancar
 * y compara CADA migración de la carpeta contra ese único máximo. Con el máximo ya en
 * el futuro, cualquier migración nueva generada con Date.now() real (hoy) queda por
 * debajo del máximo y se SALTEA sin error ni warning — el `db:migrate` "termina bien"
 * pero no aplicó nada.
 *
 * Este script:
 *  (a) lee _journal.json y detecta entries con `when > Date.now()`;
 *  (b) las reescribe con timestamps pasados, monotónicamente crecientes, anclados
 *      justo después del último `when` NO futuro (preserva el orden idx <-> cronología);
 *  (c) refleja el mismo valor en __drizzle_migrations.created_at, mapeando por HASH
 *      sha256 del archivo `{tag}.sql` correspondiente (no por posición/orden) — así no
 *      se toca una fila equivocada si algún hash no matchea 1:1 con el archivo actual
 *      (hay casos históricos de eso en esta DB, ver report, pero no afectan a las
 *      entries futuras que toca este script);
 *  (d) imprime antes/después de journal y DB.
 *
 * Idempotente: si no hay entries con `when` futuro, no toca nada (ni journal ni DB).
 *
 * Uso: npm run db:repair-journal --workspace=apps/backend
 */
import 'dotenv/config';
import { readFileSync, writeFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { sqlite } from '../db/index.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const DRIZZLE_DIR = resolve(__dirname, '../../drizzle');
const JOURNAL_PATH = resolve(DRIZZLE_DIR, 'meta/_journal.json');
const ONE_DAY_MS = 24 * 60 * 60 * 1000;

interface JournalEntry {
  idx: number;
  version: string;
  when: number;
  tag: string;
  breakpoints: boolean;
}

interface Journal {
  version: string;
  dialect: string;
  entries: JournalEntry[];
}

function fmt(ms: number): string {
  return new Date(ms).toISOString();
}

function main(): void {
  const now = Date.now();
  const raw = readFileSync(JOURNAL_PATH, 'utf8');
  const journal: Journal = JSON.parse(raw);

  const future = journal.entries.filter((e) => e.when > now);

  if (future.length === 0) {
    console.log('[repair-journal] No hay timestamps futuros en el journal. No-op.');
    return;
  }

  console.log(`[repair-journal] ANTES — ${future.length} entries con "when" futuro (now=${now}, ${fmt(now)}):`);
  for (const e of future) {
    console.log(`  idx=${e.idx} tag=${e.tag} when=${e.when} (${fmt(e.when)})`);
  }

  // Ancla: el "when" más alto entre las entries NO futuras (preserva orden idx<->cronología).
  //
  // FRAGILIDAD LATENTE: esta lógica asume que las entries futuras son TRAILING —
  // un bloque contiguo al final del journal (como en el caso real que motivó este
  // script: idx 36-39). Si alguna vez hubiera una entry futura en el MEDIO del
  // journal (con entries válidas después), asignar `anchor + N días` podría
  // producir un `when` reparado MAYOR que el de entries posteriores válidas,
  // invirtiendo el orden idx<->cronología que este script promete preservar.
  // Si te encontrás con ese caso, no corras esto a ciegas: repensá el anclaje
  // (p.ej. interpolar entre los vecinos válidos de cada entry futura).
  const nonFuture = journal.entries.filter((e) => e.when <= now).sort((a, b) => a.idx - b.idx);
  const anchor = nonFuture.length > 0
    ? nonFuture[nonFuture.length - 1].when
    : now - (future.length + 1) * ONE_DAY_MS;

  future.sort((a, b) => a.idx - b.idx);

  const updates: { tag: string; oldWhen: number; newWhen: number }[] = [];
  future.forEach((entry, i) => {
    const newWhen = anchor + (i + 1) * ONE_DAY_MS;
    if (newWhen >= now) {
      throw new Error(
        `[repair-journal] El timestamp reparado para idx=${entry.idx} (${newWhen}) no quedó en el pasado respecto de ahora (${now}). Abortando sin escribir nada.`,
      );
    }
    updates.push({ tag: entry.tag, oldWhen: entry.when, newWhen });
    entry.when = newWhen;
  });

  console.log('\n[repair-journal] DESPUÉS — nuevos valores (journal):');
  for (const u of updates) {
    console.log(`  ${u.tag}: ${u.oldWhen} (${fmt(u.oldWhen)}) -> ${u.newWhen} (${fmt(u.newWhen)})`);
  }

  console.log('\n[repair-journal] Actualizando __drizzle_migrations (mapeo por hash sha256 del .sql)...');
  const migRows = sqlite
    .prepare('SELECT rowid, hash, created_at FROM __drizzle_migrations')
    .all() as { rowid: number; hash: string; created_at: number }[];

  const updateStmt = sqlite.prepare('UPDATE __drizzle_migrations SET created_at = ? WHERE hash = ?');
  let dbUpdated = 0;
  for (const u of updates) {
    const sqlPath = resolve(DRIZZLE_DIR, `${u.tag}.sql`);
    const content = readFileSync(sqlPath);
    const hash = createHash('sha256').update(content).digest('hex');
    const row = migRows.find((r) => r.hash === hash);
    if (!row) {
      console.warn(
        `  [WARN] ${u.tag}: no se encontró fila en __drizzle_migrations con hash=${hash} (todavía no aplicada, o hash no matchea). Journal actualizado igual; DB sin cambios para esta entry.`,
      );
      continue;
    }
    const before = row.created_at;
    const info = updateStmt.run(u.newWhen, hash);
    console.log(`  ${u.tag} (hash=${hash.slice(0, 12)}...): created_at ${before} -> ${u.newWhen} (rows changed: ${info.changes})`);
    dbUpdated += info.changes;
  }

  writeFileSync(JOURNAL_PATH, JSON.stringify(journal, null, 2));

  console.log(
    `\n[repair-journal] OK — journal.json reescrito (${updates.length} entries). __drizzle_migrations filas actualizadas: ${dbUpdated}.`,
  );
}

main();
