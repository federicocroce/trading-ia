# Auditoría P0 — Correcciones Críticas Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Eliminar los 5 defectos que hacen que el sistema mienta o recomiende basura: resolución de señales rota (caso SDOT), override alcista del LLM sin gate, universo sin filtro de calidad, régimen bear que se desactiva en silencio, y llamadas LLM sin timeout.

**Architecture:** Toda la lógica nueva de decisión va como funciones puras testeables (patrón ya establecido en `intelligence/outcome-resolver.ts` y `opportunities/tradeability.ts`), con el I/O en los orquestadores existentes. Un script de backfill re-resuelve el histórico corrupto de `signal_tracking`.

**Tech Stack:** TypeScript ESM, vitest, drizzle + better-sqlite3, tsx. Monorepo npm workspaces.

## Global Constraints

- Node ≥ 20 (`engines` en package.json raíz).
- Tests: `npm run test --workspace=apps/backend` (vitest). Typecheck: `npm run typecheck --workspace=apps/backend`.
- Trabajar en branch `fix/auditoria-p0` (crear desde la rama actual; NUNCA commitear directo a main).
- Convención del codebase: comentarios en español, imports con extensión `.js` (ESM), funciones puras separadas del I/O.
- No cambiar la forma de la API tRPC (el frontend consume `action`, `verdict`, `outcome` tal como están).
- El outcome `'invalid'` es un valor nuevo permitido en `signal_tracking.outcome` (columna es `text`, no requiere migración).
- Contexto completo de la auditoría: ver conversación 2026-07-02 y `docs/auditoria-sistema-completo.md`.

### Bug de referencia (caso SDOT)

`signal-tracking.service.ts` evalúa todo lo que no es `BUY` como short (`isBuy = action === 'BUY'`). Para señales WATCH el target (takeProfit) está ARRIBA del precio, pero al evaluarlas como short chequea `currentPrice <= targetPrice` → siempre true → win automático al día 7. Resultado: 2.334 de 2.765 "wins" en DB son falsos; SDOT marcó "win" cayendo -72%. Además la resolución solo mira el precio del día 7/30 (ignora el camino: stop tocado + rebote = no loss) y hay retornos imposibles (+344%) por mismatch de splits.

---

### Task 1: Función pura `resolveTrackedSignal` en outcome-resolver

**Files:**
- Modify: `apps/backend/src/intelligence/outcome-resolver.ts` (agregar sección 3 al final del archivo)
- Test: `apps/backend/src/intelligence/outcome-resolver.test.ts` (agregar describe block)

**Interfaces:**
- Consumes: `PriceCandle`, `daysBetween`, `pctChange` (ya definidos en el mismo archivo).
- Produces: `resolveTrackedSignal(input: TrackedSignalInput, candles: PriceCandle[], asOfDate: string, opts?: TrackedSignalOpts): TrackedSignalResolution` y los tipos `SignalOutcome`, `TrackedSignalInput`, `TrackedSignalResolution` — Task 2 y Task 3 los importan.

- [ ] **Step 1: Escribir los tests que fallan**

Agregar al final de `apps/backend/src/intelligence/outcome-resolver.test.ts`:

```typescript
import { resolveTrackedSignal, type TrackedSignalInput } from './outcome-resolver.js';

describe('resolveTrackedSignal', () => {
  const candle = (date: string, close: number, high = close, low = close) => ({ date, high, low, close });

  it('WATCH que colapsa es LOSS, no win (caso SDOT)', () => {
    // SDOT: WATCH a $24.58, target $60.33, stop $0.75 — cayó a $6.77
    const input: TrackedSignalInput = {
      action: 'WATCH', entryPrice: 24.58, targetPrice: 60.33, stopLoss: 0.75, signalDate: '2026-06-11',
    };
    const candles = [candle('2026-06-16', 21.5), candle('2026-06-23', 9.25), candle('2026-07-11', 6.77)];
    const res = resolveTrackedSignal(input, candles, '2026-07-12');
    expect(res.outcome).toBe('loss');
    expect(res.hitTarget).toBe(false);
  });

  it('BUY que toca el stop en el camino es LOSS aunque después rebote', () => {
    const input: TrackedSignalInput = {
      action: 'BUY', entryPrice: 100, targetPrice: 120, stopLoss: 92, signalDate: '2026-06-01',
    };
    const candles = [candle('2026-06-05', 95, 96, 90), candle('2026-06-20', 118)];
    const res = resolveTrackedSignal(input, candles, '2026-06-21');
    expect(res.outcome).toBe('loss');
    expect(res.hitStop).toBe(true);
    expect(res.resolvedDate).toBe('2026-06-05');
  });

  it('BUY que toca target sin tocar stop es WIN en la fecha del hit', () => {
    const input: TrackedSignalInput = {
      action: 'BUY', entryPrice: 100, targetPrice: 110, stopLoss: 92, signalDate: '2026-06-01',
    };
    const candles = [candle('2026-06-03', 104), candle('2026-06-08', 109, 111, 107)];
    const res = resolveTrackedSignal(input, candles, '2026-06-10');
    expect(res.outcome).toBe('win');
    expect(res.hitTarget).toBe(true);
    expect(res.resolvedDate).toBe('2026-06-08');
  });

  it('vela que toca target y stop el mismo día resuelve conservador: LOSS', () => {
    const input: TrackedSignalInput = {
      action: 'BUY', entryPrice: 100, targetPrice: 108, stopLoss: 94, signalDate: '2026-06-01',
    };
    const candles = [candle('2026-06-02', 100, 109, 93)];
    const res = resolveTrackedSignal(input, candles, '2026-06-03');
    expect(res.outcome).toBe('loss');
  });

  it('SELL gana si el precio baja (medido como short)', () => {
    const input: TrackedSignalInput = {
      action: 'SELL', entryPrice: 100, targetPrice: null, stopLoss: null, signalDate: '2026-06-01',
    };
    const candles = [candle('2026-07-02', 90)];
    const res = resolveTrackedSignal(input, candles, '2026-07-02');
    expect(res.outcome).toBe('win');
  });

  it('sin hits y dentro del horizonte queda PENDING', () => {
    const input: TrackedSignalInput = {
      action: 'BUY', entryPrice: 100, targetPrice: 120, stopLoss: 90, signalDate: '2026-06-25',
    };
    const candles = [candle('2026-06-28', 101)];
    const res = resolveTrackedSignal(input, candles, '2026-06-30');
    expect(res.outcome).toBe('pending');
  });

  it('sin hits, horizonte vencido y retorno dentro de la banda ±2% es NEUTRAL', () => {
    const input: TrackedSignalInput = {
      action: 'BUY', entryPrice: 100, targetPrice: null, stopLoss: null, signalDate: '2026-05-01',
    };
    const candles = [candle('2026-06-05', 101)];
    const res = resolveTrackedSignal(input, candles, '2026-06-10');
    expect(res.outcome).toBe('neutral');
  });

  it('retorno implausible (>200%) marca INVALID (split sin ajustar / feed roto)', () => {
    const input: TrackedSignalInput = {
      action: 'BUY', entryPrice: 16.21, targetPrice: null, stopLoss: null, signalDate: '2026-06-13',
    };
    const candles = [candle('2026-07-15', 72.0)]; // +344% — el caso real de SDOT en la DB
    const res = resolveTrackedSignal(input, candles, '2026-07-16');
    expect(res.outcome).toBe('invalid');
  });

  it('target incoherente con la dirección se ignora (long con target bajo el entry)', () => {
    const input: TrackedSignalInput = {
      action: 'BUY', entryPrice: 100, targetPrice: 80, stopLoss: null, signalDate: '2026-05-01',
    };
    const candles = [candle('2026-05-10', 95, 96, 79)];
    // Si NO se ignorara, current <= 80 en low daría hitTarget=win con el precio cayendo
    const res = resolveTrackedSignal(input, candles, '2026-06-05');
    expect(res.outcome).toBe('loss');
    expect(res.hitTarget).toBe(false);
  });
});
```

- [ ] **Step 2: Correr los tests y verificar que fallan**

Run: `npm run test --workspace=apps/backend -- outcome-resolver`
Expected: FAIL — `resolveTrackedSignal` no existe (error de import).

- [ ] **Step 3: Implementar `resolveTrackedSignal`**

Agregar al final de `apps/backend/src/intelligence/outcome-resolver.ts`:

```typescript
// ---------------------------------------------------------------------------
// 3) Señales trackeadas (signal_tracking) — reemplaza la lógica rota que
//    evaluaba WATCH/HOLD como shorts (caso SDOT: win automático cayendo -72%).
// ---------------------------------------------------------------------------

export type SignalOutcome = 'win' | 'loss' | 'neutral' | 'pending' | 'invalid';

export interface TrackedSignalInput {
  action: 'BUY' | 'SELL' | 'HOLD' | 'WATCH';
  entryPrice: number;
  targetPrice?: number | null;
  stopLoss?: number | null;
  signalDate: string; // YYYY-MM-DD
}

export interface TrackedSignalOpts {
  /** Días para resolución definitiva por horizonte. */
  horizonDays?: number;
  /** Banda (%) dentro de la cual el resultado es neutral. */
  neutralBandPct?: number;
  /** Retorno absoluto (%) por encima del cual los datos se consideran rotos (splits). */
  maxPlausibleReturnPct?: number;
}

export interface TrackedSignalResolution {
  outcome: SignalOutcome;
  resolutionPrice: number | null;
  resolutionReturn: number | null; // % a favor de la dirección de la señal
  hitTarget: boolean;
  hitStop: boolean;
  resolvedDate: string | null;
}

/**
 * Resuelve una señal trackeada caminando las velas POSTERIORES a la fecha de señal.
 * Reglas:
 *   - SOLO SELL se mide como short. BUY/HOLD/WATCH son tesis alcistas.
 *   - Target/stop incoherentes con la dirección se ignoran (defensa vs niveles absurdos).
 *   - Stop y target en la misma vela ⇒ conservador: loss (asumimos stop-first).
 *   - Retorno implausible ⇒ invalid (split sin ajustar / feed roto), nunca win/loss.
 */
export function resolveTrackedSignal(
  input: TrackedSignalInput,
  candles: PriceCandle[],
  asOfDate: string,
  opts: TrackedSignalOpts = {},
): TrackedSignalResolution {
  const horizonDays = opts.horizonDays ?? 30;
  const neutralBandPct = opts.neutralBandPct ?? 2;
  const maxPlausible = opts.maxPlausibleReturnPct ?? 200;

  const isShort = input.action === 'SELL';
  const none: TrackedSignalResolution = {
    outcome: 'pending', resolutionPrice: null, resolutionReturn: null,
    hitTarget: false, hitStop: false, resolvedDate: null,
  };

  const after = candles
    .filter((c) => c.date > input.signalDate)
    .sort((a, b) => a.date.localeCompare(b.date));
  if (after.length === 0) {
    return daysBetween(input.signalDate, asOfDate) >= horizonDays
      ? { ...none, outcome: 'invalid' } // horizonte vencido y sin datos = no evaluable
      : none;
  }

  // Sanity: datos incoherentes (split sin ajustar) — nunca resolver win/loss con esto.
  const last = after.at(-1)!;
  if (Math.abs(pctChange(input.entryPrice, last.close)) > maxPlausible) {
    return { ...none, outcome: 'invalid', resolutionPrice: last.close, resolvedDate: last.date };
  }

  // Niveles coherentes con la dirección; si no lo son, se ignoran.
  const target =
    input.targetPrice != null && (isShort ? input.targetPrice < input.entryPrice : input.targetPrice > input.entryPrice)
      ? input.targetPrice : null;
  const stop =
    input.stopLoss != null && (isShort ? input.stopLoss > input.entryPrice : input.stopLoss < input.entryPrice)
      ? input.stopLoss : null;

  for (const c of after) {
    const hitTarget = target != null && (isShort ? c.low <= target : c.high >= target);
    const hitStop = stop != null && (isShort ? c.high >= stop : c.low <= stop);

    if (hitStop) {
      // stop-first también cuando la misma vela toca ambos (conservador)
      const ret = pctChange(input.entryPrice, stop!);
      return {
        outcome: 'loss', resolutionPrice: stop!, resolutionReturn: isShort ? -ret : ret,
        hitTarget: false, hitStop: true, resolvedDate: c.date,
      };
    }
    if (hitTarget) {
      const ret = pctChange(input.entryPrice, target!);
      return {
        outcome: 'win', resolutionPrice: target!, resolutionReturn: isShort ? -ret : ret,
        hitTarget: true, hitStop: false, resolvedDate: c.date,
      };
    }
  }

  if (daysBetween(input.signalDate, asOfDate) < horizonDays) return none;

  const ret = pctChange(input.entryPrice, last.close);
  const dirRet = isShort ? -ret : ret;
  const outcome: SignalOutcome =
    dirRet > neutralBandPct ? 'win' : dirRet < -neutralBandPct ? 'loss' : 'neutral';
  return {
    outcome, resolutionPrice: last.close, resolutionReturn: dirRet,
    hitTarget: false, hitStop: false, resolvedDate: last.date,
  };
}
```

- [ ] **Step 4: Correr los tests y verificar que pasan**

Run: `npm run test --workspace=apps/backend -- outcome-resolver`
Expected: PASS (los 9 tests nuevos + los existentes del archivo).

- [ ] **Step 5: Commit**

```bash
git add apps/backend/src/intelligence/outcome-resolver.ts apps/backend/src/intelligence/outcome-resolver.test.ts
git commit -m "fix: resolución de señales direccional y path-aware (caso SDOT)"
```

---

### Task 2: Recablear `resolveExpiredSignals` para usar velas

**Files:**
- Modify: `apps/backend/src/opportunities/signal-tracking.service.ts:62-129` (función `resolveExpiredSignals` completa)

**Interfaces:**
- Consumes: `resolveTrackedSignal`, `TrackedSignalInput`, `PriceCandle` (Task 1); `getHistoricalQuotes(symbol, range, interval): Promise<OHLC[]>` de `../shared/yahoo.js`; `getPendingSignals()`, `resolveSignal(id, data)` de `../db/repository.js` (sin cambios).
- Produces: misma firma pública `resolveExpiredSignals(): Promise<number>` — el cron (`shared/cron.ts`) y el router no cambian.

- [ ] **Step 1: Reemplazar la implementación**

En `apps/backend/src/opportunities/signal-tracking.service.ts`, reemplazar la función `resolveExpiredSignals` completa (líneas 62-129) y ajustar imports:

```typescript
import { getHistoricalQuotes } from '../shared/yahoo.js';
import {
  resolveTrackedSignal,
  type TrackedSignalInput,
  type PriceCandle,
} from '../intelligence/outcome-resolver.js';
```

(Eliminar el import de `getQuote` si queda sin uso en el archivo.)

```typescript
/**
 * Resuelve señales pendientes caminando las velas diarias posteriores a la señal
 * (path-aware: un stop tocado en el camino es loss aunque después rebote).
 * Cachea el histórico por símbolo dentro de la corrida para no repetir fetches.
 */
export async function resolveExpiredSignals(): Promise<number> {
  const pending = getPendingSignals();
  const asOfDate = new Date().toISOString().split('T')[0];
  const candleCache = new Map<string, PriceCandle[]>();
  let resolved = 0;

  for (const signal of pending) {
    try {
      let candles = candleCache.get(signal.symbol);
      if (!candles) {
        const ohlc = await getHistoricalQuotes(signal.symbol, '1y', '1d');
        candles = ohlc.map((c) => ({ date: c.date, high: c.high, low: c.low, close: c.close }));
        candleCache.set(signal.symbol, candles);
      }

      const input: TrackedSignalInput = {
        action: signal.action as TrackedSignalInput['action'],
        entryPrice: signal.entryPrice,
        targetPrice: signal.targetPrice,
        stopLoss: signal.stopLoss,
        signalDate: signal.signalDate,
      };
      const res = resolveTrackedSignal(input, candles, asOfDate);
      if (res.outcome === 'pending') continue;

      const isShort = signal.action === 'SELL';
      // resolutionReturn viene "a favor de la señal"; en DB guardamos retorno crudo del precio.
      const rawReturn = res.resolutionReturn == null ? null : (isShort ? -res.resolutionReturn : res.resolutionReturn);

      resolveSignal(signal.id, {
        priceAfter7d: signal.priceAfter7d ?? res.resolutionPrice,
        priceAfter30d: res.resolutionPrice,
        returnAfter7d: signal.returnAfter7d ?? rawReturn,
        returnAfter30d: rawReturn,
        hitTarget: res.hitTarget,
        hitStop: res.hitStop,
        outcome: res.outcome,
      });
      resolved++;
    } catch {
      // Sin histórico disponible: se reintenta en la próxima corrida del cron.
    }
  }

  return resolved;
}
```

- [ ] **Step 2: Typecheck + suite completa**

Run: `npm run typecheck --workspace=apps/backend && npm run test --workspace=apps/backend`
Expected: PASS sin errores de tipos. Si `OHLC` no expone `date/high/low/close`, revisar el tipo en `shared/yahoo.ts` y mapear los campos reales — no adivinar.

- [ ] **Step 3: Commit**

```bash
git add apps/backend/src/opportunities/signal-tracking.service.ts
git commit -m "fix: resolveExpiredSignals usa velas históricas y resolución direccional"
```

---

### Task 3: Backfill — re-resolver el histórico corrupto

**Files:**
- Create: `apps/backend/src/scripts/reresolve-signal-tracking.ts`
- Modify: `apps/backend/package.json` (agregar script `db:reresolve-signals`)

**Interfaces:**
- Consumes: `resolveTrackedSignal` (Task 1), `getHistoricalQuotes`, `db` + `schema` de `../db/index.js` y `../db/schema.js`.
- Produces: script CLI idempotente; no exporta nada.

- [ ] **Step 1: Escribir el script**

Crear `apps/backend/src/scripts/reresolve-signal-tracking.ts`:

```typescript
/**
 * Backfill one-shot: re-resuelve TODO signal_tracking con la lógica correcta
 * (resolveTrackedSignal). Necesario porque la lógica anterior evaluaba WATCH/HOLD
 * como shorts → ~2.300 wins falsos que además contaminaron el calibrador de pesos.
 *
 * Uso: npm run db:reresolve-signals --workspace=apps/backend
 */
import 'dotenv/config';
import { eq } from 'drizzle-orm';
import { db } from '../db/index.js';
import * as schema from '../db/schema.js';
import { getHistoricalQuotes } from '../shared/yahoo.js';
import {
  resolveTrackedSignal,
  type TrackedSignalInput,
  type PriceCandle,
} from '../intelligence/outcome-resolver.js';

async function main() {
  const all = db.select().from(schema.signalTracking).all();
  console.log(`[Backfill] ${all.length} señales en signal_tracking`);

  const candleCache = new Map<string, PriceCandle[] | null>();
  const asOfDate = new Date().toISOString().split('T')[0];
  const counts: Record<string, number> = {};

  for (const signal of all) {
    let candles = candleCache.get(signal.symbol);
    if (candles === undefined) {
      try {
        const ohlc = await getHistoricalQuotes(signal.symbol, '1y', '1d');
        candles = ohlc.map((c) => ({ date: c.date, high: c.high, low: c.low, close: c.close }));
      } catch {
        candles = null; // símbolo deslistado o sin datos
      }
      candleCache.set(signal.symbol, candles);
    }

    let outcome: string;
    let update: Record<string, unknown> = {};
    if (!candles) {
      outcome = 'invalid';
    } else {
      const input: TrackedSignalInput = {
        action: signal.action as TrackedSignalInput['action'],
        entryPrice: signal.entryPrice,
        targetPrice: signal.targetPrice,
        stopLoss: signal.stopLoss,
        signalDate: signal.signalDate,
      };
      const res = resolveTrackedSignal(input, candles, asOfDate);
      outcome = res.outcome;
      const isShort = signal.action === 'SELL';
      const rawReturn = res.resolutionReturn == null ? null : (isShort ? -res.resolutionReturn : res.resolutionReturn);
      update = {
        hitTarget: res.hitTarget,
        hitStop: res.hitStop,
        returnAfter30d: rawReturn,
        priceAfter30d: res.resolutionPrice,
        resolvedAt: outcome === 'pending' ? null : new Date().toISOString(),
      };
    }

    db.update(schema.signalTracking)
      .set({ outcome, ...update })
      .where(eq(schema.signalTracking.id, signal.id))
      .run();
    counts[outcome] = (counts[outcome] ?? 0) + 1;
  }

  console.log('[Backfill] Resultado:', counts);

  // Las propuestas de pesos pendientes se calcularon con outcomes corruptos: descartarlas.
  const stale = db.delete(schema.scoringWeightProposals)
    .where(eq(schema.scoringWeightProposals.status, 'pending'))
    .run();
  console.log(`[Backfill] Propuestas de pesos pendientes descartadas: ${stale.changes}`);
}

main().then(() => process.exit(0)).catch((err) => { console.error(err); process.exit(1); });
```

Nota para el implementador: verificar en `db/schema.ts` los nombres exactos `schema.signalTracking` y `schema.scoringWeightProposals` y el nombre del campo de estado de las propuestas (`status`); ajustar si difieren. Verificar también que exista una fila de ejemplo con `sqlite3 data/trading.db "SELECT status, COUNT(*) FROM scoring_weight_proposals GROUP BY 1"` antes de asumir el valor `'pending'`.

- [ ] **Step 2: Agregar el npm script**

En `apps/backend/package.json`, dentro de `scripts`, agregar:

```json
"db:reresolve-signals": "tsx src/scripts/reresolve-signal-tracking.ts"
```

- [ ] **Step 3: Typecheck**

Run: `npm run typecheck --workspace=apps/backend`
Expected: PASS.

- [ ] **Step 4: Backup de la DB y ejecutar**

```bash
cp data/trading.db "data/trading.db.pre-backfill-$(date +%Y%m%d)"
npm run db:reresolve-signals --workspace=apps/backend
```
Expected: log con el conteo por outcome. Sanity esperado: los `win` bajan de ~2.765 a un número mucho menor; aparecen `invalid`.

- [ ] **Step 5: Verificar contra el caso SDOT**

```bash
sqlite3 data/trading.db "SELECT action, outcome, return_after_30d FROM signal_tracking WHERE symbol='SDOT'"
```
Expected: ninguna fila de SDOT con outcome `win` y retorno negativo. Los WATCH de SDOT deben ser `loss` o `invalid`.

- [ ] **Step 6: Commit**

```bash
git add apps/backend/src/scripts/reresolve-signal-tracking.ts apps/backend/package.json
git commit -m "fix: backfill de outcomes corruptos en signal_tracking + descarta propuestas de pesos contaminadas"
```

---

### Task 4: Gate del override del LLM — solo puede degradar

**Files:**
- Modify: `apps/backend/src/opportunities/verdicts.service.ts` (agregar helper puro al final)
- Modify: `apps/backend/src/opportunities/opportunities.service.ts:892-921` (bloque que aplica `unified.action`)
- Test: `apps/backend/src/opportunities/verdicts.portfolio.test.ts` (agregar describe block)

**Interfaces:**
- Consumes: nada nuevo.
- Produces: `applyLlmAction(algoAction: string, llmAction: string): string` exportada de `verdicts.service.ts`.

- [ ] **Step 1: Escribir los tests que fallan**

Agregar al final de `apps/backend/src/opportunities/verdicts.portfolio.test.ts`:

```typescript
import { applyLlmAction } from './verdicts.service.js';

describe('applyLlmAction — el LLM solo puede degradar', () => {
  it('bloquea upgrade WATCH → BUY (vector del caso SDOT)', () => {
    expect(applyLlmAction('WATCH', 'BUY')).toBe('WATCH');
  });
  it('bloquea upgrade HOLD → BUY', () => {
    expect(applyLlmAction('HOLD', 'BUY')).toBe('HOLD');
  });
  it('permite degradar BUY → WATCH', () => {
    expect(applyLlmAction('BUY', 'WATCH')).toBe('WATCH');
  });
  it('permite degradar BUY → SELL', () => {
    expect(applyLlmAction('BUY', 'SELL')).toBe('SELL');
  });
  it('permite degradar HOLD → SELL (salida de posición)', () => {
    expect(applyLlmAction('HOLD', 'SELL')).toBe('SELL');
  });
  it('confirmación no cambia nada', () => {
    expect(applyLlmAction('BUY', 'BUY')).toBe('BUY');
  });
  it('acción desconocida del LLM no cambia nada', () => {
    expect(applyLlmAction('BUY', 'YOLO')).toBe('BUY');
  });
});
```

- [ ] **Step 2: Correr y verificar que fallan**

Run: `npm run test --workspace=apps/backend -- verdicts.portfolio`
Expected: FAIL — `applyLlmAction` no existe.

- [ ] **Step 3: Implementar el helper**

Agregar al final de `apps/backend/src/opportunities/verdicts.service.ts`:

```typescript
/**
 * Orden de "bullishness" de las acciones. El LLM (capa narrativa) solo puede
 * DEGRADAR la acción algorítmica hacia menos alcista — nunca subirla. Un modelo
 * entusiasmado con una narrativa no puede convertir WATCH en COMPRAR (caso SDOT).
 */
const ACTION_BULLISH_RANK: Record<string, number> = { SELL: 0, WATCH: 1, HOLD: 2, BUY: 3 };

export function applyLlmAction(algoAction: string, llmAction: string): string {
  const algoRank = ACTION_BULLISH_RANK[algoAction];
  const llmRank = ACTION_BULLISH_RANK[llmAction];
  if (algoRank === undefined || llmRank === undefined) return algoAction;
  return llmRank < algoRank ? llmAction : algoAction;
}
```

- [ ] **Step 4: Correr y verificar que pasan**

Run: `npm run test --workspace=apps/backend -- verdicts.portfolio`
Expected: PASS.

- [ ] **Step 5: Cablear el gate en opportunities.service.ts**

En `apps/backend/src/opportunities/opportunities.service.ts`, importar `applyLlmAction` desde `./verdicts.service.js` y reemplazar el bloque dentro del `for (const opp of opportunities)` que actualiza el verdict (el que hoy hace `opp.verdict.finalAction = unified.action` sin condición, ~líneas 904-921):

```typescript
      // Actualizar verdict chain con capa LLM (Stage 5b) — el LLM solo puede degradar.
      if (opp.verdict) {
        opp.verdict.layers.llmAction = unified.action;
        opp.verdict.layers.llmReason = unified.thesis.slice(0, 120);
        const gated = applyLlmAction(opp.verdict.finalAction, unified.action);
        if (gated !== opp.verdict.finalAction) {
          opp.verdict.trace.push(`llm:${unified.action} (${unified.thesis.slice(0, 60)})`);
          opp.verdict.finalAction = gated;
          opp.verdict.source = 'llm';
          opp.action = gated;
        } else if (unified.action !== opp.verdict.finalAction) {
          // El LLM quiso subir la acción: se registra pero NO se aplica.
          opp.verdict.trace.push(`llm:sugirió ${unified.action} — bloqueado (solo degrada)`);
        } else {
          opp.verdict.trace.push(`llm:confirma`);
        }
      } else {
        // Sin verdict previo: aplicar el mismo gate sobre la acción algorítmica.
        opp.action = applyLlmAction(opp.action, unified.action) as typeof opp.action;
      }
```

- [ ] **Step 6: Typecheck + suite completa**

Run: `npm run typecheck --workspace=apps/backend && npm run test --workspace=apps/backend`
Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add apps/backend/src/opportunities/verdicts.service.ts apps/backend/src/opportunities/opportunities.service.ts apps/backend/src/opportunities/verdicts.portfolio.test.ts
git commit -m "fix: el LLM solo puede degradar acciones, nunca subir WATCH/HOLD a BUY"
```

---

### Task 5: Barrera de calidad de universo (anti-SDOT)

**Files:**
- Modify: `apps/backend/src/opportunities/tradeability.ts` (agregar `meetsQualityBar`)
- Modify: `apps/backend/src/opportunities/opportunities.service.ts:790-796` (filtro del scan)
- Test: `apps/backend/src/opportunities/tradeability.test.ts` (agregar describe block)

**Interfaces:**
- Consumes: `fundMap: Map<string, FundamentalSummary>` ya en scope en `runScan` (se construye en la línea ~452); `FundamentalSummary.data.marketCap: number | null` de `@trading/shared`.
- Produces: `meetsQualityBar(meta: { marketCap?: number | null; currentPrice?: number | null }): boolean` exportada de `tradeability.ts`.

- [ ] **Step 1: Escribir los tests que fallan**

Agregar al final de `apps/backend/src/opportunities/tradeability.test.ts`:

```typescript
import { meetsQualityBar } from './tradeability.js';

describe('meetsQualityBar — barrera anti small-cap basura', () => {
  it('rechaza market cap < $500M (SDOT era ~$30M)', () => {
    expect(meetsQualityBar({ marketCap: 30_000_000, currentPrice: 24.58 })).toBe(false);
  });
  it('rechaza market cap desconocido (dato faltante = no pasa, no neutral)', () => {
    expect(meetsQualityBar({ marketCap: null, currentPrice: 50 })).toBe(false);
  });
  it('rechaza precio < $5 aunque el cap sea grande', () => {
    expect(meetsQualityBar({ marketCap: 2_000_000_000, currentPrice: 3.2 })).toBe(false);
  });
  it('acepta large-cap con precio normal', () => {
    expect(meetsQualityBar({ marketCap: 50_000_000_000, currentPrice: 180 })).toBe(true);
  });
  it('acepta justo en los umbrales', () => {
    expect(meetsQualityBar({ marketCap: 500_000_000, currentPrice: 5 })).toBe(true);
  });
});
```

- [ ] **Step 2: Correr y verificar que fallan**

Run: `npm run test --workspace=apps/backend -- tradeability`
Expected: FAIL — `meetsQualityBar` no existe.

- [ ] **Step 3: Implementar**

Agregar al final de `apps/backend/src/opportunities/tradeability.ts`:

```typescript
// Barrera de calidad: bajo estos umbrales el riesgo de pump-and-dump / iliquidez
// real supera cualquier edge del análisis. Dato faltante = NO pasa (fail-closed):
// si no sabemos cuánto vale la empresa, no la recomendamos.
const MIN_MARKET_CAP = Number(process.env.MIN_MARKET_CAP_USD ?? 500_000_000);
const MIN_QUALITY_PRICE = Number(process.env.MIN_QUALITY_PRICE_USD ?? 5);

export function meetsQualityBar(meta: { marketCap?: number | null; currentPrice?: number | null }): boolean {
  if (meta.marketCap == null || meta.marketCap < MIN_MARKET_CAP) return false;
  if (meta.currentPrice == null || meta.currentPrice < MIN_QUALITY_PRICE) return false;
  return true;
}
```

- [ ] **Step 4: Correr y verificar que pasan**

Run: `npm run test --workspace=apps/backend -- tradeability`
Expected: PASS.

- [ ] **Step 5: Cablear en el filtro del scan**

En `apps/backend/src/opportunities/opportunities.service.ts`, importar `meetsQualityBar` junto al import existente de `isTradeable`, y extender el filtro de tradeabilidad (~línea 792):

```typescript
    .filter((o) =>
      positionMap.has(o.symbol) ||
      (
        isTradeable({ name: o.classification?.name, instrumentType: o.classification?.instrumentType, avgDollarVolume: o.avgDollarVolume }) &&
        meetsQualityBar({ marketCap: fundMap.get(o.symbol)?.data.marketCap, currentPrice: o.currentPrice })
      ),
    )
```

(Las posiciones en cartera siguen exentas: siempre se muestran para poder decidir la salida.)

- [ ] **Step 6: Documentar las env vars**

Agregar a `.env.example`:

```
# Barrera de calidad del universo (anti small-caps basura)
MIN_MARKET_CAP_USD=500000000
MIN_QUALITY_PRICE_USD=5
```

- [ ] **Step 7: Typecheck + suite completa**

Run: `npm run typecheck --workspace=apps/backend && npm run test --workspace=apps/backend`
Expected: PASS.

- [ ] **Step 8: Commit**

```bash
git add apps/backend/src/opportunities/tradeability.ts apps/backend/src/opportunities/tradeability.test.ts apps/backend/src/opportunities/opportunities.service.ts .env.example
git commit -m "feat: barrera de calidad de universo (market cap >= 500M, precio >= 5)"
```

---

### Task 6: Market regime fail-safe (no perder el bloqueo bear en silencio)

**Files:**
- Modify: `apps/backend/src/evidence-signals/market-regime.service.ts` (catch final, ~líneas 99-112)
- Modify: `packages/shared/src/types/evidence-signals.ts` (agregar `degraded` al tipo del régimen)
- Modify: `apps/backend/src/evidence-signals/evidence-signals.service.ts:214-219` (gate de LONGs)
- Test: `apps/backend/src/evidence-signals/market-regime.service.test.ts` (agregar caso)

**Interfaces:**
- Consumes: tipo `MarketRegimeData` existente.
- Produces: `MarketRegimeData.degraded?: boolean` — true cuando el régimen NO pudo calcularse con datos frescos.

- [ ] **Step 1: Localizar el tipo y escribir el test que falla**

Buscar la definición de `MarketRegimeData` (está en `packages/shared/src/types/evidence-signals.ts` o en el propio service — verificar con `grep -rn "interface MarketRegimeData"`). Agregar el campo:

```typescript
  /** true = el régimen no pudo calcularse con datos frescos (fallo de fetch). Tratarlo como bloqueo de LONGs nuevos. */
  degraded?: boolean;
```

El test existente (`market-regime.service.test.ts`) solo testea helpers puros (`applyVixGate`) — no mockea I/O. Seguir ese patrón: extraer el fallback del catch como helper puro `buildDegradedRegime` y testearlo. Agregar al test file:

```typescript
import { applyVixGate, buildDegradedRegime } from './market-regime.service.js';

describe('buildDegradedRegime — fail-safe sin datos', () => {
  it('con régimen previo cacheado devuelve el previo marcado degraded (stale > ciego)', () => {
    const prev = { regime: 'bear' as const, spyPrice: 520, sma200: 540, priceVsSma200Pct: -3.7, checkedAt: '2026-07-01T12:00:00Z' };
    const res = buildDegradedRegime(prev);
    expect(res.regime).toBe('bear');
    expect(res.degraded).toBe(true);
  });

  it('sin régimen previo devuelve neutral degradado (NO operable como neutral real)', () => {
    const res = buildDegradedRegime(null);
    expect(res.regime).toBe('neutral');
    expect(res.degraded).toBe(true);
    expect(res.spyPrice).toBe(0);
  });
});
```

- [ ] **Step 2: Correr y verificar que falla**

Run: `npm run test --workspace=apps/backend -- market-regime`
Expected: FAIL — `degraded` es `undefined`.

- [ ] **Step 3: Implementar el fail-safe**

En `market-regime.service.ts`, agregar el helper puro exportado:

```typescript
/**
 * Fail-safe cuando el régimen no puede calcularse: mejor stale que ciego.
 * Devuelve el régimen previo marcado degraded, o un neutral degradado que los
 * consumidores deben tratar como bloqueo de LONGs nuevos (no como neutral real).
 */
export function buildDegradedRegime(prev: MarketRegimeData | null): MarketRegimeData {
  if (prev) return { ...prev, degraded: true };
  return {
    regime: 'neutral',
    degraded: true,
    spyPrice: 0,
    sma200: 0,
    priceVsSma200Pct: 0,
    checkedAt: new Date().toISOString(),
  };
}
```

Y reemplazar el catch final (el que hoy devuelve `regime: 'neutral', spyPrice: 0`):

```typescript
  } catch (err) {
    console.warn('[MarketRegime] Failed to compute regime:', (err as Error).message);
    const fallback = buildDegradedRegime(cachedRegime);
    // TTL corto para reintentar pronto en vez de cachear la ceguera todo el TTL normal.
    cachedRegime = fallback;
    cacheExpiresAt = Date.now() + 5 * 60 * 1000;
    return fallback;
  }
```

En el camino exitoso, asegurarse de que `degraded` quede `false` (agregar `degraded: false` al `result`).

- [ ] **Step 4: Bloquear LONGs con régimen degradado**

En `apps/backend/src/evidence-signals/evidence-signals.service.ts`, en el gate existente que bloquea señales LONG cuando `regime === 'bear'` (~líneas 214-219), extender la condición:

```typescript
if (regime.regime === 'bear' || regime.degraded) {
  // bear real O ceguera de datos: no emitir señales LONG nuevas
```

(Mantener el mensaje de log, agregando el motivo: `regime.degraded ? 'regime degraded (sin datos)' : 'bear market'`.)

- [ ] **Step 5: Correr tests + typecheck (incluye rebuild de shared)**

Run: `npm run build:shared && npm run typecheck --workspace=apps/backend && npm run test --workspace=apps/backend`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add packages/shared/src/types/evidence-signals.ts apps/backend/src/evidence-signals/market-regime.service.ts apps/backend/src/evidence-signals/evidence-signals.service.ts apps/backend/src/evidence-signals/market-regime.service.test.ts
git commit -m "fix: regimen de mercado degradado bloquea LONGs en vez de caer a neutral silencioso"
```

---

### Task 7: PEAD sin datos = NO confirmado

**Files:**
- Modify: `apps/backend/src/evidence-signals/pead.service.ts:54-68` (función `validatePriceDirection`)
- Test: crear `apps/backend/src/evidence-signals/pead.service.test.ts` si no existe (verificar primero; si `validatePriceDirection` no está exportada, exportarla para testearla)

**Interfaces:**
- Consumes: nada nuevo.
- Produces: mismo shape `{ confirmed: boolean; changePct: number | null }`, semántica fail-closed.

- [ ] **Step 1: Exportar la función y escribir los tests que fallan**

Cambiar `function validatePriceDirection(` por `export function validatePriceDirection(` en `pead.service.ts`. Crear `apps/backend/src/evidence-signals/pead.service.test.ts`:

```typescript
import { describe, it, expect } from 'vitest';
import { validatePriceDirection } from './pead.service.js';

describe('validatePriceDirection — fail-closed sin datos', () => {
  it('sin histórico OHLC NO confirma la señal (antes confirmaba por defecto)', () => {
    const res = validatePriceDirection('2026-06-15', []);
    expect(res.confirmed).toBe(false);
    expect(res.changePct).toBeNull();
  });

  it('sin velas pre-earnings NO confirma', () => {
    const res = validatePriceDirection('2026-06-15', [
      { date: '2026-06-16', open: 10, high: 11, low: 9.5, close: 10.5, volume: 1000 },
    ]);
    expect(res.confirmed).toBe(false);
  });

  it('subida real post-earnings confirma', () => {
    const res = validatePriceDirection('2026-06-15', [
      { date: '2026-06-13', open: 10, high: 10.2, low: 9.8, close: 10, volume: 1000 },
      { date: '2026-06-16', open: 10.5, high: 11.5, low: 10.4, close: 11.2, volume: 2000 },
    ]);
    expect(res.confirmed).toBe(true);
    expect(res.changePct).toBeGreaterThan(0);
  });
});
```

(Ajustar el shape del candle al tipo `OHLC` real que usa el archivo — verificar el import de `OHLC` en `pead.service.ts`.)

- [ ] **Step 2: Correr y verificar que fallan**

Run: `npm run test --workspace=apps/backend -- pead`
Expected: FAIL — los dos primeros tests (hoy devuelve `confirmed: true` sin datos).

- [ ] **Step 3: Implementar fail-closed**

En `validatePriceDirection`, cambiar los tres early-returns de `{ confirmed: true, changePct: null }` a `{ confirmed: false, changePct: null }` y actualizar el docstring:

```typescript
/**
 * Validates that price actually moved up post-earnings.
 * This catches "beat EPS but sold off on guidance cut" cases — those are NOT PEAD candidates.
 *
 * Fail-closed: sin datos de precio NO se confirma la dirección. Una señal PEAD
 * sin confirmación de precio no es señal.
 */
```

- [ ] **Step 4: Correr y verificar que pasan + suite completa**

Run: `npm run test --workspace=apps/backend`
Expected: PASS. Si algún test existente de PEAD asumía `confirmed:true` sin datos, actualizarlo — el comportamiento nuevo es el correcto.

- [ ] **Step 5: Commit**

```bash
git add apps/backend/src/evidence-signals/pead.service.ts apps/backend/src/evidence-signals/pead.service.test.ts
git commit -m "fix: PEAD sin datos de precio no confirma la señal (fail-closed)"
```

---

### Task 8: Timeout en todas las llamadas LLM cloud

**Files:**
- Create: `apps/backend/src/shared/with-timeout.ts`
- Create: `apps/backend/src/shared/with-timeout.test.ts`
- Modify: `apps/backend/src/shared/ai-router.ts` (función `tryProvider`, ~línea 51)

**Interfaces:**
- Consumes: nada nuevo.
- Produces: `withTimeout<T>(promise: Promise<T>, ms: number, label: string): Promise<T>` — rechaza con `Error('<label> timed out after <ms>ms')`.

- [ ] **Step 1: Escribir los tests que fallan**

Crear `apps/backend/src/shared/with-timeout.test.ts`:

```typescript
import { describe, it, expect } from 'vitest';
import { withTimeout } from './with-timeout.js';

describe('withTimeout', () => {
  it('resuelve normal si la promesa termina antes del límite', async () => {
    const result = await withTimeout(Promise.resolve(42), 1000, 'test');
    expect(result).toBe(42);
  });

  it('rechaza cuando la promesa excede el límite', async () => {
    const slow = new Promise((resolve) => setTimeout(resolve, 5000));
    await expect(withTimeout(slow, 50, 'gemini')).rejects.toThrow('gemini timed out after 50ms');
  });

  it('propaga el error original si la promesa falla antes del límite', async () => {
    await expect(withTimeout(Promise.reject(new Error('boom')), 1000, 'test')).rejects.toThrow('boom');
  });
});
```

- [ ] **Step 2: Correr y verificar que fallan**

Run: `npm run test --workspace=apps/backend -- with-timeout`
Expected: FAIL — módulo no existe.

- [ ] **Step 3: Implementar**

Crear `apps/backend/src/shared/with-timeout.ts`:

```typescript
/**
 * Envuelve una promesa con un límite de tiempo. Los SDKs de Groq/Gemini/OpenRouter
 * no traen timeout configurado y el pipeline corre stages en serie: una llamada
 * colgada bloquea el run entero (caso real: un news-radar tardó 91 minutos).
 * Al rechazar, el ai-router pasa al siguiente proveedor de la cadena.
 */
export function withTimeout<T>(promise: Promise<T>, ms: number, label: string): Promise<T> {
  let timer: ReturnType<typeof setTimeout>;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new Error(`${label} timed out after ${ms}ms`)), ms);
  });
  return Promise.race([promise, timeout]).finally(() => clearTimeout(timer!)) as Promise<T>;
}
```

- [ ] **Step 4: Correr y verificar que pasan**

Run: `npm run test --workspace=apps/backend -- with-timeout`
Expected: PASS.

- [ ] **Step 5: Cablear en el ai-router**

En `apps/backend/src/shared/ai-router.ts`, importar `withTimeout` desde `./with-timeout.js`. La función `tryProvider(name, fn, validateJSON)` (~línea 51) tiene un único punto de invocación: `const raw = await fn();`. Reemplazarlo:

```typescript
const LLM_TIMEOUT_MS = Number(process.env.LLM_TIMEOUT_MS ?? 90_000);
```

y dentro de `tryProvider`:

```typescript
    const raw = await withTimeout(fn(), LLM_TIMEOUT_MS, name);
```

El timeout rechaza → el `catch` existente de `tryProvider` ya loguea y devuelve `null`, con lo cual la cadena cae al siguiente proveedor. Toda llamada LLM del sistema pasa por acá (los tres entry points `callAI`/`callAIWithModel`/`callAIText` usan `tryProvider`), así que este único cambio cubre Groq, Gemini, OpenRouter y LM Studio.

Agregar a `.env.example`:

```
# Timeout por llamada LLM (ms) — una llamada colgada no puede bloquear el pipeline
LLM_TIMEOUT_MS=90000
```

- [ ] **Step 6: Typecheck + suite completa**

Run: `npm run typecheck --workspace=apps/backend && npm run test --workspace=apps/backend`
Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add apps/backend/src/shared/with-timeout.ts apps/backend/src/shared/with-timeout.test.ts apps/backend/src/shared/ai-router.ts .env.example
git commit -m "fix: timeout de 90s en toda llamada LLM (una llamada colgada no bloquea el pipeline)"
```

---

### Task 9: Verificación end-to-end del P0

**Files:** ninguno nuevo — verificación integrada.

- [ ] **Step 1: Suite completa + typecheck de todo el monorepo**

Run: `npm run build:shared && npm run typecheck && npm run test --workspace=apps/backend`
Expected: PASS completo.

- [ ] **Step 2: Verificar accuracy real post-backfill**

```bash
sqlite3 data/trading.db "SELECT action, outcome, COUNT(*) FROM signal_tracking WHERE outcome NOT IN ('pending') GROUP BY action, outcome ORDER BY action"
```
Expected: distribución creíble (los WATCH ya no son ~100% win; existen filas `invalid`).

- [ ] **Step 3: Smoke test del pipeline**

Levantar el backend (`npm run dev:backend`) y disparar un scan desde la UI o vía tRPC. Verificar en los logs:
- El filtro de calidad descarta símbolos (buscar símbolos small-cap conocidos de `discovered_symbols` como MAAS/ESP que ya no aparecen en oportunidades).
- Ningún trace de verdict contiene un upgrade `WATCH→BUY` por LLM; los bloqueados aparecen como `llm:sugirió BUY — bloqueado`.

- [ ] **Step 4: Commit final si hubo ajustes**

```bash
git add -A && git commit -m "chore: ajustes de verificación P0"
```

---

## Backlog — P1 / P2 (planes futuros, NO ejecutar con este plan)

Estos ítems salieron de la misma auditoría (2026-07-02) pero son subsistemas independientes; cada grupo merece su propio plan cuando el P0 esté mergeado y validado:

**P1 (próximo plan sugerido: performance y tokens):**
1. Tracking real de tokens: leer `response.usage` en groq/gemini/openrouter/claude y persistir en `unified_analysis_batches.tokens_input/output` (columnas ya existen, hoy null).
2. Salida LLM con JSON schema forzado (tool use / structured outputs) en vez de `jsonrepair`.
3. Cron pre-market del pipeline (7:00-7:30 ET) + run post-cierre; hoy solo corre manual.
4. Deduplicar news-radar (corre desde cron horario + pipeline + refresh = hasta 3x sobre los mismos artículos; filtrar a "solo artículos nuevos").
5. Triangulación única por ciclo (hoy corre 2x, es O(n²)).
6. Paralelizar batches de unified-analysis (hoy en serie; límite de concurrencia 2-3).
7. Batch de `getQuote` en los 5 servicios con loops seriales (usar `getQuotes`).
8. Candle intradía: no inyectar quote con `volume: 0` al histórico (corrompe OBV/volume-ratio).
9. Win en R-múltiplos vs benchmark (redefinir win = ≥ +1R o target-first, comparado contra SPY).
10. Limpiar model IDs inválidos de OpenRouter (`llama-4-scout:free`, `gemma-4-31b-it:free`) y actualizar Claude del chat (`claude-sonnet-4-20250514` → `claude-sonnet-5`).

**P2 (planes posteriores):**
1. Prompt caching (Anthropic `cache_control` / Gemini) + migrar etapas reasoning a Claude Sonnet 5; dejar de reenviar el universo de ~195 símbolos en cada batch de news-intelligence.
2. Snapshots diarios de scores completos → backtest multi-factor real en 3-6 meses.
3. Reportes con clase de riesgo (mega/large/mid/small/especulativo), liquidez y confianza calibrada (Brier / accuracy por bucket).
4. Reglas de salida por invalidación de tesis y por tiempo; toma parcial en +1R.
5. Índices DB en `opportunity_snapshots`/`web_search_articles`/`news_articles` + job de retención + VACUUM; borrar `trading.db.backup` stale.
6. Unificar los dos calibradores de pesos (el de quant se calcula y no se aplica a nada).
7. Cuarentena de 48h para tickers sugeridos por LLM antes de entrar al universo; regex de discovery más estricto.
8. Off-by-one en divergencia RSI (`technical-analysis.service.ts:120-138`).
9. `earningsSurprise` mal definido (mezcla EPS trailing con estimate forward).
10. Sizing reducido (0.25-0.5% riesgo) para clase "especulativo" + cap de exposición agregada.
