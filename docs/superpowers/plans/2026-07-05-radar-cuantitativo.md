# Radar de ciclos cuantitativo v1 — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Radar diario de gestación de ciclos: señales computadas de ~23 ETFs de país/sector (fuerza relativa vs SPY, tendencia SMA200, fase de ciclo, proxy de flujos por sharesOutstanding), persistidas en tabla nueva, expuestas por tRPC y visibles en una tab nueva del dashboard.

**Architecture:** Spec en `docs/superpowers/specs/2026-07-05-radar-cuantitativo-design.md` (leerla ante cualquier duda). Módulo nuevo `apps/backend/src/radar/`: funciones puras (`cycle-signals.ts`) + orquestador con I/O (`cycle-radar.service.ts`) + router tRPC. Stage fire-and-forget en el pipeline (molde news-radar). Frontend: tab `radar` con tabla agrupada por fase.

**Tech Stack:** TypeScript ESM (imports `.js`), vitest, drizzle/SQLite, tRPC, React+Tailwind. Sin dependencias nuevas.

## Global Constraints

- Tests canónicos: `npm run test --workspace=apps/backend` — ÚNICO conteo válido. Baseline: **420** al 2026-07-05. JAMÁS el vitest de la raíz.
- Comentarios en español. Imports ESM con `.js`. TDD (test rojo primero) para toda lógica.
- **El radar es contexto, NUNCA señal**: no emite verbos, no toca scoring/verdicts/digest. Ningún módulo del motor debe importar de `radar/`.
- Fail-closed: dato insuficiente → null con razón, jamás clasificación inventada ni 0% falso.
- Jamás `process.env` a nivel módulo. Payloads tRPC aditivos.
- Migraciones drizzle: el `when` de la migración nueva debe ser **> 1783100605156** (journal actual termina en 0041). La migración se aplica SOLO en Task 6 (controller), con backup previo de `data/trading.db`.
- Commits terminan con `Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>`.

---

### Task 1: Funciones puras de señales (`cycle-signals.ts`)

**Files:**
- Create: `apps/backend/src/radar/cycle-signals.ts`
- Test (create): `apps/backend/src/radar/cycle-signals.test.ts`

**Interfaces:**
- Consumes: nada.
- Produces (Task 3 las consume con estas firmas EXACTAS):
  - `computeReturnPct(closes: number[], sessions: number): number | null`
  - `computeSma(closes: number[], sessions: number): number | null`
  - `computeSmaSide(closes: number[], smaSessions: number): { lado: 'arriba' | 'abajo' | null; sesionesEnLado: number | null }`
  - `computeFlowDeltaPct(sharesHistory: Array<number | null>, lookback: number): number | null`
  - `classifyCycleState(input: CycleStateInput): { state: CycleState | null; reason: string | null }`
  - Tipos: `CycleState = 'girando' | 'odiado' | 'tendencia' | 'extendido' | 'neutro'`; `CycleStateInput = { distSma200Pct: number | null; rs3m: number | null; rs6m: number | null; lado: 'arriba' | 'abajo' | null; sesionesEnLado: number | null }`
  - Constantes exportadas: `RADAR_RET_SHORT_SESSIONS = 63`, `RADAR_RET_LONG_SESSIONS = 126`, `RADAR_SMA_SESSIONS = 200`, `RADAR_EXTENDED_DIST_PCT = 20`, `RADAR_TURNING_MAX_SESSIONS = 60`, `RADAR_HATED_MIN_SESSIONS = 120`, `RADAR_FLOW_LOOKBACK = 20`

- [ ] **Step 1: Escribir tests que fallan**

Crear `apps/backend/src/radar/cycle-signals.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import {
  computeReturnPct, computeSma, computeSmaSide, computeFlowDeltaPct, classifyCycleState,
} from './cycle-signals.js';

// Serie sintética: n sesiones lineales de `desde` a `hasta`
const linear = (n: number, desde: number, hasta: number) =>
  Array.from({ length: n }, (_, i) => desde + ((hasta - desde) * i) / (n - 1));

describe('computeReturnPct', () => {
  it('retorno a N sesiones: (ultimo - close de hace N) / close de hace N', () => {
    const closes = [100, 110, 121];
    expect(computeReturnPct(closes, 2)).toBeCloseTo(21, 5);
  });

  it('historia insuficiente devuelve null (fail-closed)', () => {
    expect(computeReturnPct([100, 110], 2)).toBeNull();
    expect(computeReturnPct([], 63)).toBeNull();
  });

  it('close base <= 0 devuelve null', () => {
    expect(computeReturnPct([0, 50, 100], 2)).toBeNull();
  });
});

describe('computeSma', () => {
  it('promedio simple de las ultimas N sesiones', () => {
    expect(computeSma([1, 2, 3, 4], 2)).toBe(3.5);
  });

  it('historia insuficiente devuelve null', () => {
    expect(computeSma([1, 2], 3)).toBeNull();
  });
});

describe('computeSmaSide', () => {
  it('serie alcista sostenida: lado arriba, sesionesEnLado = ventana completa (cota inferior)', () => {
    const closes = linear(300, 100, 200); // siempre por encima de su SMA200
    const r = computeSmaSide(closes, 200);
    expect(r.lado).toBe('arriba');
    expect(r.sesionesEnLado).toBe(101); // 300 - 200 + 1 sesiones con SMA calculable
  });

  it('serie bajista sostenida: lado abajo', () => {
    const closes = linear(300, 200, 100);
    const r = computeSmaSide(closes, 200);
    expect(r.lado).toBe('abajo');
  });

  it('cruce reciente: cuenta sesiones desde el cruce, no la ventana', () => {
    // 280 sesiones cayendo fuerte + 20 sesiones de rebote violento sobre la SMA
    const closes = [...linear(280, 400, 100), ...linear(20, 300, 320)];
    const r = computeSmaSide(closes, 200);
    expect(r.lado).toBe('arriba');
    expect(r.sesionesEnLado).toBeGreaterThanOrEqual(1);
    expect(r.sesionesEnLado).toBeLessThanOrEqual(20);
  });

  it('historia insuficiente devuelve nulls', () => {
    expect(computeSmaSide(linear(150, 100, 110), 200)).toEqual({ lado: null, sesionesEnLado: null });
  });
});

describe('computeFlowDeltaPct', () => {
  it('delta % entre el ultimo y el de hace `lookback` snapshots', () => {
    const hist = [...Array(20).fill(1000), 1100]; // 21 valores
    expect(computeFlowDeltaPct(hist, 20)).toBeCloseTo(10, 5);
  });

  it('historia insuficiente devuelve null (acumulando)', () => {
    expect(computeFlowDeltaPct(Array(20).fill(1000), 20)).toBeNull();
  });

  it('null o <=0 en los extremos devuelve null (fail-closed)', () => {
    expect(computeFlowDeltaPct([null, ...Array(19).fill(1000), 1100], 20)).toBeNull();
    expect(computeFlowDeltaPct([...Array(20).fill(0), 1100], 20)).toBeNull();
  });
});

describe('classifyCycleState', () => {
  const base = { distSma200Pct: 5, rs3m: 1, rs6m: 1, lado: 'arriba' as const, sesionesEnLado: 100 };

  it('extendido: arriba de la SMA200 con distancia > 20%', () => {
    expect(classifyCycleState({ ...base, distSma200Pct: 25 }).state).toBe('extendido');
  });

  it('girando: cruce alcista hace <=60 sesiones con RS 3m positiva', () => {
    expect(classifyCycleState({ ...base, sesionesEnLado: 30, rs3m: 2 }).state).toBe('girando');
  });

  it('tendencia: arriba hace >60 sesiones con RS 3m >= 0', () => {
    expect(classifyCycleState({ ...base, sesionesEnLado: 100, rs3m: 0 }).state).toBe('tendencia');
  });

  it('odiado: abajo hace >=120 sesiones con RS 6m negativa', () => {
    expect(classifyCycleState({ ...base, lado: 'abajo', sesionesEnLado: 150, rs6m: -5 }).state).toBe('odiado');
  });

  it('neutro: lo que no matchea ninguna fase', () => {
    // abajo hace poco (ni odiado ni girando)
    expect(classifyCycleState({ ...base, lado: 'abajo', sesionesEnLado: 30, rs6m: -1 }).state).toBe('neutro');
    // arriba reciente pero RS 3m negativa (no girando)
    expect(classifyCycleState({ ...base, sesionesEnLado: 30, rs3m: -2 }).state).toBe('neutro');
  });

  it('extendido gana sobre girando (orden de precedencia del spec)', () => {
    const r = classifyCycleState({ ...base, distSma200Pct: 25, sesionesEnLado: 30, rs3m: 2 });
    expect(r.state).toBe('extendido');
  });

  it('cualquier input null => state null con reason (fail-closed)', () => {
    const r = classifyCycleState({ ...base, rs3m: null });
    expect(r.state).toBeNull();
    expect(r.reason).toContain('rs3m');
  });
});
```

- [ ] **Step 2: Correr y verificar que falla**

Run: `npm run test --workspace=apps/backend -- cycle-signals`
Expected: FAIL — módulo `./cycle-signals.js` no existe.

- [ ] **Step 3: Implementación mínima**

Crear `apps/backend/src/radar/cycle-signals.ts`:

```ts
// Señales puras del radar de ciclos — sin I/O, testeables sin mocks.
// El radar es capa de CONTEXTO: acá no hay verbos ni decisiones de trading.

export const RADAR_RET_SHORT_SESSIONS = 63;   // ~3 meses
export const RADAR_RET_LONG_SESSIONS = 126;   // ~6 meses
export const RADAR_SMA_SESSIONS = 200;
export const RADAR_EXTENDED_DIST_PCT = 20;    // > 20% sobre la SMA200 = extendido
export const RADAR_TURNING_MAX_SESSIONS = 60; // cruce alcista hace <= 60 sesiones = girando
export const RADAR_HATED_MIN_SESSIONS = 120;  // abajo hace >= 120 sesiones = odiado
export const RADAR_FLOW_LOOKBACK = 20;        // delta de sharesOutstanding a ~20 snapshots

export type CycleState = 'girando' | 'odiado' | 'tendencia' | 'extendido' | 'neutro';

export interface CycleStateInput {
  distSma200Pct: number | null;
  rs3m: number | null;
  rs6m: number | null;
  lado: 'arriba' | 'abajo' | null;
  sesionesEnLado: number | null;
}

// closes en orden ascendente (más viejo primero)
export function computeReturnPct(closes: number[], sessions: number): number | null {
  if (closes.length < sessions + 1) return null;
  const ultimo = closes[closes.length - 1];
  const base = closes[closes.length - 1 - sessions];
  if (!Number.isFinite(ultimo) || !Number.isFinite(base) || base <= 0) return null;
  return ((ultimo - base) / base) * 100;
}

export function computeSma(closes: number[], sessions: number): number | null {
  if (closes.length < sessions) return null;
  const ventana = closes.slice(-sessions);
  return ventana.reduce((a, b) => a + b, 0) / sessions;
}

// De qué lado de su SMA está el cierre y hace cuántas sesiones consecutivas.
// Si nunca cruzó dentro de la ventana calculable, el conteo es cota inferior (ventana completa).
export function computeSmaSide(
  closes: number[],
  smaSessions: number,
): { lado: 'arriba' | 'abajo' | null; sesionesEnLado: number | null } {
  if (closes.length < smaSessions) return { lado: null, sesionesEnLado: null };
  const lados: boolean[] = []; // true = arriba, por cada sesión con SMA calculable
  let suma = closes.slice(0, smaSessions).reduce((a, b) => a + b, 0);
  lados.push(closes[smaSessions - 1] > suma / smaSessions);
  for (let i = smaSessions; i < closes.length; i++) {
    suma += closes[i] - closes[i - smaSessions]; // SMA rodante O(1)
    lados.push(closes[i] > suma / smaSessions);
  }
  const actual = lados[lados.length - 1];
  let sesiones = 1;
  for (let back = lados.length - 2; back >= 0 && lados[back] === actual; back--) sesiones++;
  return { lado: actual ? 'arriba' : 'abajo', sesionesEnLado: sesiones };
}

// Delta % de sharesOutstanding entre el último snapshot y el de hace `lookback`.
// Historia insuficiente o extremos inválidos => null (acumulando / fail-closed).
export function computeFlowDeltaPct(sharesHistory: Array<number | null>, lookback: number): number | null {
  if (sharesHistory.length < lookback + 1) return null;
  const ultimo = sharesHistory[sharesHistory.length - 1];
  const base = sharesHistory[sharesHistory.length - 1 - lookback];
  if (ultimo === null || base === null || !Number.isFinite(ultimo) || !Number.isFinite(base) || base <= 0 || ultimo <= 0) return null;
  return ((ultimo - base) / base) * 100;
}

// Clasificador de fase. Precedencia del spec: extendido > girando > tendencia > odiado > neutro.
export function classifyCycleState(input: CycleStateInput): { state: CycleState | null; reason: string | null } {
  const faltantes = (['distSma200Pct', 'rs3m', 'rs6m', 'lado', 'sesionesEnLado'] as const)
    .filter(k => input[k] === null);
  if (faltantes.length > 0) {
    return { state: null, reason: `datos insuficientes: ${faltantes.join(', ')}` };
  }
  const { distSma200Pct, rs3m, rs6m, lado, sesionesEnLado } = input as {
    distSma200Pct: number; rs3m: number; rs6m: number; lado: 'arriba' | 'abajo'; sesionesEnLado: number;
  };
  if (lado === 'arriba' && distSma200Pct > RADAR_EXTENDED_DIST_PCT) return { state: 'extendido', reason: null };
  if (lado === 'arriba' && sesionesEnLado <= RADAR_TURNING_MAX_SESSIONS && rs3m > 0) return { state: 'girando', reason: null };
  if (lado === 'arriba' && sesionesEnLado > RADAR_TURNING_MAX_SESSIONS && rs3m >= 0) return { state: 'tendencia', reason: null };
  if (lado === 'abajo' && sesionesEnLado >= RADAR_HATED_MIN_SESSIONS && rs6m < 0) return { state: 'odiado', reason: null };
  return { state: 'neutro', reason: null };
}
```

- [ ] **Step 4: Correr y verificar que pasa**

Run: `npm run test --workspace=apps/backend -- cycle-signals`
Expected: PASS (18 tests).

- [ ] **Step 5: Suite completa + commit**

Run: `npm run test --workspace=apps/backend` — citar conteo EXACTO (esperado 438 = 420 + 18).

```bash
git add apps/backend/src/radar/cycle-signals.ts apps/backend/src/radar/cycle-signals.test.ts
git commit -m "feat: señales puras del radar de ciclos (RS, SMA200, lado, flujos, clasificador de fase)

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 2: sharesOutstanding en yahoo.ts + tabla drizzle + repository

**Files:**
- Modify: `apps/backend/src/shared/yahoo.ts` (función aditiva al final)
- Modify: `apps/backend/src/db/schema.ts` (tabla nueva al final)
- Modify: `apps/backend/src/db/repository.ts` (helpers al final)
- Test (modify): `apps/backend/src/db/repository.test.ts`

**Interfaces:**
- Consumes: nada de otras tasks.
- Produces (Task 3/4 consumen con estas firmas EXACTAS):
  - `getKeyStats(symbol: string): Promise<{ sharesOutstanding: number | null }>` (yahoo.ts)
  - Tabla drizzle `cycleRadarSnapshots` (schema.ts) con las columnas del spec §5.
  - Repository: `insertCycleRadarSnapshots(rows: CycleRadarSnapshotInsert[]): void`, `deleteCycleRadarSnapshotsForDate(date: string): void`, `getLatestCycleRadarDate(): string | null`, `getCycleRadarSnapshots(date: string)`, `getRadarSharesHistory(symbol: string, limit: number): Array<number | null>` (ascendente por fecha), `countCycleRadarDates(): number`.
  - Type exportado `CycleRadarSnapshotInsert` (shape del insert, sin id/createdAt).

- [ ] **Step 1: Schema drizzle**

Agregar al final de `apps/backend/src/db/schema.ts` (copiar estilo de `sectorRotationCache`):

```ts
// Radar de ciclos cuantitativo: snapshot diario por canasta (ETF). Contexto, no señal.
export const cycleRadarSnapshots = sqliteTable('cycle_radar_snapshots', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  snapshotDate: text('snapshot_date').notNull(), // YYYY-MM-DD
  symbol: text('symbol').notNull(),
  label: text('label').notNull(),
  categoria: text('categoria', { enum: ['pais', 'sector'] }).notNull(),
  close: real('close').notNull(),
  sma200: real('sma200'),
  distSma200Pct: real('dist_sma200_pct'),
  ret3m: real('ret_3m'),
  ret6m: real('ret_6m'),
  rs3m: real('rs_3m'),
  rs6m: real('rs_6m'),
  sesionesEnLado: integer('sesiones_en_lado'),
  ladoSma: text('lado_sma', { enum: ['arriba', 'abajo'] }),
  sharesOutstanding: real('shares_outstanding'),
  flowDelta20d: real('flow_delta_20d'),
  cycleState: text('cycle_state', { enum: ['girando', 'odiado', 'tendencia', 'extendido', 'neutro'] }),
  stateReason: text('state_reason'),
  createdAt: text('created_at').notNull().default(sql`(datetime('now'))`),
});
```

- [ ] **Step 2: Generar la migración y verificar el journal**

Run (desde `apps/backend`): `npm run db:generate`
Verificar: existe `apps/backend/drizzle/0042_*.sql` con el CREATE TABLE, y en `apps/backend/drizzle/meta/_journal.json` la entrada nueva tiene `when` **> 1783100605156**. NO correr `db:migrate` en esta task (se aplica en Task 6 con backup).

- [ ] **Step 3: Tests que fallan (repository puro + shape)**

En `apps/backend/src/db/repository.test.ts`, sumar al import de línea 2 `buildRadarSharesHistory` y agregar al final:

```ts
describe('buildRadarSharesHistory', () => {
  it('mapea filas (fecha asc) a la serie de sharesOutstanding preservando nulls', () => {
    const rows = [
      { snapshotDate: '2026-07-01', sharesOutstanding: 1000 },
      { snapshotDate: '2026-07-02', sharesOutstanding: null },
      { snapshotDate: '2026-07-03', sharesOutstanding: 1010 },
    ];
    expect(buildRadarSharesHistory(rows)).toEqual([1000, null, 1010]);
  });

  it('lista vacía devuelve serie vacía', () => {
    expect(buildRadarSharesHistory([])).toEqual([]);
  });
});
```

Run: `npm run test --workspace=apps/backend -- repository` → FAIL (no existe `buildRadarSharesHistory`).

- [ ] **Step 4: Repository + yahoo**

Al final de `apps/backend/src/db/repository.ts` (sección `// ==================== CYCLE RADAR ====================`):

```ts
export interface CycleRadarSnapshotInsert {
  snapshotDate: string;
  symbol: string;
  label: string;
  categoria: 'pais' | 'sector';
  close: number;
  sma200: number | null;
  distSma200Pct: number | null;
  ret3m: number | null;
  ret6m: number | null;
  rs3m: number | null;
  rs6m: number | null;
  sesionesEnLado: number | null;
  ladoSma: 'arriba' | 'abajo' | null;
  sharesOutstanding: number | null;
  flowDelta20d: number | null;
  cycleState: 'girando' | 'odiado' | 'tendencia' | 'extendido' | 'neutro' | null;
  stateReason: string | null;
}

export function insertCycleRadarSnapshots(rows: CycleRadarSnapshotInsert[]) {
  if (rows.length === 0) return;
  db.insert(schema.cycleRadarSnapshots).values(rows).run();
}

export function deleteCycleRadarSnapshotsForDate(date: string) {
  db.delete(schema.cycleRadarSnapshots).where(eq(schema.cycleRadarSnapshots.snapshotDate, date)).run();
}

export function getLatestCycleRadarDate(): string | null {
  const row = db.select({ d: schema.cycleRadarSnapshots.snapshotDate }).from(schema.cycleRadarSnapshots)
    .orderBy(desc(schema.cycleRadarSnapshots.snapshotDate)).limit(1).get();
  return row?.d ?? null;
}

export function getCycleRadarSnapshots(date: string) {
  return db.select().from(schema.cycleRadarSnapshots)
    .where(eq(schema.cycleRadarSnapshots.snapshotDate, date))
    .all();
}

// Pura (sin I/O): filas ordenadas por fecha asc -> serie de sharesOutstanding.
export function buildRadarSharesHistory(rows: Array<{ snapshotDate: string; sharesOutstanding: number | null }>): Array<number | null> {
  return rows.map(r => r.sharesOutstanding);
}

export function getRadarSharesHistory(symbol: string, limit: number): Array<number | null> {
  const rows = db.select({
    snapshotDate: schema.cycleRadarSnapshots.snapshotDate,
    sharesOutstanding: schema.cycleRadarSnapshots.sharesOutstanding,
  }).from(schema.cycleRadarSnapshots)
    .where(eq(schema.cycleRadarSnapshots.symbol, symbol))
    .orderBy(desc(schema.cycleRadarSnapshots.snapshotDate)).limit(limit).all();
  return buildRadarSharesHistory(rows.reverse());
}

export function countCycleRadarDates(): number {
  const rows = db.selectDistinct({ d: schema.cycleRadarSnapshots.snapshotDate }).from(schema.cycleRadarSnapshots).all();
  return rows.length;
}
```

(Si `selectDistinct` no existe en la versión de drizzle del repo, usar `db.select({ d: ... }).from(...).groupBy(schema.cycleRadarSnapshots.snapshotDate).all()`.)

Al final de `apps/backend/src/shared/yahoo.ts`, función aditiva que copia el patrón autenticado (crumb+cookie) de `getInsiderTransactions` (líneas ~600-679 — LEER esa función y replicar su manejo de `ensureCrumb()` y errores):

```ts
/**
 * sharesOutstanding vía quoteSummary/defaultKeyStatistics.
 * Fail-closed: cualquier error o dato faltante => null (el radar lo trata como "sin dato").
 */
export async function getKeyStats(symbol: string): Promise<{ sharesOutstanding: number | null }> {
  try {
    // mismo endpoint autenticado que getInsiderTransactions, módulo defaultKeyStatistics
    // (replicar ensureCrumb() + headers + shape de respuesta de esa función)
    const stats = /* quoteSummary(symbol, 'defaultKeyStatistics') */;
    const raw = extractRaw(stats, 'sharesOutstanding');
    return { sharesOutstanding: typeof raw === 'number' && Number.isFinite(raw) && raw > 0 ? raw : null };
  } catch {
    return { sharesOutstanding: null };
  }
}
```

(El bloque comentado es pseudocódigo a propósito: el implementador DEBE copiar el mecanismo real de `getInsiderTransactions`/`ensureCrumb` del propio archivo — no inventar el fetch. `extractRaw` ya existe en yahoo.ts:346.)

- [ ] **Step 5: Verificar tests + typecheck + commit**

Run: `npm run test --workspace=apps/backend -- repository` → PASS. `npm run typecheck` limpio. Suite completa: citar conteo EXACTO (esperado 440 = 438 + 2).

```bash
git add apps/backend/src/db/schema.ts apps/backend/src/db/repository.ts apps/backend/src/db/repository.test.ts apps/backend/src/shared/yahoo.ts apps/backend/drizzle/
git commit -m "feat: tabla cycle_radar_snapshots + repository + getKeyStats (sharesOutstanding)

Migración 0042 generada, NO aplicada (se aplica en verificación e2e con backup).

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 3: Orquestador `runCycleRadar()` + wiring en pipeline

**Files:**
- Create: `apps/backend/src/radar/cycle-radar.service.ts`
- Test (create): `apps/backend/src/radar/cycle-radar.service.test.ts`
- Modify: `apps/backend/src/intelligence/pipeline.service.ts` (bloque fire-and-forget después de `runMarketScreener()`, ~línea 580)

**Interfaces:**
- Consumes: Task 1 (todas las puras y constantes de `cycle-signals.js`), Task 2 (`getKeyStats` de `../shared/yahoo.js`; `insertCycleRadarSnapshots`, `deleteCycleRadarSnapshotsForDate`, `getRadarSharesHistory`, type `CycleRadarSnapshotInsert` de `../db/repository.js`). También existentes: `getHistoricalQuotes(symbol, range, interval)` de `../shared/yahoo.js`, `getToday()` de `../shared/date-utils.js`.
- Produces: `runCycleRadar(): Promise<{ date: string; persisted: number; skipped: string[] }>` y `RADAR_UNIVERSE` exportados.

- [ ] **Step 1: Tests que fallan (mocks estilo market-screener.service.test.ts — LEER ese archivo y copiar el patrón vi.mock)**

Crear `apps/backend/src/radar/cycle-radar.service.test.ts`:

```ts
import { describe, it, expect, vi, beforeEach } from 'vitest';

const mockGetHistoricalQuotes = vi.fn();
const mockGetKeyStats = vi.fn();
vi.mock('../shared/yahoo.js', () => ({
  getHistoricalQuotes: (...args: unknown[]) => mockGetHistoricalQuotes(...args),
  getKeyStats: (...args: unknown[]) => mockGetKeyStats(...args),
}));

const mockInsert = vi.fn();
const mockDeleteForDate = vi.fn();
const mockSharesHistory = vi.fn();
vi.mock('../db/repository.js', () => ({
  insertCycleRadarSnapshots: (...args: unknown[]) => mockInsert(...args),
  deleteCycleRadarSnapshotsForDate: (...args: unknown[]) => mockDeleteForDate(...args),
  getRadarSharesHistory: (...args: unknown[]) => mockSharesHistory(...args),
}));

import { runCycleRadar, RADAR_UNIVERSE } from './cycle-radar.service.js';

// 350 velas alcistas sintéticas (suficientes para SMA200 y ret6m)
const velas = (desde: number, hasta: number, n = 350) =>
  Array.from({ length: n }, (_, i) => ({
    date: `2025-01-${(i % 28) + 1}`, open: 0, high: 0, low: 0, volume: 0,
    close: desde + ((hasta - desde) * i) / (n - 1),
  }));

beforeEach(() => {
  mockGetHistoricalQuotes.mockReset();
  mockGetKeyStats.mockReset();
  mockInsert.mockReset();
  mockDeleteForDate.mockReset();
  mockSharesHistory.mockReset();
  mockGetKeyStats.mockResolvedValue({ sharesOutstanding: 1000000 });
  mockSharesHistory.mockReturnValue([]);
});

describe('runCycleRadar', () => {
  it('persiste un snapshot por canasta del universo con delete previo (idempotente)', async () => {
    mockGetHistoricalQuotes.mockResolvedValue(velas(100, 200));
    const r = await runCycleRadar();
    expect(mockDeleteForDate).toHaveBeenCalledTimes(1);
    expect(mockInsert).toHaveBeenCalledTimes(1);
    const rows = mockInsert.mock.calls[0][0];
    expect(rows).toHaveLength(RADAR_UNIVERSE.length);
    expect(r.persisted).toBe(RADAR_UNIVERSE.length);
    expect(r.skipped).toEqual([]);
    // serie alcista sostenida => tendencia o extendido, jamás null silencioso
    expect(rows.every((row: { cycleState: string | null }) => row.cycleState !== null)).toBe(true);
  });

  it('si SPY falla, aborta honesto sin persistir nada (fail-closed)', async () => {
    mockGetHistoricalQuotes.mockRejectedValue(new Error('yahoo caido'));
    const r = await runCycleRadar();
    expect(r.persisted).toBe(0);
    expect(mockInsert).not.toHaveBeenCalled();
    expect(mockDeleteForDate).not.toHaveBeenCalled();
  });

  it('el fallo de una canasta la manda a skipped sin frenar al resto', async () => {
    mockGetHistoricalQuotes.mockImplementation((symbol: string) => {
      if (symbol === RADAR_UNIVERSE[0].symbol) return Promise.reject(new Error('timeout'));
      return Promise.resolve(velas(100, 200));
    });
    const r = await runCycleRadar();
    expect(r.persisted).toBe(RADAR_UNIVERSE.length - 1);
    expect(r.skipped).toHaveLength(1);
    expect(r.skipped[0]).toContain(RADAR_UNIVERSE[0].symbol);
  });

  it('getKeyStats que falla no voltea la canasta: sharesOutstanding null y flow null', async () => {
    mockGetHistoricalQuotes.mockResolvedValue(velas(100, 200));
    mockGetKeyStats.mockResolvedValue({ sharesOutstanding: null });
    await runCycleRadar();
    const rows = mockInsert.mock.calls[0][0];
    expect(rows[0].sharesOutstanding).toBeNull();
    expect(rows[0].flowDelta20d).toBeNull();
  });

  it('el universo tiene 23 canastas con labels y categorias validas', () => {
    expect(RADAR_UNIVERSE).toHaveLength(23);
    expect(RADAR_UNIVERSE.every(b => b.label.length > 0 && ['pais', 'sector'].includes(b.categoria))).toBe(true);
    expect(RADAR_UNIVERSE.some(b => b.symbol === 'SPY')).toBe(false); // SPY es benchmark, no canasta
  });
});
```

Run: `npm run test --workspace=apps/backend -- cycle-radar.service` → FAIL (módulo no existe).

- [ ] **Step 2: Implementar el servicio**

Crear `apps/backend/src/radar/cycle-radar.service.ts`:

```ts
// Radar de ciclos cuantitativo: contexto medible de dónde se gesta un ciclo. NO emite señales.
import { getHistoricalQuotes, getKeyStats } from '../shared/yahoo.js';
import { getToday } from '../shared/date-utils.js';
import {
  insertCycleRadarSnapshots, deleteCycleRadarSnapshotsForDate, getRadarSharesHistory,
  type CycleRadarSnapshotInsert,
} from '../db/repository.js';
import {
  computeReturnPct, computeSma, computeSmaSide, computeFlowDeltaPct, classifyCycleState,
  RADAR_RET_SHORT_SESSIONS, RADAR_RET_LONG_SESSIONS, RADAR_SMA_SESSIONS, RADAR_FLOW_LOOKBACK,
} from './cycle-signals.js';

const BENCHMARK = 'SPY';
const CANDLE_RANGE = '2y'; // la SMA200 necesita ventana amplia para conocer el "lado" (ver spec)

export const RADAR_UNIVERSE: Array<{ symbol: string; label: string; categoria: 'pais' | 'sector' }> = [
  { symbol: 'ARGT', label: 'Argentina', categoria: 'pais' },
  { symbol: 'EWZ', label: 'Brasil', categoria: 'pais' },
  { symbol: 'EWW', label: 'México', categoria: 'pais' },
  { symbol: 'ECH', label: 'Chile', categoria: 'pais' },
  { symbol: 'EPU', label: 'Perú', categoria: 'pais' },
  { symbol: 'INDA', label: 'India', categoria: 'pais' },
  { symbol: 'EWJ', label: 'Japón', categoria: 'pais' },
  { symbol: 'MCHI', label: 'China', categoria: 'pais' },
  { symbol: 'EWG', label: 'Alemania', categoria: 'pais' },
  { symbol: 'EWU', label: 'Reino Unido', categoria: 'pais' },
  { symbol: 'EEM', label: 'Emergentes', categoria: 'pais' },
  { symbol: 'XLU', label: 'Utilities US', categoria: 'sector' },
  { symbol: 'XLE', label: 'Energía US', categoria: 'sector' },
  { symbol: 'XLF', label: 'Finanzas US', categoria: 'sector' },
  { symbol: 'XBI', label: 'Biotech', categoria: 'sector' },
  { symbol: 'SMH', label: 'Semiconductores', categoria: 'sector' },
  { symbol: 'ITA', label: 'Defensa', categoria: 'sector' },
  { symbol: 'COPX', label: 'Mineras de cobre', categoria: 'sector' },
  { symbol: 'URA', label: 'Uranio', categoria: 'sector' },
  { symbol: 'LIT', label: 'Litio', categoria: 'sector' },
  { symbol: 'GDX', label: 'Mineras de oro', categoria: 'sector' },
  { symbol: 'TAN', label: 'Solar', categoria: 'sector' },
  { symbol: 'XME', label: 'Metales y minería', categoria: 'sector' },
];

export async function runCycleRadar(): Promise<{ date: string; persisted: number; skipped: string[] }> {
  const date = getToday();

  // Benchmark primero: sin SPY no hay fuerza relativa => abort honesto (fail-closed).
  let spyRet3m: number | null = null;
  let spyRet6m: number | null = null;
  try {
    const spyCloses = (await getHistoricalQuotes(BENCHMARK, CANDLE_RANGE, '1d')).map(c => c.close);
    spyRet3m = computeReturnPct(spyCloses, RADAR_RET_SHORT_SESSIONS);
    spyRet6m = computeReturnPct(spyCloses, RADAR_RET_LONG_SESSIONS);
  } catch (err) {
    console.warn('[radar] SPY sin datos, radar abortado:', (err as Error).message);
    return { date, persisted: 0, skipped: [`${BENCHMARK}: ${(err as Error).message}`] };
  }
  if (spyRet3m === null || spyRet6m === null) {
    console.warn('[radar] SPY con historia insuficiente, radar abortado');
    return { date, persisted: 0, skipped: [`${BENCHMARK}: historia insuficiente`] };
  }

  const rows: CycleRadarSnapshotInsert[] = [];
  const skipped: string[] = [];

  for (const basket of RADAR_UNIVERSE) {
    try {
      const candles = await getHistoricalQuotes(basket.symbol, CANDLE_RANGE, '1d');
      const closes = candles.map(c => c.close);
      if (closes.length === 0) throw new Error('sin velas');
      const close = closes[closes.length - 1];

      const ret3m = computeReturnPct(closes, RADAR_RET_SHORT_SESSIONS);
      const ret6m = computeReturnPct(closes, RADAR_RET_LONG_SESSIONS);
      const rs3m = ret3m === null ? null : ret3m - spyRet3m;
      const rs6m = ret6m === null ? null : ret6m - spyRet6m;
      const sma200 = computeSma(closes, RADAR_SMA_SESSIONS);
      const distSma200Pct = sma200 === null || sma200 <= 0 ? null : ((close - sma200) / sma200) * 100;
      const { lado, sesionesEnLado } = computeSmaSide(closes, RADAR_SMA_SESSIONS);
      const { state, reason } = classifyCycleState({ distSma200Pct, rs3m, rs6m, lado, sesionesEnLado });

      const { sharesOutstanding } = await getKeyStats(basket.symbol);
      const historia = getRadarSharesHistory(basket.symbol, RADAR_FLOW_LOOKBACK + 1);
      const flowDelta20d = computeFlowDeltaPct([...historia, sharesOutstanding], RADAR_FLOW_LOOKBACK);

      rows.push({
        snapshotDate: date, symbol: basket.symbol, label: basket.label, categoria: basket.categoria,
        close, sma200, distSma200Pct, ret3m, ret6m, rs3m, rs6m,
        sesionesEnLado, ladoSma: lado, sharesOutstanding, flowDelta20d,
        cycleState: state, stateReason: reason,
      });
    } catch (err) {
      skipped.push(`${basket.symbol}: ${(err as Error).message}`);
    }
  }

  if (rows.length > 0) {
    deleteCycleRadarSnapshotsForDate(date);
    insertCycleRadarSnapshots(rows);
  }
  if (skipped.length > 0) console.warn(`[radar] canastas sin datos: ${skipped.join('; ')}`);
  return { date, persisted: rows.length, skipped };
}
```

Nota para el implementador: si el test de idempotencia espera `deleteForDate` incluso con 0 filas, ajustar el test, no el servicio — el servicio NO debe borrar el snapshot previo del día si hoy no pudo computar nada (conservar el último dato bueno es el comportamiento fail-closed correcto). El test de arriba ya respeta esto (`mockDeleteForDate` not.toHaveBeenCalled en el caso SPY-falla).

- [ ] **Step 3: Wiring en pipeline (fire-and-forget, molde news-radar de pipeline.service.ts:532-543)**

En `apps/backend/src/intelligence/pipeline.service.ts`, inmediatamente DESPUÉS del bloque try/catch de `runMarketScreener()` (~línea 580), agregar:

```ts
    // Radar de ciclos: contexto cuantitativo diario (no señal). Fire-and-forget:
    // un fallo de Yahoo acá no puede tocar el estado de la corrida del pipeline.
    void (async () => {
      try {
        const radar = await runCycleRadar();
        console.log(`[pipeline] cycle radar: ${radar.persisted} canastas persistidas (${radar.date})`);
      } catch (err) {
        console.warn('[pipeline] runCycleRadar failed (non-blocking):', (err as Error).message);
      }
    })();
```

Con su import arriba: `import { runCycleRadar } from '../radar/cycle-radar.service.js';`

- [ ] **Step 4: Verificar + commit**

Run: `npm run test --workspace=apps/backend -- cycle-radar.service` → PASS (5 tests). `npm run typecheck` limpio. Suite completa: citar conteo EXACTO (esperado 445 = 440 + 5).

```bash
git add apps/backend/src/radar/cycle-radar.service.ts apps/backend/src/radar/cycle-radar.service.test.ts apps/backend/src/intelligence/pipeline.service.ts
git commit -m "feat: runCycleRadar — orquestador del radar + stage fire-and-forget en pipeline

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 4: Router tRPC

**Files:**
- Create: `apps/backend/src/radar/radar.router.ts`
- Modify: `apps/backend/src/router.ts` (registro aditivo)

**Interfaces:**
- Consumes: Task 2 (`getLatestCycleRadarDate`, `getCycleRadarSnapshots`, `countCycleRadarDates` de `../db/repository.js`). Existentes: `router`, `publicProcedure` de `../trpc.js` (molde: `macro.router.ts`).
- Produces: procedure `radar.getLatest` → `{ date: string | null, snapshots: CycleRadarRow[], historyDays: number }` (snapshots = filas crudas de la tabla; payload aditivo, sin wrappers).

- [ ] **Step 1: Implementar (sin test propio: es glue de 15 líneas — la lógica ya está testeada en repository; el typecheck y la verificación e2e de Task 6 lo cubren)**

Crear `apps/backend/src/radar/radar.router.ts`:

```ts
import { router, publicProcedure } from '../trpc.js';
import { getLatestCycleRadarDate, getCycleRadarSnapshots, countCycleRadarDates } from '../db/repository.js';

export const radarRouter = router({
  getLatest: publicProcedure.query(() => {
    const date = getLatestCycleRadarDate();
    if (!date) return { date: null, snapshots: [], historyDays: 0 };
    return { date, snapshots: getCycleRadarSnapshots(date), historyDays: countCycleRadarDates() };
  }),
});
```

En `apps/backend/src/router.ts`: agregar `import { radarRouter } from './radar/radar.router.js';` y la key `radar: radarRouter,` en el objeto del appRouter (aditivo, no tocar las demás).

- [ ] **Step 2: Verificar + commit**

Run: `npm run typecheck` limpio; suite completa sin cambios de conteo (citar EXACTO).

```bash
git add apps/backend/src/radar/radar.router.ts apps/backend/src/router.ts
git commit -m "feat: endpoint tRPC radar.getLatest

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 5: Frontend — tab "Radar" con la tabla de fases

**Files:**
- Create: `apps/frontend/src/radar/CycleRadarPage.tsx`
- Modify: `apps/frontend/src/App.tsx` (tab nueva: `VALID_TABS`, `TabsTrigger`, `TabsContent`)

**Interfaces:**
- Consumes: `trpc.radar.getLatest.useQuery()` (Task 4); `trpc` de `../shared/trpc` (ver import exacto en `SectorRotationWidget.tsx`); componentes UI existentes (`Card`, `Badge` — copiar imports de `SectorRotationWidget.tsx`).
- Produces: página visible.

- [ ] **Step 1: Componente**

Crear `apps/frontend/src/radar/CycleRadarPage.tsx` (ajustar imports de UI al patrón real de `SectorRotationWidget.tsx` — LEERLO antes):

```tsx
import { trpc } from '../shared/trpc';
import { Card, CardContent, CardHeader, CardTitle } from '../components/ui/card';
import { Badge } from '../components/ui/badge';

// Orden y estilo por fase: girando (lo que busca el radar) primero.
const FASES: Array<{ key: string; titulo: string; badge: string; descripcion: string }> = [
  { key: 'girando', titulo: 'Girando', badge: 'bg-emerald-600', descripcion: 'Cruce alcista reciente de SMA200 con fuerza relativa positiva — gestación confirmándose' },
  { key: 'odiado', titulo: 'Odiado', badge: 'bg-sky-700', descripcion: 'Abajo de la SMA200 hace ≥120 sesiones con RS 6m negativa — candidato a vigilar, no a comprar' },
  { key: 'tendencia', titulo: 'Tendencia', badge: 'bg-teal-600', descripcion: 'Arriba de la SMA200 hace >60 sesiones con RS no negativa' },
  { key: 'neutro', titulo: 'Neutro', badge: 'bg-zinc-500', descripcion: 'Sin fase definida' },
  { key: 'extendido', titulo: 'Extendido', badge: 'bg-amber-600', descripcion: '>20% sobre la SMA200 — tarde para gestación' },
];

const fmt = (v: number | null, suffix = '%') => (v === null ? '—' : `${v > 0 ? '+' : ''}${v.toFixed(1)}${suffix}`);

export function CycleRadarPage() {
  const { data, isLoading } = trpc.radar.getLatest.useQuery(undefined, { refetchInterval: 5 * 60 * 1000 });

  if (isLoading) return <div className="p-4 text-sm text-muted-foreground">Cargando radar…</div>;
  if (!data || !data.date) {
    return (
      <Card>
        <CardContent className="p-4 text-sm text-muted-foreground">
          Sin snapshots del radar todavía — se genera con el pipeline diario (o corrida manual).
        </CardContent>
      </Card>
    );
  }

  const hoy = new Date().toISOString().slice(0, 10);
  const porFase = new Map<string, typeof data.snapshots>();
  for (const s of data.snapshots) {
    const key = s.cycleState ?? 'sin-datos';
    if (!porFase.has(key)) porFase.set(key, []);
    porFase.get(key)!.push(s);
  }

  return (
    <div className="space-y-4">
      <Card>
        <CardContent className="p-3 text-xs text-muted-foreground">
          <span className="font-semibold">Contexto de ciclos — NO es señal de entrada.</span>{' '}
          Los setups los decide el scan de siempre. Snapshot: {data.date}
          {data.date < hoy && <span className="text-amber-600"> (dato de un día anterior)</span>}
          {' · '}Flujos: {data.historyDays >= 21 ? 'activos' : `acumulando historia (${data.historyDays}/21 días)`}
        </CardContent>
      </Card>

      {FASES.map(fase => {
        const filas = porFase.get(fase.key) ?? [];
        if (filas.length === 0) return null;
        return (
          <Card key={fase.key}>
            <CardHeader className="pb-2">
              <CardTitle className="flex items-center gap-2 text-base">
                <Badge className={fase.badge}>{fase.titulo}</Badge>
                <span className="text-xs font-normal text-muted-foreground">{fase.descripcion}</span>
              </CardTitle>
            </CardHeader>
            <CardContent className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="text-left text-xs text-muted-foreground">
                    <th className="py-1 pr-3">Canasta</th>
                    <th className="py-1 pr-3">Tipo</th>
                    <th className="py-1 pr-3 text-right">RS 3m</th>
                    <th className="py-1 pr-3 text-right">RS 6m</th>
                    <th className="py-1 pr-3 text-right">vs SMA200</th>
                    <th className="py-1 pr-3 text-right">Flujo 20d</th>
                    <th className="py-1 text-right">Sesiones en lado</th>
                  </tr>
                </thead>
                <tbody>
                  {filas.map(s => (
                    <tr key={s.symbol} className="border-t border-border/40">
                      <td className="py-1.5 pr-3 font-medium">{s.label} <span className="text-xs text-muted-foreground">{s.symbol}</span></td>
                      <td className="py-1.5 pr-3 text-xs">{s.categoria === 'pais' ? 'País' : 'Sector'}</td>
                      <td className={`py-1.5 pr-3 text-right ${(s.rs3m ?? 0) > 0 ? 'text-emerald-600' : 'text-red-500'}`}>{fmt(s.rs3m, ' pp')}</td>
                      <td className={`py-1.5 pr-3 text-right ${(s.rs6m ?? 0) > 0 ? 'text-emerald-600' : 'text-red-500'}`}>{fmt(s.rs6m, ' pp')}</td>
                      <td className="py-1.5 pr-3 text-right">{fmt(s.distSma200Pct)}</td>
                      <td className="py-1.5 pr-3 text-right">{s.flowDelta20d === null ? 'acumulando' : fmt(s.flowDelta20d)}</td>
                      <td className="py-1.5 text-right">{s.sesionesEnLado ?? '—'}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </CardContent>
          </Card>
        );
      })}

      {(porFase.get('sin-datos') ?? []).length > 0 && (
        <Card>
          <CardHeader className="pb-2"><CardTitle className="text-base">Sin datos suficientes</CardTitle></CardHeader>
          <CardContent className="text-sm text-muted-foreground">
            {(porFase.get('sin-datos') ?? []).map(s => (
              <div key={s.symbol}>{s.label} ({s.symbol}): {s.stateReason ?? 'sin razón registrada'}</div>
            ))}
          </CardContent>
        </Card>
      )}
    </div>
  );
}
```

- [ ] **Step 2: Montaje en App.tsx**

En `apps/frontend/src/App.tsx`: agregar `'radar'` a `VALID_TABS` (línea ~22), un `<TabsTrigger value="radar">Radar</TabsTrigger>` junto a los existentes, y `<TabsContent value="radar"><CycleRadarPage /></TabsContent>` junto a los demás (líneas ~139-153), con su import. Copiar EXACTAMENTE el estilo de los triggers/contents existentes.

- [ ] **Step 3: Verificar + commit**

Run: `npm run build:shared && npm run typecheck` — limpio en los 3 workspaces (el typecheck del frontend valida el componente contra el tipo real del router). Suite backend sin cambios (citar conteo).

```bash
git add apps/frontend/src/radar/CycleRadarPage.tsx apps/frontend/src/App.tsx
git commit -m "feat: tab Radar — tabla de fases de ciclo por canasta (contexto, no señal)

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 6: Verificación e2e (la ejecuta el CONTROLLER, no un subagente)

- [ ] **Step 1**: Backup + migración sobre la DB real: `cp data/trading.db data/trading.db.bak-radar-$(date +%Y%m%d)` → `npm run db:migrate --workspace=apps/backend` → verificar con sqlite3 que `cycle_radar_snapshots` existe con todas las columnas (`PRAGMA table_info`).
- [ ] **Step 2**: One-shot real: script temporal `npx tsx` desde `apps/backend` con `dotenv.config({ path: '../../.env' })` que llame `runCycleRadar()`; verificar ~23 filas del día en la tabla con estados coherentes (SMH probablemente `tendencia`/`extendido`; el flujo debe ser null con reason de acumulación). Borrar el script.
- [ ] **Step 3**: Levantar el backend y curl al endpoint tRPC `radar.getLatest` → JSON con snapshots.
- [ ] **Step 4**: Coherencia: `grep -rn "radar/" apps/backend/src --include="*.ts" | grep -v "src/radar" | grep -v test` — solo pipeline.service (wiring) y router.ts deben importar del módulo.
- [ ] **Step 5**: Suite completa + typecheck monorepo, citar conteos. Review final whole-branch (modelo más capaz). **NO mergear**: dejar el branch listo y el veredicto en el ledger.
