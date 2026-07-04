# Deuda técnica de discovery (B6/B7/B8/B10) — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Saldar 4 ítems de deuda del subsistema de discovery: ticker-validator rechaza tickers reales de 1 letra (B6), `upsertDiscoveredSymbol` no refresca `discoveredFrom` ni contexto al reactivar (B7), símbolos del screener entran con relevance de piso y son los primeros evictados (B8), y `.env.example` no documenta las env vars del screener/no-trade (B10).

**Architecture:** Todo vive en el flujo `registerNovelTickers` (discovery-registry) → `validateTickers` (ticker-validator) → `upsertDiscoveredSymbol` (repository) → tabla `discovered_symbols`. Cada fix extrae/ajusta lógica de decisión como función pura exportada (patrón existente: `segmentByStopRisk` en repository) y la testea sin mocks; el I/O queda en la capa que ya lo tenía.

**Tech Stack:** TypeScript ESM (imports con `.js`), vitest, drizzle/SQLite. Sin dependencias nuevas.

## Global Constraints

- Tests canónicos: `npm run test --workspace=apps/backend` — ÚNICO conteo válido. Baseline: **399** al 2026-07-04. JAMÁS el vitest de la raíz.
- Comentarios en español. Imports ESM con extensión `.js`.
- TDD: test rojo primero para toda lógica nueva.
- Fail-closed: ante duda, rechazar (whitelist explícita, no relajar reglas).
- Payloads/firmas aditivas: no romper llamadores existentes (`upsertDiscoveredSymbol` y `registerNovelTickers` tienen 4+ call sites).
- Jamás `process.env` a nivel módulo (regla envNumber lazy) — este plan NO agrega env vars nuevas, solo documenta existentes.
- Commits terminan con `Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>`.

---

### Task 1: ticker-validator acepta tickers reales de 1 letra (whitelist)

Contexto: `isValidTickerFormat` (`apps/backend/src/discovery/ticker-validator.ts:19`) rechaza todo símbolo de longitud < 2, descartando tickers reales (T=AT&T, F=Ford, V=Visa…). La línea 23 (`symbol.length === 1`) es código muerto (ya filtrado en línea 19). Fix fail-closed: whitelist explícita de tickers de 1 letra conocidos; cualquier otra letra suelta sigue rechazada (una "A" suelta en texto de noticia es ruido). Aguas arriba, el extractor de noticias (`ticker-extraction.ts`) ya exige contexto `$T` o `(T)` para tokens de 1-2 letras, así que esto no abre la puerta a alucinaciones; aguas abajo, `validateTicker` confirma existencia contra Yahoo.

**Files:**
- Modify: `apps/backend/src/discovery/ticker-validator.ts:18-27`
- Test (create): `apps/backend/src/discovery/ticker-validator.test.ts`

**Interfaces:**
- Consumes: nada de otras tasks.
- Produces: `isValidTickerFormat(symbol: string): boolean` (firma sin cambios; ahora devuelve `true` para tickers de 1 letra whitelisteados). Consumida sin cambios por `validateTicker`/`validateTickers` y sus 8 call sites.

- [ ] **Step 1: Escribir tests que fallan**

Crear `apps/backend/src/discovery/ticker-validator.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { isValidTickerFormat } from './ticker-validator.js';

describe('isValidTickerFormat', () => {
  it('acepta tickers reales de 1 letra whitelisteados (T, F, V, X)', () => {
    expect(isValidTickerFormat('T')).toBe(true);
    expect(isValidTickerFormat('F')).toBe(true);
    expect(isValidTickerFormat('V')).toBe(true);
    expect(isValidTickerFormat('X')).toBe(true);
  });

  it('rechaza letras sueltas NO whitelisteadas (sin ticker real asociado)', () => {
    expect(isValidTickerFormat('I')).toBe(false);
    expect(isValidTickerFormat('Q')).toBe(false);
    expect(isValidTickerFormat('Y')).toBe(false);
  });

  it('rechaza dígito suelto', () => {
    expect(isValidTickerFormat('5')).toBe(false);
  });

  it('sigue aceptando tickers normales de 2-10 caracteres', () => {
    expect(isValidTickerFormat('AAPL')).toBe(true);
    expect(isValidTickerFormat('BRK.B')).toBe(true);
    expect(isValidTickerFormat('GG')).toBe(true);
  });

  it('sigue rechazando la blocklist de falsos positivos', () => {
    expect(isValidTickerFormat('AI')).toBe(false);
    expect(isValidTickerFormat('CEO')).toBe(false);
    expect(isValidTickerFormat('USD')).toBe(false);
  });

  it('sigue rechazando formato inválido', () => {
    expect(isValidTickerFormat('')).toBe(false);
    expect(isValidTickerFormat('aapl')).toBe(false);
    expect(isValidTickerFormat('TOOLONGTICKER')).toBe(false);
    expect(isValidTickerFormat('123')).toBe(false);
  });
});
```

- [ ] **Step 2: Correr el test y verificar que falla**

Run: `npm run test --workspace=apps/backend -- ticker-validator`
Expected: FAIL — los 4 asserts del primer `it` devuelven `false` (la regla `length < 2` rechaza antes de todo).

- [ ] **Step 3: Implementación mínima**

En `apps/backend/src/discovery/ticker-validator.ts`, agregar la whitelist debajo de `BLOCKLIST` (línea 13) y reescribir `isValidTickerFormat`:

```ts
// Tickers reales de 1 letra (NYSE) — whitelist fail-closed: cualquier otra letra suelta es ruido de texto
const SINGLE_LETTER_TICKERS = new Set([
  'A', 'B', 'C', 'D', 'E', 'F', 'G', 'H', 'J', 'K', 'L', 'M',
  'O', 'R', 'S', 'T', 'U', 'V', 'W', 'X', 'Z',
]);

export function isValidTickerFormat(symbol: string): boolean {
  if (!symbol || symbol.length > 10) return false;
  if (!/^[A-Z0-9.-]+$/.test(symbol)) return false;
  // 1 letra: solo tickers reales conocidos — el resto se rechaza (fail-closed)
  if (symbol.length === 1) return SINGLE_LETTER_TICKERS.has(symbol);
  if (BLOCKLIST.has(symbol)) return false;
  // Solo números
  if (/^\d+$/.test(symbol)) return false;
  return true;
}
```

Notas: desaparecen tanto el `length < 2` como la línea muerta `if (symbol.length === 1) return false;`. Un dígito suelto ('5') cae en el chequeo de whitelist y devuelve `false` (no está en el Set). Quedan fuera de la whitelist a consciencia: I, N, P, Q, Y (sin ticker activo en NYSE/Nasdaq hoy).

- [ ] **Step 4: Correr los tests y verificar que pasan**

Run: `npm run test --workspace=apps/backend -- ticker-validator`
Expected: PASS (6 tests).

- [ ] **Step 5: Suite completa + commit**

Run: `npm run test --workspace=apps/backend`
Expected: 405 passed (399 baseline + 6 nuevos), 0 failed. Citar conteo exacto.

```bash
git add apps/backend/src/discovery/ticker-validator.ts apps/backend/src/discovery/ticker-validator.test.ts
git commit -m "fix: ticker-validator acepta tickers reales de 1 letra via whitelist

Recall perdido en discovery: T, F, V, X, etc. eran rechazados por la regla
length < 2. Whitelist fail-closed de 21 tickers NYSE conocidos; letras
sueltas no listadas siguen rechazadas. Elimina el chequeo length === 1
muerto.

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 2: upsertDiscoveredSymbol refresca contexto y discoveredFrom al re-descubrir

Contexto: la rama UPDATE de `upsertDiscoveredSymbol` (`apps/backend/src/db/repository.ts:783-793`) solo toca `lastSeen`, `newsCount`, `relevanceScore`, `expiresAt`, `active`. NO actualiza `discoveredFrom` ni el contexto de clasificación (`name`, `sector`, `industry`, `instrumentType`, `market`, `exchange`), que llegan frescos de `classifyAsset` en cada llamada. Caso PFE: descubierto por noticias, quedó inactivo; el screener lo re-descubrió operable pero la fila conservó el origen y contexto viejos. Fix: extraer el payload del UPDATE a una función pura `buildDiscoveredSymbolUpdate` (patrón `segmentByStopRisk` del mismo archivo), que refresca todo el contexto, pisa `discoveredFrom` con la fuente más reciente (la procedencia histórica queda en `firstSeen`) y usa el `relevanceScore` entrante como piso del incremento (+10 con cap 100 — el piso lo aprovecha la Task 3).

**Files:**
- Modify: `apps/backend/src/db/repository.ts:767-802`
- Test (modify): `apps/backend/src/db/repository.test.ts` (agregar describe nuevo)

**Interfaces:**
- Consumes: nada de otras tasks.
- Produces:
  - `buildDiscoveredSymbolUpdate(existing: { newsCount: number | null; relevanceScore: number | null }, data: DiscoveredSymbolUpsertInput, now: string): objeto set del UPDATE` — exportada de `repository.ts` para test.
  - `DiscoveredSymbolUpsertInput` — type exportado con el shape actual del parámetro de `upsertDiscoveredSymbol` (sin cambios de campos).
  - La firma externa de `upsertDiscoveredSymbol` NO cambia (aditivo; Task 3 le pasa `relevanceScore`).

- [ ] **Step 1: Escribir tests que fallan**

En `apps/backend/src/db/repository.test.ts`: sumar los símbolos nuevos al import existente de `./repository.js` (línea 2) y agregar al final del archivo el helper y el describe:

```ts
// en el import de la línea 2, agregar: buildDiscoveredSymbolUpdate, type DiscoveredSymbolUpsertInput

function upsertInput(overrides: Partial<DiscoveredSymbolUpsertInput> = {}): DiscoveredSymbolUpsertInput {
  return {
    symbol: 'PFE',
    name: 'Pfizer Inc.',
    instrumentType: 'accion',
    sector: 'Salud',
    industry: 'Farmacéutica',
    market: 'us',
    exchange: 'NYSE',
    discoveredFrom: 'screener',
    expiresAt: '2026-07-18T00:00:00.000Z',
    ...overrides,
  };
}

describe('buildDiscoveredSymbolUpdate', () => {
  const NOW = '2026-07-04T12:00:00.000Z';

  it('refresca discoveredFrom y todo el contexto de clasificación con los datos entrantes', () => {
    const update = buildDiscoveredSymbolUpdate({ newsCount: 3, relevanceScore: 20 }, upsertInput(), NOW);
    expect(update.discoveredFrom).toBe('screener');
    expect(update.name).toBe('Pfizer Inc.');
    expect(update.sector).toBe('Salud');
    expect(update.industry).toBe('Farmacéutica');
    expect(update.instrumentType).toBe('accion');
    expect(update.market).toBe('us');
    expect(update.exchange).toBe('NYSE');
    expect(update.expiresAt).toBe('2026-07-18T00:00:00.000Z');
    expect(update.lastSeen).toBe(NOW);
    expect(update.active).toBe(true);
  });

  it('incrementa newsCount y relevanceScore (+10, cap 100) como antes', () => {
    const update = buildDiscoveredSymbolUpdate({ newsCount: 3, relevanceScore: 95 }, upsertInput(), NOW);
    expect(update.newsCount).toBe(4);
    expect(update.relevanceScore).toBe(100);
  });

  it('usa el relevanceScore entrante como piso: re-descubrimiento por screener levanta una fila de baja relevance', () => {
    const update = buildDiscoveredSymbolUpdate({ newsCount: 1, relevanceScore: 10 }, upsertInput({ relevanceScore: 30 }), NOW);
    // max(10 + 10, 30) = 30 — sin piso quedaría en 20
    expect(update.relevanceScore).toBe(30);
  });

  it('sin relevanceScore entrante conserva el incremento simple', () => {
    const update = buildDiscoveredSymbolUpdate({ newsCount: 1, relevanceScore: 10 }, upsertInput(), NOW);
    expect(update.relevanceScore).toBe(20);
  });

  it('tolera existing con nulls (filas viejas)', () => {
    const update = buildDiscoveredSymbolUpdate({ newsCount: null, relevanceScore: null }, upsertInput(), NOW);
    expect(update.newsCount).toBe(1);
    expect(update.relevanceScore).toBe(10);
  });

  it('normaliza industry/exchange ausentes a null (no undefined)', () => {
    const update = buildDiscoveredSymbolUpdate({ newsCount: 1, relevanceScore: 10 }, upsertInput({ industry: undefined, exchange: undefined }), NOW);
    expect(update.industry).toBeNull();
    expect(update.exchange).toBeNull();
  });
});
```

- [ ] **Step 2: Correr el test y verificar que falla**

Run: `npm run test --workspace=apps/backend -- repository`
Expected: FAIL — `buildDiscoveredSymbolUpdate` no existe (error de import/compilación del test).

- [ ] **Step 3: Implementación mínima**

En `apps/backend/src/db/repository.ts`, reemplazar `upsertDiscoveredSymbol` (líneas 767-802) por:

```ts
export interface DiscoveredSymbolUpsertInput {
  symbol: string;
  name: string;
  instrumentType: string;
  sector: string;
  industry?: string | null;
  market: string;
  exchange?: string | null;
  discoveredFrom: string;
  relevanceScore?: number;
  expiresAt: string;
}

// Pura (sin I/O): payload del UPDATE al re-descubrir un símbolo.
// Refresca discoveredFrom (última fuente gana; la procedencia histórica queda en firstSeen)
// y el contexto de clasificación, que llega fresco de classifyAsset en cada llamada.
// El relevanceScore entrante actúa como piso del incremento (+10, cap 100): un
// re-descubrimiento por screener (30) levanta filas que quedaron en el fondo.
export function buildDiscoveredSymbolUpdate(
  existing: { newsCount: number | null; relevanceScore: number | null },
  data: DiscoveredSymbolUpsertInput,
  now: string,
) {
  return {
    lastSeen: now,
    newsCount: (existing.newsCount ?? 0) + 1,
    relevanceScore: Math.min(100, Math.max((existing.relevanceScore ?? 0) + 10, data.relevanceScore ?? 0)),
    expiresAt: data.expiresAt,
    active: true,
    discoveredFrom: data.discoveredFrom,
    name: data.name,
    instrumentType: data.instrumentType,
    sector: data.sector,
    industry: data.industry ?? null,
    market: data.market,
    exchange: data.exchange ?? null,
  };
}

export function upsertDiscoveredSymbol(data: DiscoveredSymbolUpsertInput) {
  const existing = db.select().from(schema.discoveredSymbols)
    .where(eq(schema.discoveredSymbols.symbol, data.symbol))
    .get();

  if (existing) {
    return db.update(schema.discoveredSymbols)
      .set(buildDiscoveredSymbolUpdate(existing, data, new Date().toISOString()))
      .where(eq(schema.discoveredSymbols.symbol, data.symbol))
      .run();
  }

  return db.insert(schema.discoveredSymbols).values({
    ...data,
    industry: data.industry ?? null,
    exchange: data.exchange ?? null,
    relevanceScore: data.relevanceScore ?? 10,
  }).run();
}
```

- [ ] **Step 4: Correr los tests y verificar que pasan**

Run: `npm run test --workspace=apps/backend -- repository`
Expected: PASS (los 6 nuevos + los existentes del archivo).

- [ ] **Step 5: Typecheck + suite completa + commit**

Run: `npm run typecheck` (los 3 workspaces limpios) y `npm run test --workspace=apps/backend`
Expected: 411 passed (405 + 6), 0 failed. Citar conteo exacto.

```bash
git add apps/backend/src/db/repository.ts apps/backend/src/db/repository.test.ts
git commit -m "fix: upsertDiscoveredSymbol refresca discoveredFrom y contexto al re-descubrir

La rama UPDATE conservaba origen y clasificación viejos (caso PFE: re-
descubierto operable por screener, la fila seguía diciendo lo contrario).
Payload extraído a buildDiscoveredSymbolUpdate pura y testeada; el
relevanceScore entrante ahora es piso del incremento.

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 3: símbolos del screener entran con relevance 30 + eviction testeada

Contexto: `registerNovelTickers` (`apps/backend/src/discovery/discovery-registry.ts:75-85`) nunca pasa `relevanceScore`, así que TODO símbolo nuevo entra con 10. Los de noticias se re-mencionan y escalan (+10 por mención); los del screener entran una vez, quedan en 10 y son los primeros evictados al cap de 120 (sort ascendente por relevance en líneas 30-37). Pero un candidato del screener ya pasó el embudo completo (quality bar → anti-chase → SMA200 → setup válido + RR≥2): es evidencia más fuerte que una mención suelta de noticia. Fix: relevance inicial por fuente (screener=30 ≈ 3 menciones, resto=10) vía helper puro, y extraer el sort de eviction a `selectEvictionCandidates` pura con tests (hoy la eviction no tiene ninguno).

**Files:**
- Modify: `apps/backend/src/discovery/discovery-registry.ts:14-97`
- Test (create): `apps/backend/src/discovery/discovery-registry.test.ts`

**Interfaces:**
- Consumes: de Task 2 — `upsertDiscoveredSymbol` acepta `relevanceScore?: number` (ya existía en la firma) y su rama UPDATE usa `Math.max(existing + 10, data.relevanceScore ?? 0)` como piso.
- Produces:
  - `initialRelevanceForSource(source: 'finnhub' | 'yahoo' | 'llm' | 'screener'): number` — exportada de `discovery-registry.ts`.
  - `selectEvictionCandidates<T extends { symbol: string; relevanceScore: number | null; lastSeen: string | null }>(rows: T[], batchSize: number): T[]` — exportada de `discovery-registry.ts`.
  - Firma de `registerNovelTickers` sin cambios.

- [ ] **Step 1: Escribir tests que fallan**

Crear `apps/backend/src/discovery/discovery-registry.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { initialRelevanceForSource, selectEvictionCandidates } from './discovery-registry.js';

describe('initialRelevanceForSource', () => {
  it('screener entra con 30: ya pasó el embudo operable completo (quality bar, SMA200, setup+RR)', () => {
    expect(initialRelevanceForSource('screener')).toBe(30);
  });

  it('las fuentes de noticias/llm entran con el piso de 10 (una mención)', () => {
    expect(initialRelevanceForSource('finnhub')).toBe(10);
    expect(initialRelevanceForSource('yahoo')).toBe(10);
    expect(initialRelevanceForSource('llm')).toBe(10);
  });
});

describe('selectEvictionCandidates', () => {
  const row = (symbol: string, relevanceScore: number | null, lastSeen: string | null) =>
    ({ symbol, relevanceScore, lastSeen });

  it('ordena por relevance ascendente: los de menor relevance se evictan primero', () => {
    const rows = [
      row('ALTA', 50, '2026-07-01T00:00:00.000Z'),
      row('BAJA', 10, '2026-07-03T00:00:00.000Z'),
      row('MEDIA', 30, '2026-07-02T00:00:00.000Z'),
    ];
    const evict = selectEvictionCandidates(rows, 2);
    expect(evict.map(r => r.symbol)).toEqual(['BAJA', 'MEDIA']);
  });

  it('a igual relevance desempata por lastSeen más viejo primero', () => {
    const rows = [
      row('RECIENTE', 10, '2026-07-03T00:00:00.000Z'),
      row('VIEJO', 10, '2026-07-01T00:00:00.000Z'),
    ];
    const evict = selectEvictionCandidates(rows, 1);
    expect(evict[0].symbol).toBe('VIEJO');
  });

  it('un símbolo del screener (30) sobrevive frente a menciones sueltas de noticias (10)', () => {
    const rows = [
      row('NEWS1', 10, '2026-07-03T00:00:00.000Z'),
      row('SCREENER', 30, '2026-07-01T00:00:00.000Z'),
      row('NEWS2', 10, '2026-07-02T00:00:00.000Z'),
    ];
    const evict = selectEvictionCandidates(rows, 2);
    expect(evict.map(r => r.symbol).sort()).toEqual(['NEWS1', 'NEWS2']);
  });

  it('relevance null cuenta como 0 (primero en evictarse)', () => {
    const rows = [
      row('SIN_SCORE', null, '2026-07-03T00:00:00.000Z'),
      row('CON_SCORE', 10, '2026-07-01T00:00:00.000Z'),
    ];
    const evict = selectEvictionCandidates(rows, 1);
    expect(evict[0].symbol).toBe('SIN_SCORE');
  });

  it('no muta el array de entrada y respeta batchSize', () => {
    const rows = [row('A2', 20, null), row('B2', 10, null), row('C2', 30, null)];
    const copia = [...rows];
    const evict = selectEvictionCandidates(rows, 2);
    expect(evict).toHaveLength(2);
    expect(rows).toEqual(copia);
  });
});
```

- [ ] **Step 2: Correr el test y verificar que falla**

Run: `npm run test --workspace=apps/backend -- discovery-registry`
Expected: FAIL — `initialRelevanceForSource` / `selectEvictionCandidates` no existen.

- [ ] **Step 3: Implementación mínima**

En `apps/backend/src/discovery/discovery-registry.ts`:

(a) Debajo de las constantes existentes (línea 16), agregar:

```ts
const SCREENER_INITIAL_RELEVANCE = 30;  // ya pasó el embudo operable: vale ~3 menciones de noticias
const DEFAULT_INITIAL_RELEVANCE = 10;   // una mención

// Pura: relevance inicial según la fuente del descubrimiento.
export function initialRelevanceForSource(source: 'finnhub' | 'yahoo' | 'llm' | 'screener'): number {
  return source === 'screener' ? SCREENER_INITIAL_RELEVANCE : DEFAULT_INITIAL_RELEVANCE;
}

// Pura: candidatos a evictar al cap — menor relevance primero, desempate por lastSeen más viejo.
export function selectEvictionCandidates<T extends { symbol: string; relevanceScore: number | null; lastSeen: string | null }>(
  rows: T[],
  batchSize: number,
): T[] {
  return [...rows]
    .sort((a, b) => {
      const relA = a.relevanceScore ?? 0;
      const relB = b.relevanceScore ?? 0;
      if (relA !== relB) return relA - relB;
      return new Date(a.lastSeen ?? 0).getTime() - new Date(b.lastSeen ?? 0).getTime();
    })
    .slice(0, batchSize);
}
```

(b) En `registerNovelTickers`, reemplazar el bloque inline del sort (líneas 29-37) por:

```ts
    const toEvict = selectEvictionCandidates(current, EVICTION_BATCH_SIZE);
```

(el `if (toEvict.length > 0)` y el update a `active: false` quedan igual).

(c) En el llamado a `upsertDiscoveredSymbol` (líneas 75-85), agregar el campo:

```ts
      upsertDiscoveredSymbol({
        symbol,
        name: classification.name,
        instrumentType: classification.instrumentType,
        sector: classification.sector,
        industry: classification.industry,
        market: classification.market,
        exchange: classification.exchange ?? null,
        discoveredFrom: source,
        relevanceScore: initialRelevanceForSource(source),
        expiresAt,
      });
```

Nota: con Task 2, esto también levanta a ≥30 una fila vieja que el screener re-descubre (piso en la rama UPDATE) — exactamente el caso PFE.

- [ ] **Step 4: Correr los tests y verificar que pasan**

Run: `npm run test --workspace=apps/backend -- discovery-registry`
Expected: PASS (7 tests).

- [ ] **Step 5: Typecheck + suite completa + commit**

Run: `npm run typecheck` y `npm run test --workspace=apps/backend`
Expected: 418 passed (411 + 7), 0 failed. Citar conteo exacto.

```bash
git add apps/backend/src/discovery/discovery-registry.ts apps/backend/src/discovery/discovery-registry.test.ts
git commit -m "fix: screener entra al universo con relevance 30, eviction extraída y testeada

Los símbolos del screener entraban con el piso 10 y eran los primeros
evictados al cap de 120 pese a haber pasado el embudo operable completo.
Relevance inicial por fuente (screener=30) + sort de eviction extraído a
selectEvictionCandidates pura con tests (antes sin cobertura).

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 4: documentar env vars del screener/no-trade en .env.example

Contexto: 5 env vars operativas leídas vía `envNumber` no figuran en `.env.example` (raíz del repo): `SCREENER_MAX_DAY_MOVE_PCT` (default 15, `market-screener.ts:26`), `SCREENER_MAX_CANDIDATES` (40, `market-screener.ts:27`), `SCREENER_MIN_RR` (2, `market-screener.service.ts:33`), `NO_TRADE_MIN_SETUPS` (3, `market-report.service.ts:242`), `MAX_SETUP_RISK_PCT` (10, `scoring.ts:1108` y `repository.ts:972`). Solo documentación — sin cambios de código ni tests.

**Files:**
- Modify: `.env.example` (raíz del repo, 41 líneas)

**Interfaces:**
- Consumes: nada.
- Produces: nada (doc).

- [ ] **Step 1: Agregar el bloque al final de `.env.example`**

Después de la línea 41 (`REARM_MIN_SCORE=55`), agregar:

```bash

# Screener de mercado (embudo: quality bar → anti-chase → SMA200 → setup válido + RR)
SCREENER_MAX_DAY_MOVE_PCT=15   # anti-chase: descarta candidatos que ya se movieron más de ±15% en el día
SCREENER_MAX_CANDIDATES=40     # tope de candidatos que pasan al scan técnico por corrida
SCREENER_MIN_RR=2              # R/R mínimo del setup para considerar un candidato operable

# Modo "hoy no se opera": se activa con menos de N setups válidos en el scan del día
NO_TRADE_MIN_SETUPS=3

# Riesgo máximo del setup (% entre entrada y stop) — por encima, setupQuality='invalid' y BUY degrada a WATCH
MAX_SETUP_RISK_PCT=10
```

Los valores del example son los defaults del código (comportamiento idéntico con o sin la var seteada).

- [ ] **Step 2: Verificar que los defaults citados coinciden con el código**

Run: `grep -rn "SCREENER_MAX_DAY_MOVE_PCT\|SCREENER_MAX_CANDIDATES\|SCREENER_MIN_RR\|NO_TRADE_MIN_SETUPS\|MAX_SETUP_RISK_PCT" apps/backend/src --include="*.ts" | grep -v test`
Expected: cada var aparece con `envNumber('<VAR>', <default>)` y el default coincide con el valor del example (15, 40, 2, 3, 10).

- [ ] **Step 3: Suite completa (sanity, no debería cambiar) + commit**

Run: `npm run test --workspace=apps/backend`
Expected: 418 passed (sin cambios vs Task 3), 0 failed.

```bash
git add .env.example
git commit -m "docs: documentar env vars de screener/no-trade/riesgo en .env.example

SCREENER_MAX_DAY_MOVE_PCT, SCREENER_MAX_CANDIDATES, SCREENER_MIN_RR,
NO_TRADE_MIN_SETUPS y MAX_SETUP_RISK_PCT existían en el código pero no
estaban documentadas. Valores del example = defaults del código.

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

## Verificación de cierre (checklist del prompt maestro, sección 8)

1. `npm run build:shared && npm run typecheck` — limpio en los 3 workspaces.
2. `npm run test --workspace=apps/backend` — conteo exacto esperado: **418** (baseline 399 + 6 + 6 + 7).
3. No se tocó pipeline/scan en runtime (solo discovery-registry aguas arriba) — no requiere one-shot, pero verificar que `data/trading.db` no tenga filas rotas es opcional.
4. Coherencia entre superficies: sin cambios de payloads ni verbos — no aplica.
5. Visibilidad: son fixes de infraestructura de discovery; la superficie visible es indirecta (símbolos de 1 letra y del screener sobreviviendo en el universo). No hay UI nueva que montar.
6. Review final whole-branch en el modelo más capaz antes de merge; merge a `feat/outcome-resolver` solo con "Ready to merge: Yes".
