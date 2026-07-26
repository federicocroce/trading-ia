# Registro y accuracy de las propuestas de "Hoy" — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Registrar cada día exactamente qué tickers propuso la vista "Hoy" (top-6), mostrar en cada card cuántas veces apareció (streak), degradar residentes crónicos (4ª+ aparición) de COMPRAR a OBSERVAR con evidencia citada, y exponer el track record medido de esas propuestas en la UI.

**Architecture:** Tabla nueva `today_proposals` poblada al persistir cada scan con la MISMA función pura de selección que usa la vista (fuente única: lo guardado = lo mostrado). Backfill único desde los JSON de `opportunity_scans` para tener historia desde abril. Accuracy = join `today_proposals` ↔ `signal_tracking` (symbol + fecha), que ya tiene outcomes y R-multiples resueltos.

**Tech Stack:** drizzle/better-sqlite3, tRPC, vitest, React 19 + Tailwind 4.

**Evidencia que motiva el cambio** (reconstrucción de 165 scans abr–jul 2026 cruzada con `signal_tracking` — regla dura 7):
- Propuestas top-6 históricas: 45.7% win rate, +0.098R promedio.
- Por enésima aparición (regla operable en vivo): 1ª → 53.6% win / +0.28R (n=110); 2ª–3ª → 50.0% / +0.31R (n=118); **4ª o más → 40.4% / −0.05R (n=260)**.
- 76% de las salidas del top-6 son desplazamiento por score (setup vivo), no invalidación.

## Global Constraints

- **Fail-closed**: dato faltante ⇒ null/omisión honesta, jamás default neutro (ej.: sin `nthAppearance` no se inventa caveat).
- **Jerarquía de decisión**: la regla crónica SOLO degrada (COMPRAR→OBSERVAR), jamás sube un verbo. No toca `action` del motor ni el scoring.
- **`envNumber` lazy**: todo umbral configurable se lee DENTRO de la función (`apps/backend/src/shared/env-number.ts`). Jamás `process.env` a nivel módulo.
- **Payloads tRPC aditivos**: campos nuevos por spread/extensión del shape existente; nada de wrappers.
- **Convenciones**: comentarios en español, imports ESM con extensión `.js`, funciones de decisión puras (sin I/O), TDD (test rojo primero).
- **LANDMINE migraciones drizzle**: backup de `data/trading.db` ANTES de `npm run db:generate`; `initDatabase()` aplica la migración en el próximo boot; verificar la columna en la DB viva antes de asumir que un insert funciona. Migración nueva debe tener `when` mayor a `1783366599584` (0044) en `apps/backend/drizzle/meta/_journal.json` — drizzle-kit lo genera con el timestamp actual, solo verificar.
- **Tests — comando canónico** (único conteo válido): `npm run test --workspace=apps/backend`. Un archivo: `npm run test --workspace=apps/backend -- src/opportunities/today-proposals.test.ts`. NUNCA vitest desde la raíz.
- **Branch**: todo el trabajo en `feat/hoy-registro-propuestas`; merge solo con review aprobado.
- El registro post-scan y el backfill JAMÁS deben romper el scan/boot: try/catch con log de error.

## File Structure

```
apps/backend/src/db/schema.ts                                  (modif: tabla today_proposals)
apps/backend/drizzle/00XX_*.sql                                (generada por drizzle-kit)
apps/backend/src/opportunities/today-proposals.ts              (nuevo: selección pura + regla crónica)
apps/backend/src/opportunities/today-proposals.test.ts         (nuevo: tests TDD)
apps/backend/src/db/repository.ts                              (modif: upsert/appearances/accuracy)
apps/backend/src/opportunities/opportunities.service.ts        (modif: registro post-scan en persistScanResult)
apps/backend/src/scripts/backfill-today-proposals.ts           (nuevo: backfill único)
apps/backend/package.json                                      (modif: npm script db:backfill-hoy)
apps/backend/src/opportunities/today-decisions.service.ts      (modif: usa selector compartido + streak + degradación)
apps/backend/src/opportunities/opportunities.router.ts         (modif: query todayAccuracy)
apps/frontend/src/today/TodayPage.tsx                          (modif: badge de aparición, caveat, footer accuracy)
```

---

### Task 1: Tabla `today_proposals` (schema + migración)

**Files:**
- Modify: `apps/backend/src/db/schema.ts` (después del bloque `signalTracking`, ~línea 240)

**Interfaces:**
- Produces: tabla `today_proposals` con unique index `(scan_date, symbol)`; export drizzle `todayProposals` que consumen Tasks 3, 4 y 6.

- [ ] **Step 1: Crear branch**

```bash
git checkout -b feat/hoy-registro-propuestas
```

- [ ] **Step 2: Agregar la tabla al schema**

En `apps/backend/src/db/schema.ts`, después de la definición completa de `signalTracking` (y de su cierre `});`), agregar:

```ts
// --- Registro de propuestas de "Hoy" ---
// Qué mostró la vista cada día (top-6 de "Oportunidades - no las tenés"), para poder medir
// el accuracy de LO PROPUESTO (no del scan entero) y contar apariciones (residente crónico).
// Se llena al persistir cada scan con la misma selección pura que usa la vista — fuente única.
export const todayProposals = sqliteTable('today_proposals', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  scanId: integer('scan_id').notNull(),
  scanDate: text('scan_date').notNull(),               // YYYY-MM-DD del scan
  symbol: text('symbol').notNull(),
  verb: text('verb').notNull(),                        // COMPRAR | OBSERVAR — lo que se mostró (post-degradación crónica)
  engineAction: text('engine_action').notNull(),       // BUY | WATCH — acción cruda del motor
  score: integer('score').notNull(),
  entryPrice: real('entry_price'),
  stopLoss: real('stop_loss'),
  targetPrice: real('target_price'),
  nthAppearance: integer('nth_appearance').notNull(),  // 1 = primera vez en el top de Hoy (días distintos)
  createdAt: text('created_at').notNull().default(sql`(datetime('now'))`),
}, (t) => [uniqueIndex('today_proposals_date_symbol_uq').on(t.scanDate, t.symbol)]);
```

- [ ] **Step 3: Backup de la DB (obligatorio ANTES de db:generate)**

```bash
cp data/trading.db data/trading.db.bak-2026-07-14-hoy-proposals
```

- [ ] **Step 4: Generar la migración**

```bash
npm run db:generate --workspace=apps/backend
```

Verificar: se creó `apps/backend/drizzle/0045_*.sql` con `CREATE TABLE today_proposals` + `CREATE UNIQUE INDEX today_proposals_date_symbol_uq`, y en `apps/backend/drizzle/meta/_journal.json` la entrada nueva tiene `"when"` mayor a `1783366599584`.

- [ ] **Step 5: Aplicar la migración sobre la DB real**

```bash
npm run db:migrate --workspace=apps/backend
```

- [ ] **Step 6: Verificar la columna en la DB viva (landmine check)**

```bash
sqlite3 data/trading.db "PRAGMA table_info(today_proposals);" && sqlite3 data/trading.db "SELECT COUNT(*) FROM today_proposals;"
```

Expected: 12 columnas listadas; count `0`.

- [ ] **Step 7: Typecheck y commit**

```bash
npm run typecheck
git add apps/backend/src/db/schema.ts apps/backend/drizzle/
git commit -m "feat(hoy): tabla today_proposals — registro de lo que la vista propone cada día"
```

---

### Task 2: Módulo puro `today-proposals.ts` (selección + regla del residente crónico)

**Files:**
- Create: `apps/backend/src/opportunities/today-proposals.ts`
- Test: `apps/backend/src/opportunities/today-proposals.test.ts`
- Modify: `apps/backend/src/opportunities/today-decisions.service.ts:14` (tipo `MarketVerb`) y `:144-147` (selección)

**Interfaces:**
- Produces (consumen Tasks 3, 4 y 5):
  - `selectTodayProposals<T extends ProposalCandidate>(opps: T[], heldSet: Set<string>, limit?: number): T[]`
  - `verbFor(action: string): MarketVerb`
  - `chronicAdjustment(verb: MarketVerb, nthAppearance: number | null, threshold?: number): { verb: MarketVerb; caveat?: string }`
  - `chronicThreshold(): number` — lee `HOY_CHRONIC_THRESHOLD` (default 4) lazy
  - `TODAY_PROPOSAL_LIMIT = 6`, tipo `MarketVerb = 'COMPRAR' | 'OBSERVAR'`

- [ ] **Step 1: Escribir los tests que fallan**

Crear `apps/backend/src/opportunities/today-proposals.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import {
  selectTodayProposals,
  verbFor,
  chronicAdjustment,
  chronicThreshold,
  TODAY_PROPOSAL_LIMIT,
} from './today-proposals.js';

function opp(symbol: string, action: string, score: number) {
  return { symbol, action, opportunityScore: score };
}

describe('selectTodayProposals (misma selección para la vista y el registro)', () => {
  it('filtra a BUY/WATCH, excluye tenidos, ordena por score desc y corta el top N', () => {
    const opps = [
      opp('AAA', 'BUY', 50),
      opp('BBB', 'SELL', 99),   // SELL afuera
      opp('CCC', 'WATCH', 70),
      opp('DDD', 'HOLD', 95),   // HOLD afuera
      opp('EEE', 'BUY', 90),    // tenida → afuera
    ];
    const out = selectTodayProposals(opps, new Set(['EEE']));
    expect(out.map((o) => o.symbol)).toEqual(['CCC', 'AAA']);
  });

  it('la exclusión de tenidos es case-insensitive', () => {
    const out = selectTodayProposals([opp('dal', 'BUY', 80)], new Set(['DAL']));
    expect(out).toEqual([]);
  });

  it('corta en TODAY_PROPOSAL_LIMIT por default', () => {
    const many = Array.from({ length: 10 }, (_, i) => opp(`S${i}`, 'BUY', 100 - i));
    expect(selectTodayProposals(many, new Set()).length).toBe(TODAY_PROPOSAL_LIMIT);
  });

  it('devuelve las mismas filas que recibe (genérico, sin remap)', () => {
    const rich = [{ ...opp('AAA', 'BUY', 50), tradeLevels: { entryPrice: 10 } }];
    expect(selectTodayProposals(rich, new Set())[0].tradeLevels.entryPrice).toBe(10);
  });
});

describe('verbFor', () => {
  it('BUY → COMPRAR; cualquier otra cosa → OBSERVAR', () => {
    expect(verbFor('BUY')).toBe('COMPRAR');
    expect(verbFor('WATCH')).toBe('OBSERVAR');
  });
});

describe('chronicAdjustment (evidencia: 4ª+ aparición = 40.4% win, −0.05R, n=260)', () => {
  it('debajo del umbral: no toca el verbo ni agrega caveat', () => {
    expect(chronicAdjustment('COMPRAR', 3, 4)).toEqual({ verb: 'COMPRAR' });
  });

  it('en el umbral: COMPRAR degrada a OBSERVAR con caveat que nombra la enésima aparición', () => {
    const adj = chronicAdjustment('COMPRAR', 4, 4);
    expect(adj.verb).toBe('OBSERVAR');
    expect(adj.caveat).toContain('4ª aparición');
  });

  it('OBSERVAR crónico: mantiene el verbo (jamás sube) pero lleva caveat', () => {
    const adj = chronicAdjustment('OBSERVAR', 9, 4);
    expect(adj.verb).toBe('OBSERVAR');
    expect(adj.caveat).toBeDefined();
  });

  it('fail-closed: sin dato de apariciones (null) no degrada ni inventa caveat', () => {
    expect(chronicAdjustment('COMPRAR', null, 4)).toEqual({ verb: 'COMPRAR' });
  });
});

describe('chronicThreshold (envNumber lazy)', () => {
  it('default 4; respeta HOY_CHRONIC_THRESHOLD', () => {
    delete process.env.HOY_CHRONIC_THRESHOLD;
    expect(chronicThreshold()).toBe(4);
    process.env.HOY_CHRONIC_THRESHOLD = '7';
    expect(chronicThreshold()).toBe(7);
    delete process.env.HOY_CHRONIC_THRESHOLD;
  });
});
```

- [ ] **Step 2: Correr los tests y verificar que fallan**

```bash
npm run test --workspace=apps/backend -- src/opportunities/today-proposals.test.ts
```

Expected: FAIL — `Cannot find module './today-proposals.js'`.

- [ ] **Step 3: Implementar el módulo**

Crear `apps/backend/src/opportunities/today-proposals.ts`:

```ts
/**
 * Selección pura del top de "Oportunidades (no las tenés)" de Hoy + regla del residente crónico.
 *
 * Compartida entre la vista (today-decisions.service), el registro post-scan
 * (opportunities.service → persistScanResult) y el backfill, para que lo guardado sea
 * EXACTAMENTE lo mostrado — fuente única, sin doble discurso.
 *
 * Evidencia (signal_tracking × reconstrucción de opportunity_scans, abr–jul 2026, 165 scans):
 *   1ª aparición en el top:  win rate 53.6%, R prom +0.28 (n=110)
 *   2ª–3ª aparición:         win rate 50.0%, R prom +0.31 (n=118)
 *   4ª o más:                win rate 40.4%, R prom −0.05 (n=260)
 * El residente crónico no tiene edge medido → desde el umbral, COMPRAR degrada a OBSERVAR.
 * Solo degrada, jamás sube — misma dirección que el gate del LLM (applyLlmAction).
 */
import { envNumber } from '../shared/env-number.js';

export type MarketVerb = 'COMPRAR' | 'OBSERVAR';

export interface ProposalCandidate {
  symbol: string;
  action: string; // BUY | SELL | HOLD | WATCH
  opportunityScore: number;
}

export const TODAY_PROPOSAL_LIMIT = 6;

/** Filtra BUY/WATCH no tenidos, ordena por score desc y corta el top N. Devuelve las mismas filas que recibe. */
export function selectTodayProposals<T extends ProposalCandidate>(
  opps: T[],
  heldSet: Set<string>,
  limit: number = TODAY_PROPOSAL_LIMIT,
): T[] {
  return opps
    .filter((o) => !heldSet.has(o.symbol.toUpperCase()) && (o.action === 'BUY' || o.action === 'WATCH'))
    .sort((a, b) => b.opportunityScore - a.opportunityScore)
    .slice(0, limit);
}

export function verbFor(action: string): MarketVerb {
  return action === 'BUY' ? 'COMPRAR' : 'OBSERVAR';
}

/** Umbral configurable lazy (regla dura 3). HOY_CHRONIC_THRESHOLD=999 lo desactiva en la práctica. */
export function chronicThreshold(): number {
  return envNumber('HOY_CHRONIC_THRESHOLD', 4);
}

export interface ChronicAdjustment {
  verb: MarketVerb;
  /** Presente cuando la señal es crónica: viaja CON la card, citando la evidencia medida. */
  caveat?: string;
}

/**
 * Regla del residente crónico: nthAppearance >= umbral ⇒ COMPRAR degrada a OBSERVAR
 * (jamás al revés) y cualquier verbo lleva caveat. nth null = dato faltante ⇒ no se
 * inventa nada (fail-closed).
 */
export function chronicAdjustment(
  verb: MarketVerb,
  nthAppearance: number | null,
  threshold: number = chronicThreshold(),
): ChronicAdjustment {
  if (nthAppearance == null || nthAppearance < threshold) return { verb };
  const cierre = verb === 'COMPRAR' ? 'Degradado a OBSERVAR.' : 'Sin apuro: si fuera a despegar, ya lo habría hecho.';
  return {
    verb: verb === 'COMPRAR' ? 'OBSERVAR' : verb,
    caveat:
      `${nthAppearance}ª aparición en el top de Hoy. Los residentes crónicos (${threshold}ª o más) ` +
      `históricamente no tienen edge: 40% de aciertos y R −0.05 (n=260, abr–jul 2026), ` +
      `contra +0.3R de las apariciones frescas. ${cierre}`,
  };
}
```

- [ ] **Step 4: Correr los tests y verificar que pasan**

```bash
npm run test --workspace=apps/backend -- src/opportunities/today-proposals.test.ts
```

Expected: PASS (10 tests).

- [ ] **Step 5: Reusar el selector en la vista (sin cambio de comportamiento)**

En `apps/backend/src/opportunities/today-decisions.service.ts`:

1. Agregar import y reemplazar el tipo local. Reemplazar la línea `export type MarketVerb = 'COMPRAR' | 'OBSERVAR';` por:

```ts
import { selectTodayProposals, verbFor, type MarketVerb } from './today-proposals.js';

export type { MarketVerb };
```

(el `import { ... }` va junto al bloque de imports del archivo, arriba)

2. En el bloque `// --- Mercado: solo lo que NO tenés ...`, reemplazar:

```ts
  const opportunities: TodayOpportunity[] = opps
    .filter((o) => !heldSet.has(o.symbol.toUpperCase()) && (o.action === 'BUY' || o.action === 'WATCH'))
    .sort((a, b) => b.opportunityScore - a.opportunityScore)
    .slice(0, 6)
    .map((o) => {
```

por:

```ts
  const opportunities: TodayOpportunity[] = selectTodayProposals(opps, heldSet)
    .map((o) => {
```

3. Dentro del `.map`, reemplazar la línea:

```ts
      const verb = o.action === 'BUY' ? 'COMPRAR' as const : 'OBSERVAR' as const;
```

por:

```ts
      const verb = verbFor(o.action);
```

- [ ] **Step 6: Suite completa + typecheck (verificar que nada cambió de comportamiento)**

```bash
npm run test --workspace=apps/backend && npm run typecheck
```

Expected: PASS todo, mismos conteos previos + 10 nuevos.

- [ ] **Step 7: Commit**

```bash
git add apps/backend/src/opportunities/today-proposals.ts apps/backend/src/opportunities/today-proposals.test.ts apps/backend/src/opportunities/today-decisions.service.ts
git commit -m "feat(hoy): selección pura compartida del top-6 + regla del residente crónico (evidencia n=260)"
```

---

### Task 3: Repositorio + registro post-scan

**Files:**
- Modify: `apps/backend/src/db/repository.ts` (agregar al final, antes del último export si lo hubiera)
- Modify: `apps/backend/src/opportunities/opportunities.service.ts` (función `persistScanResult`, después del bloque de anti-hype rejections y de `const scanDate = scannedAtISO.slice(0, 10);` ~línea 1127)

**Interfaces:**
- Consumes: `selectTodayProposals`, `verbFor`, `chronicAdjustment` (Task 2); tabla `todayProposals` (Task 1).
- Produces (consumen Tasks 4, 5 y 6):
  - `upsertTodayProposals(rows: TodayProposalInsert[]): void` — upsert por `(scanDate, symbol)`, el último scan del día gana.
  - `getTodayProposalAppearances(symbols: string[], beforeDate: string): Map<string, number>` — días distintos ANTERIORES a `beforeDate` en que cada símbolo apareció (excluye el día actual: nth de hoy = resultado + 1).

- [ ] **Step 1: Agregar las funciones al repositorio**

En `apps/backend/src/db/repository.ts` (verificar que `sql`, `and`, `inArray`, `lt` estén en el import de `drizzle-orm`; agregar los que falten):

```ts
// --- Today proposals (registro de lo que "Hoy" propuso cada día) ---

export interface TodayProposalInsert {
  scanId: number;
  scanDate: string; // YYYY-MM-DD
  symbol: string;
  verb: string;         // COMPRAR | OBSERVAR (lo mostrado, post-degradación)
  engineAction: string; // BUY | WATCH
  score: number;
  entryPrice: number | null;
  stopLoss: number | null;
  targetPrice: number | null;
  nthAppearance: number;
}

/** Upsert por (scanDate, symbol): si hay varios scans en el día, gana el último — igual que la vista. */
export function upsertTodayProposals(rows: TodayProposalInsert[]): void {
  for (const row of rows) {
    db.insert(schema.todayProposals)
      .values(row)
      .onConflictDoUpdate({
        target: [schema.todayProposals.scanDate, schema.todayProposals.symbol],
        set: {
          scanId: row.scanId,
          verb: row.verb,
          engineAction: row.engineAction,
          score: row.score,
          entryPrice: row.entryPrice,
          stopLoss: row.stopLoss,
          targetPrice: row.targetPrice,
          nthAppearance: row.nthAppearance,
        },
      })
      .run();
  }
}

/**
 * Días distintos ANTERIORES a `beforeDate` en que cada símbolo ya apareció en el top de Hoy.
 * Excluye el día actual a propósito: la enésima aparición de hoy = resultado + 1, y así
 * el número no cambia si el scan se re-corre en el día (idempotente).
 */
export function getTodayProposalAppearances(symbols: string[], beforeDate: string): Map<string, number> {
  const map = new Map<string, number>();
  if (symbols.length === 0) return map;
  const rows = db
    .select({
      symbol: schema.todayProposals.symbol,
      days: sql<number>`count(distinct ${schema.todayProposals.scanDate})`,
    })
    .from(schema.todayProposals)
    .where(and(
      inArray(schema.todayProposals.symbol, symbols),
      lt(schema.todayProposals.scanDate, beforeDate),
    ))
    .groupBy(schema.todayProposals.symbol)
    .all();
  for (const r of rows) map.set(r.symbol, r.days);
  return map;
}
```

- [ ] **Step 2: Registrar las propuestas al persistir el scan**

En `apps/backend/src/opportunities/opportunities.service.ts`:

1. Agregar a los imports de arriba:

```ts
import { selectTodayProposals, verbFor, chronicAdjustment } from './today-proposals.js';
```

y sumar `upsertTodayProposals, getTodayProposalAppearances` al import existente de `../db/repository.js`.

2. Dentro de `persistScanResult`, inmediatamente DESPUÉS de la línea `const scanDate = scannedAtISO.slice(0, 10);` (~línea 1127), insertar:

```ts
    // === REGISTRO DE PROPUESTAS DE HOY: exactamente lo que la vista va a mostrar de este scan,
    // con enésima aparición y verbo post-degradación crónica. Nunca rompe el scan. ===
    try {
      const heldNow = new Set(getPortfolioPositions().map((p) => p.symbol.toUpperCase()));
      const proposed = selectTodayProposals(result.opportunities, heldNow);
      const priorAppearances = getTodayProposalAppearances(proposed.map((o) => o.symbol), scanDate);
      upsertTodayProposals(proposed.map((o) => {
        const nth = (priorAppearances.get(o.symbol) ?? 0) + 1;
        const adj = chronicAdjustment(verbFor(o.action), nth);
        return {
          scanId,
          scanDate,
          symbol: o.symbol,
          verb: adj.verb,
          engineAction: o.action,
          score: Math.round(o.opportunityScore),
          entryPrice: o.tradeLevels?.entryPrice ?? null,
          stopLoss: o.tradeLevels?.stopLoss ?? null,
          targetPrice: o.tradeLevels?.takeProfit ?? null,
          nthAppearance: nth,
        };
      }));
      console.log(`[opportunities] Registradas ${proposed.length} propuestas de Hoy (${scanDate})`);
    } catch (err) {
      console.error('[opportunities] Failed to record today proposals:', (err as Error).message);
    }
```

(`getPortfolioPositions` ya está importado en este archivo; `scanId` y `scanDate` ya existen en ese scope.)

- [ ] **Step 3: Suite + typecheck**

```bash
npm run test --workspace=apps/backend && npm run typecheck
```

Expected: PASS.

- [ ] **Step 4: Commit**

```bash
git add apps/backend/src/db/repository.ts apps/backend/src/opportunities/opportunities.service.ts
git commit -m "feat(hoy): el scan registra sus propuestas top-6 en today_proposals con nº de aparición"
```

---

### Task 4: Backfill histórico desde `opportunity_scans`

**Files:**
- Create: `apps/backend/src/scripts/backfill-today-proposals.ts`
- Modify: `apps/backend/package.json` (bloque `scripts`)

**Interfaces:**
- Consumes: `selectTodayProposals`, `verbFor` (Task 2); `todayProposals` schema (Task 1).
- Produces: tabla poblada con la historia abr–jul 2026 (~165 scans, ~950 filas, ~225 símbolos), que Task 5 usa para el streak y Task 6 para el accuracy.

- [ ] **Step 1: Escribir el script**

Crear `apps/backend/src/scripts/backfill-today-proposals.ts`:

```ts
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
```

- [ ] **Step 2: Agregar el npm script**

En `apps/backend/package.json`, dentro de `"scripts"`, después de `"db:backfill-r"`:

```json
    "db:backfill-hoy": "tsx src/scripts/backfill-today-proposals.ts",
```

- [ ] **Step 3: Correr el backfill**

```bash
npm run db:backfill-hoy --workspace=apps/backend
```

Expected: `165 scans a procesar` (o más si hubo scans nuevos) y ~900–1000 filas upserted.

- [ ] **Step 4: Verificar contra los números conocidos**

```bash
sqlite3 data/trading.db "SELECT COUNT(*), COUNT(DISTINCT symbol), COUNT(DISTINCT scan_date) FROM today_proposals;"
sqlite3 data/trading.db "SELECT scan_date, nth_appearance FROM today_proposals WHERE symbol='DAL' ORDER BY scan_date;"
```

Expected: ~200+ símbolos distintos; DAL con `nth_appearance` estrictamente creciente (1, 2, 3, …) y ~9 apariciones en jun–jul.

- [ ] **Step 5: Idempotencia — re-correr y verificar que no duplica**

```bash
npm run db:backfill-hoy --workspace=apps/backend
sqlite3 data/trading.db "SELECT COUNT(*) FROM today_proposals;"
```

Expected: mismo count que en Step 4.

- [ ] **Step 6: Commit**

```bash
git add apps/backend/src/scripts/backfill-today-proposals.ts apps/backend/package.json
git commit -m "feat(hoy): backfill de today_proposals desde los JSON históricos de opportunity_scans"
```

---

### Task 5: Streak + degradación crónica en la vista "Hoy"

**Files:**
- Modify: `apps/backend/src/opportunities/today-decisions.service.ts` (interfaz `TodayOpportunity` + bloque de mercado)

**Interfaces:**
- Consumes: `getTodayProposalAppearances` (Task 3); `chronicAdjustment` (Task 2).
- Produces (consume el frontend en Task 6): campos ADITIVOS en `TodayOpportunity`:
  - `appearances: number | null` — enésima aparición contando hoy; null si no hay registro (fail-closed).
  - `persistenceCaveat?: string` — presente solo para crónicos.
  - `verb` ahora puede venir degradado (COMPRAR→OBSERVAR) por la regla crónica.

- [ ] **Step 1: Extender la interfaz (aditivo)**

En `apps/backend/src/opportunities/today-decisions.service.ts`, dentro de `TodayOpportunity`, después de `timingCaveat?: string;` agregar:

```ts
  /** Enésima aparición en el top de Hoy (contando hoy). null = sin registro — no se inventa. */
  appearances: number | null;
  /** Regla del residente crónico (4ª+ aparición): viaja con la card, cita la evidencia. */
  persistenceCaveat?: string;
```

- [ ] **Step 2: Calcular streak y aplicar la degradación en el mapeo**

En el mismo archivo:

1. Sumar imports: `chronicAdjustment` desde `./today-proposals.js` (junto al import de Task 2) y `getTodayProposalAppearances` en el import de `../db/repository.js`.

2. Reemplazar el bloque completo de mercado:

```ts
  const opportunities: TodayOpportunity[] = selectTodayProposals(opps, heldSet)
    .map((o) => {
```

y su interior, por:

```ts
  const scanDay = scan?.scannedAt?.slice(0, 10) ?? generatedAt.slice(0, 10);
  const candidates = selectTodayProposals(opps, heldSet);
  // Enésima aparición: días previos registrados + 1 (hoy). Sin filas previas ni registro
  // del propio scan (tabla recién creada) el prior es 0 → appearances = 1, honesto.
  const priorAppearances = getTodayProposalAppearances(candidates.map((c) => c.symbol), scanDay);

  const opportunities: TodayOpportunity[] = candidates.map((o) => {
    const entry = o.tradeLevels?.entryPrice;
    const stop = o.tradeLevels?.stopLoss;
    const size = entry != null && stop != null && portfolioValue > 0
      ? suggestPositionSize({ portfolioValue, entry, stop })
      : null;
    const nth = (priorAppearances.get(o.symbol) ?? 0) + 1;
    const adj = chronicAdjustment(verbFor(o.action), nth);
    return {
      symbol: o.symbol,
      verb: adj.verb,
      reason: pickReason(o),
      timingCaveat: timingCaveatFor(adj.verb, o.timingView),
      appearances: nth,
      persistenceCaveat: adj.caveat,
      score: Math.round(o.opportunityScore),
      currentPrice: round2(o.currentPrice),
      assetClass: assetClassOf(o.symbol),
      entry,
      stop,
      target: o.tradeLevels?.takeProfit,
      suggestedShares: size?.shares,
      suggestedDollars: size?.dollars,
    };
  });
```

Nota: `timingCaveatFor` recibe el verbo YA degradado — si la regla crónica bajó a OBSERVAR, el caveat de timing de compra no aplica (solo advierte sobre COMPRAR), lo cual es coherente: la card ya no invita a comprar.

- [ ] **Step 3: Suite + typecheck**

```bash
npm run test --workspace=apps/backend && npm run typecheck
```

Expected: PASS.

- [ ] **Step 4: Verificación runtime (levantar y pegarle al endpoint)**

```bash
npm run dev &
sleep 15 && curl -s 'http://localhost:3001/trpc/opportunities.today' | head -c 2000
```

Expected: cada item de `opportunities` trae `appearances` numérico; si algún símbolo va por la 4ª+ aparición (ej. DAL), su `verb` es `OBSERVAR` y trae `persistenceCaveat`. Matar el dev server al terminar.

- [ ] **Step 5: Commit**

```bash
git add apps/backend/src/opportunities/today-decisions.service.ts
git commit -m "feat(hoy): streak de apariciones en cada card + degradación del residente crónico"
```

---

### Task 6: Accuracy endpoint + UI (badge, caveat y track record)

**Files:**
- Modify: `apps/backend/src/db/repository.ts` (función de accuracy)
- Modify: `apps/backend/src/opportunities/opportunities.router.ts` (query `todayAccuracy`, junto a `today`)
- Modify: `apps/frontend/src/today/TodayPage.tsx`

**Interfaces:**
- Consumes: tabla `today_proposals` poblada (Tasks 3–4); `signal_tracking` existente; campos `appearances`/`persistenceCaveat` (Task 5).
- Produces: `opportunities.todayAccuracy` → `{ total: AccuracyBucket | null, byBucket: AccuracyBucket[] }` con `AccuracyBucket = { bucket: string; n: number; winRate: number; avgR: number | null }`.

- [ ] **Step 1: Función de accuracy en el repositorio**

En `apps/backend/src/db/repository.ts`, después de `getTodayProposalAppearances`:

```ts
export interface TodayAccuracyBucket {
  bucket: string;       // '1' | '2-3' | '4+' | 'total'
  n: number;            // señales con outcome win/loss (neutral no cuenta para win rate)
  winRate: number;      // % redondeado a 1 decimal
  avgR: number | null;  // R-multiple promedio (incluye neutrales con R), null si no hay
}

/**
 * Track record de LO QUE HOY PROPUSO: join de today_proposals con signal_tracking por
 * (symbol, fecha). Solo outcomes resueltos; sin filas no se inventa nada (total null).
 */
export function getTodayProposalAccuracy(): { total: TodayAccuracyBucket | null; byBucket: TodayAccuracyBucket[] } {
  const rows = db.all<{ bucket: string; wins: number; losses: number; avg_r: number | null }>(sql`
    SELECT CASE WHEN tp.nth_appearance = 1 THEN '1'
                WHEN tp.nth_appearance <= 3 THEN '2-3'
                ELSE '4+' END AS bucket,
           SUM(st.outcome = 'win')  AS wins,
           SUM(st.outcome = 'loss') AS losses,
           AVG(st.r_multiple)       AS avg_r
    FROM today_proposals tp
    JOIN signal_tracking st ON st.symbol = tp.symbol AND st.signal_date = tp.scan_date
    WHERE st.outcome IN ('win', 'loss', 'neutral')
    GROUP BY bucket
  `);

  const toBucket = (bucket: string, wins: number, losses: number, avgR: number | null): TodayAccuracyBucket | null => {
    const n = wins + losses;
    if (n === 0) return null;
    return {
      bucket,
      n,
      winRate: Math.round((wins / n) * 1000) / 10,
      avgR: avgR == null ? null : Math.round(avgR * 1000) / 1000,
    };
  };

  const byBucket = rows
    .map((r) => toBucket(r.bucket, r.wins, r.losses, r.avg_r))
    .filter((b): b is TodayAccuracyBucket => b !== null);

  const totWins = rows.reduce((s, r) => s + r.wins, 0);
  const totLosses = rows.reduce((s, r) => s + r.losses, 0);
  // avg_r total ponderado no es exacto sumando promedios — se consulta aparte si hay filas.
  const totalAvgR = rows.length > 0
    ? db.all<{ avg_r: number | null }>(sql`
        SELECT AVG(st.r_multiple) AS avg_r
        FROM today_proposals tp
        JOIN signal_tracking st ON st.symbol = tp.symbol AND st.signal_date = tp.scan_date
        WHERE st.outcome IN ('win', 'loss', 'neutral')
      `)[0]?.avg_r ?? null
    : null;

  return { total: toBucket('total', totWins, totLosses, totalAvgR), byBucket };
}
```

- [ ] **Step 2: Exponer la query en el router**

En `apps/backend/src/opportunities/opportunities.router.ts`, sumar `getTodayProposalAccuracy` al import de `../db/repository.js` (o el import donde convenga) y, debajo de la línea `today: publicProcedure.query(() => getTodayDecisions()),` agregar:

```ts
  // Track record medido de lo que "Hoy" propuso (join today_proposals ↔ signal_tracking).
  todayAccuracy: publicProcedure.query(() => getTodayProposalAccuracy()),
```

- [ ] **Step 3: UI — badge de aparición, caveat crónico y footer de track record**

En `apps/frontend/src/today/TodayPage.tsx`:

1. Debajo de la línea `const { data, isLoading } = trpc.opportunities.today.useQuery(...)`:

```tsx
  const { data: accuracy } = trpc.opportunities.todayAccuracy.useQuery(undefined, { staleTime: 300_000 });
```

2. En la card de oportunidad, en el `div` del encabezado, después del `<button ...>{o.symbol}</button>` agregar:

```tsx
                  {o.appearances != null && (
                    <span className={`text-[10px] ${o.appearances >= 4 ? 'text-amber-400 font-semibold' : 'text-muted-foreground'}`}>
                      {o.appearances === 1 ? 'nueva' : `${o.appearances}ª aparición`}
                    </span>
                  )}
```

3. Debajo de la línea del `timingCaveat` (`{o.timingCaveat && ...}`) agregar:

```tsx
                {o.persistenceCaveat && <p className="text-[10px] text-amber-400">⚠ {o.persistenceCaveat}</p>}
```

4. Al final de la sección de oportunidades, después del `.map` de cards y antes del cierre `</section>`, agregar:

```tsx
        {accuracy?.total && (
          <p className="text-[10px] text-muted-foreground">
            Track record medido de estas propuestas: {accuracy.total.winRate}% de aciertos
            {accuracy.total.avgR != null && <> · R promedio {accuracy.total.avgR >= 0 ? '+' : ''}{accuracy.total.avgR}</>}
            {' '}({accuracy.total.n} señales resueltas). Las apariciones frescas (1ª–3ª) rinden mejor que los residentes crónicos (4ª+).
          </p>
        )}
```

- [ ] **Step 4: Typecheck completo + suite**

```bash
npm run typecheck && npm run test --workspace=apps/backend
```

Expected: PASS (el frontend typecheckea contra el `AppRouter` nuevo).

- [ ] **Step 5: Verificación visual**

```bash
npm run dev
```

Abrir `http://localhost:5050`, tab Hoy. Expected: cards con "nueva" / "Nª aparición"; DAL (u otro crónico) en OBSERVAR con caveat ámbar citando la evidencia; footer con el track record (~46% win, R ≈ +0.1). Matar el dev server al terminar.

- [ ] **Step 6: Commit**

```bash
git add apps/backend/src/db/repository.ts apps/backend/src/opportunities/opportunities.router.ts apps/frontend/src/today/TodayPage.tsx
git commit -m "feat(hoy): endpoint todayAccuracy + streak, caveat crónico y track record en la UI"
```

---

## Notas para el review final

- La degradación crónica queda ACTIVA por default (umbral 4, `HOY_CHRONIC_THRESHOLD` para ajustar/desactivar). Justificación regla 7: bucket 4ª+ = 40.4% win / −0.05R / n=260 vs +0.3R de frescas. Solo degrada — jamás sube — así que respeta la jerarquía de decisión.
- `today_proposals.verb` guarda lo MOSTRADO (post-degradación) y `engine_action` lo crudo: el efecto forward de la regla queda medible (¿cuánto costó/ahorró degradar?).
- El backfill guarda el verbo histórico SIN degradación porque eso fue lo que se mostró — el registro es fiel, no revisionista.
- Actualizar el ledger `.superpowers/sdd/progress.md` al ejecutar, y al mergear considerar registrar la evidencia nueva en la sección 4 del prompt maestro (`docs/IA/prompt-maestro-mejora-continua.md`).
