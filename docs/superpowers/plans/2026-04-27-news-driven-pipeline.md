# News-Driven Pipeline Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace hardcoded symbol-driven analysis with a news-driven pipeline that reasons causal chains from today's events to determine which stocks to analyze.

**Architecture:** A new `macroIntelligence` stage runs between `news` and `analysis`. It makes two LLM calls: first to extract 5–8 key macro events from headlines, then to reason causal chains per event (direct + indirect ticker impacts). The resulting `CausalMap` is persisted to DB and replaces `getActiveSymbolList()` as the symbol source for the analysis stage. Each symbol carries its causal context into the per-symbol LLM card.

**Tech Stack:** TypeScript, Drizzle ORM (SQLite), Hono + tRPC, `@trading/shared` types, `callAI`/`callAIWithModel` from `ai-router.js`

---

## File Map

| Action | File | Responsibility |
|--------|------|----------------|
| Modify | `packages/shared/src/types/intelligence.ts` | Add `macroIntelligence` to `PipelineRun.stages` |
| Modify | `apps/backend/src/db/schema.ts` | New tables: `macro_events`, `causal_chains`, `event_relations`; new columns on `pipeline_runs` |
| Modify | `apps/backend/src/db/repository.ts` | CRUD for causal map tables |
| Modify | `apps/backend/src/intelligence/pipeline.repository.ts` | New stage in `updatePipelineStage` union + `rowToPipelineRun` |
| Create | `apps/backend/src/intelligence/macro-intelligence.service.ts` | Two-step LLM logic: event extraction + causal chain reasoning |
| Modify | `apps/backend/src/intelligence/pipeline.service.ts` | New `runMacroIntelligenceStage`, wire into `runRemainingStages`, "Noticias" force-clear |
| Modify | `apps/backend/src/opportunities/opportunities.service.ts` | Replace `getActiveSymbolList()` with causal tickers in `runLiveScan` |
| Modify | `apps/backend/src/intelligence/unified-analysis.service.ts` | Add `causalContextMap` param to `buildCompactCard` + `runUnifiedAnalysis` |
| Modify | `apps/frontend/src/layout/Header.tsx` | "Noticias" button passes `force: true` and calls full pipeline |

---

## Task 1: Add `macroIntelligence` stage to shared `PipelineRun` type

**Files:**
- Modify: `packages/shared/src/types/intelligence.ts:168-182`

- [ ] **Step 1: Add the stage to the type**

In `packages/shared/src/types/intelligence.ts`, update the `PipelineRun` interface:

```typescript
export interface PipelineRun {
  id: number
  date: string
  status: 'running' | 'ok' | 'partial' | 'failed' | 'waiting_user' | 'cancelled'
  stages: {
    webSearch: StageResult
    news: StageResult
    macroIntelligence: StageResult   // ← new
    fundamentals: StageResult
    analysis: StageResult
    quant?: StageResult
    report: StageResult
  }
  startedAt: string
  finishedAt: string | null
}
```

- [ ] **Step 2: Verify TypeScript compiles**

```bash
cd /Users/federicocroce/Documents/Fede/trading
npx tsc -p packages/shared/tsconfig.json --noEmit
```
Expected: no errors.

- [ ] **Step 3: Commit**

```bash
git add packages/shared/src/types/intelligence.ts
git commit -m "feat(shared): add macroIntelligence stage to PipelineRun type"
```

---

## Task 2: DB schema — new tables + pipeline_runs columns

**Files:**
- Modify: `apps/backend/src/db/schema.ts` (append after line ~588)

- [ ] **Step 1: Add new tables and columns to schema.ts**

At the end of `apps/backend/src/db/schema.ts`, append:

```typescript
// --- Macro Intelligence ---
export const macroEvents = sqliteTable('macro_events', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  date: text('date').notNull(),
  eventId: text('event_id').notNull(),
  event: text('event').notNull(),
  category: text('category').notNull(),
  magnitude: text('magnitude', { enum: ['high', 'medium', 'low'] }).notNull(),
  createdAt: text('created_at').notNull().default(sql`(datetime('now'))`),
});

export const causalChains = sqliteTable('causal_chains', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  date: text('date').notNull(),
  eventId: text('event_id').notNull(),
  ticker: text('ticker').notNull(),
  category: text('category').notNull(),
  direction: text('direction', { enum: ['positive', 'negative'] }).notNull(),
  impact: text('impact', { enum: ['direct', 'indirect'] }).notNull(),
  reason: text('reason').notNull(),
  createdAt: text('created_at').notNull().default(sql`(datetime('now'))`),
});

export const eventRelations = sqliteTable('event_relations', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  date: text('date').notNull(),
  eventId: text('event_id').notNull(),
  relatedEventId: text('related_event_id').notNull(),
});
```

- [ ] **Step 2: Add macroIntelligence columns to pipelineRuns table**

In the `pipelineRuns` sqliteTable definition (around line 398, after the `news` stage columns and before `fundamentals`), add:

```typescript
  // Stage: macroIntelligence
  macroIntelligenceStatus: text('macro_intelligence_status', { enum: ['pending', 'running', 'ok', 'partial', 'failed', 'skipped'] }).notNull().default('pending'),
  macroIntelligenceDetail: text('macro_intelligence_detail'),
  macroIntelligenceErrors: text('macro_intelligence_errors'),
  macroIntelligenceStartedAt: text('macro_intelligence_started_at'),
  macroIntelligenceFinishedAt: text('macro_intelligence_finished_at'),
```

- [ ] **Step 3: Apply migration by restarting backend**

```bash
cd /Users/federicocroce/Documents/Fede/trading
npm run dev --workspace=apps/backend
```

Watch for `[db] Migration applied` or no errors. Stop the server (Ctrl+C).

- [ ] **Step 4: Verify tables exist**

```bash
sqlite3 data/trading.db ".tables" | tr ' ' '\n' | grep -E "macro|causal|event_rel"
```
Expected output includes: `macro_events`, `causal_chains`, `event_relations`

- [ ] **Step 5: Commit**

```bash
git add apps/backend/src/db/schema.ts
git commit -m "feat(db): add macro_events, causal_chains, event_relations tables and macroIntelligence stage columns"
```

---

## Task 3: Repository functions for causal map

**Files:**
- Modify: `apps/backend/src/db/repository.ts` (append near end, before last export)

- [ ] **Step 1: Add causal map CRUD functions**

At the end of `apps/backend/src/db/repository.ts`, append:

```typescript
// ─── Causal Map ───────────────────────────────────────────────────────────────

export interface CausalChainRow {
  eventId: string;
  ticker: string;
  category: string;
  direction: 'positive' | 'negative';
  impact: 'direct' | 'indirect';
  reason: string;
}

export interface MacroEventRow {
  eventId: string;
  event: string;
  category: string;
  magnitude: 'high' | 'medium' | 'low';
  relatedEventIds: string[];
  chains: CausalChainRow[];
}

export function clearCausalMapForDate(date: string): void {
  db.delete(schema.eventRelations).where(eq(schema.eventRelations.date, date)).run();
  db.delete(schema.causalChains).where(eq(schema.causalChains.date, date)).run();
  db.delete(schema.macroEvents).where(eq(schema.macroEvents.date, date)).run();
}

export function saveCausalMap(date: string, events: MacroEventRow[]): void {
  clearCausalMapForDate(date);
  db.transaction((trx) => {
    for (const evt of events) {
      trx.insert(schema.macroEvents).values({
        date,
        eventId: evt.eventId,
        event: evt.event,
        category: evt.category,
        magnitude: evt.magnitude,
      }).run();
      for (const chain of evt.chains) {
        trx.insert(schema.causalChains).values({
          date,
          eventId: evt.eventId,
          ticker: chain.ticker,
          category: chain.category,
          direction: chain.direction,
          impact: chain.impact,
          reason: chain.reason,
        }).run();
      }
      for (const relId of evt.relatedEventIds) {
        trx.insert(schema.eventRelations).values({
          date,
          eventId: evt.eventId,
          relatedEventId: relId,
        }).run();
      }
    }
  });
}

export function getCausalMapByDate(date: string): MacroEventRow[] {
  const events = db.select().from(schema.macroEvents)
    .where(eq(schema.macroEvents.date, date))
    .all();
  const chains = db.select().from(schema.causalChains)
    .where(eq(schema.causalChains.date, date))
    .all();
  const relations = db.select().from(schema.eventRelations)
    .where(eq(schema.eventRelations.date, date))
    .all();

  return events.map(evt => ({
    eventId: evt.eventId,
    event: evt.event,
    category: evt.category,
    magnitude: evt.magnitude as 'high' | 'medium' | 'low',
    relatedEventIds: relations
      .filter(r => r.eventId === evt.eventId)
      .map(r => r.relatedEventId),
    chains: chains
      .filter(c => c.eventId === evt.eventId)
      .map(c => ({
        eventId: c.eventId,
        ticker: c.ticker,
        category: c.category,
        direction: c.direction as 'positive' | 'negative',
        impact: c.impact as 'direct' | 'indirect',
        reason: c.reason,
      })),
  }));
}

export function getCausalTickersByDate(date: string): Array<{ ticker: string; direction: 'positive' | 'negative'; causalSummary: string }> {
  const chains = db.select().from(schema.causalChains)
    .where(eq(schema.causalChains.date, date))
    .all();
  const events = db.select().from(schema.macroEvents)
    .where(eq(schema.macroEvents.date, date))
    .all();
  const eventMap = new Map(events.map(e => [e.eventId, e]));

  // Deduplicate: one entry per ticker, strongest direction wins, accumulate reasons
  const tickerMap = new Map<string, { direction: 'positive' | 'negative'; reasons: string[] }>();
  for (const chain of chains) {
    const evt = eventMap.get(chain.eventId);
    const reason = `[${chain.impact === 'direct' ? 'DIRECTO' : 'INDIRECTO'}] ${evt?.event ?? chain.eventId}: ${chain.reason}`;
    if (!tickerMap.has(chain.ticker)) {
      tickerMap.set(chain.ticker, { direction: chain.direction as 'positive' | 'negative', reasons: [reason] });
    } else {
      const entry = tickerMap.get(chain.ticker)!;
      if (chain.direction === 'positive' && entry.direction === 'negative') {
        entry.direction = 'positive'; // positive overrides negative
      }
      entry.reasons.push(reason);
    }
  }

  return [...tickerMap.entries()].map(([ticker, data]) => ({
    ticker,
    direction: data.direction,
    causalSummary: data.reasons.join('\n'),
  }));
}
```

- [ ] **Step 2: Add schema imports for new tables**

At the top of `repository.ts`, the `schema` import is already `import * as schema from './schema.js'` — no change needed since the new tables are exported from schema.ts.

- [ ] **Step 3: Verify TypeScript compiles**

```bash
npx tsc -p apps/backend/tsconfig.json --noEmit
```
Expected: no errors.

- [ ] **Step 4: Commit**

```bash
git add apps/backend/src/db/repository.ts
git commit -m "feat(db): add causal map CRUD functions (saveCausalMap, getCausalMapByDate, getCausalTickersByDate)"
```

---

## Task 4: Update pipeline.repository.ts for new stage

**Files:**
- Modify: `apps/backend/src/intelligence/pipeline.repository.ts`

- [ ] **Step 1: Add macroIntelligence to updatePipelineStage union**

In `pipeline.repository.ts`, change line 90:
```typescript
// Before:
  stage: 'webSearch' | 'news' | 'fundamentals' | 'analysis' | 'quant' | 'report',

// After:
  stage: 'webSearch' | 'news' | 'macroIntelligence' | 'fundamentals' | 'analysis' | 'quant' | 'report',
```

- [ ] **Step 2: Add macroIntelligence to rowToPipelineRun**

In the `rowToPipelineRun` function (around line 28), add after the `news` line:
```typescript
      macroIntelligence: stageResultFromRow(row.macroIntelligenceStatus, row.macroIntelligenceDetail, row.macroIntelligenceErrors, row.macroIntelligenceStartedAt, row.macroIntelligenceFinishedAt),
```

- [ ] **Step 3: Add macroIntelligenceStatus to createPipelineRun**

In `createPipelineRun` (around line 44), add `macroIntelligenceStatus: 'pending'` alongside the other pending statuses:
```typescript
    macroIntelligenceStatus: 'pending',
```

- [ ] **Step 4: Verify TypeScript compiles**

```bash
npx tsc -p apps/backend/tsconfig.json --noEmit
```
Expected: no errors.

- [ ] **Step 5: Commit**

```bash
git add apps/backend/src/intelligence/pipeline.repository.ts
git commit -m "feat(pipeline): add macroIntelligence stage to pipeline repository"
```

---

## Task 5: Create macro-intelligence.service.ts

**Files:**
- Create: `apps/backend/src/intelligence/macro-intelligence.service.ts`

This is the core of the feature. Two LLM calls:
- **Paso 1** — extract 5–8 macro events from today's headlines
- **Paso 2** — reason causal chains per event

- [ ] **Step 1: Create the file**

```typescript
// apps/backend/src/intelligence/macro-intelligence.service.ts
import { callAI } from '../shared/ai-router.js';
import type { MacroEventRow } from '../db/repository.js';

const VALID_CATEGORIES = [
  'Política Monetaria', 'Semiconductores/IA', 'Energía/Oil', 'Argentina/CEDEARs',
  'Cripto', 'Banca US', 'Salud/Biotech', 'Commodities', 'Comercio/Aranceles',
  'Consumo/Retail', 'Defensa/Geopolítica',
] as const;

const EVENT_EXTRACTION_PROMPT = `Sos un analista de mercados financieros. 
Te doy los titulares de noticias del día. Identificá los 5-8 EVENTOS MACRO más relevantes para los mercados financieros.

Para cada evento:
- "id": "evt_1", "evt_2", etc. (secuencial)
- "event": una oración clara describiendo qué pasó
- "category": una de estas categorías exactas: ${VALID_CATEGORIES.join(', ')}
- "magnitude": "high" | "medium" | "low"

Solo incluí eventos con impacto real y verificable en precios de activos. Ignorá ruido y clickbait.

Respondé SOLO con JSON válido: {"events": [...]}`;

const CAUSAL_CHAINS_PROMPT = `Sos un estratega de inversiones senior. 
Te doy una lista de eventos macro del día. Para cada evento, razoná las cadenas causales y determiná qué tickers de bolsa están impactados.

Para cada ticker en una cadena:
- "ticker": símbolo válido NYSE/NASDAQ/ADR (ej: "AMD", "GGAL", "YPF")
- "category": sector del ticker (ej: "Semiconductores/IA", "Banca US", "Energía/Oil", "Argentina/CEDEARs")  
- "direction": "positive" | "negative"
- "impact": "direct" (el evento afecta directamente a esta empresa) | "indirect" (efecto de segundo orden)
- "reason": una oración explicando la cadena causal

Reglas:
- Sé específico: nombrá tickers concretos, no sectores genéricos
- Incluí efectos de segundo orden: si AMD supera earnings → NVDA se beneficia por validación de demanda IA
- Incluí impactos negativos: si AMD gana market share → INTC sufre
- Vinculá eventos relacionados en "relatedEventIds" (ej: Fed + CPI son eventos relacionados de Política Monetaria)
- Máximo 6 tickers por evento
- Solo tickers con impacto claro y justificable

Respondé SOLO con JSON válido:
{"events": [{"id": "evt_1", "relatedEventIds": [], "chains": [...]}]}`;

interface RawEvent {
  id: string;
  event: string;
  category: string;
  magnitude: string;
}

interface RawChain {
  ticker: string;
  category: string;
  direction: string;
  impact: string;
  reason: string;
}

interface RawChainEvent {
  id: string;
  relatedEventIds: string[];
  chains: RawChain[];
}

export async function runMacroIntelligence(headlines: string[]): Promise<MacroEventRow[]> {
  if (headlines.length === 0) return [];

  // Paso 1: Extract macro events
  const headlinesBlock = headlines.slice(0, 40).map((h, i) => `${i + 1}. ${h}`).join('\n');
  let rawEvents: RawEvent[] = [];

  try {
    const paso1 = await callAI('reasoning', `TITULARES DEL DÍA:\n${headlinesBlock}`, EVENT_EXTRACTION_PROMPT, 2048);
    const parsed = JSON.parse(paso1);
    rawEvents = Array.isArray(parsed.events) ? parsed.events : [];
    console.log(`[macro-intelligence] Paso 1: ${rawEvents.length} eventos extraídos`);
  } catch (err) {
    console.warn('[macro-intelligence] Paso 1 falló:', (err as Error).message?.slice(0, 100));
    return [];
  }

  if (rawEvents.length === 0) return [];

  // Paso 2: Reason causal chains
  const eventsBlock = rawEvents.map(e =>
    `${e.id}: [${e.category}] ${e.event} (magnitud: ${e.magnitude})`
  ).join('\n');

  let rawChainEvents: RawChainEvent[] = [];

  try {
    const paso2 = await callAI('reasoning', `EVENTOS MACRO DE HOY:\n${eventsBlock}`, CAUSAL_CHAINS_PROMPT, 4096);
    const parsed = JSON.parse(paso2);
    rawChainEvents = Array.isArray(parsed.events) ? parsed.events : [];
    console.log(`[macro-intelligence] Paso 2: cadenas causales para ${rawChainEvents.length} eventos`);
  } catch (err) {
    console.warn('[macro-intelligence] Paso 2 falló:', (err as Error).message?.slice(0, 100));
    return [];
  }

  // Merge paso1 metadata with paso2 chains
  const chainMap = new Map<string, RawChainEvent>(rawChainEvents.map(e => [e.id, e]));

  return rawEvents.map(evt => {
    const chainEvt = chainMap.get(evt.id);
    return {
      eventId: evt.id,
      event: evt.event,
      category: evt.category,
      magnitude: (['high', 'medium', 'low'].includes(evt.magnitude) ? evt.magnitude : 'medium') as 'high' | 'medium' | 'low',
      relatedEventIds: chainEvt?.relatedEventIds ?? [],
      chains: (chainEvt?.chains ?? [])
        .filter(c => c.ticker && c.direction && c.impact)
        .map(c => ({
          eventId: evt.id,
          ticker: c.ticker.trim().toUpperCase(),
          category: c.category ?? 'General',
          direction: (c.direction === 'positive' || c.direction === 'negative' ? c.direction : 'positive') as 'positive' | 'negative',
          impact: (c.impact === 'direct' || c.impact === 'indirect' ? c.impact : 'indirect') as 'direct' | 'indirect',
          reason: c.reason ?? '',
        })),
    };
  });
}
```

- [ ] **Step 2: Verify TypeScript compiles**

```bash
npx tsc -p apps/backend/tsconfig.json --noEmit
```
Expected: no errors.

- [ ] **Step 3: Commit**

```bash
git add apps/backend/src/intelligence/macro-intelligence.service.ts
git commit -m "feat(intelligence): add macro-intelligence service — event extraction + causal chain reasoning"
```

---

## Task 6: Wire macroIntelligence stage into pipeline

**Files:**
- Modify: `apps/backend/src/intelligence/pipeline.service.ts`

- [ ] **Step 1: Add imports**

At the top of `pipeline.service.ts`, add:
```typescript
import { runMacroIntelligence } from './macro-intelligence.service.js';
import { saveCausalMap, getCausalMapByDate, clearCausalMapForDate } from '../db/repository.js';
```

- [ ] **Step 2: Add `isMacroIntelligenceStageValid` function**

After the existing `isAnalysisStageValid()` function (around line 61), add:

```typescript
function isMacroIntelligenceStageValid(): boolean {
  const today = getToday();
  const run = getPipelineRunByDate(today);
  if (!run) return false;
  const existing = getCausalMapByDate(today);
  return existing.length > 0 &&
    (run.stages.macroIntelligence.status === 'ok' || run.stages.macroIntelligence.status === 'partial');
}
```

- [ ] **Step 3: Add `runMacroIntelligenceStage` function**

After `runNewsStage` (around line 179), add:

```typescript
async function runMacroIntelligenceStage(runId: number): Promise<StageResult> {
  const startedAt = new Date().toISOString();
  updatePipelineStage(runId, 'macroIntelligence', { status: 'running', startedAt });
  const today = getToday();
  try {
    // Gather all today's headlines: web search + news articles
    const newsArticles = getNewsArticlesForToday('medium');
    const webArticles = getWebSearchArticlesForDate(today);
    const headlines = [
      ...webArticles.map(a => a.title),
      ...newsArticles.map(a => a.title),
    ].filter(Boolean);

    const events = await runMacroIntelligence(headlines);

    if (events.length === 0) {
      const sr: StageResult = {
        status: 'failed',
        startedAt,
        finishedAt: new Date().toISOString(),
        detail: 'LLM no generó eventos macro.',
        errors: [],
        criticalError: 'Sin eventos — sin noticias suficientes',
      };
      updatePipelineStage(runId, 'macroIntelligence', sr);
      return sr;
    }

    saveCausalMap(today, events);
    const totalTickers = new Set(events.flatMap(e => e.chains.map(c => c.ticker))).size;
    const sr: StageResult = {
      status: 'ok',
      startedAt,
      finishedAt: new Date().toISOString(),
      detail: `${events.length} eventos macro, ${totalTickers} tickers en cadenas causales.`,
      errors: [],
    };
    updatePipelineStage(runId, 'macroIntelligence', sr);
    return sr;
  } catch (err) {
    const errMsg = (err as Error).message ?? String(err);
    console.error('[pipeline] runMacroIntelligenceStage error:', errMsg);
    const sr: StageResult = {
      status: 'failed',
      startedAt,
      finishedAt: new Date().toISOString(),
      detail: 'Error en macro intelligence.',
      errors: [],
      criticalError: errMsg.slice(0, 200),
    };
    updatePipelineStage(runId, 'macroIntelligence', sr);
    return sr;
  }
}
```

- [ ] **Step 4: Add `getWebSearchArticlesForDate` to the import from repository**

In `pipeline.service.ts`, the repository import line currently imports `getNewsArticlesForToday` and others. Add `getWebSearchArticlesForDate`:

```typescript
import { getNewsArticlesForToday, getTodayOpportunityScan, getFundamentalCacheAge, insertWebSearchArticles, getWebSearchArticlesForDate } from '../db/repository.js';
```

- [ ] **Step 5: Wire into `runRemainingStages`**

In `runRemainingStages` (around line 352), add the macroIntelligence stage between news and fundamentals:

```typescript
// After the news stage block (around line 370), before fundamentals, add:

  if (!isMacroIntelligenceStageValid()) {
    const macroResult = await runMacroIntelligenceStage(runId);
    recordStageArtifact(runId, 'macroIntelligence' as any, macroResult);
    if (macroResult.status === 'failed') {
      console.warn('[pipeline] macroIntelligence falló — continuando con portfolio-only');
      updatePipelineStage(runId, 'macroIntelligence', {
        status: 'partial',
        detail: 'Falló — análisis limitado a posiciones abiertas.',
        errors: [],
      });
    }
  } else {
    updatePipelineStage(runId, 'macroIntelligence', {
      status: 'skipped',
      startedAt: new Date().toISOString(),
      finishedAt: new Date().toISOString(),
      detail: 'CausalMap del día ya disponible.',
      errors: [],
    });
  }
```

Note: pass `'macroIntelligence' as any` to `recordStageArtifact` since its stage type may not include it yet — or extend its type similarly to `updatePipelineStage`.

- [ ] **Step 6: Add `finishPipelineRun` stageList to include macroIntelligence**

In the final status check at the end of `runRemainingStages` (around line 406):
```typescript
  const stageList = [finalRun.stages.webSearch, finalRun.stages.news, finalRun.stages.macroIntelligence, finalRun.stages.fundamentals, finalRun.stages.analysis, finalRun.stages.report];
```

- [ ] **Step 7: Force-clear in `checkOrRunPipeline` when force=true**

In `checkOrRunPipeline`, the `force=true` path already creates a new run. Add clearing the causal map before creating the new run:

```typescript
  // After the waitingRun check, before creating/reusing run:
  if (force) {
    clearCausalMapForDate(today);
  }
```

- [ ] **Step 8: Verify TypeScript compiles**

```bash
npx tsc -p apps/backend/tsconfig.json --noEmit
```
Expected: no errors.

- [ ] **Step 9: Commit**

```bash
git add apps/backend/src/intelligence/pipeline.service.ts
git commit -m "feat(pipeline): add macroIntelligence stage — wired between news and fundamentals"
```

---

## Task 7: Replace symbol selection in `runLiveScan` with causal tickers

**Files:**
- Modify: `apps/backend/src/opportunities/opportunities.service.ts:255-259`

- [ ] **Step 1: Add import for causal map functions**

At the top of `opportunities.service.ts`, the repository imports already exist. Add `getCausalTickersByDate`:

```typescript
import {
  // ... existing imports ...
  getCausalTickersByDate,
} from '../db/repository.js';
```

- [ ] **Step 2: Replace symbol selection (lines 255-259)**

Replace:
```typescript
  const dbSymbols = getActiveSymbolList(); // portfolio + watchlist
  const discovered = getDiscoveredTickers().map(t => t.symbol);
  const allSymbols = [...new Set([...dbSymbols, ...discovered])];
```

With:
```typescript
  const portfolioSymbols = getPortfolioPositions().map(p => p.symbol);
  const today = new Date().toISOString().slice(0, 10);
  const causalTickers = getCausalTickersByDate(today).map(c => c.ticker);
  const discovered = getDiscoveredTickers().map(t => t.symbol);
  // Portfolio always included; news-derived tickers replace hardcoded watchlist
  const allSymbols = [...new Set([...portfolioSymbols, ...causalTickers, ...discovered])];
  const causalContextMap = new Map(getCausalTickersByDate(today).map(c => [c.ticker, c.causalSummary]));
```

Note: `causalContextMap` is used in Task 8 to inject context per symbol. Keep it in scope.

- [ ] **Step 3: Pass `causalContextMap` to `runUnifiedAnalysis`**

Later in `runLiveScan`, find the call to `runUnifiedAnalysis` (around line 490+) and add the causal map:

```typescript
  const analyses = await runUnifiedAnalysis(
    opportunities,
    techMap,
    fundMap,
    sentimentMap,
    12,
    pipelineRunId,
    macroContextStr,
    causalContextMap,   // ← new parameter
  );
```

- [ ] **Step 4: Update the log message (line ~259)**

```typescript
  console.log(`[opportunities] Paso 2: ${allSymbols.length} simbolos (${portfolioSymbols.length} portfolio + ${causalTickers.length} causal + ${discovered.length} descubiertos)`);
```

- [ ] **Step 5: Verify TypeScript compiles**

```bash
npx tsc -p apps/backend/tsconfig.json --noEmit
```
Expected: no errors (may fail until Task 8 adds the new param to `runUnifiedAnalysis`).

- [ ] **Step 6: Commit after Task 8 (defer this commit)**

This task's commit happens together with Task 8.

---

## Task 8: Inject causal context per symbol in unified-analysis

**Files:**
- Modify: `apps/backend/src/intelligence/unified-analysis.service.ts`

- [ ] **Step 1: Add `causalContext` param to `buildCompactCard`**

Change the signature of `buildCompactCard` (line 43):
```typescript
function buildCompactCard(
  opp: Opportunity,
  positions: PortfolioPosition[],
  tech?: TechnicalSummary,
  fund?: FundamentalSummary,
  sent?: SentimentInput,
  causalContext?: string,   // ← new
): string {
```

At the end of `buildCompactCard`, before `return lines.join('\n')` (line 123), add:
```typescript
  // Causal context from today's macro events
  if (causalContext) {
    lines.push(`causal:\n${causalContext}`);
  }
```

- [ ] **Step 2: Add `causalContextMap` param to `analyzeBatch`**

Change the signature of `analyzeBatch` (line 130):
```typescript
async function analyzeBatch(
  batch: Opportunity[],
  techMap: Map<string, TechnicalSummary>,
  fundMap: Map<string, FundamentalSummary>,
  sentimentMap: Map<string, SentimentInput>,
  pipelineRunId?: number,
  batchIndex = 0,
  macroContext = '',
  causalContextMap?: Map<string, string>,   // ← new
): Promise<Map<string, UnifiedAssetAnalysis>> {
```

Change the `symbolCards` construction (line 142):
```typescript
  const symbolCards = batch
    .map(o => buildCompactCard(
      o,
      positions,
      techMap.get(o.symbol),
      fundMap.get(o.symbol),
      sentimentMap.get(o.symbol),
      causalContextMap?.get(o.symbol),   // ← new
    ))
    .join('\n---\n');
```

- [ ] **Step 3: Add `causalContextMap` param to `runUnifiedAnalysis`**

Change signature (line 211):
```typescript
export async function runUnifiedAnalysis(
  opportunities: Opportunity[],
  techMap: Map<string, TechnicalSummary>,
  fundMap: Map<string, FundamentalSummary>,
  sentimentMap: Map<string, SentimentInput>,
  maxAssets = 12,
  pipelineRunId?: number,
  macroContext = '',
  causalContextMap?: Map<string, string>,   // ← new
): Promise<Map<string, UnifiedAssetAnalysis>> {
```

Pass it through to `analyzeBatch` (line 245):
```typescript
    batches.map((batch, i) => analyzeBatch(batch, techMap, fundMap, sentimentMap, pipelineRunId, i, macroContext, causalContextMap)),
```

- [ ] **Step 4: Verify TypeScript compiles**

```bash
npx tsc -p apps/backend/tsconfig.json --noEmit
```
Expected: no errors.

- [ ] **Step 5: Commit Tasks 7 + 8 together**

```bash
git add apps/backend/src/opportunities/opportunities.service.ts \
        apps/backend/src/intelligence/unified-analysis.service.ts
git commit -m "feat(analysis): replace symbol selection with causal map tickers + inject causal context per symbol"
```

---

## Task 9: "Noticias" button — force full pipeline refresh

**Files:**
- Modify: `apps/frontend/src/layout/Header.tsx`

- [ ] **Step 1: Read the current Header.tsx to find the button**

```bash
grep -n "Noticias\|pipeline\|generateMarketReport\|run\b\|force" apps/frontend/src/layout/Header.tsx | head -20
```

- [ ] **Step 2: Ensure "Noticias" calls pipeline with force=true**

Find the button in `Header.tsx`. It should call the pipeline mutation with `force: true`. The `usePipeline` hook exposes `run(force?: boolean)`. The button should call `run(true)`:

If the button currently calls `run()` or `run(false)`, change it to `run(true)`:
```tsx
<Button onClick={() => run(true)}>
  Noticias
</Button>
```

If the button calls `trpc.intelligence.generateMarketReport` directly, change the input:
```tsx
mutation.mutate({ force: true })
```

- [ ] **Step 3: Verify the UI still starts the pipeline**

Start backend + frontend:
```bash
npm run dev
```
Open `http://localhost:5173`, click "Noticias", verify the pipeline status shows "running" in the UI and the backend logs show `[pipeline] Starting fresh run`.

- [ ] **Step 4: Commit**

```bash
git add apps/frontend/src/layout/Header.tsx
git commit -m "feat(ui): Noticias button forces full pipeline refresh (force=true)"
```

---

## Task 10: End-to-end smoke test

- [ ] **Step 1: Run full pipeline manually**

With backend running, trigger via the UI "Noticias" button OR via curl:
```bash
curl -s -X POST http://localhost:3001/trpc/intelligence.generateMarketReport \
  -H "Content-Type: application/json" \
  -d '{"json":{"force":true}}' | jq '.result.data.stages.macroIntelligence'
```
Expected: `{"status":"ok","detail":"X eventos macro, Y tickers en cadenas causales.",...}`

- [ ] **Step 2: Verify causal map in DB**

```bash
sqlite3 data/trading.db "
SELECT me.event_id, me.event, me.category, me.magnitude,
       cc.ticker, cc.direction, cc.impact, cc.reason
FROM macro_events me
JOIN causal_chains cc ON cc.event_id = me.event_id AND cc.date = me.date
WHERE me.date = date('now')
LIMIT 20;
"
```
Expected: rows showing events and their causal chains with real tickers.

- [ ] **Step 3: Verify symbols analyzed include causal tickers**

```bash
sqlite3 data/trading.db "
SELECT symbol, action FROM opportunity_scans
WHERE scanned_at >= datetime('now', '-1 hour')
LIMIT 1;
" | head -5
# Then check opportunities JSON for non-portfolio tickers
```

- [ ] **Step 4: Press "Analizar" a second time, verify macroIntelligence is skipped**

```bash
curl -s -X POST http://localhost:3001/trpc/intelligence.generateMarketReport \
  -H "Content-Type: application/json" \
  -d '{"json":{}}' | jq '.result.data.stages.macroIntelligence.status'
```
Expected: `"skipped"`

- [ ] **Step 5: Final commit**

```bash
git add -A
git commit -m "feat: news-driven pipeline with macro intelligence stage complete"
```
