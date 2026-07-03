-- unified_analysis_results.dedupe_key existía en db/schema.ts (NOT NULL UNIQUE) pero
-- nunca se aplicó a la DB viva: 0030_unified_analysis_results.sql fue editado a mano
-- DESPUÉS de haber sido aplicado (agregando `dedupe_key` inline al CREATE TABLE), pero
-- eso no reescribe una migración ya corrida. Resultado: la tabla real quedó sin la
-- columna y saveUnifiedAnalysisResults() (onConflictDoUpdate sobre dedupeKey) fallaba
-- en cada insert desde siempre, tragado por el catch de unified-analysis.service.ts.
-- (Ese hand-edit de 0030 fue revertido junto con este fix: 0030 vuelve a su contenido
-- original aplicado — hash re-alineado con __drizzle_migrations — y esta migración es
-- la única fuente de `dedupe_key`, así una DB nueva desde cero corre 0030→0040 sin
-- "duplicate column".)
--
-- SQLite no permite ADD COLUMN ... UNIQUE inline, por eso va en dos pasos.
-- SQLite tampoco permite ADD COLUMN NOT NULL sin DEFAULT (incluso con la tabla vacía),
-- por eso DEFAULT ''. Con 0 filas en la tabla al momento de esta migración, el default
-- nunca se usa para backfill real. db/schema.ts se mantiene `dedupeKey: text('dedupe_key').notNull().unique()`
-- sin `.default()` porque drizzle-kit resuelve diffs contra el snapshot (no introspección
-- de la DB viva), así que ese default a nivel SQL no genera drift de "generate" futuros.
ALTER TABLE `unified_analysis_results` ADD COLUMN `dedupe_key` text NOT NULL DEFAULT '';
--> statement-breakpoint
CREATE UNIQUE INDEX `idx_unified_analysis_results_dedupe_key` ON `unified_analysis_results` (`dedupe_key`);
