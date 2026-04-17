# Fase 1: Config en DB + Persistencia Completa — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Mover símbolos/queries hardcodeados a DB editable + guardar audit trail completo de cada run del pipeline.

**Architecture:** Nuevas tablas Drizzle SQLite para `discoveryQueries`, `thematicQueries`, `pipelineStageArtifacts`, `unifiedAnalysisBatches`. Los servicios leen config desde DB con fallback a defaults si tabla vacía. Cada stage del pipeline guarda su I/O en `pipelineStageArtifacts`. Cada llamada LLM del unified analysis guarda prompt+respuesta en `unifiedAnalysisBatches`.

**Tech Stack:** Drizzle ORM + better-sqlite3, tRPC, TypeScript, React + Vite (frontend), shadcn/ui

---

## File Map

| Action | Path | Responsibility |
|--------|------|---------------|
| Modify | `apps/backend/src/db/schema.ts` | Add 4 new tables |
| Create | `apps/backend/src/intelligence/config.repository.ts` | CRUD discoveryQueries + thematicQueries |
| Create | `apps/backend/src/intelligence/pipeline-artifacts.repository.ts` | Save/read stage artifacts |
| Modify | `apps/backend/src/web-search/web-search.service.ts` | Read DISCOVERY_QUERIES from DB |
| Modify | `apps/backend/src/intelligence/market-report.service.ts` | Read THEMATIC_QUERIES from DB |
| Modify | `apps/backend/src/intelligence/pipeline.service.ts` | Save stage artifacts per stage + seed config on init |
| Modify | `apps/backend/src/intelligence/unified-analysis.service.ts` | Save each LLM batch to unifiedAnalysisBatches |
| Modify | `apps/backend/src/intelligence/intelligence.router.ts` | Add config management endpoints |
| Create | `apps/frontend/src/intelligence/PipelineConfig.tsx` | UI for editing queries |

---

### Task 1: Add new tables to schema.ts

**Files:**
- Modify: `apps/backend/src/db/schema.ts`

- [ ] **Step 1: Add `discoveryQueries` table** after `pipelineRuns` at end of schema.ts

```typescript
// --- Discovery Queries (user-configurable web search queries) ---
export const discoveryQueries = sqliteTable('discovery_queries', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  query: text('query').notNull(),
  lang: text('lang', { enum: ['en', 'es'] }).notNull().default('en'),
  active: integer('active', { mode: 'boolean' }).notNull().default(true),
  priority: integer('priority').notNull().default(0),
  category: text('category').notNull().default('general'),
  createdAt: text('created_at').notNull().default(sql`(datetime('now'))`),
});
```

- [ ] **Step 2: Add `thematicQueries` table**

```typescript
// --- Thematic Queries (user-configurable market report themes) ---
export const thematicQueries = sqliteTable('thematic_queries', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  name: text('name').notNull(),
  keywords: text('keywords').notNull(), // JSON array of strings
  active: integer('active', { mode: 'boolean' }).notNull().default(true),
  priority: integer('priority').notNull().default(0),
  createdAt: text('created_at').notNull().default(sql`(datetime('now'))`),
});
```

- [ ] **Step 3: Add `pipelineStageArtifacts` table**

```typescript
// --- Pipeline Stage Artifacts (audit trail per stage per run) ---
export const pipelineStageArtifacts = sqliteTable('pipeline_stage_artifacts', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  pipelineRunId: integer('pipeline_run_id').notNull().references(() => pipelineRuns.id),
  stage: text('stage', { enum: ['webSearch', 'news', 'fundamentals', 'opportunities', 'report', 'digest'] }).notNull(),
  inputSnapshot: text('input_snapshot'),   // JSON — truncated to 50KB max
  outputSnapshot: text('output_snapshot'), // JSON — truncated to 50KB max
  tokensUsed: integer('tokens_used'),
  modelUsed: text('model_used'),
  symbolsProcessed: text('symbols_processed'), // JSON array of strings
  durationMs: integer('duration_ms'),
  errorCount: integer('error_count').notNull().default(0),
  createdAt: text('created_at').notNull().default(sql`(datetime('now'))`),
});
```

- [ ] **Step 4: Add `unifiedAnalysisBatches` table**

```typescript
// --- Unified Analysis Batches (each LLM call during unified analysis) ---
export const unifiedAnalysisBatches = sqliteTable('unified_analysis_batches', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  pipelineRunId: integer('pipeline_run_id').notNull().references(() => pipelineRuns.id),
  batchIndex: integer('batch_index').notNull(),
  assetsInput: text('assets_input').notNull(),  // JSON array of symbol names
  modelUsed: text('model_used').notNull(),
  tokensInput: integer('tokens_input'),
  tokensOutput: integer('tokens_output'),
  durationMs: integer('duration_ms'),
  parsedOk: integer('parsed_ok', { mode: 'boolean' }).notNull().default(true),
  errorMsg: text('error_msg'),
  rawResponse: text('raw_response'), // Full LLM response (always saved)
  createdAt: text('created_at').notNull().default(sql`(datetime('now'))`),
});
```

- [ ] **Step 5: Run migration** — the app uses auto-migration on startup. Restart backend to apply:

```bash
cd /Users/federicocroce/Documents/Fede/trading
npm run dev:backend
# Check console for "Database migrated" or similar
# Verify in sqlite: sqlite3 data/trading.db ".tables" | grep -E "discovery_queries|thematic_queries|pipeline_stage|unified_analysis"
```

Expected output includes: `discovery_queries  thematic_queries  pipeline_stage_artifacts  unified_analysis_batches`

- [ ] **Step 6: Commit**

```bash
git add apps/backend/src/db/schema.ts
git commit -m "feat(db): add discoveryQueries, thematicQueries, pipelineStageArtifacts, unifiedAnalysisBatches tables"
```

---

### Task 2: Create config.repository.ts

**Files:**
- Create: `apps/backend/src/intelligence/config.repository.ts`

- [ ] **Step 1: Create the file**

```typescript
import { db } from '../db/database.js';
import { discoveryQueries, thematicQueries } from '../db/schema.js';
import { eq } from 'drizzle-orm';

// ─── Default seeds ────────────────────────────────────────────────────────────

const DEFAULT_DISCOVERY_QUERIES = [
  { query: 'best stock market opportunities today', lang: 'en' as const, category: 'general', priority: 1 },
  { query: 'AI semiconductors stocks news today', lang: 'en' as const, category: 'tech', priority: 2 },
  { query: 'oil energy stocks opportunities today', lang: 'en' as const, category: 'energy', priority: 3 },
  { query: 'acciones argentinas oportunidades hoy merval cedears', lang: 'es' as const, category: 'argentina', priority: 4 },
  { query: 'bitcoin criptomonedas oportunidades esta semana', lang: 'es' as const, category: 'crypto', priority: 5 },
  { query: 'noticias economicas argentina inversiones hoy', lang: 'es' as const, category: 'argentina', priority: 6 },
  { query: 'bolsa new york oportunidades acciones hoy', lang: 'es' as const, category: 'general', priority: 7 },
];

const DEFAULT_THEMATIC_QUERIES = [
  { name: 'Geopolítica y conflictos', keywords: JSON.stringify(['war', 'conflict', 'sanctions', 'military', 'NATO', 'Russia', 'Ukraine', 'Middle East']), priority: 1 },
  { name: 'Política monetaria', keywords: JSON.stringify(['Fed', 'interest rates', 'inflation', 'CPI', 'FOMC', 'Powell', 'ECB', 'rate hike', 'rate cut']), priority: 2 },
  { name: 'Tecnología e IA', keywords: JSON.stringify(['AI', 'semiconductor', 'earnings', 'NVIDIA', 'chips', 'data center', 'machine learning', 'Broadcom']), priority: 3 },
  { name: 'Energía y petróleo', keywords: JSON.stringify(['oil', 'OPEC', 'crude', 'gas', 'renewable', 'energy', 'Brent', 'WTI', 'petroleum']), priority: 4 },
  { name: 'Mercados emergentes y Argentina', keywords: JSON.stringify(['Argentina', 'IMF', 'emerging', 'Latin America', 'Brazil', 'CEDEAR', 'Merval', 'peso']), priority: 5 },
  { name: 'Comercio y aranceles', keywords: JSON.stringify(['tariffs', 'trade', 'China', 'supply chain', 'export', 'import', 'WTO', 'trade war']), priority: 6 },
  { name: 'Crypto y fintech', keywords: JSON.stringify(['Bitcoin', 'blockchain', 'DeFi', 'SEC', 'Ethereum', 'crypto', 'stablecoin', 'ETF crypto']), priority: 7 },
  { name: 'Salud y pharma', keywords: JSON.stringify(['FDA', 'biotech', 'drug', 'healthcare', 'clinical trial', 'approval', 'pharma', 'vaccine']), priority: 8 },
  { name: 'Commodities', keywords: JSON.stringify(['gold', 'copper', 'lithium', 'uranium', 'mining', 'metals', 'silver', 'platinum']), priority: 9 },
  { name: 'M&A y earnings', keywords: JSON.stringify(['merger', 'acquisition', 'earnings', 'IPO', 'buyout', 'revenue', 'guidance', 'beat', 'miss']), priority: 10 },
];

// ─── Seeding ──────────────────────────────────────────────────────────────────

export function seedConfigIfEmpty(): void {
  const existingDiscovery = db.select().from(discoveryQueries).all();
  if (existingDiscovery.length === 0) {
    for (const q of DEFAULT_DISCOVERY_QUERIES) {
      db.insert(discoveryQueries).values(q).run();
    }
    console.log('[config] Seeded discovery queries with defaults');
  }

  const existingThematic = db.select().from(thematicQueries).all();
  if (existingThematic.length === 0) {
    for (const q of DEFAULT_THEMATIC_QUERIES) {
      db.insert(thematicQueries).values(q).run();
    }
    console.log('[config] Seeded thematic queries with defaults');
  }
}

// ─── Discovery Queries ────────────────────────────────────────────────────────

export function getActiveDiscoveryQueries(): string[] {
  const rows = db.select()
    .from(discoveryQueries)
    .where(eq(discoveryQueries.active, true))
    .orderBy(discoveryQueries.priority)
    .all();
  return rows.map(r => r.query);
}

export function getAllDiscoveryQueries() {
  return db.select().from(discoveryQueries).orderBy(discoveryQueries.priority).all();
}

export function updateDiscoveryQuery(id: number, data: { query?: string; active?: boolean; priority?: number; category?: string }) {
  db.update(discoveryQueries).set(data).where(eq(discoveryQueries.id, id)).run();
}

export function addDiscoveryQuery(data: { query: string; lang: 'en' | 'es'; category?: string; priority?: number }) {
  return db.insert(discoveryQueries).values({
    query: data.query,
    lang: data.lang,
    category: data.category ?? 'general',
    priority: data.priority ?? 0,
  }).returning().get();
}

export function deleteDiscoveryQuery(id: number) {
  db.delete(discoveryQueries).where(eq(discoveryQueries.id, id)).run();
}

// ─── Thematic Queries ─────────────────────────────────────────────────────────

export type ThematicQuery = { id: number; name: string; keywords: string[]; active: boolean; priority: number };

export function getActiveThematicQueries(): Array<{ theme: string; query: string }> {
  const rows = db.select()
    .from(thematicQueries)
    .where(eq(thematicQueries.active, true))
    .orderBy(thematicQueries.priority)
    .all();
  return rows.map(r => ({
    theme: r.name,
    query: (JSON.parse(r.keywords) as string[]).join(' OR '),
  }));
}

export function getAllThematicQueries(): ThematicQuery[] {
  const rows = db.select().from(thematicQueries).orderBy(thematicQueries.priority).all();
  return rows.map(r => ({ ...r, keywords: JSON.parse(r.keywords) as string[] }));
}

export function updateThematicQuery(id: number, data: { name?: string; keywords?: string[]; active?: boolean; priority?: number }) {
  const update: Record<string, unknown> = {};
  if (data.name !== undefined) update.name = data.name;
  if (data.active !== undefined) update.active = data.active;
  if (data.priority !== undefined) update.priority = data.priority;
  if (data.keywords !== undefined) update.keywords = JSON.stringify(data.keywords);
  db.update(thematicQueries).set(update).where(eq(thematicQueries.id, id)).run();
}

export function addThematicQuery(data: { name: string; keywords: string[]; priority?: number }) {
  return db.insert(thematicQueries).values({
    name: data.name,
    keywords: JSON.stringify(data.keywords),
    priority: data.priority ?? 0,
  }).returning().get();
}

export function deleteThematicQuery(id: number) {
  db.delete(thematicQueries).where(eq(thematicQueries.id, id)).run();
}
```

- [ ] **Step 2: Verify DB import path** — check that `db` is exported from `../db/database.js`. If the path is different, adjust accordingly:

```bash
grep -r "export.*db" apps/backend/src/db/ | head -5
```

- [ ] **Step 3: Commit**

```bash
git add apps/backend/src/intelligence/config.repository.ts
git commit -m "feat(intelligence): config.repository — CRUD for discoveryQueries and thematicQueries with seed defaults"
```

---

### Task 3: Create pipeline-artifacts.repository.ts

**Files:**
- Create: `apps/backend/src/intelligence/pipeline-artifacts.repository.ts`

- [ ] **Step 1: Create the file**

```typescript
import { db } from '../db/database.js';
import { pipelineStageArtifacts, unifiedAnalysisBatches } from '../db/schema.js';
import { eq } from 'drizzle-orm';

const MAX_SNAPSHOT_BYTES = 50 * 1024; // 50KB

function truncateSnapshot(data: unknown): string {
  const str = JSON.stringify(data);
  if (str.length <= MAX_SNAPSHOT_BYTES) return str;
  // If too large, save a summary instead of full dump
  return JSON.stringify({ _truncated: true, _originalSize: str.length, preview: str.slice(0, 1000) });
}

export function saveStageArtifact(params: {
  pipelineRunId: number;
  stage: 'webSearch' | 'news' | 'fundamentals' | 'opportunities' | 'report' | 'digest';
  input?: unknown;
  output?: unknown;
  tokensUsed?: number;
  modelUsed?: string;
  symbolsProcessed?: string[];
  durationMs?: number;
  errorCount?: number;
}): void {
  db.insert(pipelineStageArtifacts).values({
    pipelineRunId: params.pipelineRunId,
    stage: params.stage,
    inputSnapshot: params.input !== undefined ? truncateSnapshot(params.input) : null,
    outputSnapshot: params.output !== undefined ? truncateSnapshot(params.output) : null,
    tokensUsed: params.tokensUsed ?? null,
    modelUsed: params.modelUsed ?? null,
    symbolsProcessed: params.symbolsProcessed ? JSON.stringify(params.symbolsProcessed) : null,
    durationMs: params.durationMs ?? null,
    errorCount: params.errorCount ?? 0,
  }).run();
}

export function saveUnifiedAnalysisBatch(params: {
  pipelineRunId: number;
  batchIndex: number;
  assetsInput: string[];
  modelUsed: string;
  tokensInput?: number;
  tokensOutput?: number;
  durationMs?: number;
  parsedOk: boolean;
  errorMsg?: string;
  rawResponse?: string;
}): void {
  db.insert(unifiedAnalysisBatches).values({
    pipelineRunId: params.pipelineRunId,
    batchIndex: params.batchIndex,
    assetsInput: JSON.stringify(params.assetsInput),
    modelUsed: params.modelUsed,
    tokensInput: params.tokensInput ?? null,
    tokensOutput: params.tokensOutput ?? null,
    durationMs: params.durationMs ?? null,
    parsedOk: params.parsedOk,
    errorMsg: params.errorMsg ?? null,
    rawResponse: params.rawResponse ?? null,
  }).run();
}

export function getStageArtifactsByRun(pipelineRunId: number) {
  return db.select()
    .from(pipelineStageArtifacts)
    .where(eq(pipelineStageArtifacts.pipelineRunId, pipelineRunId))
    .orderBy(pipelineStageArtifacts.createdAt)
    .all();
}

export function getUnifiedBatchesByRun(pipelineRunId: number) {
  return db.select()
    .from(unifiedAnalysisBatches)
    .where(eq(unifiedAnalysisBatches.pipelineRunId, pipelineRunId))
    .orderBy(unifiedAnalysisBatches.batchIndex)
    .all();
}
```

- [ ] **Step 2: Commit**

```bash
git add apps/backend/src/intelligence/pipeline-artifacts.repository.ts
git commit -m "feat(intelligence): pipeline-artifacts.repository — save/read stage artifacts and unified LLM batches"
```

---

### Task 4: Migrate DISCOVERY_QUERIES from code to DB

**Files:**
- Modify: `apps/backend/src/web-search/web-search.service.ts`

- [ ] **Step 1: Open `web-search.service.ts`** and find the `DISCOVERY_QUERIES` constant (lines ~19-29)

- [ ] **Step 2: Remove the hardcoded constant and import from config.repository**

Remove:
```typescript
const DISCOVERY_QUERIES = [
  'best stock market opportunities today',
  'AI semiconductors stocks news today',
  'oil energy stocks opportunities today',
  'acciones argentinas oportunidades hoy merval cedears',
  'bitcoin criptomonedas oportunidades esta semana',
  'noticias economicas argentina inversiones hoy',
  'bolsa new york oportunidades acciones hoy',
];
```

Add at top imports:
```typescript
import { getActiveDiscoveryQueries } from '../intelligence/config.repository.js';
```

- [ ] **Step 3: Find where `DISCOVERY_QUERIES` is used in the discovery search loop** (look for `for ... of DISCOVERY_QUERIES` or `DISCOVERY_QUERIES.map`) and replace the reference:

Replace: `DISCOVERY_QUERIES`
With: `getActiveDiscoveryQueries()`

The call should be inside the async function `runWebSearch`, so the DB call happens at runtime (not module-load time):
```typescript
const discoveryQueriesList = getActiveDiscoveryQueries();
// then use discoveryQueriesList in place of DISCOVERY_QUERIES
```

- [ ] **Step 4: Verify backend compiles and starts**

```bash
cd /Users/federicocroce/Documents/Fede/trading
npx tsc --noEmit -p apps/backend/tsconfig.json 2>&1 | head -20
```

Expected: no errors

- [ ] **Step 5: Verify seed runs on startup** — restart backend and check console for `[config] Seeded discovery queries with defaults`

- [ ] **Step 6: Commit**

```bash
git add apps/backend/src/web-search/web-search.service.ts
git commit -m "feat(web-search): read DISCOVERY_QUERIES from DB instead of hardcoded constant"
```

---

### Task 5: Migrate THEMATIC_QUERIES from code to DB

**Files:**
- Modify: `apps/backend/src/intelligence/market-report.service.ts`

- [ ] **Step 1: Open `market-report.service.ts`** and find the `THEMATIC_QUERIES` constant (lines ~46-57)

- [ ] **Step 2: Remove the hardcoded constant**

Remove the `THEMATIC_QUERIES` array from the file.

- [ ] **Step 3: Add import and replace usage**

Add import:
```typescript
import { getActiveThematicQueries } from './config.repository.js';
```

Find where `THEMATIC_QUERIES` is iterated (in `fetchThematicNewsFromAPI` or the thematic pipeline) and replace:

Replace: `THEMATIC_QUERIES`
With: `getActiveThematicQueries()`

Since `getActiveThematicQueries()` returns `Array<{ theme: string; query: string }>` — same shape as the original — no other changes needed.

- [ ] **Step 4: Call `seedConfigIfEmpty` from pipeline init** — open `pipeline.service.ts` and find `initPipeline()`:

```typescript
import { seedConfigIfEmpty } from './config.repository.js';

export function initPipeline(): void {
  markOrphanedRunsFailed();
  seedConfigIfEmpty(); // ADD THIS LINE
}
```

- [ ] **Step 5: Verify compilation**

```bash
npx tsc --noEmit -p apps/backend/tsconfig.json 2>&1 | head -20
```

- [ ] **Step 6: Commit**

```bash
git add apps/backend/src/intelligence/market-report.service.ts apps/backend/src/intelligence/pipeline.service.ts
git commit -m "feat(intelligence): read THEMATIC_QUERIES from DB, seed config on pipeline init"
```

---

### Task 6: Save stage artifacts in pipeline.service.ts

**Files:**
- Modify: `apps/backend/src/intelligence/pipeline.service.ts`

- [ ] **Step 1: Add import**

```typescript
import { saveStageArtifact } from './pipeline-artifacts.repository.js';
```

- [ ] **Step 2: After each stage completes, save its artifact**

Find each stage function (e.g., `runWebSearchStage`, `runNewsStage`, `runFundamentalsStage`, `runAnalysisStage`, `runReportStage`) and after updating the pipeline stage status, add a `saveStageArtifact` call.

Pattern for each stage (adapt input/output/symbols to what's available):

**webSearch stage** (after `runWebSearchStage` resolves):
```typescript
const webStart = Date.now();
const webResult = await runWebSearchStage(runId);
saveStageArtifact({
  pipelineRunId: runId,
  stage: 'webSearch',
  output: { articleCount: webResult.articles?.length ?? 0, errors: webResult.errors },
  symbolsProcessed: [...new Set(webResult.articles?.map(a => a.symbol).filter(Boolean) ?? [])],
  durationMs: Date.now() - webStart,
  errorCount: webResult.errors?.length ?? 0,
});
```

**news stage:**
```typescript
const newsStart = Date.now();
const newsResult = await runNewsStage(runId);
saveStageArtifact({
  pipelineRunId: runId,
  stage: 'news',
  output: { articlesAnalyzed: newsResult.articlesAnalyzed, triangulated: newsResult.triangulated },
  durationMs: Date.now() - newsStart,
  errorCount: newsResult.errors?.length ?? 0,
});
```

**fundamentals stage:**
```typescript
const fundStart = Date.now();
const fundResult = await runFundamentalsStage(runId);
saveStageArtifact({
  pipelineRunId: runId,
  stage: 'fundamentals',
  output: { refreshed: fundResult.refreshed, skipped: fundResult.skipped },
  symbolsProcessed: fundResult.symbols ?? [],
  durationMs: Date.now() - fundStart,
  errorCount: fundResult.errors?.length ?? 0,
});
```

**opportunities stage:**
```typescript
const analysisStart = Date.now();
const analysisResult = await runAnalysisStage(runId);
saveStageArtifact({
  pipelineRunId: runId,
  stage: 'opportunities',
  output: {
    totalScanned: analysisResult.totalScanned,
    buyCount: analysisResult.buyCount,
    sellCount: analysisResult.sellCount,
    watchCount: analysisResult.watchCount,
  },
  symbolsProcessed: analysisResult.opportunities?.map((o: { symbol: string }) => o.symbol) ?? [],
  durationMs: Date.now() - analysisStart,
  errorCount: analysisResult.errors?.length ?? 0,
});
```

**report stage:**
```typescript
const reportStart = Date.now();
const reportResult = await runReportStage(runId, analyses);
saveStageArtifact({
  pipelineRunId: runId,
  stage: 'report',
  output: { engine: reportResult.engine, themeCount: reportResult.themes?.length ?? 0 },
  durationMs: Date.now() - reportStart,
  errorCount: reportResult.errors?.length ?? 0,
});
```

> Note: Adapt the exact field names to match what each stage function actually returns. The key is to capture duration, error count, and a lightweight output summary. Do NOT pass the full opportunities array as output — that's already in `opportunitySnapshots`.

- [ ] **Step 3: Verify compilation**

```bash
npx tsc --noEmit -p apps/backend/tsconfig.json 2>&1 | head -20
```

- [ ] **Step 4: Run one pipeline and verify artifacts are saved**

```bash
sqlite3 data/trading.db "SELECT stage, duration_ms, error_count, created_at FROM pipeline_stage_artifacts ORDER BY created_at DESC LIMIT 10;"
```

Expected: rows for each stage of the last run

- [ ] **Step 5: Commit**

```bash
git add apps/backend/src/intelligence/pipeline.service.ts
git commit -m "feat(pipeline): save stage artifacts for full audit trail after each stage"
```

---

### Task 7: Save unified analysis batches

**Files:**
- Modify: `apps/backend/src/intelligence/unified-analysis.service.ts`

- [ ] **Step 1: Add import**

```typescript
import { saveUnifiedAnalysisBatch } from './pipeline-artifacts.repository.js';
```

- [ ] **Step 2: Update `runUnifiedAnalysis` (or equivalent main function) signature** to accept `pipelineRunId`:

Find the exported main function. Change signature from:
```typescript
export async function runUnifiedAnalysis(opportunities, positions, techData, fundData, sentData)
```
To:
```typescript
export async function runUnifiedAnalysis(opportunities, positions, techData, fundData, sentData, pipelineRunId?: number)
```

- [ ] **Step 3: Inside the batch loop**, after each LLM call, save the batch. Find the loop over batches (uses `BATCH_SIZE = 4`) and add after the LLM call:

```typescript
const batchStart = Date.now();
let rawResponse: string | undefined;
let parsedOk = true;
let errorMsg: string | undefined;

try {
  const response = await callAIWithModel('reasoning', systemPrompt, userPrompt, 6144);
  rawResponse = typeof response === 'string' ? response : JSON.stringify(response);
  // ... existing parse logic ...
} catch (err) {
  parsedOk = false;
  errorMsg = String(err);
}

if (pipelineRunId) {
  saveUnifiedAnalysisBatch({
    pipelineRunId,
    batchIndex: i, // current batch index
    assetsInput: batch.map((o: { symbol: string }) => o.symbol),
    modelUsed: 'reasoning', // or the actual model name if available
    durationMs: Date.now() - batchStart,
    parsedOk,
    errorMsg,
    rawResponse,
  });
}
```

- [ ] **Step 4: Thread `pipelineRunId` from pipeline.service.ts** — find where `runUnifiedAnalysis` is called in `opportunities.service.ts` or `pipeline.service.ts` and pass `runId`:

```typescript
const analyses = await runUnifiedAnalysis(opps, positions, techData, fundData, sentData, runId);
```

- [ ] **Step 5: Verify compilation and run**

```bash
npx tsc --noEmit -p apps/backend/tsconfig.json 2>&1 | head -20
sqlite3 data/trading.db "SELECT batch_index, assets_input, parsed_ok, duration_ms FROM unified_analysis_batches ORDER BY created_at DESC LIMIT 5;"
```

- [ ] **Step 6: Commit**

```bash
git add apps/backend/src/intelligence/unified-analysis.service.ts
git commit -m "feat(intelligence): save each LLM batch to unified_analysis_batches for audit trail"
```

---

### Task 8: tRPC config endpoints

**Files:**
- Modify: `apps/backend/src/intelligence/intelligence.router.ts`

- [ ] **Step 1: Add imports**

```typescript
import {
  getAllDiscoveryQueries,
  updateDiscoveryQuery,
  addDiscoveryQuery,
  deleteDiscoveryQuery,
  getAllThematicQueries,
  updateThematicQuery,
  addThematicQuery,
  deleteThematicQuery,
} from './config.repository.js';
import { getStageArtifactsByRun, getUnifiedBatchesByRun } from './pipeline-artifacts.repository.js';
```

- [ ] **Step 2: Add new procedures** to `intelligenceRouter`:

```typescript
// Config: Discovery queries
configGetDiscoveryQueries: publicProcedure.query(() => {
  return getAllDiscoveryQueries();
}),

configUpdateDiscoveryQuery: publicProcedure
  .input(z.object({
    id: z.number(),
    query: z.string().optional(),
    active: z.boolean().optional(),
    priority: z.number().optional(),
    category: z.string().optional(),
  }))
  .mutation(({ input }) => {
    updateDiscoveryQuery(input.id, input);
    return { ok: true };
  }),

configAddDiscoveryQuery: publicProcedure
  .input(z.object({
    query: z.string().min(5),
    lang: z.enum(['en', 'es']),
    category: z.string().optional(),
    priority: z.number().optional(),
  }))
  .mutation(({ input }) => {
    return addDiscoveryQuery(input);
  }),

configDeleteDiscoveryQuery: publicProcedure
  .input(z.object({ id: z.number() }))
  .mutation(({ input }) => {
    deleteDiscoveryQuery(input.id);
    return { ok: true };
  }),

// Config: Thematic queries
configGetThematicQueries: publicProcedure.query(() => {
  return getAllThematicQueries();
}),

configUpdateThematicQuery: publicProcedure
  .input(z.object({
    id: z.number(),
    name: z.string().optional(),
    keywords: z.array(z.string()).optional(),
    active: z.boolean().optional(),
    priority: z.number().optional(),
  }))
  .mutation(({ input }) => {
    updateThematicQuery(input.id, input);
    return { ok: true };
  }),

configAddThematicQuery: publicProcedure
  .input(z.object({
    name: z.string().min(2),
    keywords: z.array(z.string()).min(1),
    priority: z.number().optional(),
  }))
  .mutation(({ input }) => {
    return addThematicQuery(input);
  }),

configDeleteThematicQuery: publicProcedure
  .input(z.object({ id: z.number() }))
  .mutation(({ input }) => {
    deleteThematicQuery(input.id);
    return { ok: true };
  }),

// Audit trail
pipelineArtifacts: publicProcedure
  .input(z.object({ pipelineRunId: z.number() }))
  .query(({ input }) => {
    return getStageArtifactsByRun(input.pipelineRunId);
  }),

pipelineUnifiedBatches: publicProcedure
  .input(z.object({ pipelineRunId: z.number() }))
  .query(({ input }) => {
    return getUnifiedBatchesByRun(input.pipelineRunId);
  }),
```

- [ ] **Step 3: Verify compilation**

```bash
npx tsc --noEmit -p apps/backend/tsconfig.json 2>&1 | head -20
```

- [ ] **Step 4: Test endpoints via tRPC** — start backend and verify in console that the router registers without errors

- [ ] **Step 5: Commit**

```bash
git add apps/backend/src/intelligence/intelligence.router.ts
git commit -m "feat(intelligence): tRPC endpoints for discovery/thematic query config and audit trail"
```

---

### Task 9: Frontend — Settings UI for queries

**Files:**
- Create: `apps/frontend/src/intelligence/PipelineConfig.tsx`
- Modify: existing settings page or add tab in main App

- [ ] **Step 1: Create `PipelineConfig.tsx`**

```tsx
import { useState } from 'react';
import { trpc } from '../trpc.js';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Switch } from '@/components/ui/switch';
import { Input } from '@/components/ui/input';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';

export function PipelineConfig() {
  const utils = trpc.useUtils();
  const { data: discoveryQueries } = trpc.intelligence.configGetDiscoveryQueries.useQuery();
  const { data: thematicQueries } = trpc.intelligence.configGetThematicQueries.useQuery();

  const updateDiscovery = trpc.intelligence.configUpdateDiscoveryQuery.useMutation({
    onSuccess: () => utils.intelligence.configGetDiscoveryQueries.invalidate(),
  });
  const deleteDiscovery = trpc.intelligence.configDeleteDiscoveryQuery.useMutation({
    onSuccess: () => utils.intelligence.configGetDiscoveryQueries.invalidate(),
  });
  const addDiscovery = trpc.intelligence.configAddDiscoveryQuery.useMutation({
    onSuccess: () => utils.intelligence.configGetDiscoveryQueries.invalidate(),
  });

  const updateThematic = trpc.intelligence.configUpdateThematicQuery.useMutation({
    onSuccess: () => utils.intelligence.configGetThematicQueries.invalidate(),
  });
  const deleteThematic = trpc.intelligence.configDeleteThematicQuery.useMutation({
    onSuccess: () => utils.intelligence.configGetThematicQueries.invalidate(),
  });

  const [newDiscoveryQuery, setNewDiscoveryQuery] = useState('');
  const [newDiscoveryLang, setNewDiscoveryLang] = useState<'en' | 'es'>('en');
  const [newThemeName, setNewThemeName] = useState('');
  const [newThemeKeywords, setNewThemeKeywords] = useState('');

  return (
    <div className="space-y-6 p-4">
      <Card>
        <CardHeader>
          <CardTitle>Discovery Queries</CardTitle>
          <p className="text-sm text-muted-foreground">Queries usadas en la búsqueda web de Stage 1</p>
        </CardHeader>
        <CardContent className="space-y-2">
          {discoveryQueries?.map(q => (
            <div key={q.id} className="flex items-center gap-3 py-1 border-b border-border/40">
              <Switch
                checked={q.active}
                onCheckedChange={active => updateDiscovery.mutate({ id: q.id, active })}
              />
              <span className={`flex-1 text-sm ${!q.active ? 'opacity-40 line-through' : ''}`}>{q.query}</span>
              <Badge variant="outline" className="text-xs">{q.lang}</Badge>
              <Button
                variant="ghost"
                size="sm"
                onClick={() => deleteDiscovery.mutate({ id: q.id })}
                className="text-destructive hover:text-destructive"
              >
                ✕
              </Button>
            </div>
          ))}
          <div className="flex gap-2 mt-3">
            <Input
              placeholder="Nueva query de búsqueda..."
              value={newDiscoveryQuery}
              onChange={e => setNewDiscoveryQuery(e.target.value)}
              className="flex-1"
            />
            <select
              value={newDiscoveryLang}
              onChange={e => setNewDiscoveryLang(e.target.value as 'en' | 'es')}
              className="border rounded px-2 text-sm bg-background"
            >
              <option value="en">EN</option>
              <option value="es">ES</option>
            </select>
            <Button
              size="sm"
              onClick={() => {
                if (newDiscoveryQuery.trim()) {
                  addDiscovery.mutate({ query: newDiscoveryQuery.trim(), lang: newDiscoveryLang });
                  setNewDiscoveryQuery('');
                }
              }}
            >
              + Agregar
            </Button>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Temas del Market Report</CardTitle>
          <p className="text-sm text-muted-foreground">Temas usados en el análisis temático de Stage 5</p>
        </CardHeader>
        <CardContent className="space-y-2">
          {thematicQueries?.map(q => (
            <div key={q.id} className="flex items-center gap-3 py-1 border-b border-border/40">
              <Switch
                checked={q.active}
                onCheckedChange={active => updateThematic.mutate({ id: q.id, active })}
              />
              <div className="flex-1">
                <div className={`text-sm font-medium ${!q.active ? 'opacity-40 line-through' : ''}`}>{q.name}</div>
                <div className="text-xs text-muted-foreground">{q.keywords.slice(0, 4).join(', ')}{q.keywords.length > 4 ? '...' : ''}</div>
              </div>
              <Button
                variant="ghost"
                size="sm"
                onClick={() => deleteThematic.mutate({ id: q.id })}
                className="text-destructive hover:text-destructive"
              >
                ✕
              </Button>
            </div>
          ))}
          <div className="flex gap-2 mt-3">
            <Input
              placeholder="Nombre del tema..."
              value={newThemeName}
              onChange={e => setNewThemeName(e.target.value)}
              className="w-40"
            />
            <Input
              placeholder="Keywords separadas por coma..."
              value={newThemeKeywords}
              onChange={e => setNewThemeKeywords(e.target.value)}
              className="flex-1"
            />
            <Button
              size="sm"
              onClick={() => {
                if (newThemeName.trim() && newThemeKeywords.trim()) {
                  addThematic.mutate({
                    name: newThemeName.trim(),
                    keywords: newThemeKeywords.split(',').map(k => k.trim()).filter(Boolean),
                  });
                  setNewThemeName('');
                  setNewThemeKeywords('');
                }
              }}
            >
              + Agregar
            </Button>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
```

- [ ] **Step 2: Fix missing mutation variable** — in the component above, `addThematic` is referenced but should be `addThematicQuery` — rename the variable:

```typescript
const addThematic = trpc.intelligence.configAddThematicQuery.useMutation({
  onSuccess: () => utils.intelligence.configGetThematicQueries.invalidate(),
});
```

- [ ] **Step 3: Mount `PipelineConfig` in app** — find the main settings or config section in `App.tsx` or wherever pipeline settings live, and add a tab or section for `PipelineConfig`:

```tsx
import { PipelineConfig } from './intelligence/PipelineConfig.js';

// In the tab/settings area, add:
<PipelineConfig />
```

- [ ] **Step 4: Start frontend dev server and verify**

```bash
npm run dev:frontend
# Open http://localhost:5173
# Navigate to settings/pipeline config
# Verify queries list renders
# Toggle one on/off, verify persists after refresh
```

- [ ] **Step 5: Commit**

```bash
git add apps/frontend/src/intelligence/PipelineConfig.tsx apps/frontend/src/App.tsx
git commit -m "feat(frontend): PipelineConfig UI — editable discovery and thematic queries"
```
