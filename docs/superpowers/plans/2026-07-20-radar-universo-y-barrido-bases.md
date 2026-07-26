# Puente Radar→Universo + Barrido Semanal de Bases — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Cerrar los dos puntos ciegos de cobertura del universo de scan: (1) sectores que el radar detecta "girando" nominan sus constituyentes al scan; (2) barrido semanal del S&P500 detecta acciones haciendo piso silencioso (caso IREN) antes de que aparezcan en noticias o movers.

**Architecture:** Ambos caños son NOMINADORES, no señales: inyectan símbolos en `discovered_symbols` vía `registerNovelTickers` con source propio (`'radar'` / `'base_sweep'`), y el embudo normal (anti-hype → scoring → niveles) decide. Cada source queda medible en `signal_tracking` por join — cada caño es un experimento, no una convicción.

**Tech Stack:** TypeScript ESM (imports con `.js`), vitest, drizzle/better-sqlite3, node-cron, Yahoo vía `shared/yahoo.ts`.

## Global Constraints

- Regla #1 fail-closed: dato faltante = rechazo/skip honesto, jamás pass silencioso.
- Regla #3: toda constante configurable vía `envNumber(...)` DENTRO de la función (jamás `process.env` a nivel módulo).
- Regla #5: comentarios en español, imports ESM con `.js`, TDD (test rojo primero), funciones de decisión puras (sin I/O).
- Regla #7: los caños nuevos NO tocan pesos/umbrales del scoring — solo agregan candidatos al universo.
- El radar sigue sin decidir acciones (regla del proyecto): solo nomina símbolos para escanear.
- Tests: `npm run test --workspace=apps/backend` (jamás vitest desde la raíz).
- Branch: `feat/universo-cobertura` (desde `feat/peg-vote`).
- Sin migraciones de DB: `discovered_from` ya es TEXT libre; solo se amplía el union type de TS.

---

### Task 0: Branch

- [ ] **Step 1: Crear branch**

```bash
cd /Users/federicocroce/Docu/Fede/trading
git checkout feat/peg-vote && git checkout -b feat/universo-cobertura
```

---

### Task 1: Constituyentes del radar + selector puro

**Files:**
- Create: `apps/backend/src/discovery/radar-constituents.ts`
- Test: `apps/backend/src/discovery/radar-constituents.test.ts`

**Interfaces:**
- Produces: `RADAR_CONSTITUENTS: Record<string, string[]>` (ETF → constituyentes) y `selectRadarNominees(rows: Array<{ symbol: string; categoria: string; cycleState: string | null }>, snapshotDate: string | null, today: string): string[]`. Task 2 los consume tal cual.

- [ ] **Step 1: Test rojo**

```typescript
// apps/backend/src/discovery/radar-constituents.test.ts
import { describe, it, expect } from 'vitest';
import { selectRadarNominees, RADAR_CONSTITUENTS } from './radar-constituents.js';

const row = (symbol: string, cycleState: string | null, categoria = 'sector') =>
  ({ symbol, categoria, cycleState });

describe('selectRadarNominees', () => {
  it('sector girando nomina sus constituyentes', () => {
    const out = selectRadarNominees([row('XLF', 'girando')], '2026-07-20', '2026-07-20');
    expect(out).toEqual(RADAR_CONSTITUENTS['XLF']);
    expect(out.length).toBeGreaterThanOrEqual(8);
  });

  it('sectores no-girando no nominan nada', () => {
    const rows = [row('SMH', 'extendido'), row('XLE', 'neutro'), row('GDX', null)];
    expect(selectRadarNominees(rows, '2026-07-20', '2026-07-20')).toEqual([]);
  });

  it('categoría país girando NO nomina (v1 = solo sectores)', () => {
    expect(selectRadarNominees([row('ARGT', 'girando', 'pais')], '2026-07-20', '2026-07-20')).toEqual([]);
  });

  it('snapshot viejo (>7 días) no nomina — fail-closed contra radar caído', () => {
    expect(selectRadarNominees([row('XLF', 'girando')], '2026-07-10', '2026-07-20')).toEqual([]);
  });

  it('snapshotDate null no nomina — fail-closed', () => {
    expect(selectRadarNominees([row('XLF', 'girando')], null, '2026-07-20')).toEqual([]);
  });

  it('dos sectores girando dedupean constituyentes compartidos', () => {
    // FCX está en COPX y XME
    const out = selectRadarNominees([row('COPX', 'girando'), row('XME', 'girando')], '2026-07-20', '2026-07-20');
    expect(out.filter((s) => s === 'FCX').length).toBe(1);
  });

  it('ETF girando sin mapa de constituyentes no rompe (skip silencioso con lista vacía)', () => {
    expect(selectRadarNominees([row('XXXX', 'girando')], '2026-07-20', '2026-07-20')).toEqual([]);
  });
});
```

- [ ] **Step 2: Verificar RED**

Run: `npm run test --workspace=apps/backend -- src/discovery/radar-constituents.test.ts`
Expected: FAIL — `Cannot find module './radar-constituents.js'`

- [ ] **Step 3: Implementación mínima**

```typescript
// apps/backend/src/discovery/radar-constituents.ts
/**
 * Puente radar→universo: cuando un sector del radar de ciclos pasa a "girando",
 * sus constituyentes líquidos entran al universo del scan como NOMINADOS
 * (source='radar'). El radar NO decide acciones — solo nomina candidatos;
 * el embudo normal (anti-hype → scoring → niveles) decide.
 *
 * Lista curada a mano (top holdings líquidos de cada ETF sectorial del radar).
 * Refresh manual esperable ~1 vez/año; registerNovelTickers valida contra Yahoo
 * así que un ticker desactualizado se descarta solo.
 */
export const RADAR_CONSTITUENTS: Record<string, string[]> = {
  XLF: ['JPM', 'BAC', 'WFC', 'GS', 'MS', 'AXP', 'SCHW', 'C', 'BLK', 'SPGI'],
  SMH: ['NVDA', 'TSM', 'AVGO', 'AMD', 'QCOM', 'MU', 'INTC', 'AMAT', 'ASML', 'LRCX'],
  XBI: ['VRTX', 'REGN', 'GILD', 'AMGN', 'BIIB', 'MRNA', 'ALNY', 'SRPT', 'INCY', 'EXEL'],
  XLE: ['XOM', 'CVX', 'COP', 'EOG', 'SLB', 'MPC', 'PSX', 'VLO', 'OXY', 'WMB'],
  XLU: ['NEE', 'DUK', 'SO', 'D', 'AEP', 'EXC', 'SRE', 'XEL', 'ED', 'PEG'],
  ITA: ['GE', 'RTX', 'BA', 'LMT', 'NOC', 'GD', 'HWM', 'LHX', 'TDG', 'AXON'],
  COPX: ['FCX', 'SCCO', 'TECK', 'HBM', 'ERO'],
  URA: ['CCJ', 'NXE', 'UEC', 'DNN', 'LEU', 'UUUU'],
  LIT: ['ALB', 'SQM', 'LAC', 'SGML', 'PLL'],
  GDX: ['NEM', 'GOLD', 'AEM', 'WPM', 'FNV', 'KGC', 'AU', 'RGLD'],
  TAN: ['FSLR', 'ENPH', 'SEDG', 'RUN', 'ARRY', 'SHLS'],
  XME: ['X', 'CLF', 'NUE', 'STLD', 'AA', 'FCX', 'MP', 'ATI'],
};

const MAX_SNAPSHOT_AGE_DAYS = 7;

/** Función pura de decisión: qué símbolos nomina el radar hoy. */
export function selectRadarNominees(
  rows: Array<{ symbol: string; categoria: string; cycleState: string | null }>,
  snapshotDate: string | null,
  today: string,
): string[] {
  // Fail-closed: sin snapshot o snapshot viejo (radar caído) → no nominar nada.
  if (!snapshotDate) return [];
  const ageMs = new Date(today + 'T00:00:00Z').getTime() - new Date(snapshotDate + 'T00:00:00Z').getTime();
  if (ageMs > MAX_SNAPSHOT_AGE_DAYS * 86_400_000 || ageMs < 0) return [];

  const nominees = new Set<string>();
  for (const r of rows) {
    if (r.categoria !== 'sector' || r.cycleState !== 'girando') continue;
    for (const c of RADAR_CONSTITUENTS[r.symbol] ?? []) nominees.add(c);
  }
  return [...nominees];
}
```

- [ ] **Step 4: Verificar GREEN**

Run: `npm run test --workspace=apps/backend -- src/discovery/radar-constituents.test.ts`
Expected: PASS (7 tests)

- [ ] **Step 5: Commit**

```bash
git add apps/backend/src/discovery/radar-constituents.ts apps/backend/src/discovery/radar-constituents.test.ts
git commit -m "feat(discovery): constituyentes del radar + selector puro de nominados

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 2: Integrar puente al scan + sources nuevos

**Files:**
- Modify: `apps/backend/src/discovery/discovery-registry.ts:47` (union type de source)
- Modify: `apps/backend/src/opportunities/opportunities.service.ts:434-445` (PASO 2, construcción del universo)

**Interfaces:**
- Consumes: `selectRadarNominees` / Task 1; `getLatestCycleRadarDate()`, `getCycleRadarSnapshots(date)` de `../db/repository.js` (ya existen); `registerNovelTickers` existente.
- Produces: universo del scan incluye nominados del radar; `discovered_symbols.discovered_from` puede ser `'radar'` o `'base_sweep'`.

- [ ] **Step 1: Ampliar el union type de source**

En `discovery-registry.ts` línea 47:

```typescript
  source: 'finnhub' | 'yahoo' | 'llm' | 'screener' | 'radar' | 'base_sweep',
```

- [ ] **Step 2: Integrar en opportunities.service.ts**

Localizar en PASO 2 (≈línea 434) el bloque que arma `discovered`:

```typescript
  const discovered = getActiveDiscoveredSymbols()
```

Insertar ANTES de esa línea:

```typescript
  // Puente radar→universo: sectores "girando" nominan constituyentes al scan.
  // El radar no decide acciones (regla del proyecto) — solo nomina; el embudo decide.
  // Fail-closed: sin snapshot fresco no se nomina nada (selectRadarNominees).
  try {
    const radarDate = getLatestCycleRadarDate();
    const radarRows = radarDate ? getCycleRadarSnapshots(radarDate) : [];
    const nominees = selectRadarNominees(
      radarRows.map((r) => ({ symbol: r.symbol, categoria: r.categoria, cycleState: r.cycleState })),
      radarDate,
      today,
    );
    if (nominees.length > 0) {
      const registered = await registerNovelTickers(nominees, 'radar');
      console.log(`[opportunities] Radar nomina ${nominees.length} constituyentes (girando) → ${registered} registrados`);
    }
  } catch (err) {
    // El puente jamás voltea el scan: sin radar se escanea igual con el universo base.
    console.warn('[opportunities] Puente radar→universo falló:', (err as Error).message);
  }
```

Agregar imports arriba del archivo (zona de imports existente):

```typescript
import { selectRadarNominees } from '../discovery/radar-constituents.js';
import { getLatestCycleRadarDate, getCycleRadarSnapshots } from '../db/repository.js';
import { registerNovelTickers } from '../discovery/discovery-registry.js';
```

⚠️ Verificar qué imports ya existen en el archivo (repository seguro ya se importa — sumar los getters al import existente; `registerNovelTickers` puede ya estar importado). `today` ya existe en scope (línea ≈430). Los campos del row del radar en drizzle son camelCase (`cycleState`, `categoria`) — verificar contra `schema.ts` al integrar.

- [ ] **Step 3: Typecheck + suite completa**

Run: `npm run typecheck && npm run test --workspace=apps/backend`
Expected: 0 errores TS; todos los tests pasan (la integración no tiene test unitario propio — la lógica de decisión está testeada en Task 1; el try/catch garantiza no-regresión del scan).

- [ ] **Step 4: Commit**

```bash
git add apps/backend/src/discovery/discovery-registry.ts apps/backend/src/opportunities/opportunities.service.ts
git commit -m "feat(scan): puente radar→universo — sectores girando nominan constituyentes

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 3: Universo del barrido (S&P 500 estático)

**Files:**
- Create: `apps/backend/src/discovery/sweep-universe.json`

**Interfaces:**
- Produces: JSON array plano de tickers (formato Yahoo: `BRK-B`, no `BRK.B`). Task 5 lo importa con `import universe from './sweep-universe.json' with { type: 'json' }` — verificar que el tsconfig del backend tenga `resolveJsonModule`; si no, agregar la opción o cargar con `readFileSync`.

- [ ] **Step 1: Generar el archivo desde el dataset público**

```bash
cd /Users/federicocroce/Docu/Fede/trading
curl -sL "https://raw.githubusercontent.com/datasets/s-and-p-500-companies/main/data/constituents.csv" \
  | node -e "
    let raw=''; process.stdin.on('data',d=>raw+=d).on('end',()=>{
      const lines = raw.trim().split('\n').slice(1);
      const tickers = lines.map(l => l.split(',')[0].trim().replace(/\./g,'-')).filter(Boolean).sort();
      if (tickers.length < 480) { console.error('CSV sospechoso: solo ' + tickers.length + ' tickers'); process.exit(1); }
      require('fs').writeFileSync('apps/backend/src/discovery/sweep-universe.json', JSON.stringify(tickers, null, 0) + '\n');
      console.log(tickers.length + ' tickers escritos');
    })"
```

Expected: `~503 tickers escritos`. Si el fetch falla o da <480, NO inventar la lista a mano — parar y avisar (fail-closed).

- [ ] **Step 2: Sanity visual**

```bash
node -e "const u=require('/Users/federicocroce/Docu/Fede/trading/apps/backend/src/discovery/sweep-universe.json'); console.log(u.length, u.slice(0,5), u.includes('BRK-B'), u.includes('BRK.B'))"
```

Expected: `503 [...] true false` (aprox; dots convertidos a dashes).

- [ ] **Step 3: Commit**

```bash
git add apps/backend/src/discovery/sweep-universe.json
git commit -m "feat(discovery): universo estático S&P500 para el barrido de bases

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 4: Detector de bases (puro, TDD)

**Files:**
- Create: `apps/backend/src/discovery/base-detector.ts`
- Test: `apps/backend/src/discovery/base-detector.test.ts`

**Interfaces:**
- Consumes: tipo `OHLC` de `@trading/shared` (`{date, open, high, low, close, volume}`).
- Produces: `detectBase(bars: OHLC[], spyCloses: number[]): BaseDetection` con `BaseDetection = { isBase: boolean; strength: number; reasons: string[] }`. Task 5 consume exactamente esto.

**Criterios (concretos, todos en la función pura):**
1. Fail-closed: `<220` barras → `{isBase: false, reasons: ['historial insuficiente']}`.
2. Liquidez: promedio 20d de `close*volume` ≥ `SWEEP_MIN_DOLLAR_VOLUME` (envNumber, default 10_000_000) — si no, rechazo.
3. Castigada (obligatorio): precio < SMA200 **o** precio ≤ −25% vs máximo 252d.
4. Reparando (obligatorio): precio > SMA50 **y** SMA50 hoy > SMA50 de hace 10 ruedas.
5. Volumen despertando (opcional, suma strength): avg vol 20d > avg vol 60d.
6. RS 1m vs SPY positivo (opcional, suma strength): `(px/px[-21] − 1) − (spy/spy[-21] − 1) > 0`.

`isBase` = (2) ∧ (3) ∧ (4) ∧ al menos una de {(5),(6)}. `strength` = cantidad de opcionales cumplidos (1 o 2) — Task 5 rankea por strength.

- [ ] **Step 1: Test rojo**

```typescript
// apps/backend/src/discovery/base-detector.test.ts
import { describe, it, expect } from 'vitest';
import { detectBase } from './base-detector.js';
import type { OHLC } from '@trading/shared';

// Serie sintética: precios y volúmenes controlados por tramos.
// mk(300, i => 100, i => 1e6) = 300 barras planas a $100 con 1M de volumen.
function mk(n: number, price: (i: number) => number, vol: (i: number) => number = () => 1_000_000): OHLC[] {
  return Array.from({ length: n }, (_, i) => ({
    date: `d${i}`, open: price(i), high: price(i) * 1.01, low: price(i) * 0.99,
    close: price(i), volume: vol(i),
  }));
}
const flatSpy = (n: number) => Array.from({ length: n }, () => 500);

// Base clásica: cayó de 100 a 55 (bajo SMA200), últimos 30d recupera a 62 (sobre SMA50
// y SMA50 subiendo), volumen 20d > 60d.
function baseCase(): OHLC[] {
  return mk(300,
    (i) => (i < 200 ? 100 - (i * 45) / 200 : i < 270 ? 55 : 55 + ((i - 270) * 7) / 30),
    (i) => (i >= 280 ? 2_000_000 : 1_000_000),
  );
}

describe('detectBase — fail-closed y criterios', () => {
  it('historial insuficiente (<220 barras) rechaza', () => {
    const r = detectBase(mk(100, () => 50), flatSpy(100));
    expect(r.isBase).toBe(false);
    expect(r.reasons.join(' ')).toMatch(/historial insuficiente/i);
  });

  it('ilíquida rechaza (dollar volume 20d < piso)', () => {
    const bars = baseCase().map((b) => ({ ...b, volume: 100 })); // ~$6k/día
    const r = detectBase(bars, flatSpy(300));
    expect(r.isBase).toBe(false);
    expect(r.reasons.join(' ')).toMatch(/liquidez/i);
  });

  it('base clásica detecta: castigada + reparando + volumen despertando', () => {
    const r = detectBase(baseCase(), flatSpy(300));
    expect(r.isBase).toBe(true);
    expect(r.strength).toBeGreaterThanOrEqual(1);
  });

  it('en tendencia alcista plena (sobre SMA200, cerca de máximos) NO es base', () => {
    const r = detectBase(mk(300, (i) => 100 + i * 0.5), flatSpy(300));
    expect(r.isBase).toBe(false);
  });

  it('castigada pero todavía cayendo (bajo SMA50) NO es base — cuchillo', () => {
    const r = detectBase(mk(300, (i) => 100 - i * 0.2), flatSpy(300));
    expect(r.isBase).toBe(false);
  });

  it('castigada y sobre SMA50 pero sin volumen NI RS (SPY sube más) NO alcanza', () => {
    // Precio repara suave con volumen plano; SPY sube 10% el último mes → RS negativo.
    const bars = mk(300, (i) => (i < 200 ? 100 - (i * 45) / 200 : i < 270 ? 55 : 55 + ((i - 270) * 3) / 30));
    const spy = Array.from({ length: 300 }, (_, i) => (i < 279 ? 500 : 500 + (i - 279) * 2.5));
    const r = detectBase(bars, spy);
    expect(r.isBase).toBe(false);
  });
});
```

- [ ] **Step 2: Verificar RED**

Run: `npm run test --workspace=apps/backend -- src/discovery/base-detector.test.ts`
Expected: FAIL — `Cannot find module './base-detector.js'`

- [ ] **Step 3: Implementación**

```typescript
// apps/backend/src/discovery/base-detector.ts
/**
 * Detector de bases silenciosas (caso IREN): acción castigada que empieza a
 * repararse sin haber aparecido aún en noticias ni en movers. Función pura de
 * decisión — sin I/O. El barrido semanal (base-sweep.service) la alimenta.
 */
import type { OHLC } from '@trading/shared';
import { envNumber } from '../shared/env-number.js';

export interface BaseDetection {
  isBase: boolean;
  strength: number; // 1-2: cantidad de confirmaciones opcionales (volumen, RS)
  reasons: string[];
}

function avg(xs: number[]): number {
  return xs.reduce((a, b) => a + b, 0) / xs.length;
}

function sma(closes: number[], endIdx: number, period: number): number | null {
  if (endIdx + 1 < period) return null;
  let s = 0;
  for (let i = endIdx - period + 1; i <= endIdx; i++) s += closes[i];
  return s / period;
}

export function detectBase(bars: OHLC[], spyCloses: number[]): BaseDetection {
  const reject = (why: string): BaseDetection => ({ isBase: false, strength: 0, reasons: [why] });

  // Fail-closed: sin historial suficiente no se opina.
  if (bars.length < 220 || spyCloses.length < 220) return reject('historial insuficiente');

  const closes = bars.map((b) => b.close);
  const last = closes.length - 1;
  const price = closes[last];

  // Liquidez: piso de dollar volume para que el swing sea ejecutable.
  const minDollarVol = envNumber('SWEEP_MIN_DOLLAR_VOLUME', 10_000_000);
  const dollarVol20 = avg(bars.slice(-20).map((b) => b.close * b.volume));
  if (dollarVol20 < minDollarVol) return reject(`liquidez insuficiente ($${(dollarVol20 / 1e6).toFixed(1)}M/día < $${(minDollarVol / 1e6).toFixed(0)}M)`);

  const sma200 = sma(closes, last, 200)!;
  const sma50Now = sma(closes, last, 50)!;
  const sma50Prev = sma(closes, last - 10, 50)!;
  const high252 = Math.max(...closes.slice(-252));

  // Obligatorio 1 — castigada: bajo SMA200 o lejos del máximo anual.
  const beaten = price < sma200 || price <= high252 * 0.75;
  if (!beaten) return reject('no está castigada (sobre SMA200 y cerca de máximos)');

  // Obligatorio 2 — reparando: sobre SMA50 y SMA50 con pendiente positiva.
  const repairing = price > sma50Now && sma50Now > sma50Prev;
  if (!repairing) return reject('no está reparando (bajo SMA50 o SMA50 cayendo)');

  const reasons: string[] = ['castigada', 'reparando (sobre SMA50 con pendiente positiva)'];
  let strength = 0;

  // Opcional 1 — volumen despertando: acumulación reciente.
  const vol20 = avg(bars.slice(-20).map((b) => b.volume));
  const vol60 = avg(bars.slice(-60).map((b) => b.volume));
  if (vol20 > vol60) { strength++; reasons.push('volumen despertando (20d > 60d)'); }

  // Opcional 2 — RS 1m vs SPY positivo: el giro le gana al mercado.
  const spyLast = spyCloses.length - 1;
  const ret1m = price / closes[last - 21] - 1;
  const spyRet1m = spyCloses[spyLast] / spyCloses[spyLast - 21] - 1;
  if (ret1m - spyRet1m > 0) { strength++; reasons.push('RS 1m vs SPY positivo'); }

  if (strength === 0) return reject('repara pero sin confirmación (ni volumen ni RS)');

  return { isBase: true, strength, reasons };
}
```

- [ ] **Step 4: Verificar GREEN**

Run: `npm run test --workspace=apps/backend -- src/discovery/base-detector.test.ts`
Expected: PASS (6 tests). Si el caso sintético 3 falla por aritmética de la serie, ajustar la SERIE del test (los tramos), no los umbrales del detector.

- [ ] **Step 5: Commit**

```bash
git add apps/backend/src/discovery/base-detector.ts apps/backend/src/discovery/base-detector.test.ts
git commit -m "feat(discovery): detector puro de bases silenciosas (TDD)

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 5: Orquestador del barrido + selección + cron semanal

**Files:**
- Create: `apps/backend/src/discovery/base-sweep.service.ts`
- Test: `apps/backend/src/discovery/base-sweep.test.ts` (solo la selección pura)
- Modify: `apps/backend/src/shared/cron.ts` (job semanal)

**Interfaces:**
- Consumes: `detectBase`/`BaseDetection` (Task 4), `sweep-universe.json` (Task 3), `getHistoricalQuotes(symbol, '1y', '1d')` de `../shared/yahoo.js`, `registerNovelTickers(tickers, 'base_sweep')` (Task 2), `getActiveDiscoveredSymbols()` de `./discovery-registry.js` o repository, `getPortfolioPositions()` y `getLiveWatchlistItems()` de `../db/repository.js` (verificar nombres exactos al integrar — son los que usa `opportunities.service.ts` PASO 2).
- Produces: `runBaseSweep(): Promise<{ scanned: number; failures: number; candidates: string[]; registered: number; aborted: boolean }>` y helper puro `selectSweepCandidates(results: Array<{ symbol: string; detection: BaseDetection }>, cap: number): string[]`.

- [ ] **Step 1: Test rojo de la selección pura**

```typescript
// apps/backend/src/discovery/base-sweep.test.ts
import { describe, it, expect } from 'vitest';
import { selectSweepCandidates } from './base-sweep.service.js';

const det = (isBase: boolean, strength: number) => ({ isBase, strength, reasons: [] });

describe('selectSweepCandidates', () => {
  it('filtra no-bases, rankea por strength desc y corta en el cap', () => {
    const out = selectSweepCandidates([
      { symbol: 'A', detection: det(true, 1) },
      { symbol: 'B', detection: det(false, 0) },
      { symbol: 'C', detection: det(true, 2) },
      { symbol: 'D', detection: det(true, 2) },
    ], 2);
    expect(out).toEqual(['C', 'D']); // strength 2 primero; empate = orden de llegada
  });

  it('sin bases devuelve vacío', () => {
    expect(selectSweepCandidates([{ symbol: 'A', detection: det(false, 0) }], 10)).toEqual([]);
  });
});
```

- [ ] **Step 2: Verificar RED**

Run: `npm run test --workspace=apps/backend -- src/discovery/base-sweep.test.ts`
Expected: FAIL — módulo inexistente.

- [ ] **Step 3: Implementación**

```typescript
// apps/backend/src/discovery/base-sweep.service.ts
/**
 * Barrido semanal de bases: recorre el S&P500 estático buscando acciones
 * haciendo piso silencioso (detectBase) que noticias y screener de movers no
 * ven. Los hallazgos entran como source='base_sweep' — caño medible en
 * signal_tracking. Corre sábados (mercado cerrado, cola Yahoo libre).
 */
import { getHistoricalQuotes } from '../shared/yahoo.js';
import { envNumber } from '../shared/env-number.js';
import { detectBase, type BaseDetection } from './base-detector.js';
import { registerNovelTickers } from './discovery-registry.js';
import { getActiveDiscoveredSymbols } from '../db/repository.js'; // ⚠️ verificar export real
import { getPortfolioPositions, getLiveWatchlistItems } from '../db/repository.js'; // ⚠️ ídem
import universe from './sweep-universe.json' with { type: 'json' };

/** Selección pura: bases rankeadas por strength, cap de candidatos. */
export function selectSweepCandidates(
  results: Array<{ symbol: string; detection: BaseDetection }>,
  cap: number,
): string[] {
  return results
    .filter((r) => r.detection.isBase)
    .sort((a, b) => b.detection.strength - a.detection.strength)
    .slice(0, cap)
    .map((r) => r.symbol);
}

export async function runBaseSweep(): Promise<{
  scanned: number; failures: number; candidates: string[]; registered: number; aborted: boolean;
}> {
  const cap = envNumber('SWEEP_MAX_CANDIDATES', 15);

  // Excluir lo que el sistema ya mira: portfolio, descubiertos activos, watchlist viva.
  const already = new Set<string>([
    ...getPortfolioPositions().map((p) => p.symbol),
    ...getActiveDiscoveredSymbols().map((s) => s.symbol),
    ...getLiveWatchlistItems().map((i) => i.symbol),
  ]);
  const targets = (universe as string[]).filter((s) => !already.has(s));

  // SPY primero: sin benchmark no hay RS → sin barrido (fail-closed).
  const spy = await getHistoricalQuotes('SPY', '1y', '1d');
  if (spy.length < 220) {
    console.warn('[BaseSweep] SPY insuficiente — abortando barrido');
    return { scanned: 0, failures: 0, candidates: [], registered: 0, aborted: true };
  }
  const spyCloses = spy.map((c) => c.close);

  const results: Array<{ symbol: string; detection: BaseDetection }> = [];
  let failures = 0;
  // Secuencial a propósito: ~500 fetches respetando la cola global de Yahoo.
  for (const symbol of targets) {
    try {
      const bars = await getHistoricalQuotes(symbol, '1y', '1d');
      results.push({ symbol, detection: detectBase(bars, spyCloses) });
    } catch {
      failures++;
    }
  }

  // Fail-closed: si falló más de la mitad, los "hallazgos" son sesgo de qué
  // respondió Yahoo, no del mercado — no registrar nada.
  if (failures > targets.length / 2) {
    console.warn(`[BaseSweep] ${failures}/${targets.length} fetches fallaron — abortando sin registrar`);
    return { scanned: results.length, failures, candidates: [], registered: 0, aborted: true };
  }

  const candidates = selectSweepCandidates(results, cap);
  const registered = candidates.length > 0 ? await registerNovelTickers(candidates, 'base_sweep') : 0;
  console.log(`[BaseSweep] ${results.length} escaneados, ${failures} fallos → ${candidates.length} bases → ${registered} registrados: ${candidates.join(', ')}`);
  return { scanned: results.length, failures, candidates, registered, aborted: false };
}
```

- [ ] **Step 4: Verificar GREEN + typecheck**

Run: `npm run test --workspace=apps/backend -- src/discovery/base-sweep.test.ts && npm run typecheck`
Expected: PASS (2 tests), 0 errores TS. Si `with { type: 'json' }` no compila con el tsconfig del backend, cambiar a `readFileSync` + `JSON.parse` con path vía `new URL('./sweep-universe.json', import.meta.url)`.

- [ ] **Step 5: Cron semanal**

En `apps/backend/src/shared/cron.ts`, junto a los jobs existentes, mismo patrón:

```typescript
  // Barrido de bases: sábados 14:00 — mercado cerrado, cola Yahoo libre.
  // ~500 fetches secuenciales (≈10-15 min). Fire-and-forget como el radar.
  cron.schedule('0 14 * * 6', async () => {
    try {
      const { runBaseSweep } = await import('../discovery/base-sweep.service.js');
      await runBaseSweep();
    } catch (err) {
      console.error('[Cron] Barrido de bases falló:', (err as Error).message);
    }
  });
```

- [ ] **Step 6: Suite completa**

Run: `npm run test --workspace=apps/backend && npm run typecheck`
Expected: todo verde.

- [ ] **Step 7: Commit**

```bash
git add apps/backend/src/discovery/base-sweep.service.ts apps/backend/src/discovery/base-sweep.test.ts apps/backend/src/shared/cron.ts
git commit -m "feat(discovery): barrido semanal de bases silenciosas + cron sabatino

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 6: Smoke test real + docs

**Files:**
- Modify: `.env.example` (vars nuevas)
- Modify: `docs/IA/prompt-maestro-mejora-continua.md` (secciones 5 y 7)

- [ ] **Step 1: Smoke del barrido en vivo (una corrida manual, previa al cron)**

```bash
cd /Users/federicocroce/Docu/Fede/trading/apps/backend && npx tsx -e "
import('./src/discovery/base-sweep.service.js').then(async (m) => {
  const r = await m.runBaseSweep();
  console.log(JSON.stringify(r, null, 2));
  process.exit(0);
});"
```

Expected: corre 10-15 min, `aborted: false`, `failures` bajo, 0-15 candidatos coherentes (castigados reparando — verificar 2-3 a mano contra un chart). Si aborta por fallos Yahoo, investigar antes de commitear el cron como está.

- [ ] **Step 2: Documentar env vars**

En `.env.example`, sección de screener/discovery:

```bash
# Barrido semanal de bases (sábados 14:00)
SWEEP_MIN_DOLLAR_VOLUME=10000000   # piso de liquidez ($/día promedio 20d)
SWEEP_MAX_CANDIDATES=15            # tope de bases registradas por corrida
```

- [ ] **Step 3: Prompt maestro**

Sección 5 (Estado), agregar al final:

```markdown
**Branch `feat/universo-cobertura` (2026-07-20):** dos caños nuevos de cobertura, ambos NOMINADORES medibles (jamás señal): (1) puente radar→universo — sector "girando" nomina sus constituyentes (`radar-constituents.ts`, lista curada) vía `registerNovelTickers(source='radar')`, fail-closed si el snapshot tiene >7 días; (2) barrido semanal de bases — S&P500 estático (`sweep-universe.json`) × `detectBase` puro (castigada + reparando + volumen o RS), cron sábados 14:00, `source='base_sweep'`, aborta si >50% de fetches fallan. El embudo normal decide; los sources permiten medir expectancy por caño en `signal_tracking`.
```

Sección 7 (Preguntas abiertas), agregar:

```markdown
- ¿El puente radar→universo nomina ganadores? → esperar n≥30 señales `source='radar'` resueltas; comparar expectancy vs discovery por noticias.
- ¿El barrido de bases anticipa de verdad (caso IREN)? → n≥30 de `source='base_sweep'`; medir además cuántos nominados terminan generando señal BUY/WATCH con setup válido (si casi ninguno pasa el embudo, el detector está mal calibrado o el concepto no aplica).
```

- [ ] **Step 4: Commit**

```bash
git add .env.example docs/IA/prompt-maestro-mejora-continua.md
git commit -m "docs: caños radar/base_sweep en estado y preguntas abiertas + env vars del barrido

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

## Self-Review

- **Cobertura del spec**: puente radar (Tasks 1-2) ✅, barrido de bases (Tasks 3-5) ✅, medición por source (union ampliado Task 2 + preguntas abiertas Task 6) ✅, IREN-gap cubierto por criterios del detector ✅.
- **Placeholders**: ninguno — todo el código está inline. Los ⚠️ marcan verificaciones contra el código real (nombres de getters de repository, imports ya presentes, `resolveJsonModule`), no trabajo faltante.
- **Consistencia de tipos**: `BaseDetection` producido en Task 4 = consumido en Task 5; `selectRadarNominees(rows, snapshotDate, today)` idéntico entre Tasks 1 y 2; source union `'radar' | 'base_sweep'` usado en Tasks 2 y 5.
- **Riesgos conocidos**: (a) constituyentes curados de memoria — mitigado: `registerNovelTickers` valida contra Yahoo y descarta muertos; (b) universe JSON estático se desactualiza — churn ~5%/año, aceptado y comentado; (c) 500 fetches sabatinos — secuencial sobre la cola global, smoke test en Task 6 lo valida en vivo.
