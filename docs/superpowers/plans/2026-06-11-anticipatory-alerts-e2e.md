# Anticipatory Alerts E2E + Coherencia Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Alertas anticipatorias bullish (confluencia ≥2 señales) de punta a punta — motor, persistencia, tRPC, frontend, notificaciones — más fixes de coherencia: feedback al veredicto, scans parciales marcados, news degradado graceful, grounding de prompts y alertas de stop-loss.

**Architecture:** Funciones puras TDD en `apps/backend/src/opportunities/anticipatory-alerts.ts` leen señales que el motor ya computa (`divergences` + `timingView.triggers`). Un campo `direction` explícito en `TimingTrigger` reemplaza string-matching. La confluencia alimenta el veredicto (capa smart) ANTES de la proyección del digest, así todas las superficies heredan el mismo discurso. Persistencia en SQLite (drizzle), entrega vía tRPC + sección fijada en Daily + badge/tab + Notification API.

**Tech Stack:** TypeScript ESM, drizzle-orm/better-sqlite3, tRPC v11, vitest, React + TanStack Query, node-cron.

**Spec:** `docs/superpowers/specs/2026-06-11-anticipatory-alerts-design.md`

**Comandos de verificación globales:**
- Tests backend: `npm run test --workspace=apps/backend` (o `npx vitest run <file>` desde `apps/backend/`)
- Typecheck: `npm run typecheck`
- Migración DB: `npm run db:generate --workspace=apps/backend` + `npm run db:migrate --workspace=apps/backend`

**Convención de commits:** un commit por task, mensaje indicado en cada task.

---

## FASE 1 — Motor: dirección explícita + señales + veredicto

### Task 1: Campo `direction` en TimingTrigger

**Files:**
- Modify: `packages/shared/src/types/technical.ts:12-27`
- Modify: `packages/shared/src/types/opportunity.ts:63-73` (TimingView inline triggers)
- Modify: `apps/backend/src/technical/timing-analysis.service.ts` (todos los constructores de triggers)
- Test: `apps/backend/src/technical/timing-direction.test.ts` (nuevo)

Hoy la dirección vive solo en el texto (`isBuyTrigger` matchea `'alcista'`/`'sobreventa'` en `description`, líneas 298-324). Frágil. Agregamos `direction` explícito en el origen.

- [ ] **Step 1: Escribir el test que falla**

Crear `apps/backend/src/technical/timing-direction.test.ts`:

```typescript
import { describe, it, expect } from 'vitest';
import { analyzeTimingSignals } from './timing-analysis.service.js';
import type { OHLC, TechnicalIndicators } from '@trading/shared';

function baseIndicators(overrides: Partial<TechnicalIndicators> = {}): TechnicalIndicators {
  return {
    rsi14: 50, macd: null, sma20: 100, sma50: 100, sma200: 100,
    bollingerBands: null, currentPrice: 100,
    priceVsSma20: 0, priceVsSma50: 0, priceVsSma200: 0, volumeRatio: 1,
    stochastic: null, atr14: null, atrPercent: null,
    obvTrend: null, obvDivergence: false,
    supports: [], resistances: [], nearestSupport: null, nearestResistance: null,
    crossovers: null, bbSqueeze: false, bbSqueezeIntensity: null,
    ...overrides,
  };
}

function flatHistory(days = 60, close = 100): OHLC[] {
  return Array.from({ length: days }, (_, i) => ({
    date: `2026-01-${String((i % 28) + 1).padStart(2, '0')}`,
    open: close, high: close, low: close, close, volume: 1000,
  }));
}

describe('TimingTrigger.direction', () => {
  it('golden cross inminente → direction bullish', () => {
    const ind = baseIndicators({
      crossovers: { goldenCross: false, deathCross: false, sma20Above50: true, estimatedDaysToCross: 4, crossDirection: 'golden' },
    });
    const result = analyzeTimingSignals(flatHistory(), ind);
    const t = result.triggers.find(t => t.type === 'sma_cross');
    expect(t?.direction).toBe('bullish');
  });

  it('death cross confirmado → direction bearish', () => {
    const ind = baseIndicators({
      crossovers: { goldenCross: false, deathCross: true, sma20Above50: false, estimatedDaysToCross: null, crossDirection: 'death' },
    });
    const result = analyzeTimingSignals(flatHistory(), ind);
    const t = result.triggers.find(t => t.type === 'sma_cross');
    expect(t?.direction).toBe('bearish');
  });

  it('RSI sobreventa → direction bullish; sobrecompra → bearish', () => {
    const oversold = analyzeTimingSignals(flatHistory(), baseIndicators({ rsi14: 25 }));
    expect(oversold.triggers.find(t => t.type === 'rsi_zone')?.direction).toBe('bullish');
    const overbought = analyzeTimingSignals(flatHistory(), baseIndicators({ rsi14: 75 }));
    expect(overbought.triggers.find(t => t.type === 'rsi_zone')?.direction).toBe('bearish');
  });

  it('bb_squeeze: dirección sigue priceVsSma20', () => {
    const bull = analyzeTimingSignals(flatHistory(), baseIndicators({ bbSqueeze: true, bbSqueezeIntensity: 90, priceVsSma20: 2 }));
    expect(bull.triggers.find(t => t.type === 'bb_squeeze')?.direction).toBe('bullish');
    const bear = analyzeTimingSignals(flatHistory(), baseIndicators({ bbSqueeze: true, bbSqueezeIntensity: 90, priceVsSma20: -2 }));
    expect(bear.triggers.find(t => t.type === 'bb_squeeze')?.direction).toBe('bearish');
  });

  it('OBV divergence: rising → bullish, falling → bearish', () => {
    const bull = analyzeTimingSignals(flatHistory(), baseIndicators({ obvDivergence: true, obvTrend: 'rising' }));
    expect(bull.triggers.find(t => t.type === 'obv_divergence')?.direction).toBe('bullish');
    const bear = analyzeTimingSignals(flatHistory(), baseIndicators({ obvDivergence: true, obvTrend: 'falling' }));
    expect(bear.triggers.find(t => t.type === 'obv_divergence')?.direction).toBe('bearish');
  });

  it('support_bounce → bullish, resistance_break → bearish (anticipan rebote/rechazo)', () => {
    // support_bounce: precio cayendo hacia soporte
    const falling: OHLC[] = Array.from({ length: 60 }, (_, i) => {
      const close = 110 - i * 0.5; // cae $0.5/día
      return { date: `d${i}`, open: close, high: close, low: close, close, volume: 1000 };
    });
    const ind = baseIndicators({
      currentPrice: falling[falling.length - 1].close,
      supports: [{ price: falling[falling.length - 1].close - 3, strength: 2, touches: 3 }],
    });
    const result = analyzeTimingSignals(falling, ind);
    expect(result.triggers.find(t => t.type === 'support_bounce')?.direction).toBe('bullish');
  });
});
```

- [ ] **Step 2: Correr el test y verificar que falla**

Run: `cd apps/backend && npx vitest run src/technical/timing-direction.test.ts`
Expected: FAIL — `direction` es `undefined` (la propiedad no existe en el tipo ni en los objetos).

- [ ] **Step 3: Agregar `direction` al tipo compartido**

En `packages/shared/src/types/technical.ts`, dentro de `TimingTrigger` (después de `description`):

```typescript
export interface TimingTrigger {
  type:
    | 'sma_cross'
    | 'rsi_zone'
    | 'bb_squeeze'
    | 'support_bounce'
    | 'resistance_break'
    | 'stoch_cross'
    | 'obv_divergence'
    | 'macd_cross'
    | 'rsi_divergence'
    | 'macd_divergence';
  description: string;
  /** Dirección explícita de la señal — NO derivar del texto de description. */
  direction: 'bullish' | 'bearish' | 'neutral';
  estimatedDays: number | null;
  impact: 'high' | 'medium';
}
```

En `packages/shared/src/types/opportunity.ts`, en `TimingView.triggers` (inline type, líneas 67-72), agregar la misma propiedad:

```typescript
  triggers: {
    type: string;
    description: string;
    direction: 'bullish' | 'bearish' | 'neutral';
    estimatedDays: number | null;
    impact: 'high' | 'medium';
  }[];
```

- [ ] **Step 4: Setear `direction` en cada constructor de trigger**

En `apps/backend/src/technical/timing-analysis.service.ts`, agregar `direction` a CADA objeto trigger:

| Función | Caso | direction |
|---|---|---|
| `estimateSMACrossoverDays` | goldenCross confirmado (línea 22) | `'bullish'` |
| | deathCross confirmado (línea 31) | `'bearish'` |
| | cross estimado (línea 43) | `crossDirection === 'golden' ? 'bullish' : 'bearish'` |
| `estimateRSIZoneEntry` | RSI < 30 (línea 64) | `'bullish'` |
| | RSI > 70 (línea 72) | `'bearish'` |
| | approaching oversold (línea 90) | `'bullish'` |
| | approaching overbought (línea 103) | `'bearish'` |
| `estimateSupportResistanceArrival` | support_bounce (línea 148) | `'bullish'` |
| | resistance_break (línea 165) | `'bearish'` |
| `estimateBBSqueezeTiming` | (línea 186) | `indicators.priceVsSma20 > 0 ? 'bullish' : 'bearish'` |
| `estimateMACDCross` | (línea 230) | `crossingUp ? 'bullish' : 'bearish'` |
| `estimateStochasticCross` | k<25 cruce up (línea 247) | `'bullish'` |
| | k>75 cruce down (línea 257) | `'bearish'` |
| `estimateOBVDivergence` | rising (línea 274) | `'bullish'` |
| | falling (línea 283) | `'bearish'` |

Ejemplo del primero (golden cross confirmado):

```typescript
  if (indicators.crossovers.goldenCross) {
    return {
      type: 'sma_cross',
      description: 'Golden Cross (SMA50 cruzó SMA200 hacia arriba) — señal alcista confirmada',
      direction: 'bullish',
      estimatedDays: 0,
      impact: 'high',
    };
  }
```

- [ ] **Step 5: Refactor isBuyTrigger/isSellTrigger para usar direction**

Reemplazar los cuerpos de `isBuyTrigger` (líneas 298-310) e `isSellTrigger` (líneas 312-324):

```typescript
function isBuyTrigger(t: TimingTrigger): boolean {
  return t.direction === 'bullish';
}

function isSellTrigger(t: TimingTrigger): boolean {
  return t.direction === 'bearish';
}
```

- [ ] **Step 6: Compilar y arreglar TODOS los demás sitios de construcción**

Run: `npm run build:shared && npm run typecheck`
Expected: errores TS2741 ("Property 'direction' is missing") en cada lugar que construya `TimingTrigger` fuera de timing-analysis (ej. triggers de divergencia semanal en `scoring.ts` y `technical-analysis.service.ts` si existen — buscar con `grep -rn "type: 'rsi_divergence'\|type: 'macd_divergence'" apps/backend/src`). En cada sitio: si el trigger viene de un `DivergenceSignal`, usar `direction: d.type === 'bullish' ? 'bullish' : 'bearish'`. Repetir typecheck hasta limpio.

- [ ] **Step 7: Correr tests y verificar que pasan**

Run: `cd apps/backend && npx vitest run src/technical/timing-direction.test.ts && npm run test`
Expected: PASS (todos, incluidos los suites preexistentes).

- [ ] **Step 8: Commit**

```bash
git add packages/shared/src/types apps/backend/src
git commit -m "feat(timing): direction explicito en TimingTrigger (fin del string-matching)"
```

---

### Task 2: Funciones puras `extractBullishSignals` + `buildAlertsFromScan`

**Files:**
- Create: `packages/shared/src/types/anticipatory-alert.ts`
- Modify: `packages/shared/src/types/index.ts` (export)
- Create: `apps/backend/src/opportunities/anticipatory-alerts.ts`
- Test: `apps/backend/src/opportunities/anticipatory-alerts.test.ts`

Reglas de la spec: gate de anticipación (`estimatedDays ≥ 1`, excepción `rsi_zone` oversold-now), dedup de divergencias (`*_divergence` → categoría `divergence`), confluencia ≥2 categorías distintas, regla de conflicto (divergencia bajista o `timingView.action === 'SELL'` → sin alerta).

- [ ] **Step 1: Crear los tipos compartidos**

`packages/shared/src/types/anticipatory-alert.ts`:

```typescript
export type BullishSignalCategory =
  | 'divergence'
  | 'golden_cross'
  | 'bb_squeeze'
  | 'macd_cross'
  | 'oversold_bounce';

export interface BullishSignal {
  category: BullishSignalCategory;
  description: string;       // verbatim de la señal del motor
  estimatedDays: number | null;
  timeframe?: 'daily' | 'weekly';
}

export type AnticipatoryAlertStatus = 'active' | 'triggered' | 'expired';

export interface AnticipatoryAlert {
  /** Clave estable: `${symbol}:${categorias ordenadas join '+'}` (kind anticipatory) o `stop:${symbol}` (stop_breach). */
  id: string;
  kind: 'anticipatory' | 'stop_breach';
  symbol: string;
  signals: BullishSignal[];
  currentPrice: number;
  entryPrice?: number;
  stopLoss?: number;
  takeProfit?: number;
  score: number;             // opportunityScore
  status: AnticipatoryAlertStatus;
  firstSeenDate: string;     // YYYY-MM-DD
  lastSeenDate: string;
  seen: boolean;
}
```

En `packages/shared/src/types/index.ts` agregar (siguiendo el patrón de los demás exports):

```typescript
export * from './anticipatory-alert.js';
```

Run: `npm run build:shared`
Expected: compila sin errores.

- [ ] **Step 2: Escribir los tests que fallan**

`apps/backend/src/opportunities/anticipatory-alerts.test.ts`:

```typescript
import { describe, it, expect } from 'vitest';
import { extractBullishSignals, buildAlertsFromScan, type AlertSource } from './anticipatory-alerts.js';

function makeOpp(overrides: Partial<AlertSource> = {}): AlertSource {
  return {
    symbol: 'GGAL',
    currentPrice: 50,
    opportunityScore: 55,
    divergences: [],
    timingView: undefined,
    tradeLevels: undefined,
    ...overrides,
  };
}

const trigger = (type: string, direction: 'bullish' | 'bearish' | 'neutral', estimatedDays: number | null) => ({
  type, direction, estimatedDays, description: `${type} ${direction} ~${estimatedDays}d`, impact: 'high' as const,
});

describe('extractBullishSignals', () => {
  it('divergencia alcista → categoria divergence', () => {
    const signals = extractBullishSignals(makeOpp({
      divergences: [{ type: 'bullish', indicator: 'macd', timeframe: 'weekly', description: 'Divergencia alcista MACD semanal' }],
    }));
    expect(signals).toHaveLength(1);
    expect(signals[0].category).toBe('divergence');
    expect(signals[0].timeframe).toBe('weekly');
  });

  it('gate de anticipacion: sma_cross con estimatedDays 0 (ya ocurrio) NO cuenta; >=1 si', () => {
    const confirmado = extractBullishSignals(makeOpp({
      timingView: { action: 'BUY', timing: 'now', confidence: 80, triggers: [trigger('sma_cross', 'bullish', 0)] },
    }));
    expect(confirmado).toHaveLength(0);

    const inminente = extractBullishSignals(makeOpp({
      timingView: { action: 'BUY', timing: 'soon', confidence: 80, triggers: [trigger('sma_cross', 'bullish', 4)] },
    }));
    expect(inminente).toHaveLength(1);
    expect(inminente[0].category).toBe('golden_cross');
  });

  it('excepcion rsi_zone: oversold-now (estimatedDays 0) SI cuenta — el rebote es lo anticipado', () => {
    const signals = extractBullishSignals(makeOpp({
      timingView: { action: 'BUY', timing: 'now', confidence: 70, triggers: [trigger('rsi_zone', 'bullish', 0)] },
    }));
    expect(signals).toHaveLength(1);
    expect(signals[0].category).toBe('oversold_bounce');
  });

  it('dedup: *_divergence triggers mapean a divergence — misma divergencia en ambos lados = 1 categoria', () => {
    const signals = extractBullishSignals(makeOpp({
      divergences: [{ type: 'bullish', indicator: 'rsi', timeframe: 'daily', description: 'Div alcista RSI' }],
      timingView: { action: 'BUY', timing: 'soon', confidence: 70, triggers: [trigger('rsi_divergence', 'bullish', 3)] },
    }));
    const categories = new Set(signals.map(s => s.category));
    expect(categories.size).toBe(1);
    expect([...categories][0]).toBe('divergence');
  });

  it('señales bearish nunca cuentan', () => {
    const signals = extractBullishSignals(makeOpp({
      divergences: [{ type: 'bearish', indicator: 'rsi', timeframe: 'daily', description: 'Div bajista' }],
      timingView: { action: 'SELL', timing: 'soon', confidence: 70, triggers: [trigger('macd_cross', 'bearish', 2)] },
    }));
    expect(signals).toHaveLength(0);
  });

  it('stoch_cross y triggers fuera de taxonomia se ignoran', () => {
    const signals = extractBullishSignals(makeOpp({
      timingView: { action: 'BUY', timing: 'now', confidence: 70, triggers: [trigger('stoch_cross', 'bullish', 0), trigger('resistance_break', 'bearish', 3)] },
    }));
    expect(signals).toHaveLength(0);
  });
});

describe('buildAlertsFromScan', () => {
  const SCAN_DATE = '2026-06-11';

  it('<2 categorias → sin alerta', () => {
    const alerts = buildAlertsFromScan([makeOpp({
      divergences: [{ type: 'bullish', indicator: 'macd', timeframe: 'weekly', description: 'Div alcista MACD semanal' }],
    })], SCAN_DATE);
    expect(alerts).toHaveLength(0);
  });

  it('>=2 categorias distintas → alerta con id estable y ambas señales', () => {
    const alerts = buildAlertsFromScan([makeOpp({
      divergences: [{ type: 'bullish', indicator: 'macd', timeframe: 'weekly', description: 'Div alcista MACD semanal' }],
      timingView: { action: 'BUY', timing: 'soon', confidence: 80, triggers: [trigger('macd_cross', 'bullish', 3)] },
    })], SCAN_DATE);
    expect(alerts).toHaveLength(1);
    expect(alerts[0].id).toBe('GGAL:divergence+macd_cross');
    expect(alerts[0].signals).toHaveLength(2);
    expect(alerts[0].status).toBe('active');
    expect(alerts[0].firstSeenDate).toBe(SCAN_DATE);
    expect(alerts[0].seen).toBe(false);
    expect(alerts[0].kind).toBe('anticipatory');
  });

  it('entry/stop/target desde tradeLevels; fallback a currentPrice', () => {
    const conLevels = buildAlertsFromScan([makeOpp({
      divergences: [{ type: 'bullish', indicator: 'rsi', timeframe: 'daily', description: 'd' }],
      timingView: { action: 'BUY', timing: 'soon', confidence: 80, triggers: [trigger('bb_squeeze', 'bullish', 1)] },
      tradeLevels: { entryPrice: 49, stopLoss: 46, takeProfit: 58 },
    })], SCAN_DATE)[0];
    expect(conLevels.entryPrice).toBe(49);
    expect(conLevels.stopLoss).toBe(46);
    expect(conLevels.takeProfit).toBe(58);

    const sinLevels = buildAlertsFromScan([makeOpp({
      divergences: [{ type: 'bullish', indicator: 'rsi', timeframe: 'daily', description: 'd' }],
      timingView: { action: 'BUY', timing: 'soon', confidence: 80, triggers: [trigger('bb_squeeze', 'bullish', 1)] },
    })], SCAN_DATE)[0];
    expect(sinLevels.entryPrice).toBe(50);
    expect(sinLevels.stopLoss).toBeUndefined();
  });

  it('regla de conflicto: divergencia bajista presente → sin alerta aunque haya confluencia bullish', () => {
    const alerts = buildAlertsFromScan([makeOpp({
      divergences: [
        { type: 'bullish', indicator: 'macd', timeframe: 'weekly', description: 'd' },
        { type: 'bearish', indicator: 'rsi', timeframe: 'daily', description: 'd' },
      ],
      timingView: { action: 'BUY', timing: 'soon', confidence: 80, triggers: [trigger('macd_cross', 'bullish', 3)] },
    })], SCAN_DATE);
    expect(alerts).toHaveLength(0);
  });

  it('regla de conflicto: timingView.action SELL → sin alerta', () => {
    const alerts = buildAlertsFromScan([makeOpp({
      divergences: [{ type: 'bullish', indicator: 'macd', timeframe: 'weekly', description: 'd' }],
      timingView: { action: 'SELL', timing: 'soon', confidence: 80, triggers: [trigger('macd_cross', 'bullish', 3)] },
    })], SCAN_DATE);
    expect(alerts).toHaveLength(0);
  });
});
```

- [ ] **Step 3: Correr tests y verificar que fallan**

Run: `cd apps/backend && npx vitest run src/opportunities/anticipatory-alerts.test.ts`
Expected: FAIL — módulo `./anticipatory-alerts.js` no existe.

- [ ] **Step 4: Implementar**

`apps/backend/src/opportunities/anticipatory-alerts.ts`:

```typescript
import type {
  AnticipatoryAlert,
  BullishSignal,
  BullishSignalCategory,
  DivergenceSignal,
  TimingView,
} from '@trading/shared';

/**
 * Subset estructural de Opportunity que necesita el detector. El scan completo
 * lo satisface (mismo patron que RecommendationSource en digest-recommendations).
 */
export interface AlertSource {
  symbol: string;
  currentPrice: number;
  opportunityScore: number;
  divergences?: DivergenceSignal[];
  timingView?: TimingView;
  tradeLevels?: { entryPrice: number; stopLoss: number; takeProfit: number };
}

/** trigger.type → categoria. *_divergence colapsa en 'divergence' (dedup anti-confluencia-falsa). */
const TRIGGER_CATEGORY: Record<string, BullishSignalCategory> = {
  sma_cross: 'golden_cross',
  bb_squeeze: 'bb_squeeze',
  macd_cross: 'macd_cross',
  rsi_zone: 'oversold_bounce',
  rsi_divergence: 'divergence',
  macd_divergence: 'divergence',
  obv_divergence: 'divergence',
};

/**
 * Gate de anticipacion: estimatedDays === 0 significa "ya ocurrio" (confirmatorio).
 * Solo rsi_zone escapa al gate: la zona ES el setup, el rebote (lo anticipado) aun no paso.
 */
function passesAnticipationGate(type: string, estimatedDays: number | null): boolean {
  if (type === 'rsi_zone') return true;
  if (type.endsWith('_divergence')) return true; // divergencias anticipan reversal por naturaleza
  return estimatedDays != null && estimatedDays >= 1;
}

export function extractBullishSignals(opp: AlertSource): BullishSignal[] {
  const signals: BullishSignal[] = [];

  for (const d of opp.divergences ?? []) {
    if (d.type !== 'bullish') continue;
    signals.push({
      category: 'divergence',
      description: d.description,
      estimatedDays: null,
      timeframe: d.timeframe,
    });
  }

  for (const t of opp.timingView?.triggers ?? []) {
    if (t.direction !== 'bullish') continue;
    const category = TRIGGER_CATEGORY[t.type];
    if (!category) continue; // stoch_cross, support_bounce, resistance_break: fuera de taxonomia v1
    if (!passesAnticipationGate(t.type, t.estimatedDays)) continue;
    // dedup: si ya hay señal de divergencia (desde opp.divergences), no duplicar la categoria
    if (category === 'divergence' && signals.some(s => s.category === 'divergence')) continue;
    signals.push({ category, description: t.description, estimatedDays: t.estimatedDays });
  }

  return signals;
}

/** Regla de conflicto: tape contradictorio = sin alerta. Un override bajista siempre gana. */
export function hasBearishConflict(opp: AlertSource): boolean {
  if ((opp.divergences ?? []).some(d => d.type === 'bearish')) return true;
  if (opp.timingView?.action === 'SELL') return true;
  return false;
}

export function buildAlertsFromScan(opps: AlertSource[], scanDate: string): AnticipatoryAlert[] {
  const alerts: AnticipatoryAlert[] = [];

  for (const opp of opps) {
    if (hasBearishConflict(opp)) continue;
    const signals = extractBullishSignals(opp);
    const categories = [...new Set(signals.map(s => s.category))].sort();
    if (categories.length < 2) continue;

    alerts.push({
      id: `${opp.symbol}:${categories.join('+')}`,
      kind: 'anticipatory',
      symbol: opp.symbol,
      signals,
      currentPrice: opp.currentPrice,
      entryPrice: opp.tradeLevels?.entryPrice ?? opp.currentPrice,
      stopLoss: opp.tradeLevels?.stopLoss,
      takeProfit: opp.tradeLevels?.takeProfit,
      score: opp.opportunityScore,
      status: 'active',
      firstSeenDate: scanDate,
      lastSeenDate: scanDate,
      seen: false,
    });
  }

  return alerts;
}
```

- [ ] **Step 5: Correr tests y verificar que pasan**

Run: `cd apps/backend && npx vitest run src/opportunities/anticipatory-alerts.test.ts`
Expected: PASS (12 tests).

- [ ] **Step 6: Commit**

```bash
git add packages/shared/src/types apps/backend/src/opportunities/anticipatory-alerts.ts apps/backend/src/opportunities/anticipatory-alerts.test.ts
git commit -m "feat(alerts): deteccion de confluencia bullish con gate de anticipacion y dedup"
```

---

### Task 3: `reconcileAlerts` (lifecycle / dedup diario)

**Files:**
- Modify: `apps/backend/src/opportunities/anticipatory-alerts.ts`
- Test: `apps/backend/src/opportunities/anticipatory-alerts.test.ts` (append)

Evita re-push del mismo setup cada día. Nueva confluencia → insert (dispara push). Presente → update lastSeen/precios, `seen` se preserva. Desaparecida → `expired` tras 7 días calendario sin verse (v1; refinamiento `triggered` es follow-up).

- [ ] **Step 1: Escribir los tests que fallan**

Append a `anticipatory-alerts.test.ts`:

```typescript
import { reconcileAlerts } from './anticipatory-alerts.js';
import type { AnticipatoryAlert } from '@trading/shared';

function makeAlert(overrides: Partial<AnticipatoryAlert> = {}): AnticipatoryAlert {
  return {
    id: 'GGAL:divergence+macd_cross', kind: 'anticipatory', symbol: 'GGAL',
    signals: [{ category: 'divergence', description: 'd', estimatedDays: null }],
    currentPrice: 50, entryPrice: 50, score: 55, status: 'active',
    firstSeenDate: '2026-06-10', lastSeenDate: '2026-06-10', seen: false,
    ...overrides,
  };
}

describe('reconcileAlerts', () => {
  const TODAY = '2026-06-11';

  it('id nuevo → toInsert + newAlerts (esto dispara el push)', () => {
    const current = [makeAlert({ firstSeenDate: TODAY, lastSeenDate: TODAY })];
    const r = reconcileAlerts(current, [], TODAY);
    expect(r.toInsert).toHaveLength(1);
    expect(r.newAlerts).toHaveLength(1);
    expect(r.toUpdate).toHaveLength(0);
    expect(r.toExpire).toHaveLength(0);
  });

  it('id presente → toUpdate con lastSeen/precios nuevos, seen y firstSeenDate preservados, NO newAlert', () => {
    const stored = [makeAlert({ seen: true, currentPrice: 48 })];
    const current = [makeAlert({ firstSeenDate: TODAY, lastSeenDate: TODAY, currentPrice: 52, seen: false })];
    const r = reconcileAlerts(current, stored, TODAY);
    expect(r.newAlerts).toHaveLength(0);
    expect(r.toInsert).toHaveLength(0);
    expect(r.toUpdate).toHaveLength(1);
    expect(r.toUpdate[0].seen).toBe(true);            // preservado
    expect(r.toUpdate[0].firstSeenDate).toBe('2026-06-10'); // preservado
    expect(r.toUpdate[0].lastSeenDate).toBe(TODAY);
    expect(r.toUpdate[0].currentPrice).toBe(52);      // refrescado
  });

  it('id desaparecido hace <7 dias → se mantiene (sin expirar todavia)', () => {
    const stored = [makeAlert({ lastSeenDate: '2026-06-08' })];
    const r = reconcileAlerts([], stored, TODAY);
    expect(r.toExpire).toHaveLength(0);
  });

  it('id desaparecido hace >=7 dias → toExpire', () => {
    const stored = [makeAlert({ lastSeenDate: '2026-06-03' })];
    const r = reconcileAlerts([], stored, TODAY);
    expect(r.toExpire).toEqual(['GGAL:divergence+macd_cross']);
  });

  it('mismo id nunca produce un segundo new', () => {
    const stored = [makeAlert()];
    const current = [makeAlert({ firstSeenDate: TODAY, lastSeenDate: TODAY })];
    const r = reconcileAlerts(current, stored, TODAY);
    expect(r.newAlerts).toHaveLength(0);
  });

  it('alertas expired/triggered en stored se ignoran (no reviven ni re-expiran)', () => {
    const stored = [makeAlert({ status: 'expired', lastSeenDate: '2026-05-01' })];
    const r = reconcileAlerts([], stored, TODAY);
    expect(r.toExpire).toHaveLength(0);
    // y si la confluencia reaparece, es un NEW (re-alerta legitima tras expirar)
    const r2 = reconcileAlerts([makeAlert({ firstSeenDate: TODAY, lastSeenDate: TODAY })], stored, TODAY);
    expect(r2.newAlerts).toHaveLength(1);
  });
});
```

- [ ] **Step 2: Correr y verificar que falla**

Run: `cd apps/backend && npx vitest run src/opportunities/anticipatory-alerts.test.ts`
Expected: FAIL — `reconcileAlerts` no exportado.

- [ ] **Step 3: Implementar**

Append a `anticipatory-alerts.ts`:

```typescript
/** Dias calendario sin verse antes de expirar una alerta activa (≈1 semana de trading). */
export const ALERT_EXPIRY_DAYS = 7;

export interface ReconcileResult {
  toInsert: AnticipatoryAlert[];
  toUpdate: AnticipatoryAlert[];
  toExpire: string[];               // ids a marcar expired
  newAlerts: AnticipatoryAlert[];   // == toInsert; lo que dispara push/notificacion
}

function daysBetween(fromYmd: string, toYmd: string): number {
  return Math.floor((new Date(toYmd).getTime() - new Date(fromYmd).getTime()) / 86_400_000);
}

/**
 * Reconcilia la confluencia de HOY contra lo persistido, keyed por id (symbol+categorias).
 * Puro: la capa de persistencia aplica el resultado.
 */
export function reconcileAlerts(
  current: AnticipatoryAlert[],
  stored: AnticipatoryAlert[],
  scanDate: string,
): ReconcileResult {
  const activeStored = new Map(stored.filter(a => a.status === 'active').map(a => [a.id, a]));
  const currentIds = new Set(current.map(a => a.id));

  const toInsert: AnticipatoryAlert[] = [];
  const toUpdate: AnticipatoryAlert[] = [];
  const toExpire: string[] = [];

  for (const alert of current) {
    const existing = activeStored.get(alert.id);
    if (!existing) {
      toInsert.push(alert);
    } else {
      toUpdate.push({
        ...existing,
        lastSeenDate: scanDate,
        currentPrice: alert.currentPrice,
        entryPrice: alert.entryPrice,
        stopLoss: alert.stopLoss,
        takeProfit: alert.takeProfit,
        score: alert.score,
        signals: alert.signals,
      });
    }
  }

  for (const [id, existing] of activeStored) {
    if (currentIds.has(id)) continue;
    if (daysBetween(existing.lastSeenDate, scanDate) >= ALERT_EXPIRY_DAYS) toExpire.push(id);
  }

  return { toInsert, toUpdate, toExpire, newAlerts: toInsert };
}
```

- [ ] **Step 4: Correr tests y verificar que pasan**

Run: `cd apps/backend && npx vitest run src/opportunities/anticipatory-alerts.test.ts`
Expected: PASS (18 tests).

- [ ] **Step 5: Commit**

```bash
git add apps/backend/src/opportunities/anticipatory-alerts.ts apps/backend/src/opportunities/anticipatory-alerts.test.ts
git commit -m "feat(alerts): reconcileAlerts — lifecycle sin re-push diario"
```

---

### Task 4: Feedback al veredicto (confluencia → upgrade, sin doble discurso)

**Files:**
- Modify: `apps/backend/src/opportunities/anticipatory-alerts.ts` (nueva fn pura)
- Modify: `apps/backend/src/opportunities/scoring.ts:1554-1576` (hook post-smartAction)
- Test: `apps/backend/src/opportunities/anticipatory-alerts.test.ts` (append)

Raíz del miss de GGAL: el upgrade HOLD→BUY existente exige R/R≥2 con UNA divergencia ([scoring.ts:531](apps/backend/src/opportunities/scoring.ts#L531)). Con confluencia ≥2 categorías relajamos: HOLD→BUY con R/R≥1.5, WATCH→BUY con composite≥50. Corre ANTES de `resolveFinalVerdict`, así el trace lo registra como capa smart y el digest (proyección verbatim) lo hereda gratis. Nunca pisa un veto ni un override bajista.

- [ ] **Step 1: Escribir los tests que fallan**

Append a `anticipatory-alerts.test.ts`:

```typescript
import { anticipatoryUpgrade } from './anticipatory-alerts.js';

describe('anticipatoryUpgrade', () => {
  const twoSignals = () => makeOpp({
    divergences: [{ type: 'bullish', indicator: 'macd', timeframe: 'weekly', description: 'Div alcista MACD semanal' }],
    timingView: { action: 'BUY', timing: 'soon', confidence: 80, triggers: [trigger('macd_cross', 'bullish', 3)] },
    tradeLevels: { entryPrice: 49, stopLoss: 46, takeProfit: 58 },
  });

  it('HOLD + confluencia >=2 + R/R>=1.5 → BUY (caso GGAL)', () => {
    const r = anticipatoryUpgrade('HOLD', 54, twoSignals(), 1.8, false);
    expect(r.action).toBe('BUY');
    expect(r.reason).toContain('confluencia');
  });

  it('WATCH + confluencia + composite>=50 → BUY', () => {
    const r = anticipatoryUpgrade('WATCH', 52, twoSignals(), 1.2, false);
    expect(r.action).toBe('BUY');
  });

  it('WATCH + composite<50 → sin cambio', () => {
    expect(anticipatoryUpgrade('WATCH', 45, twoSignals(), 2, false).action).toBe('WATCH');
  });

  it('HOLD + R/R<1.5 → WATCH (señal visible pero sin gatillar compra)', () => {
    expect(anticipatoryUpgrade('HOLD', 54, twoSignals(), 1.1, false).action).toBe('WATCH');
  });

  it('veto activo → nunca upgradea', () => {
    expect(anticipatoryUpgrade('WATCH', 60, twoSignals(), 2, true).action).toBe('WATCH');
  });

  it('conflicto bajista → nunca upgradea', () => {
    const conBearish = makeOpp({
      divergences: [
        { type: 'bullish', indicator: 'macd', timeframe: 'weekly', description: 'd' },
        { type: 'bearish', indicator: 'rsi', timeframe: 'daily', description: 'd' },
      ],
      timingView: { action: 'BUY', timing: 'soon', confidence: 80, triggers: [trigger('macd_cross', 'bullish', 3)] },
    });
    expect(anticipatoryUpgrade('HOLD', 60, conBearish, 2, false).action).toBe('HOLD');
  });

  it('<2 categorias → sin cambio', () => {
    const una = makeOpp({ divergences: [{ type: 'bullish', indicator: 'macd', timeframe: 'weekly', description: 'd' }] });
    expect(anticipatoryUpgrade('HOLD', 60, una, 2, false).action).toBe('HOLD');
  });

  it('SELL y BUY no se tocan', () => {
    expect(anticipatoryUpgrade('SELL', 60, twoSignals(), 2, false).action).toBe('SELL');
    expect(anticipatoryUpgrade('BUY', 60, twoSignals(), 2, false).action).toBe('BUY');
  });
});
```

- [ ] **Step 2: Correr y verificar que falla**

Run: `cd apps/backend && npx vitest run src/opportunities/anticipatory-alerts.test.ts`
Expected: FAIL — `anticipatoryUpgrade` no exportado.

- [ ] **Step 3: Implementar la función pura**

Append a `anticipatory-alerts.ts`:

```typescript
import type { SignalAction } from '@trading/shared';

/**
 * Contraparte alcista del override bajista de smartAction: la MISMA confluencia
 * que dispara la alerta sube el veredicto. Un solo discurso en toda la app.
 * Nunca pisa vetos ni overrides bajistas; SELL/BUY no se tocan.
 */
export function anticipatoryUpgrade(
  action: SignalAction,
  composite: number,
  opp: AlertSource,
  riskRewardRatio: number | undefined,
  hasAxisVeto: boolean,
): { action: SignalAction; reason?: string } {
  if (action === 'SELL' || action === 'BUY') return { action };
  if (hasAxisVeto || hasBearishConflict(opp)) return { action };

  const signals = extractBullishSignals(opp);
  const categories = [...new Set(signals.map(s => s.category))];
  if (categories.length < 2) return { action };

  const detail = signals.map(s => s.description).slice(0, 3).join(' + ');
  const rr = riskRewardRatio ?? 0;

  if (action === 'HOLD' && rr >= 1.5) {
    return {
      action: 'BUY',
      reason: `Confluencia anticipatoria (${categories.length} señales: ${detail}). Setups asi historicamente preceden el movimiento — R/R 1:${rr.toFixed(1)} acompaña. Es probabilidad, no certeza.`,
    };
  }
  if (action === 'HOLD') {
    return {
      action: 'WATCH',
      reason: `Confluencia anticipatoria (${detail}) pero R/R 1:${rr.toFixed(1)} insuficiente para agregar — vigilar de cerca.`,
    };
  }
  if (action === 'WATCH' && composite >= 50) {
    return {
      action: 'BUY',
      reason: `Confluencia anticipatoria (${categories.length} señales: ${detail}) con score ${composite}/100. El setup precede al movimiento — entrar antes de que se confirme. Es probabilidad, no certeza.`,
    };
  }
  return { action };
}
```

- [ ] **Step 4: Correr tests de la fn pura**

Run: `cd apps/backend && npx vitest run src/opportunities/anticipatory-alerts.test.ts`
Expected: PASS.

- [ ] **Step 5: Hookear en buildAlgorithmicOpportunity**

En `apps/backend/src/opportunities/scoring.ts`, import arriba (junto a los demás imports locales):

```typescript
import { anticipatoryUpgrade } from './anticipatory-alerts.js';
```

Insertar DESPUÉS del bloque "Post-smartAction safety" (que termina en la línea 1565 con `}`) y ANTES del comentario `// Compute conviction tier...` (línea 1567):

```typescript
  // === ANTICIPATORY UPGRADE: confluencia bullish (>=2 categorias) sube el veredicto ===
  // Contraparte alcista del override bajista. Misma fuente que las alertas anticipatorias
  // — el digest proyecta el action verbatim, asi que no puede haber doble discurso.
  const upgraded = anticipatoryUpgrade(
    result.action,
    composite,
    result,
    result.tradeLevels?.riskRewardRatio,
    Boolean(axisVeto),
  );
  if (upgraded.action !== result.action) {
    result.action = upgraded.action;
    result.tradeLevels = computeTradeLevels(tech, upgraded.action, portfolioValue, portfolioQuantity);
    if (upgraded.reason) {
      result.simpleReasoning = upgraded.reason;
      result.catalysts = [upgraded.reason.split('.')[0], ...result.catalysts].slice(0, 3);
    }
  }
```

Nota: `result` satisface `AlertSource` estructuralmente (tiene symbol, currentPrice, opportunityScore, divergences, timingView, tradeLevels). `resolveFinalVerdict` (línea 1591) ya toma `smartAction: result.action`, así que el trace registra el upgrade como capa smart sin tocar tipos.

- [ ] **Step 6: Typecheck + suite completa**

Run: `npm run typecheck && cd apps/backend && npm run test`
Expected: PASS — atención a `verdicts.portfolio.test.ts` y `entry-score.test.ts`: si algún test asume que HOLD con divergencia alcista semanal queda HOLD, revisar si el fixture tiene ≥2 categorías (es el comportamiento nuevo deseado; ajustar la aserción del test viejo, documentando por qué).

- [ ] **Step 7: Commit**

```bash
git add apps/backend/src/opportunities
git commit -m "feat(verdicts): confluencia anticipatoria sube HOLD/WATCH (simetrico al override bajista)"
```

---

## FASE 2 — Persistencia + hook de scan + tRPC

### Task 5: Tabla `anticipatory_alerts` + repository

**Files:**
- Modify: `apps/backend/src/db/schema.ts` (después de `swingAlerts`, línea 143)
- Modify: `apps/backend/src/db/repository.ts` (después de las fns de swing alerts, ~línea 560)
- Migration: `npm run db:generate` (drizzle-kit la crea)

Sigue las convenciones de `swingAlerts` (snake_case, `status` text, `created_at` con `datetime('now')`).

- [ ] **Step 1: Agregar tabla al schema**

En `apps/backend/src/db/schema.ts`, después del cierre de `swingAlerts` (línea 143):

```typescript
// --- Anticipatory alerts (confluencia bullish >=2 señales + stop breaches) ---
export const anticipatoryAlerts = sqliteTable('anticipatory_alerts', {
  id: text('id').primaryKey(),                        // `${symbol}:${cats}` | `stop:${symbol}`
  kind: text('kind').notNull().default('anticipatory'), // 'anticipatory' | 'stop_breach'
  symbol: text('symbol').notNull(),
  signals: text('signals').notNull(),                  // JSON BullishSignal[]
  currentPrice: real('current_price').notNull(),
  entryPrice: real('entry_price'),
  stopLoss: real('stop_loss'),
  takeProfit: real('take_profit'),
  score: real('score').notNull().default(0),
  status: text('status').notNull().default('active'),  // active | triggered | expired
  firstSeenDate: text('first_seen_date').notNull(),    // YYYY-MM-DD
  lastSeenDate: text('last_seen_date').notNull(),
  seen: integer('seen', { mode: 'boolean' }).notNull().default(false),
  createdAt: text('created_at').notNull().default(sql`(datetime('now'))`),
  updatedAt: text('updated_at').notNull().default(sql`(datetime('now'))`),
});
```

- [ ] **Step 2: Generar y aplicar migración**

Run: `npm run db:generate --workspace=apps/backend && npm run db:migrate --workspace=apps/backend`
Expected: nuevo archivo `apps/backend/drizzle/00XX_*.sql` con `CREATE TABLE anticipatory_alerts`, migración aplicada sin error.

- [ ] **Step 3: Funciones de repository**

En `apps/backend/src/db/repository.ts`, después de las funciones de swing alerts (~línea 560). Usa los helpers ya importados en el archivo (`eq`, `desc`, `inArray`, `db`, `schema` — verificar imports existentes arriba del archivo y agregar `inArray` de `drizzle-orm` si falta):

```typescript
// --- Anticipatory alerts ---

import type { AnticipatoryAlert } from '@trading/shared'; // mover junto a los demás type-imports del archivo

function rowToAnticipatoryAlert(row: typeof schema.anticipatoryAlerts.$inferSelect): AnticipatoryAlert {
  return {
    id: row.id,
    kind: row.kind as AnticipatoryAlert['kind'],
    symbol: row.symbol,
    signals: JSON.parse(row.signals),
    currentPrice: row.currentPrice,
    entryPrice: row.entryPrice ?? undefined,
    stopLoss: row.stopLoss ?? undefined,
    takeProfit: row.takeProfit ?? undefined,
    score: row.score,
    status: row.status as AnticipatoryAlert['status'],
    firstSeenDate: row.firstSeenDate,
    lastSeenDate: row.lastSeenDate,
    seen: row.seen,
  };
}

export function getActiveAnticipatoryAlerts(): AnticipatoryAlert[] {
  return db.select().from(schema.anticipatoryAlerts)
    .where(eq(schema.anticipatoryAlerts.status, 'active'))
    .orderBy(desc(schema.anticipatoryAlerts.lastSeenDate), desc(schema.anticipatoryAlerts.score))
    .all().map(rowToAnticipatoryAlert);
}

export function getRecentAnticipatoryAlerts(limit = 50): AnticipatoryAlert[] {
  return db.select().from(schema.anticipatoryAlerts)
    .orderBy(desc(schema.anticipatoryAlerts.lastSeenDate), desc(schema.anticipatoryAlerts.createdAt))
    .limit(limit)
    .all().map(rowToAnticipatoryAlert);
}

export function upsertAnticipatoryAlerts(toInsert: AnticipatoryAlert[], toUpdate: AnticipatoryAlert[]): void {
  const now = new Date().toISOString();
  for (const a of toInsert) {
    db.insert(schema.anticipatoryAlerts).values({
      id: a.id, kind: a.kind, symbol: a.symbol, signals: JSON.stringify(a.signals),
      currentPrice: a.currentPrice, entryPrice: a.entryPrice ?? null,
      stopLoss: a.stopLoss ?? null, takeProfit: a.takeProfit ?? null,
      score: a.score, status: a.status,
      firstSeenDate: a.firstSeenDate, lastSeenDate: a.lastSeenDate,
      seen: a.seen, updatedAt: now,
    }).onConflictDoNothing().run();
  }
  for (const a of toUpdate) {
    db.update(schema.anticipatoryAlerts).set({
      signals: JSON.stringify(a.signals), currentPrice: a.currentPrice,
      entryPrice: a.entryPrice ?? null, stopLoss: a.stopLoss ?? null,
      takeProfit: a.takeProfit ?? null, score: a.score,
      lastSeenDate: a.lastSeenDate, updatedAt: now,
    }).where(eq(schema.anticipatoryAlerts.id, a.id)).run();
  }
}

export function expireAnticipatoryAlerts(ids: string[]): void {
  if (ids.length === 0) return;
  db.update(schema.anticipatoryAlerts)
    .set({ status: 'expired', updatedAt: new Date().toISOString() })
    .where(inArray(schema.anticipatoryAlerts.id, ids)).run();
}

export function markAnticipatoryAlertsSeen(ids?: string[]): void {
  const now = new Date().toISOString();
  if (ids && ids.length > 0) {
    db.update(schema.anticipatoryAlerts).set({ seen: true, updatedAt: now })
      .where(inArray(schema.anticipatoryAlerts.id, ids)).run();
  } else {
    db.update(schema.anticipatoryAlerts).set({ seen: true, updatedAt: now })
      .where(eq(schema.anticipatoryAlerts.seen, false)).run();
  }
}

export function countUnseenAnticipatoryAlerts(): number {
  return db.select().from(schema.anticipatoryAlerts)
    .where(and(eq(schema.anticipatoryAlerts.seen, false), eq(schema.anticipatoryAlerts.status, 'active')))
    .all().length;
}
```

(`and` ya está importado en repository.ts — verificar; si no, agregarlo al import de `drizzle-orm`.)

- [ ] **Step 4: Typecheck**

Run: `npm run typecheck`
Expected: limpio.

- [ ] **Step 5: Commit**

```bash
git add apps/backend/src/db apps/backend/drizzle
git commit -m "feat(alerts): tabla anticipatory_alerts + repository"
```

---

### Task 6: Hook del scan — build → reconcile → persist

**Files:**
- Modify: `apps/backend/src/opportunities/opportunities.service.ts` (`persistScanResult`, ~línea 1023)

`persistScanResult` corre al final de cada scan (vía `runLiveScan`), tanto en pipeline completo como en scan suelto — el punto único correcto.

- [ ] **Step 1: Implementar el hook**

Imports nuevos arriba de `opportunities.service.ts`:

```typescript
import { buildAlertsFromScan, reconcileAlerts } from './anticipatory-alerts.js';
import { getActiveAnticipatoryAlerts, getRecentAnticipatoryAlerts, upsertAnticipatoryAlerts, expireAnticipatoryAlerts } from '../db/repository.js';
```

(merge con los imports ya existentes de `../db/repository.js`.)

Al FINAL del `try` de `persistScanResult` (después del bloque de anti-hype rejections, antes del `catch`):

```typescript
    // === ANTICIPATORY ALERTS: confluencia bullish del scan → reconciliar y persistir ===
    try {
      const scanDate = scannedAtISO.slice(0, 10); // YYYY-MM-DD
      const current = buildAlertsFromScan(result.opportunities, scanDate);
      const stored = getRecentAnticipatoryAlerts(200);
      const { toInsert, toUpdate, toExpire, newAlerts } = reconcileAlerts(current, stored, scanDate);
      upsertAnticipatoryAlerts(toInsert, toUpdate);
      expireAnticipatoryAlerts(toExpire);
      if (newAlerts.length > 0) {
        console.log(`[alerts] ${newAlerts.length} alertas anticipatorias NUEVAS: ${newAlerts.map(a => a.id).join(', ')}`);
      }
    } catch (err) {
      console.error('[alerts] Failed to reconcile anticipatory alerts:', (err as Error).message);
    }
```

- [ ] **Step 2: Typecheck + suite**

Run: `npm run typecheck && cd apps/backend && npm run test`
Expected: PASS.

- [ ] **Step 3: Commit**

```bash
git add apps/backend/src/opportunities/opportunities.service.ts
git commit -m "feat(alerts): hook de scan — build/reconcile/persist en cada persistScanResult"
```

---

### Task 7: Router tRPC `alerts`

**Files:**
- Create: `apps/backend/src/alerts/alerts.router.ts`
- Modify: `apps/backend/src/router.ts`

- [ ] **Step 1: Crear el router**

`apps/backend/src/alerts/alerts.router.ts` (patrón de `etf.router.ts`):

```typescript
import { z } from 'zod';
import { router, publicProcedure } from '../trpc.js';
import {
  getActiveAnticipatoryAlerts,
  getRecentAnticipatoryAlerts,
  markAnticipatoryAlertsSeen,
  countUnseenAnticipatoryAlerts,
} from '../db/repository.js';

export const alertsRouter = router({
  /** Activas + historial reciente, para la sección fijada y el panel. */
  list: publicProcedure
    .input(z.object({ limit: z.number().min(1).max(200).default(50) }).optional())
    .query(({ input }) => ({
      active: getActiveAnticipatoryAlerts(),
      recent: getRecentAnticipatoryAlerts(input?.limit ?? 50),
    })),

  /** Cuenta de no-vistas activas — alimenta el badge y la notificación browser. */
  unseenCount: publicProcedure.query(() => ({ count: countUnseenAnticipatoryAlerts() })),

  /** Marca vistas (todas, o ids puntuales). Se llama al abrir el panel. */
  markSeen: publicProcedure
    .input(z.object({ ids: z.array(z.string()).optional() }).optional())
    .mutation(({ input }) => {
      markAnticipatoryAlertsSeen(input?.ids);
      return { ok: true };
    }),
});
```

- [ ] **Step 2: Registrar en el router raíz**

En `apps/backend/src/router.ts`:

```typescript
import { alertsRouter } from './alerts/alerts.router.js';
```

y dentro de `appRouter`:

```typescript
  alerts: alertsRouter,
```

- [ ] **Step 3: Typecheck + commit**

Run: `npm run typecheck`
Expected: limpio.

```bash
git add apps/backend/src/alerts apps/backend/src/router.ts
git commit -m "feat(alerts): router tRPC list/unseenCount/markSeen"
```

---

## FASE 3 — Frontend: sección fijada + badge/panel + notificaciones

### Task 8: Sección fijada `⚡ Alertas Anticipatorias` en Daily

**Files:**
- Create: `apps/frontend/src/alerts/AnticipatoryAlertsPinned.tsx`
- Modify: `apps/frontend/src/daily/DailySummary.tsx:851-852`

Render solo si hay ≥1 alerta activa (empty state oculto). Arriba del Market Digest.

- [ ] **Step 1: Crear el componente**

`apps/frontend/src/alerts/AnticipatoryAlertsPinned.tsx` (mismos imports UI que DailySummary: `Card/CardHeader/CardContent` de `@/components/ui/card`, `Badge` de `@/components/ui/badge`):

```tsx
import { Card, CardContent, CardHeader } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { trpc } from '@/shared/trpc';
import { useNavigation } from '@/shared/navigation';

const CATEGORY_LABELS: Record<string, string> = {
  divergence: 'Divergencia alcista',
  golden_cross: 'Golden Cross inminente',
  bb_squeeze: 'BB Squeeze breakout',
  macd_cross: 'Cruce MACD inminente',
  oversold_bounce: 'Rebote sobreventa',
};

export function AnticipatoryAlertsPinned() {
  const { data } = trpc.alerts.list.useQuery(undefined, { staleTime: 60_000 });
  const { goToSymbol } = useNavigation();
  const active = data?.active ?? [];
  if (active.length === 0) return null; // empty state oculto por diseño

  return (
    <Card size="sm" className="border-l-4 border-l-purple-500">
      <CardHeader>
        <div className="flex items-center justify-between">
          <span className="text-xs font-semibold uppercase tracking-wider text-purple-400">
            ⚡ Alertas Anticipatorias
          </span>
          <Badge className="text-[9px] bg-purple-500/20 text-purple-400">{active.length} setup{active.length > 1 ? 's' : ''}</Badge>
        </div>
        <p className="text-[10px] text-muted-foreground mt-0.5">
          Confluencia de señales que históricamente preceden el movimiento. Son setups probabilísticos, no certezas.
        </p>
      </CardHeader>
      <CardContent className="space-y-2">
        {active.map((a) => (
          <div key={a.id} className="rounded-md bg-muted/20 border border-purple-500/20 p-2">
            <div className="flex items-center gap-2 flex-wrap">
              <button
                className="text-xs font-bold text-foreground hover:text-purple-400"
                onClick={() => goToSymbol(a.symbol)}
              >
                {a.symbol}
              </button>
              <span className="text-[9px] text-muted-foreground">score {Math.round(a.score)}</span>
              {[...new Set(a.signals.map(s => s.category))].map(cat => (
                <Badge key={cat} className="text-[8px] bg-purple-500/15 text-purple-300">
                  {CATEGORY_LABELS[cat] ?? cat}
                </Badge>
              ))}
            </div>
            <div className="flex gap-3 mt-1 text-[10px] text-muted-foreground">
              {a.entryPrice != null && <span>Entrada <span className="text-foreground">${a.entryPrice.toFixed(2)}</span></span>}
              {a.stopLoss != null && <span>Stop <span className="text-red-400">${a.stopLoss.toFixed(2)}</span></span>}
              {a.takeProfit != null && <span>Target <span className="text-green-400">${a.takeProfit.toFixed(2)}</span></span>}
              <span className="ml-auto">visto {a.firstSeenDate}</span>
            </div>
          </div>
        ))}
      </CardContent>
    </Card>
  );
}
```

- [ ] **Step 2: Montar en DailySummary**

En `apps/frontend/src/daily/DailySummary.tsx`, import:

```tsx
import { AnticipatoryAlertsPinned } from '@/alerts/AnticipatoryAlertsPinned';
```

y en el JSX, INMEDIATAMENTE ANTES de `{/* 1. Digest del día ... */}` (línea 851):

```tsx
      {/* 0. Alertas anticipatorias — fijadas arriba de todo (solo si hay activas) */}
      {isToday && <AnticipatoryAlertsPinned />}
```

- [ ] **Step 3: Verificar typecheck frontend**

Run: `npm run typecheck`
Expected: limpio. (El tipo de `trpc.alerts.list` fluye automático desde `AppRouter`.)

- [ ] **Step 4: Commit**

```bash
git add apps/frontend/src/alerts apps/frontend/src/daily/DailySummary.tsx
git commit -m "feat(alerts): seccion fijada de alertas anticipatorias en Daily"
```

---

### Task 9: Badge + tab `Alertas` con panel de historial

**Files:**
- Create: `apps/frontend/src/alerts/AlertsPanel.tsx`
- Modify: `apps/frontend/src/App.tsx:21-23` (VALID_TABS), `:122-128` (TabsTrigger), `:137-148` (TabsContent)

- [ ] **Step 1: Crear AlertsPanel**

`apps/frontend/src/alerts/AlertsPanel.tsx`:

```tsx
import { useEffect } from 'react';
import { Card, CardContent, CardHeader } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { trpc } from '@/shared/trpc';
import { useNavigation } from '@/shared/navigation';

const STATUS_STYLE: Record<string, { label: string; cls: string }> = {
  active: { label: 'VIGENTE', cls: 'bg-purple-500/20 text-purple-400' },
  triggered: { label: 'DISPARADA', cls: 'bg-green-500/20 text-green-400' },
  expired: { label: 'VENCIDA', cls: 'bg-muted text-muted-foreground' },
};

export function AlertsPanel() {
  const utils = trpc.useUtils();
  const { data } = trpc.alerts.list.useQuery({ limit: 100 }, { staleTime: 60_000 });
  const markSeen = trpc.alerts.markSeen.useMutation({
    onSuccess: () => utils.alerts.unseenCount.invalidate(),
  });
  const { goToSymbol } = useNavigation();

  // Abrir el panel = marcar todo visto (limpia el badge)
  useEffect(() => {
    markSeen.mutate(undefined);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const recent = data?.recent ?? [];

  return (
    <div className="p-4 space-y-3 max-w-3xl mx-auto">
      <h2 className="text-sm font-semibold uppercase tracking-wider text-purple-400">⚡ Alertas Anticipatorias</h2>
      <p className="text-[11px] text-muted-foreground">
        Setups con confluencia de ≥2 señales anticipatorias. Probabilidades, no garantías: usá siempre el stop sugerido.
      </p>
      {recent.length === 0 && (
        <Card size="sm"><CardContent><p className="text-xs text-muted-foreground py-4">Sin alertas todavía. Se generan en cada scan diario cuando ≥2 señales anticipatorias coinciden en un activo.</p></CardContent></Card>
      )}
      {recent.map((a) => {
        const st = STATUS_STYLE[a.status] ?? STATUS_STYLE.active;
        return (
          <Card key={a.id} size="sm" className={a.status === 'active' ? 'border-l-4 border-l-purple-500' : 'opacity-70'}>
            <CardHeader>
              <div className="flex items-center gap-2">
                <button className="text-sm font-bold hover:text-purple-400" onClick={() => goToSymbol(a.symbol)}>{a.symbol}</button>
                <Badge className={`text-[9px] ${st.cls}`}>{st.label}</Badge>
                <span className="text-[10px] text-muted-foreground ml-auto">{a.firstSeenDate} → {a.lastSeenDate}</span>
              </div>
            </CardHeader>
            <CardContent className="space-y-1.5">
              {a.signals.map((s, i) => (
                <p key={i} className="text-[11px] text-foreground">• {s.description}{s.estimatedDays != null ? ` (~${s.estimatedDays}d)` : ''}</p>
              ))}
              <div className="flex gap-3 text-[10px] text-muted-foreground pt-1">
                {a.entryPrice != null && <span>Entrada ${a.entryPrice.toFixed(2)}</span>}
                {a.stopLoss != null && <span>Stop ${a.stopLoss.toFixed(2)}</span>}
                {a.takeProfit != null && <span>Target ${a.takeProfit.toFixed(2)}</span>}
                <span className="ml-auto">score {Math.round(a.score)}</span>
              </div>
            </CardContent>
          </Card>
        );
      })}
    </div>
  );
}
```

- [ ] **Step 2: Tab + badge en App.tsx**

En `apps/frontend/src/App.tsx`:

1. Línea 21: `const VALID_TABS = ['daily', 'opportunities', 'portfolio', 'historico', 'alertas'] as const;`
2. Import: `import { AlertsPanel } from './alerts/AlertsPanel';`
3. Componente badge (junto a `BuyBadge`, línea 45):

```tsx
function AlertsBadge() {
  const { data } = trpc.alerts.unseenCount.useQuery(undefined, { refetchInterval: 60_000 });
  const count = data?.count ?? 0;
  if (count === 0) return null;
  return (
    <span className="absolute -top-0.5 -right-1 flex h-4 w-4 items-center justify-center rounded-full bg-purple-500 text-[8px] font-bold text-white">
      {count > 9 ? '9+' : count}
    </span>
  );
}
```

4. En `TabsList` (después del trigger `historico`, línea 128):

```tsx
                <TabsTrigger value="alertas" className="relative">
                  Alertas
                  <AlertsBadge />
                </TabsTrigger>
```

5. En los `TabsContent` (después de `historico`, línea 148):

```tsx
                  <TabsContent value="alertas" className="flex-1 overflow-y-auto">
                    <AlertsPanel />
                  </TabsContent>
```

- [ ] **Step 3: Verificación manual**

Run: `npm run typecheck` → limpio. Luego `npm run dev`, abrir `http://localhost:5050?tab=alertas`.
Expected: panel renderiza (vacío o con alertas si un scan ya corrió); badge aparece en el tab si hay no-vistas y se limpia al abrir.

- [ ] **Step 4: Commit**

```bash
git add apps/frontend/src/alerts apps/frontend/src/App.tsx
git commit -m "feat(alerts): tab Alertas con panel de historial + badge de no-vistas"
```

---

### Task 10: Notificación browser (opt-in, tab abierta)

**Files:**
- Create: `apps/frontend/src/alerts/useAlertNotifications.ts`
- Modify: `apps/frontend/src/alerts/AlertsPanel.tsx` (control de opt-in)
- Modify: `apps/frontend/src/App.tsx` (montar el hook)

Scope v1: dispara mientras la tab esté abierta (incl. backgrounded). Web Push real = fuera de scope (spec). NUNCA auto-prompt al cargar — opt-in explícito.

- [ ] **Step 1: Crear el hook**

`apps/frontend/src/alerts/useAlertNotifications.ts`:

```typescript
import { useEffect, useRef } from 'react';
import { trpc } from '@/shared/trpc';

const OPTIN_KEY = 'alerts:notifications';

export function notificationsEnabled(): boolean {
  return typeof window !== 'undefined'
    && 'Notification' in window
    && Notification.permission === 'granted'
    && window.localStorage.getItem(OPTIN_KEY) === 'on';
}

export async function enableNotifications(): Promise<boolean> {
  if (!('Notification' in window)) return false;
  const perm = await Notification.requestPermission();
  if (perm !== 'granted') return false;
  window.localStorage.setItem(OPTIN_KEY, 'on');
  return true;
}

export function disableNotifications(): void {
  window.localStorage.setItem(OPTIN_KEY, 'off');
}

/**
 * Polea unseenCount (cadencia diaria de alertas → 60s sobra) y notifica
 * SOLO cuando el count SUBE (alerta nueva), nunca en el primer render.
 */
export function useAlertNotifications() {
  const { data } = trpc.alerts.unseenCount.useQuery(undefined, { refetchInterval: 60_000 });
  const prev = useRef<number | null>(null);

  useEffect(() => {
    const count = data?.count;
    if (count == null) return;
    if (prev.current != null && count > prev.current && notificationsEnabled()) {
      const n = new Notification('⚡ Alerta anticipatoria nueva', {
        body: `${count - prev.current} setup(s) con confluencia bullish detectados. Abrí el panel de Alertas.`,
        tag: 'anticipatory-alerts', // colapsa repetidas
      });
      n.onclick = () => {
        window.focus();
        window.location.search = '?tab=alertas';
      };
    }
    prev.current = count;
  }, [data?.count]);
}
```

- [ ] **Step 2: Montar el hook en App**

En `App.tsx`, dentro del componente `App()` (después de `usePipeline()`):

```tsx
  useAlertNotifications();
```

con su import: `import { useAlertNotifications } from './alerts/useAlertNotifications';`

- [ ] **Step 3: Control de opt-in en AlertsPanel**

En `AlertsPanel.tsx`, debajo del párrafo descriptivo:

```tsx
import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { enableNotifications, disableNotifications, notificationsEnabled } from './useAlertNotifications';

// ...dentro del componente:
  const [notifOn, setNotifOn] = useState(notificationsEnabled());

// ...en el JSX, después del <p> descriptivo:
      <Button
        size="sm" variant="outline" className="h-7 text-[10px]"
        onClick={async () => {
          if (notifOn) { disableNotifications(); setNotifOn(false); }
          else setNotifOn(await enableNotifications());
        }}
      >
        {notifOn ? '🔔 Notificaciones activadas — desactivar' : '🔕 Activar notificaciones de escritorio'}
      </Button>
```

- [ ] **Step 4: Verificación manual + commit**

`npm run typecheck` limpio; en el browser: activar notificaciones desde el panel, insertar una alerta a mano en la DB (`sqlite3`) o correr un scan, verificar que al subir el count llega la notificación.

```bash
git add apps/frontend/src/alerts apps/frontend/src/App.tsx
git commit -m "feat(alerts): notificacion browser opt-in al detectar alerta nueva"
```

---

## FASE 4 — Confiabilidad del pipeline (datos honestos para las alertas)

### Task 11: Marcar análisis parcial cuando los providers AI se agotan

**Files:**
- Modify: `apps/backend/src/intelligence/unified-analysis.service.ts` (~línea 284-300, loop de batches)
- Modify: `apps/backend/src/intelligence/pipeline.service.ts:350-368` (`runAnalysisStage`)

Hoy el circuit breaker aborta batches restantes ([unified-analysis.service.ts:293-296](apps/backend/src/intelligence/unified-analysis.service.ts#L293)) pero el stage reporta `ok` — scan trunco parece completo.

- [ ] **Step 1: Exponer stats del último run**

En `unified-analysis.service.ts`, a nivel módulo (junto a otros estados de módulo):

```typescript
let _lastRunStats: { analyzed: number; targets: number; abortedByQuota: boolean } | null = null;

export function getLastUnifiedAnalysisStats() {
  return _lastRunStats;
}
```

En el loop de batches (líneas 284-298), capturar el abort:

```typescript
  let abortedByQuota = false;
  for (let i = 0; i < batches.length; i++) {
    try {
      const batchResult = await analyzeBatch(batches[i], techMap, fundMap, sentimentMap, pipelineRunId, i, macroContext, causalContextMap);
      for (const [symbol, analysis] of batchResult) {
        result.set(symbol, analysis);
      }
    } catch (err) {
      const msg = (err as Error).message ?? '';
      if (msg.includes('All providers failed') || msg.includes('All providers quota-exhausted')) {
        console.warn(`[unified-analysis] Circuit breaker: todos los providers AI agotados. Abortando ${batches.length - i - 1} batches restantes.`);
        abortedByQuota = true;
        break;
      }
    }
  }
  _lastRunStats = { analyzed: result.size, targets: targets.length, abortedByQuota };
```

- [ ] **Step 2: Propagar a runAnalysisStage**

En `pipeline.service.ts`, import `getLastUnifiedAnalysisStats` desde `./unified-analysis.service.js` (verificar ruta del import existente de unified-analysis en el archivo; si no hay, agregarlo). Reemplazar la construcción del `StageResult` exitoso (líneas 358-365):

```typescript
    const stats = getLastUnifiedAnalysisStats();
    const partial = Boolean(stats && (stats.abortedByQuota || stats.analyzed < stats.targets));
    const sr: StageResult = {
      status: partial ? 'partial' : 'ok',
      startedAt,
      finishedAt: new Date().toISOString(),
      detail: partial && stats
        ? `PARCIAL: ${stats.analyzed}/${stats.targets} símbolos con análisis IA${stats.abortedByQuota ? ' (quota agotada a mitad de run)' : ''}. ${symbolCount} escaneados.`
        : `${symbolCount} símbolos analizados, ${_stageUnifiedAnalyses?.size ?? 0} con análisis IA.`,
      errors: partial && stats ? [`Análisis IA cubrió ${stats.analyzed}/${stats.targets} targets`] : [],
    };
```

(Verificar que `StageResult.status` admite `'partial'` — `runReportStage` ya lo usa en línea 457, así que sí.)

- [ ] **Step 3: Typecheck + suite + commit**

Run: `npm run typecheck && cd apps/backend && npm run test`
Expected: PASS.

```bash
git add apps/backend/src/intelligence
git commit -m "fix(pipeline): marcar stage analysis como partial cuando quota corta el run"
```

---

### Task 12: News stage degradado graceful (0 artículos hoy ≠ matar todo)

**Files:**
- Modify: `apps/backend/src/intelligence/pipeline.service.ts:154-171` (`runNewsStage`) y `:484-493` (`runRemainingStages`)

Hoy 0 artículos → stage `failed` → fundamentals/analysis/report skipped y run `failed` — un feriado sin noticias mata el día entero, y ese día no hay alertas. Cambio: 0 artículos nuevos pero con artículos recientes en DB (ventana 3 días que ya usa `loadFromDB`) → `partial` y el pipeline sigue con sentiment degradado.

- [ ] **Step 1: Cambiar la condición de fallo**

En `runNewsStage`, reemplazar el bloque `if (articleCount === 0)` (líneas 160-170):

```typescript
    if (articleCount === 0) {
      // 0 articulos HOY es normal en feriados. Si la DB tiene articulos recientes
      // (ventana de 3 dias), seguimos con sentiment degradado en vez de matar el run.
      const { getNewsArticlesForToday } = await import('../db/repository.js');
      const recentInDb = getNewsArticlesForToday('low').length;
      const sr: StageResult = {
        status: recentInDb > 0 ? 'partial' : 'failed',
        startedAt,
        finishedAt: new Date().toISOString(),
        detail: recentInDb > 0
          ? `PARCIAL: 0 artículos nuevos hoy — continuando con ${recentInDb} artículos recientes de la DB (sentiment degradado).`
          : 'Sin artículos obtenidos ni recientes en DB.',
        errors: recentInDb > 0 ? ['0 artículos nuevos — usando ventana de 3 días'] : [],
        ...(recentInDb === 0 ? { criticalError: '0 artículos — fuentes no disponibles' } : {}),
      };
      updatePipelineStage(runId, 'news', sr);
      return sr;
    }
```

Nota para el ejecutor: si `getNewsArticlesForToday` no acepta `'low'` o filtra solo HOY (verificar firma en `db/repository.ts:1176`), usar en su lugar el helper que cargue la ventana de 3 días (`getNewsArticlesSince`, línea 341) con `new Date(Date.now() - 3 * 86_400_000).toISOString()`.

- [ ] **Step 2: runRemainingStages solo skipea en `failed`**

La condición existente (línea 487) ya es `if (newsResult.status === 'failed')` — verificar que `partial` NO entra ahí (no debería). No tocar si ya es así; agregar log:

```typescript
    if (newsResult.status === 'partial') {
      console.warn('[pipeline] News parcial — continuando con datos degradados');
    }
```

- [ ] **Step 3: Typecheck + suite + commit**

Run: `npm run typecheck && cd apps/backend && npm run test`

```bash
git add apps/backend/src/intelligence/pipeline.service.ts
git commit -m "fix(pipeline): 0 noticias hoy degrada a partial con ventana 3d, no mata el run"
```

---

## FASE 5 — Grounding de prompts + coherencia LLM

### Task 13: Inyectar alertas activas a la síntesis + grounding de overnightSummary + avoidList

**Files:**
- Modify: `packages/shared/src/constants/prompts.ts` (`COMBINED_SYNTHESIS_PROMPT`)
- Modify: `apps/backend/src/intelligence/market-report.service.ts` (~líneas 272-285 y 365-370)
- Modify: `packages/shared/src/types/intelligence.ts:78-86` (`DigestRecommendation`)
- Modify: `apps/backend/src/intelligence/digest-recommendations.ts`
- Test: `apps/backend/src/intelligence/digest-recommendations.test.ts` (append)

Tres coherencias: (1) la narrativa LLM conoce las alertas y no las contradice, (2) `avoidList` jamás incluye un símbolo con alerta activa (filtro engine-side, no solo client-side), (3) las filas del digest llevan flag `anticipatoryAlert` → chip ⚡ en UI.

- [ ] **Step 1: Test del filtro avoidList + flag (falla primero)**

Append a `digest-recommendations.test.ts`:

```typescript
import { flagAlertedRecommendations, filterAvoidVsAlerts } from './digest-recommendations.js';

describe('coherencia con alertas anticipatorias', () => {
  it('flagAlertedRecommendations marca anticipatoryAlert en filas cuyo simbolo tiene alerta activa', () => {
    const recs = [
      { symbol: 'GGAL', action: 'BUY' as const, reason: 'r', currentPrice: 50, score: 60 },
      { symbol: 'NVDA', action: 'WATCH' as const, reason: 'r', currentPrice: 900, score: 55 },
    ];
    const flagged = flagAlertedRecommendations(recs, new Set(['GGAL']));
    expect(flagged[0].anticipatoryAlert).toBe(true);
    expect(flagged[1].anticipatoryAlert).toBeUndefined();
  });

  it('filterAvoidVsAlerts elimina items que mencionan simbolos con alerta activa', () => {
    const avoid = ['Evitar GGAL hasta que confirme', 'No tocar bonos largos'];
    expect(filterAvoidVsAlerts(avoid, new Set(['GGAL']))).toEqual(['No tocar bonos largos']);
  });
});
```

Run: `cd apps/backend && npx vitest run src/intelligence/digest-recommendations.test.ts` → FAIL (funciones no existen).

- [ ] **Step 2: Implementar en digest-recommendations.ts**

Tipo primero — en `packages/shared/src/types/intelligence.ts`, agregar a `DigestRecommendation`:

```typescript
  /** true si el simbolo tiene una alerta anticipatoria activa (chip ⚡ en UI). */
  anticipatoryAlert?: boolean;
```

Append a `digest-recommendations.ts`:

```typescript
/** Marca las filas cuyo símbolo tiene alerta anticipatoria activa — un solo discurso, chip ⚡. */
export function flagAlertedRecommendations(
  recs: DigestRecommendation[],
  alertedSymbols: Set<string>,
): DigestRecommendation[] {
  return recs.map(r => alertedSymbols.has(r.symbol.toUpperCase()) ? { ...r, anticipatoryAlert: true } : r);
}

/** Un símbolo con alerta activa jamás puede aparecer en avoidList (doble discurso). */
export function filterAvoidVsAlerts(items: string[], alertedSymbols: Set<string>): string[] {
  if (alertedSymbols.size === 0) return items;
  return items.filter(item => {
    const upper = item.toUpperCase();
    for (const sym of alertedSymbols) {
      if (new RegExp(`\\b${sym}\\b`).test(upper)) {
        console.warn(`[digest] avoidList descartó "${item.slice(0, 50)}" — ${sym} tiene alerta anticipatoria activa`);
        return false;
      }
    }
    return true;
  });
}
```

Run test → PASS.

- [ ] **Step 3: Cablear en market-report.service.ts**

Import: `import { getActiveAnticipatoryAlerts } from '../db/repository.js';` y `flagAlertedRecommendations, filterAvoidVsAlerts` desde `./digest-recommendations.js`.

(a) Antes de armar `userMsgParts` (~línea 272):

```typescript
  const activeAlerts = getActiveAnticipatoryAlerts();
  const alertedSymbols = new Set(activeAlerts.map(a => a.symbol.toUpperCase()));
```

(b) Dentro de `userMsgParts`, después del bloque de headlines ticker-específicas (línea 283):

```typescript
    activeAlerts.length > 0
      ? `\nALERTAS ANTICIPATORIAS ACTIVAS (el motor detectó confluencia bullish — tu narrativa NO puede contradecirlas; si mencionás estos símbolos, reconocé el setup):\n${activeAlerts.map(a => `- ${a.symbol}: ${a.signals.map(s => s.description).join(' + ')}`).join('\n')}`
      : '',
```

(c) En el parse del LLM, reemplazar la línea de avoidList (línea 370):

```typescript
    avoidList = filterAvoidVsAlerts(
      filterAvoidListVsBuy(Array.isArray(p.avoidList) ? p.avoidList : [], buyTickers),
      alertedSymbols,
    );
```

(d) En la construcción del digest (líneas 376-378), flaggear:

```typescript
    const { portfolioRecommendations, marketRecommendations } = buildDigestRecommendations(
      digestInputs?.opportunities ?? [],
    );
    const portfolioRecsFlagged = flagAlertedRecommendations(portfolioRecommendations, alertedSymbols);
    const marketRecsFlagged = flagAlertedRecommendations(marketRecommendations, alertedSymbols);
```

y usar `portfolioRecsFlagged`/`marketRecsFlagged` en el objeto `digest` (líneas 392-393). Aplicar lo mismo en `buildFallbackDigest` pasando `alertedSymbols` como parámetro nuevo (default `new Set()`).

- [ ] **Step 4: Grounding de overnightSummary en el prompt**

En `packages/shared/src/constants/prompts.ts`, reemplazar la línea de overnightSummary del `COMBINED_SYNTHESIS_PROMPT`:

```
"overnightSummary": 3-4 oraciones sobre qué pasó en las últimas horas. SOLO podés usar eventos que aparezcan en las HEADLINES recibidas (macro o ticker-específicas) — PROHIBIDO mencionar eventos, datos o números que no estén en esas headlines. Si las headlines son pocas, escribí menos oraciones; nunca rellenes inventando.
```

Y agregar al final del bloque REGLAS:

```
- Si recibís ALERTAS ANTICIPATORIAS ACTIVAS: no incluyas esos símbolos en avoidList ni los describas como "sin catalizadores" — el motor ya detectó un setup en ellos.
```

- [ ] **Step 5: Chip ⚡ en RecommendationRow (frontend)**

En `apps/frontend/src/daily/DailySummary.tsx`, el tipo local `DigestRec` (línea 166) gana `anticipatoryAlert?: boolean;`. En `RecommendationRow` (línea 177), junto al símbolo:

```tsx
      {rec.anticipatoryAlert && (
        <span title="Alerta anticipatoria activa" className="text-[10px] text-purple-400">⚡</span>
      )}
```

- [ ] **Step 6: Typecheck + suite + commit**

Run: `npm run build:shared && npm run typecheck && cd apps/backend && npm run test`

```bash
git add packages/shared apps/backend/src/intelligence apps/frontend/src/daily/DailySummary.tsx
git commit -m "feat(digest): alertas inyectadas al prompt, avoidList filtrado y chip en recomendaciones"
```

---

### Task 14: Validación de triggers de precio en wouldDo/wouldNotDo

**Files:**
- Create: `apps/backend/src/intelligence/trigger-validation.ts`
- Modify: `apps/backend/src/intelligence/unified-analysis.service.ts:174-175`
- Test: `apps/backend/src/intelligence/trigger-validation.test.ts`

Un trigger sin precio/nivel concreto ("esperar pullback") es inaccionable. Filtramos los que no referencian `$precio`, RSI, SMA o nivel.

- [ ] **Step 1: Test que falla**

`apps/backend/src/intelligence/trigger-validation.test.ts`:

```typescript
import { describe, it, expect } from 'vitest';
import { isActionableTrigger, filterActionableTriggers } from './trigger-validation.js';

describe('isActionableTrigger', () => {
  it('acepta triggers con precio concreto', () => {
    expect(isActionableTrigger('BUY si cierra sobre $64.50 con volumen')).toBe(true);
    expect(isActionableTrigger('Skip si pierde $61')).toBe(true);
  });
  it('acepta referencias a RSI / SMA / soporte / resistencia', () => {
    expect(isActionableTrigger('Entrar si RSI vuelve sobre 40')).toBe(true);
    expect(isActionableTrigger('BUY si recupera la SMA50')).toBe(true);
    expect(isActionableTrigger('Comprar en el soporte')).toBe(true);
  });
  it('rechaza triggers vagos sin nivel', () => {
    expect(isActionableTrigger('Esperar pullback')).toBe(false);
    expect(isActionableTrigger('Ver como abre mañana')).toBe(false);
  });
});

describe('filterActionableTriggers', () => {
  it('filtra los vagos pero conserva al menos el primero si TODOS son vagos (no perder señal)', () => {
    expect(filterActionableTriggers(['Esperar pullback', 'BUY sobre $50'])).toEqual(['BUY sobre $50']);
    expect(filterActionableTriggers(['Esperar pullback'])).toEqual(['Esperar pullback']);
    expect(filterActionableTriggers([])).toEqual([]);
  });
});
```

Run: `cd apps/backend && npx vitest run src/intelligence/trigger-validation.test.ts` → FAIL.

- [ ] **Step 2: Implementar**

`apps/backend/src/intelligence/trigger-validation.ts`:

```typescript
/**
 * Un trigger accionable referencia un nivel concreto: precio ($X), RSI, SMA/media,
 * soporte/resistencia, breakout o porcentaje. "Esperar pullback" no permite setear nada.
 */
const LEVEL_PATTERN = /\$\s?\d+(\.\d+)?|\bRSI\b|\bSMA\s?\d*\b|\bmedia de \d+\b|soporte|resistencia|breakout|ruptura|\d+(\.\d+)?\s?%/i;

export function isActionableTrigger(trigger: string): boolean {
  return LEVEL_PATTERN.test(trigger);
}

/** Si todos son vagos, conserva el primero — mejor señal débil que campo vacío. */
export function filterActionableTriggers(triggers: string[]): string[] {
  if (triggers.length === 0) return triggers;
  const actionable = triggers.filter(isActionableTrigger);
  return actionable.length > 0 ? actionable : [triggers[0]];
}
```

- [ ] **Step 3: Aplicar en el mapping del LLM**

En `unified-analysis.service.ts` (líneas 174-175), con import `import { filterActionableTriggers } from './trigger-validation.js';`:

```typescript
        wouldDo: Array.isArray(a.wouldDo) ? filterActionableTriggers(a.wouldDo.slice(0, 2)) : [],
        wouldNotDo: Array.isArray(a.wouldNotDo) ? filterActionableTriggers(a.wouldNotDo.slice(0, 1)) : [],
```

- [ ] **Step 4: Tests + commit**

Run: `cd apps/backend && npx vitest run src/intelligence/trigger-validation.test.ts && npm run test`

```bash
git add apps/backend/src/intelligence
git commit -m "fix(analysis): wouldDo/wouldNotDo exigen nivel concreto (precio/RSI/SMA)"
```

---

## FASE 6 — Alertas de stop-loss en tiempo real

### Task 15: Watcher de stops perforados (reusa la infra de alertas)

**Files:**
- Create: `apps/backend/src/alerts/stop-breach.service.ts`
- Test: `apps/backend/src/alerts/stop-breach.test.ts`
- Modify: `apps/backend/src/shared/cron.ts` (nuevo cron cada 10 min en horario de mercado)

Si el precio actual de una posición del portfolio perfora el stop sugerido por el último scan, hoy nadie avisa hasta días después. Detector puro + cron. Inserta en `anticipatory_alerts` con `kind='stop_breach'` → badge + notificación browser gratis (Tasks 9-10 ya poleean `unseenCount`).

- [ ] **Step 1: Test que falla**

`apps/backend/src/alerts/stop-breach.test.ts`:

```typescript
import { describe, it, expect } from 'vitest';
import { detectStopBreaches } from './stop-breach.service.js';

const pos = (symbol: string) => ({ symbol, quantity: 10, avgCost: 50 });
const opp = (symbol: string, stopLoss: number) => ({
  symbol, inPortfolio: true, tradeLevels: { entryPrice: 50, stopLoss, takeProfit: 60 },
});

describe('detectStopBreaches', () => {
  const TODAY = '2026-06-11';

  it('precio < stop → alerta stop_breach con id estable stop:SYMBOL', () => {
    const breaches = detectStopBreaches(
      [pos('GGAL')],
      [opp('GGAL', 46)],
      new Map([['GGAL', 45.5]]),
      TODAY,
    );
    expect(breaches).toHaveLength(1);
    expect(breaches[0].id).toBe('stop:GGAL');
    expect(breaches[0].kind).toBe('stop_breach');
    expect(breaches[0].stopLoss).toBe(46);
    expect(breaches[0].currentPrice).toBe(45.5);
    expect(breaches[0].signals[0].description).toContain('perforó el stop');
  });

  it('precio >= stop → sin alerta', () => {
    expect(detectStopBreaches([pos('GGAL')], [opp('GGAL', 46)], new Map([['GGAL', 46.0]]), TODAY)).toHaveLength(0);
    expect(detectStopBreaches([pos('GGAL')], [opp('GGAL', 46)], new Map([['GGAL', 48]]), TODAY)).toHaveLength(0);
  });

  it('sin tradeLevels, sin quote o fuera de portfolio → sin alerta', () => {
    expect(detectStopBreaches([pos('GGAL')], [{ symbol: 'GGAL', inPortfolio: true }], new Map([['GGAL', 1]]), TODAY)).toHaveLength(0);
    expect(detectStopBreaches([pos('GGAL')], [opp('GGAL', 46)], new Map(), TODAY)).toHaveLength(0);
    expect(detectStopBreaches([], [opp('GGAL', 46)], new Map([['GGAL', 45]]), TODAY)).toHaveLength(0);
  });
});
```

Run: `cd apps/backend && npx vitest run src/alerts/stop-breach.test.ts` → FAIL.

- [ ] **Step 2: Implementar detector puro + runner**

`apps/backend/src/alerts/stop-breach.service.ts`:

```typescript
import type { AnticipatoryAlert } from '@trading/shared';
import { getPortfolioPositions, getActiveAnticipatoryAlerts, upsertAnticipatoryAlerts } from '../db/repository.js';
import { getLatestOpportunityScan } from '../db/repository.js';
import { getQuotes } from '../shared/yahoo.js';

export interface StopBreachPosition { symbol: string; quantity: number; avgCost: number; }
export interface StopBreachOpp { symbol: string; inPortfolio: boolean; tradeLevels?: { entryPrice: number; stopLoss: number; takeProfit: number }; }

/** Puro: posiciones × stops del último scan × precios actuales → breaches. */
export function detectStopBreaches(
  positions: StopBreachPosition[],
  opportunities: StopBreachOpp[],
  prices: Map<string, number>,
  today: string,
): AnticipatoryAlert[] {
  const held = new Set(positions.map(p => p.symbol.toUpperCase()));
  const breaches: AnticipatoryAlert[] = [];

  for (const opp of opportunities) {
    if (!opp.inPortfolio || !held.has(opp.symbol.toUpperCase())) continue;
    const stop = opp.tradeLevels?.stopLoss;
    if (stop == null || stop <= 0) continue;
    const price = prices.get(opp.symbol);
    if (price == null || price <= 0) continue;
    if (price >= stop) continue;

    breaches.push({
      id: `stop:${opp.symbol}`,
      kind: 'stop_breach',
      symbol: opp.symbol,
      signals: [{
        category: 'divergence', // sin categoria propia en v1; el kind manda en UI
        description: `${opp.symbol} perforó el stop sugerido $${stop.toFixed(2)} (precio $${price.toFixed(2)}). Revisar salida — proteger capital.`,
        estimatedDays: 0,
      }],
      currentPrice: price,
      stopLoss: stop,
      score: 0,
      status: 'active',
      firstSeenDate: today,
      lastSeenDate: today,
      seen: false,
    });
  }
  return breaches;
}

/** Runner con I/O: dedup contra alertas activas (no re-insertar el mismo breach). */
export async function checkStopBreaches(): Promise<number> {
  const positions = getPortfolioPositions();
  if (positions.length === 0) return 0;

  const scan = getLatestOpportunityScan();
  if (!scan) return 0;
  const opportunities: StopBreachOpp[] = JSON.parse(scan.opportunities);

  const quotes = await getQuotes(positions.map(p => p.symbol));
  const prices = new Map(quotes.map(q => [q.symbol, q.current]));
  const today = new Date().toISOString().slice(0, 10);

  const breaches = detectStopBreaches(positions, opportunities, prices, today);
  const activeIds = new Set(getActiveAnticipatoryAlerts().map(a => a.id));
  const fresh = breaches.filter(b => !activeIds.has(b.id));
  if (fresh.length > 0) {
    upsertAnticipatoryAlerts(fresh, []);
    console.log(`[stop-breach] ${fresh.length} stops perforados: ${fresh.map(b => b.symbol).join(', ')}`);
  }
  return fresh.length;
}
```

Nota ejecutor: verificar firmas reales de `getPortfolioPositions`/`getLatestOpportunityScan` en `db/repository.ts` (ya se usan en `market-report.service.ts:176` y `etf.router.ts:5`) y ajustar imports si difieren.

- [ ] **Step 3: Tests del detector**

Run: `cd apps/backend && npx vitest run src/alerts/stop-breach.test.ts`
Expected: PASS.

- [ ] **Step 4: Cron cada 10 min en horario de mercado**

En `apps/backend/src/shared/cron.ts`, dentro de `startCronJobs()` al final, siguiendo el patrón de los crons existentes:

```typescript
  // Stop-loss watcher: cada 10 min, 13-21 UTC lun-vie (≈ 10:00-18:00 ART / horario NYSE)
  cron.schedule('*/10 13-21 * * 1-5', async () => {
    try {
      const { checkStopBreaches } = await import('../alerts/stop-breach.service.js');
      await checkStopBreaches();
    } catch (err) {
      console.error('[Cron] Stop-breach check failed:', (err as Error).message);
    }
  });
  console.log('[Cron] Scheduled: stop-breach watcher cada 10 min (13-21 UTC, lun-vie)');
```

- [ ] **Step 5: UI — distinguir stop_breach en el panel**

En `apps/frontend/src/alerts/AlertsPanel.tsx` y `AnticipatoryAlertsPinned.tsx`, donde se renderiza cada alerta, variar el estilo por kind:

```tsx
// En AlertsPanel, en la Card de cada alerta:
className={a.kind === 'stop_breach'
  ? 'border-l-4 border-l-red-500'
  : a.status === 'active' ? 'border-l-4 border-l-purple-500' : 'opacity-70'}

// Y en el header de la fila, tras el simbolo:
{a.kind === 'stop_breach' && <Badge className="text-[9px] bg-red-500/20 text-red-400">STOP PERFORADO</Badge>}
```

- [ ] **Step 6: Typecheck + suite + commit**

Run: `npm run typecheck && cd apps/backend && npm run test`

```bash
git add apps/backend/src/alerts apps/backend/src/shared/cron.ts apps/frontend/src/alerts
git commit -m "feat(alerts): watcher de stop-loss perforado cada 10 min via cron"
```

---

## Task 16: Verificación final end-to-end

**Files:** ninguno nuevo — verificación.

- [ ] **Step 1: Suite completa + typecheck + build**

Run: `npm run build:shared && npm run typecheck && cd apps/backend && npm run test`
Expected: todo PASS, cero errores TS.

- [ ] **Step 2: Smoke E2E manual**

1. `npm run dev`
2. Disparar un scan (botón "Generar reporte" o pipeline).
3. Verificar en orden:
   - Backend loggea `[alerts] N alertas anticipatorias NUEVAS` si hay confluencia (o ninguna — válido).
   - `sqlite3 <db> "SELECT id, status, seen FROM anticipatory_alerts"` muestra filas coherentes.
   - Daily: sección ⚡ fijada arriba solo si hay activas; chip ⚡ en recomendaciones de símbolos alertados.
   - Tab Alertas: badge con count, se limpia al abrir; historial con estados.
   - Un símbolo con alerta activa NO aparece en avoidList del reporte.
   - Segundo scan del mismo día: NO se duplican alertas (reconcile → toUpdate, badge no sube).
4. Verificar veredicto: un símbolo en portfolio con divergencia alcista semanal + segundo trigger bullish debe mostrar BUY/WATCH (no MANTENER) y su `verdict.trace` debe registrar el upgrade.

- [ ] **Step 3: Actualizar la spec con lo implementado**

Marcar en `docs/superpowers/specs/2026-06-11-anticipatory-alerts-design.md` cualquier desvío de implementación (ej. expiry por días calendario en vez de 5 scans).

- [ ] **Step 4: Commit final**

```bash
git add docs/superpowers
git commit -m "docs(alerts): plan e2e ejecutado — spec actualizada con desvios"
```

---

## Correcciones a la auditoría (verificado contra código — NO implementar)

1. **"Fundamental score nunca usado" — FALSO.** `normFund` pondera 15%/35% en `computeHorizonScore` (`scoring.ts:86`). Sin acción.
2. **"División por cero en velocities" — FALSO.** Guards existentes: `rsiVelocity < -1` exige |v|>1; MACD `convergenceRate` guard 0.0001 (línea 218); precio `dailyChange` guard 0.001 (línea 139). Sin acción.
3. **"Weight proposals nunca aplicables" — FALSO.** `generateWeightProposal` corre en pipeline (líneas 575/737), `approveWeightProposal` expuesto en `intelligence.router.ts:240`, consumido por AccuracyDashboard. Sin acción.

## Fuera de alcance (follow-ups anotados, NO en este plan)

- Web Push real con tab cerrada (VAPID + service worker).
- Cadencia intradía del scan completo.
- Refinamiento `triggered` vs `expired` (¿el setup realmente rompió?).
- Alertas anticipatorias bajistas (simetría de notificación; el override de veredicto ya existe).
- Decay temporal de sentiment + clustering de titulares repetidos (Fase propia — tocar news-intelligence).
- Position sizing sugerido + moneda ARS/CCL en portfolio.
- Action queue unificada en Daily (consolidar 10 secciones).
- Taxonomía única de sectores (27 vs 12 vs 11).





