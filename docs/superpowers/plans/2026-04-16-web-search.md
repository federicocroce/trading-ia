# Web Search Pipeline Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add web search (Tavily + Brave fallback) as the first stage of the daily pipeline, fetching fresh news for portfolio symbols and discovering new opportunities.

**Architecture:** New `web-search` stage runs before `news`, stores results in `web_search_articles` DB table, which the news aggregator reads and merges before deduplication. If all portfolio searches fail, pipeline pauses in `waiting_user` state and the frontend shows a blocking modal with retry/skip/cancel options.

**Tech Stack:** Tavily Search API, Brave Search API, Drizzle ORM (SQLite), tRPC, React + shadcn/ui

---

## File Map

**New files:**
- `apps/backend/src/web-search/tavily.ts` — Tavily API client
- `apps/backend/src/web-search/brave.ts` — Brave Search API client (fallback)
- `apps/backend/src/web-search/web-search.service.ts` — portfolio + discovery search orchestration
- `apps/backend/drizzle/0016_web_search.sql` — DB migration
- `apps/frontend/src/pipeline/WebSearchBlockedModal.tsx` — blocking modal for `waiting_user` state

**Modified files:**
- `packages/shared/src/types/intelligence.ts` — add `webSearch` stage to `PipelineRun`, new status values
- `apps/backend/src/db/schema.ts` — new `webSearchArticles` table + webSearch columns in `pipelineRuns`
- `apps/backend/drizzle/meta/_journal.json` — register new migration
- `apps/backend/src/db/repository.ts` — add `insertWebSearchArticles`, `getWebSearchArticlesByDate`
- `apps/backend/src/intelligence/pipeline.repository.ts` — support webSearch stage in all functions
- `apps/backend/src/intelligence/pipeline.service.ts` — `runWebSearchStage()`, `resolveWebSearch()`, integrate as stage 0
- `apps/backend/src/intelligence/intelligence.router.ts` — add `resolveWebSearch` mutation, extend `rerunStage`
- `apps/backend/src/news/news-aggregator.service.ts` — inject web search articles before dedup
- `apps/frontend/src/pipeline/usePipeline.ts` — poll on `waiting_user`, add `resolveWebSearch` mutation
- `apps/frontend/src/pipeline/PipelineStatusButton.tsx` — handle `waiting_user` / `cancelled`
- `apps/frontend/src/pipeline/PipelineStatusToast.tsx` — add webSearch as first stage
- `apps/frontend/src/pipeline/PipelineHistoryModal.tsx` — add webSearch stage + new status badges
- `apps/frontend/src/App.tsx` — mount `WebSearchBlockedModal`
- `.env.example` — add `TAVILY_API_KEY`, `BRAVE_API_KEY`

---

## Task 1: Update shared types

**Files:**
- Modify: `packages/shared/src/types/intelligence.ts`

- [ ] **Step 1: Add `WebSearchResult` interface and update `PipelineRun` types**

In `packages/shared/src/types/intelligence.ts`, replace the pipeline types section (lines 157–180) with:

```ts
export type StageStatus = 'pending' | 'running' | 'ok' | 'partial' | 'failed' | 'skipped' | 'waiting_user'

export interface StageResult {
  status: StageStatus
  startedAt: string | null
  finishedAt: string | null
  detail: string
  errors: string[]
  criticalError?: string
}

export interface PipelineRun {
  id: number
  date: string
  status: 'running' | 'ok' | 'partial' | 'failed' | 'waiting_user' | 'cancelled'
  stages: {
    webSearch: StageResult
    news: StageResult
    fundamentals: StageResult
    analysis: StageResult
    report: StageResult
  }
  startedAt: string
  finishedAt: string | null
}

export interface WebSearchResult {
  title: string
  url: string
  content: string
  publishedDate: string | null
}
```

- [ ] **Step 2: Export `WebSearchResult` from the shared index**

In `packages/shared/src/types/index.ts`, verify `intelligence.ts` is re-exported. It should already be — no change needed if it exports `export * from './intelligence.js'`.

- [ ] **Step 3: Build shared package to catch type errors**

```bash
cd packages/shared && npm run build 2>&1 | tail -20
```
Expected: no errors.

- [ ] **Step 4: Commit**

```bash
git add packages/shared/src/types/intelligence.ts
git commit -m "feat(types): add webSearch stage and waiting_user/cancelled status to PipelineRun"
```

---

## Task 2: DB schema + migration

**Files:**
- Modify: `apps/backend/src/db/schema.ts`
- Create: `apps/backend/drizzle/0016_web_search.sql`
- Modify: `apps/backend/drizzle/meta/_journal.json`

- [ ] **Step 1: Add `webSearchArticles` table and new columns to `pipelineRuns` in schema**

At the end of `apps/backend/src/db/schema.ts`, add:

```ts
// --- Web Search Articles (daily cache, one row per search result) ---
export const webSearchArticles = sqliteTable('web_search_articles', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  date: text('date').notNull(), // 'YYYY-MM-DD' — matches pipeline_runs.date
  symbol: text('symbol'), // populated for portfolio searches, null for discovery
  query: text('query').notNull(),
  layer: text('layer', { enum: ['portfolio', 'discovery'] }).notNull(),
  title: text('title').notNull(),
  url: text('url').notNull(),
  content: text('content').notNull(),
  publishedAt: text('published_at'),
  relatedSymbols: text('related_symbols').notNull().default('[]'), // JSON array
  createdAt: text('created_at').notNull().default(sql`(datetime('now'))`),
});
```

Also in `pipelineRuns`, add these columns after `reportFinishedAt`:

```ts
  // Stage: web-search (runs before news)
  webSearchStatus: text('web_search_status', { enum: ['pending', 'running', 'ok', 'partial', 'failed', 'skipped', 'waiting_user'] }).notNull().default('pending'),
  webSearchDetail: text('web_search_detail'),
  webSearchErrors: text('web_search_errors'), // JSON array
  webSearchStartedAt: text('web_search_started_at'),
  webSearchFinishedAt: text('web_search_finished_at'),
```

- [ ] **Step 2: Create migration SQL file**

Create `apps/backend/drizzle/0016_web_search.sql`:

```sql
CREATE TABLE IF NOT EXISTS `web_search_articles` (
  `id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
  `date` text NOT NULL,
  `symbol` text,
  `query` text NOT NULL,
  `layer` text NOT NULL,
  `title` text NOT NULL,
  `url` text NOT NULL,
  `content` text NOT NULL,
  `published_at` text,
  `related_symbols` text NOT NULL DEFAULT '[]',
  `created_at` text NOT NULL DEFAULT (datetime('now'))
);

ALTER TABLE `pipeline_runs` ADD COLUMN `web_search_status` text NOT NULL DEFAULT 'pending';
ALTER TABLE `pipeline_runs` ADD COLUMN `web_search_detail` text;
ALTER TABLE `pipeline_runs` ADD COLUMN `web_search_errors` text;
ALTER TABLE `pipeline_runs` ADD COLUMN `web_search_started_at` text;
ALTER TABLE `pipeline_runs` ADD COLUMN `web_search_finished_at` text;
```

- [ ] **Step 3: Register migration in journal**

In `apps/backend/drizzle/meta/_journal.json`, add to the `entries` array:

```json
{
  "idx": 16,
  "version": "6",
  "when": 1776297600000,
  "tag": "0016_web_search",
  "breakpoints": true
}
```

- [ ] **Step 4: Verify migration runs**

```bash
cd apps/backend && npm run dev 2>&1 | grep -E "\[db\]|migration|error" | head -20
```
Expected: `[db] Database ready.` with no migration errors. Stop the server with Ctrl+C.

- [ ] **Step 5: Commit**

```bash
git add apps/backend/src/db/schema.ts apps/backend/drizzle/0016_web_search.sql apps/backend/drizzle/meta/_journal.json
git commit -m "feat(db): add web_search_articles table and webSearch columns to pipeline_runs"
```

---

## Task 3: Tavily API client

**Files:**
- Create: `apps/backend/src/web-search/tavily.ts`

- [ ] **Step 1: Create Tavily client**

Create `apps/backend/src/web-search/tavily.ts`:

```ts
import type { WebSearchResult } from '@trading/shared';

const TAVILY_URL = 'https://api.tavily.com/search';

export function isTavilyAvailable(): boolean {
  return !!process.env.TAVILY_API_KEY;
}

export async function searchTavily(query: string, maxResults = 5): Promise<WebSearchResult[]> {
  const apiKey = process.env.TAVILY_API_KEY;
  if (!apiKey) throw new Error('TAVILY_API_KEY not set');

  const res = await fetch(TAVILY_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      api_key: apiKey,
      query,
      search_depth: 'advanced',
      include_answer: false,
      include_raw_content: false,
      max_results: maxResults,
    }),
  });

  if (!res.ok) {
    const text = await res.text().catch(() => '');
    throw new Error(`Tavily ${res.status}: ${text.slice(0, 100)}`);
  }

  const data = await res.json() as {
    results: Array<{ title: string; url: string; content: string; published_date?: string }>;
  };

  return (data.results ?? []).map(r => ({
    title: r.title,
    url: r.url,
    content: r.content,
    publishedDate: r.published_date ?? null,
  }));
}
```

- [ ] **Step 2: Commit**

```bash
git add apps/backend/src/web-search/tavily.ts
git commit -m "feat(web-search): add Tavily API client"
```

---

## Task 4: Brave Search client (fallback)

**Files:**
- Create: `apps/backend/src/web-search/brave.ts`

- [ ] **Step 1: Create Brave client**

Create `apps/backend/src/web-search/brave.ts`:

```ts
import type { WebSearchResult } from '@trading/shared';

const BRAVE_URL = 'https://api.search.brave.com/res/v1/news/search';

export function isBraveAvailable(): boolean {
  return !!process.env.BRAVE_API_KEY;
}

export async function searchBrave(query: string, count = 5): Promise<WebSearchResult[]> {
  const apiKey = process.env.BRAVE_API_KEY;
  if (!apiKey) throw new Error('BRAVE_API_KEY not set');

  const url = `${BRAVE_URL}?q=${encodeURIComponent(query)}&count=${count}`;
  const res = await fetch(url, {
    headers: {
      'Accept': 'application/json',
      'Accept-Encoding': 'gzip',
      'X-Subscription-Token': apiKey,
    },
  });

  if (!res.ok) {
    const text = await res.text().catch(() => '');
    throw new Error(`Brave ${res.status}: ${text.slice(0, 100)}`);
  }

  const data = await res.json() as {
    results: Array<{ title: string; url: string; description: string; age?: string }>;
  };

  return (data.results ?? []).map(r => ({
    title: r.title,
    url: r.url,
    content: r.description,
    publishedDate: null,
  }));
}
```

- [ ] **Step 2: Commit**

```bash
git add apps/backend/src/web-search/brave.ts
git commit -m "feat(web-search): add Brave Search client as fallback"
```

---

## Task 5: WebSearchService

**Files:**
- Create: `apps/backend/src/web-search/web-search.service.ts`

- [ ] **Step 1: Create WebSearchService**

Create `apps/backend/src/web-search/web-search.service.ts`:

```ts
import type { WebSearchResult } from '@trading/shared';
import { searchTavily, isTavilyAvailable } from './tavily.js';
import { searchBrave, isBraveAvailable } from './brave.js';
import { getPortfolioPositions } from '../db/repository.js';
import { insertWebSearchArticles } from '../db/repository.js';
import { validateTickers } from '../discovery/ticker-validator.js';
import { registerNovelTickers } from '../discovery/discovery-registry.js';

const DISCOVERY_QUERIES = [
  'best stock market opportunities today',
  'Argentina stocks breaking news today',
  'crypto bitcoin opportunities this week',
  'AI semiconductors stocks news today',
  'oil energy stocks opportunities today',
];

// Ticker extraction: uppercase words 1-5 chars that look like tickers
const TICKER_REGEX = /\b([A-Z]{1,5})\b/g;

/**
 * Try Tavily first, fall back to Brave.
 * Throws if both fail.
 */
async function search(query: string): Promise<WebSearchResult[]> {
  if (isTavilyAvailable()) {
    try {
      return await searchTavily(query);
    } catch (err) {
      console.warn(`[web-search] Tavily failed for "${query}": ${(err as Error).message}`);
    }
  }

  if (isBraveAvailable()) {
    return await searchBrave(query);
  }

  throw new Error('No web search provider available (TAVILY_API_KEY and BRAVE_API_KEY both missing/failed)');
}

function extractTickers(texts: string[]): string[] {
  const candidates = new Set<string>();
  for (const text of texts) {
    const matches = text.matchAll(TICKER_REGEX);
    for (const [, ticker] of matches) {
      // Filter obvious non-tickers
      if (!['THE', 'AND', 'FOR', 'WITH', 'THIS', 'FROM', 'THAT', 'HAVE', 'ARE', 'WAS', 'NOT', 'BUT', 'ALL', 'NEW', 'CAN', 'HAS', 'MORE', 'ITS', 'CEO', 'IPO', 'ETF', 'USD', 'GDP', 'FED', 'SEC'].includes(ticker)) {
        candidates.add(ticker);
      }
    }
  }
  return [...candidates];
}

/**
 * Run one search per portfolio symbol in parallel.
 * Returns count of articles saved and per-symbol errors.
 */
export async function runPortfolioSearches(date: string): Promise<{ count: number; errors: string[] }> {
  const positions = getPortfolioPositions();
  if (positions.length === 0) return { count: 0, errors: [] };

  const results = await Promise.allSettled(
    positions.map(async (pos) => {
      const query = `${pos.symbol} stock news analysis today`;
      const items = await search(query);
      const articles = items.map(item => ({
        date,
        symbol: pos.symbol,
        query,
        layer: 'portfolio' as const,
        title: item.title,
        url: item.url,
        content: item.content,
        publishedAt: item.publishedDate,
        relatedSymbols: JSON.stringify([pos.symbol]),
      }));
      insertWebSearchArticles(articles);
      return articles.length;
    }),
  );

  let count = 0;
  const errors: string[] = [];
  for (let i = 0; i < results.length; i++) {
    const r = results[i];
    if (r.status === 'fulfilled') {
      count += r.value;
    } else {
      errors.push(`${positions[i].symbol}: ${r.reason?.message ?? 'unknown error'}`);
    }
  }

  return { count, errors };
}

/**
 * Run discovery queries sequentially to respect rate limits.
 * Extracts novel tickers and registers them.
 */
export async function runDiscoverySearches(date: string): Promise<{ count: number }> {
  let count = 0;

  for (const query of DISCOVERY_QUERIES) {
    try {
      const items = await search(query);
      const articles = items.map(item => ({
        date,
        symbol: null as string | null,
        query,
        layer: 'discovery' as const,
        title: item.title,
        url: item.url,
        content: item.content,
        publishedAt: item.publishedDate,
        relatedSymbols: '[]',
      }));
      insertWebSearchArticles(articles);
      count += articles.length;

      // Extract and register novel tickers
      const texts = items.map(i => `${i.title} ${i.content}`);
      const candidates = extractTickers(texts);
      if (candidates.length > 0) {
        const valid = await validateTickers(candidates);
        if (valid.length > 0) {
          await registerNovelTickers(valid, 'llm');
        }
      }
    } catch (err) {
      console.warn(`[web-search] Discovery query failed: "${query}": ${(err as Error).message}`);
      // Discovery failures are non-blocking — continue
    }
  }

  return { count };
}

/**
 * Run both layers. Throws if ALL portfolio searches fail (triggers waiting_user).
 */
export async function runWebSearch(date: string): Promise<{
  portfolioCount: number;
  discoveryCount: number;
  errors: string[];
}> {
  const positions = getPortfolioPositions();
  const portfolio = await runPortfolioSearches(date);

  // All portfolio searches failed = critical failure
  if (positions.length > 0 && portfolio.errors.length === positions.length) {
    throw new Error(`All portfolio searches failed: ${portfolio.errors.join('; ')}`);
  }

  const discovery = await runDiscoverySearches(date);

  return {
    portfolioCount: portfolio.count,
    discoveryCount: discovery.count,
    errors: portfolio.errors,
  };
}
```

- [ ] **Step 2: Commit**

```bash
git add apps/backend/src/web-search/
git commit -m "feat(web-search): add WebSearchService with portfolio + discovery layers"
```

---

## Task 6: DB repository functions

**Files:**
- Modify: `apps/backend/src/db/repository.ts`

- [ ] **Step 1: Add import for new schema table**

At the top of `apps/backend/src/db/repository.ts`, the import is `import { db, schema } from './index.js';`. The new table `webSearchArticles` will be accessible via `schema.webSearchArticles` once the schema is updated (Task 2 already did this). No import change needed.

- [ ] **Step 2: Add `insertWebSearchArticles` and `getWebSearchArticlesByDate` functions**

Add at the end of `apps/backend/src/db/repository.ts`:

```ts
// ==================== WEB SEARCH ARTICLES ====================

export function insertWebSearchArticles(articles: Array<{
  date: string;
  symbol: string | null;
  query: string;
  layer: 'portfolio' | 'discovery';
  title: string;
  url: string;
  content: string;
  publishedAt: string | null;
  relatedSymbols: string;
}>) {
  if (articles.length === 0) return;
  db.insert(schema.webSearchArticles).values(articles).run();
}

export function getWebSearchArticlesByDate(date: string) {
  return db.select().from(schema.webSearchArticles)
    .where(eq(schema.webSearchArticles.date, date))
    .all();
}
```

- [ ] **Step 3: Verify TypeScript compiles**

```bash
cd apps/backend && npx tsc --noEmit 2>&1 | head -30
```
Expected: no errors related to these functions.

- [ ] **Step 4: Commit**

```bash
git add apps/backend/src/db/repository.ts
git commit -m "feat(db): add insertWebSearchArticles and getWebSearchArticlesByDate"
```

---

## Task 7: Pipeline repository — webSearch stage support

**Files:**
- Modify: `apps/backend/src/intelligence/pipeline.repository.ts`

- [ ] **Step 1: Extend `rowToPipelineRun` to include webSearch stage**

In `pipeline.repository.ts`, the `rowToPipelineRun` function currently maps 4 stages. Replace it with:

```ts
function rowToPipelineRun(row: typeof schema.pipelineRuns.$inferSelect): PipelineRun {
  return {
    id: row.id,
    date: row.date,
    status: row.status as PipelineRun['status'],
    startedAt: row.startedAt,
    finishedAt: row.finishedAt ?? null,
    stages: {
      webSearch: stageResultFromRow(row.webSearchStatus, row.webSearchDetail, row.webSearchErrors, row.webSearchStartedAt, row.webSearchFinishedAt),
      news: stageResultFromRow(row.newsStatus, row.newsDetail, row.newsErrors, row.newsStartedAt, row.newsFinishedAt),
      fundamentals: stageResultFromRow(row.fundamentalsStatus, row.fundamentalsDetail, row.fundamentalsErrors, row.fundamentalsStartedAt, row.fundamentalsFinishedAt),
      analysis: stageResultFromRow(row.analysisStatus, row.analysisDetail, row.analysisErrors, row.analysisStartedAt, row.analysisFinishedAt),
      report: stageResultFromRow(row.reportStatus, row.reportDetail, row.reportErrors, row.reportStartedAt, row.reportFinishedAt),
    },
  };
}
```

- [ ] **Step 2: Extend `createPipelineRun` to initialize webSearch as pending**

In `createPipelineRun`, add `webSearchStatus: 'pending'` to the `.values({...})` call:

```ts
export function createPipelineRun(date: string): PipelineRun {
  const now = new Date().toISOString();
  const result = db.insert(schema.pipelineRuns).values({
    date,
    status: 'running',
    webSearchStatus: 'pending',
    newsStatus: 'pending',
    fundamentalsStatus: 'pending',
    analysisStatus: 'pending',
    reportStatus: 'pending',
    startedAt: now,
  }).returning().get();
  return rowToPipelineRun(result);
}
```

- [ ] **Step 3: Extend `updatePipelineStage` type to accept 'webSearch'**

Change the `stage` parameter type:

```ts
export function updatePipelineStage(
  runId: number,
  stage: 'webSearch' | 'news' | 'fundamentals' | 'analysis' | 'report',
  result: Partial<StageResult & { startedAt: string | null; finishedAt: string | null }>,
) {
```

The existing dynamic key building (`${stage}Status`, etc.) already works for `'webSearch'` → `webSearchStatus`.

- [ ] **Step 4: Add `pausePipelineWaitingUser` and `cancelPipelineRun` functions**

Add after `finishPipelineRun`:

```ts
export function pausePipelineWaitingUser(runId: number) {
  db.update(schema.pipelineRuns).set({
    status: 'waiting_user',
  }).where(eq(schema.pipelineRuns.id, runId)).run();
}

export function cancelPipelineRun(runId: number) {
  db.update(schema.pipelineRuns).set({
    status: 'cancelled',
    finishedAt: new Date().toISOString(),
  }).where(eq(schema.pipelineRuns.id, runId)).run();
}
```

- [ ] **Step 5: Extend `markOrphanedRunsFailed` to also handle `waiting_user`**

Update the where clause to catch both orphaned statuses:

```ts
export function markOrphanedRunsFailed() {
  const orphans = db.select().from(schema.pipelineRuns)
    .where(
      sql`${schema.pipelineRuns.status} IN ('running', 'waiting_user')`
    )
    .all();
  for (const o of orphans) {
    db.update(schema.pipelineRuns).set({
      status: 'failed',
      finishedAt: new Date().toISOString(),
    }).where(eq(schema.pipelineRuns.id, o.id)).run();
  }
}
```

- [ ] **Step 6: Verify TypeScript compiles**

```bash
cd apps/backend && npx tsc --noEmit 2>&1 | head -20
```
Expected: no errors.

- [ ] **Step 7: Commit**

```bash
git add apps/backend/src/intelligence/pipeline.repository.ts
git commit -m "feat(pipeline): extend repository with webSearch stage, waiting_user, cancelled"
```

---

## Task 8: Pipeline service — integrate web-search as stage 0

**Files:**
- Modify: `apps/backend/src/intelligence/pipeline.service.ts`

- [ ] **Step 1: Add imports**

At the top of `pipeline.service.ts`, add:

```ts
import { runWebSearch } from '../web-search/web-search.service.js';
import { pausePipelineWaitingUser, cancelPipelineRun } from './pipeline.repository.js';
```

Also add to the existing import from `./pipeline.repository.js`:
```ts
import { ..., pausePipelineWaitingUser, cancelPipelineRun } from './pipeline.repository.js';
```

- [ ] **Step 2: Add `runWebSearchStage` function**

Add after the imports, before `isNewsStageValid`:

```ts
async function runWebSearchStage(runId: number, date: string): Promise<StageResult> {
  const startedAt = new Date().toISOString();
  updatePipelineStage(runId, 'webSearch', { status: 'running', startedAt });
  try {
    const result = await runWebSearch(date);
    const sr: StageResult = {
      status: result.errors.length > 0 ? 'partial' : 'ok',
      startedAt,
      finishedAt: new Date().toISOString(),
      detail: `${result.portfolioCount} artículos portfolio, ${result.discoveryCount} discovery.`,
      errors: result.errors,
    };
    updatePipelineStage(runId, 'webSearch', sr);
    return sr;
  } catch (err) {
    const sr: StageResult = {
      status: 'failed',
      startedAt,
      finishedAt: new Date().toISOString(),
      detail: 'Web search falló completamente.',
      errors: [],
      criticalError: (err as Error).message.slice(0, 200),
    };
    updatePipelineStage(runId, 'webSearch', sr);
    return sr;
  }
}
```

- [ ] **Step 3: Integrate web-search as stage 0 in `checkOrRunPipeline`**

In `checkOrRunPipeline`, before the existing Stage 1 (News) block, add:

```ts
  // Stage 0: Web Search (blocking — pauses pipeline if all searches fail)
  const webSearchResult = await runWebSearchStage(runId, today);
  if (webSearchResult.status === 'failed') {
    // Pause pipeline — frontend will show modal to user
    pausePipelineWaitingUser(runId);
    return getPipelineRunByDate(today)!;
  }
```

- [ ] **Step 4: Add `resolveWebSearch` export function**

Add after `checkOrRunPipeline`:

```ts
/**
 * Called by the frontend modal when user decides how to handle a web-search failure.
 * 'retry'  — re-runs web search, continues pipeline if OK
 * 'skip'   — marks web-search as skipped, continues pipeline from news
 * 'cancel' — marks pipeline as cancelled
 */
export async function resolveWebSearch(
  action: 'retry' | 'skip' | 'cancel',
): Promise<PipelineRun> {
  const today = getToday();
  const existingRun = getPipelineRunByDate(today);
  if (!existingRun || existingRun.status !== 'waiting_user') {
    throw new Error('No pipeline run in waiting_user state');
  }
  const runId = existingRun.id;

  if (action === 'cancel') {
    cancelPipelineRun(runId);
    return getPipelineRunByDate(today)!;
  }

  // Mark as running again before continuing
  markRunAsRunning(runId);

  if (action === 'retry') {
    const webSearchResult = await runWebSearchStage(runId, today);
    if (webSearchResult.status === 'failed') {
      pausePipelineWaitingUser(runId);
      return getPipelineRunByDate(today)!;
    }
  } else {
    // skip
    updatePipelineStage(runId, 'webSearch', {
      status: 'skipped',
      startedAt: new Date().toISOString(),
      finishedAt: new Date().toISOString(),
      detail: 'Saltado por el usuario.',
      errors: [],
    });
  }

  // Continue pipeline from news
  if (!isNewsStageValid()) {
    const newsResult = await runNewsStage(runId);
    if (newsResult.status === 'failed') {
      for (const s of ['fundamentals', 'analysis', 'report'] as const) {
        updatePipelineStage(runId, s, { status: 'skipped', detail: 'Saltado: noticias fallaron.', errors: [], startedAt: null, finishedAt: null });
      }
      finishPipelineRun(runId, 'failed');
      return getPipelineRunByDate(today)!;
    }
  }

  await runFundamentalsStage(runId);

  if (!isAnalysisStageValid()) {
    const analysisResult = await runAnalysisStage(runId);
    if (analysisResult.status === 'failed') {
      updatePipelineStage(runId, 'report', { status: 'skipped', detail: 'Saltado: análisis falló.', errors: [], startedAt: null, finishedAt: null });
      finishPipelineRun(runId, 'failed');
      return getPipelineRunByDate(today)!;
    }
  }

  await runReportStage(runId);

  const finalRun = getPipelineRunByDate(today)!;
  const stageList = [finalRun.stages.webSearch, finalRun.stages.news, finalRun.stages.fundamentals, finalRun.stages.analysis, finalRun.stages.report];
  const anyFailed = stageList.some(s => s.status === 'failed');
  const allOk = stageList.every(s => s.status === 'ok' || s.status === 'skipped');
  finishPipelineRun(runId, anyFailed ? 'failed' : allOk ? 'ok' : 'partial');
  return getPipelineRunByDate(today)!;
}
```

- [ ] **Step 5: Extend `rerunPipelineStage` to accept 'webSearch'**

Change the function signature:

```ts
export async function rerunPipelineStage(
  stage: 'webSearch' | 'news' | 'fundamentals' | 'analysis' | 'report'
): Promise<PipelineRun> {
```

Add at the top of the if/else chain:

```ts
  if (stage === 'webSearch') {
    for (const s of ['news', 'fundamentals', 'analysis', 'report'] as const) {
      updatePipelineStage(runId, s, { status: 'pending', detail: 'Pendiente re-run de web search.', errors: [], startedAt: null, finishedAt: null });
    }
    const webSearchResult = await runWebSearchStage(runId, today);
    if (webSearchResult.status === 'failed') {
      pausePipelineWaitingUser(runId);
      return getPipelineRunByDate(today)!;
    }
    await runNewsStage(runId);
    await runFundamentalsStage(runId);
    await runAnalysisStage(runId);
    await runReportStage(runId);
  } else if (stage === 'news') {
```

Also update the final stageList to include webSearch:
```ts
  const stageList = [finalRun.stages.webSearch, finalRun.stages.news, finalRun.stages.fundamentals, finalRun.stages.analysis, finalRun.stages.report];
```

- [ ] **Step 6: Verify TypeScript**

```bash
cd apps/backend && npx tsc --noEmit 2>&1 | head -30
```
Expected: no errors.

- [ ] **Step 7: Commit**

```bash
git add apps/backend/src/intelligence/pipeline.service.ts
git commit -m "feat(pipeline): add web-search as stage 0 with waiting_user pause on failure"
```

---

## Task 9: News aggregator — inject web search articles

**Files:**
- Modify: `apps/backend/src/news/news-aggregator.service.ts`

- [ ] **Step 1: Add import**

At the top of `news-aggregator.service.ts`, add:

```ts
import { getWebSearchArticlesByDate } from '../db/repository.js';
```

- [ ] **Step 2: Identify the main export function**

Read the bottom of `apps/backend/src/news/news-aggregator.service.ts` to find the exported function name (likely `aggregateNews` or similar).

```bash
grep -n "^export" apps/backend/src/news/news-aggregator.service.ts
```

- [ ] **Step 3: Inject web search articles before adapter articles**

`aggregateNews()` in `news-aggregator.service.ts` initializes `const allArticles: RawNewsArticle[] = []` then pushes adapter results into it. Add web search articles right after that initialization (line ~132):

```ts
  // Inject web search articles from today's pipeline run (prepend so they are visible)
  const today = new Date().toISOString().split('T')[0];
  const webSearchRows = getWebSearchArticlesByDate(today);
  const webSearchRaw: RawNewsArticle[] = webSearchRows.map(row => ({
    externalId: `ws-${row.id}`,
    title: row.title,
    summary: row.content.slice(0, 500),
    url: row.url,
    publishedAt: row.publishedAt ?? row.createdAt,
    source: 'Web Search',
    sourceType: 'api' as const,
    relatedSymbols: JSON.parse(row.relatedSymbols) as string[],
  }));
  allArticles.push(...webSearchRaw);
  if (webSearchRaw.length > 0) sourceStats['Web Search'] = webSearchRaw.length;
```

This goes immediately after `const allArticles: RawNewsArticle[] = [];` and `const sourceStats: NewsSourceStats = {};`, before the `for (const r of results)` loop.

- [ ] **Step 5: Verify TypeScript**

```bash
cd apps/backend && npx tsc --noEmit 2>&1 | head -20
```

- [ ] **Step 6: Commit**

```bash
git add apps/backend/src/news/news-aggregator.service.ts packages/shared/src/types/news-source.ts
git commit -m "feat(news): inject web search articles before aggregation dedup"
```

---

## Task 10: Intelligence router — resolveWebSearch + extend rerunStage

**Files:**
- Modify: `apps/backend/src/intelligence/intelligence.router.ts`

- [ ] **Step 1: Add `resolveWebSearch` import and mutation**

In `intelligence.router.ts`, add `resolveWebSearch` to the import from `./pipeline.service.js`:

```ts
import {
  checkOrRunPipeline,
  rerunPipelineStage,
  resolveWebSearch,
  getPipelineRunByDate,
  getActivePipelineRun,
  getPipelineHistory,
} from './pipeline.service.js';
```

Add the new mutation to the router:

```ts
  resolveWebSearch: publicProcedure
    .input(z.object({ action: z.enum(['retry', 'skip', 'cancel']) }))
    .mutation(async ({ input }) => {
      return resolveWebSearch(input.action);
    }),
```

- [ ] **Step 2: Extend `rerunStage` input to include 'webSearch'**

```ts
  rerunStage: publicProcedure
    .input(z.object({ stage: z.enum(['webSearch', 'news', 'fundamentals', 'analysis', 'report']) }))
    .mutation(async ({ input }) => {
      return rerunPipelineStage(input.stage);
    }),
```

- [ ] **Step 3: Verify TypeScript**

```bash
cd apps/backend && npx tsc --noEmit 2>&1 | head -20
```

- [ ] **Step 4: Start backend and verify new endpoints exist**

```bash
cd apps/backend && npm run dev &
sleep 3
curl -s http://localhost:3001/trpc/intelligence.pipelineStatus | head -5
```
Expected: JSON response (not 404).

- [ ] **Step 5: Commit**

```bash
git add apps/backend/src/intelligence/intelligence.router.ts
git commit -m "feat(router): add resolveWebSearch mutation, extend rerunStage to include webSearch"
```

---

## Task 11: Frontend — usePipeline.ts

**Files:**
- Modify: `apps/frontend/src/pipeline/usePipeline.ts`

- [ ] **Step 1: Continue polling on `waiting_user`, add `resolveWebSearch` mutation**

Replace `usePipeline.ts` with:

```ts
import { useState, useEffect } from 'react';
import { trpc } from '@/shared/trpc';
import type { PipelineRun } from '@trading/shared';

const POLL_INTERVAL_MS = 2000;

export function usePipeline() {
  const utils = trpc.useUtils();
  const [isPolling, setIsPolling] = useState(false);

  const statusQuery = trpc.intelligence.pipelineStatus.useQuery(undefined, {
    refetchInterval: isPolling ? POLL_INTERVAL_MS : false,
    staleTime: isPolling ? 0 : 30_000,
  });

  const historyQuery = trpc.intelligence.pipelineHistory.useQuery({ limit: 7 });

  const runMutation = trpc.intelligence.generateMarketReport.useMutation({
    onSuccess: () => {
      setIsPolling(true);
      utils.intelligence.pipelineStatus.invalidate();
    },
  });

  const rerunMutation = trpc.intelligence.rerunStage.useMutation({
    onMutate: () => {
      setIsPolling(true);
      utils.intelligence.pipelineStatus.invalidate();
    },
    onSuccess: () => {
      utils.intelligence.pipelineStatus.invalidate();
    },
  });

  const resolveWebSearchMutation = trpc.intelligence.resolveWebSearch.useMutation({
    onMutate: () => {
      setIsPolling(true);
      utils.intelligence.pipelineStatus.invalidate();
    },
    onSuccess: () => {
      utils.intelligence.pipelineStatus.invalidate();
    },
  });

  useEffect(() => {
    const status = statusQuery.data?.status;
    // Stop polling only when pipeline is fully done (not waiting_user — user must act)
    if (status && status !== 'running' && status !== 'waiting_user') {
      setIsPolling(false);
      utils.intelligence.marketReport.invalidate();
      utils.intelligence.pipelineHistory.invalidate();
    }
  }, [statusQuery.data?.status]);

  const todayRun = statusQuery.data ?? null;
  const isRunning = todayRun?.status === 'running';
  const isWaitingUser = todayRun?.status === 'waiting_user';

  return {
    run: (force = false) => runMutation.mutate({ force }),
    rerunStage: (stage: 'webSearch' | 'news' | 'fundamentals' | 'analysis' | 'report') =>
      rerunMutation.mutate({ stage }),
    resolveWebSearch: (action: 'retry' | 'skip' | 'cancel') =>
      resolveWebSearchMutation.mutate({ action }),
    status: todayRun,
    history: historyQuery.data ?? [],
    isRunning,
    isWaitingUser,
    todayRun,
    isLoading: statusQuery.isLoading,
  };
}
```

- [ ] **Step 2: Commit**

```bash
git add apps/frontend/src/pipeline/usePipeline.ts
git commit -m "feat(pipeline): poll on waiting_user, add resolveWebSearch mutation"
```

---

## Task 12: Frontend — PipelineStatusButton + PipelineStatusToast

**Files:**
- Modify: `apps/frontend/src/pipeline/PipelineStatusButton.tsx`
- Modify: `apps/frontend/src/pipeline/PipelineStatusToast.tsx`

- [ ] **Step 1: Update `statusDot` and `statusClass` in PipelineStatusButton**

In `PipelineStatusButton.tsx`, update the two functions:

```ts
function statusDot(status: string | undefined): string {
  switch (status) {
    case 'ok': return '🟢';
    case 'partial': return '🟡';
    case 'failed': return '🔴';
    case 'running': return '🔵';
    case 'waiting_user': return '🟠';
    case 'cancelled': return '⚫';
    default: return '⚪';
  }
}

function statusClass(status: string | undefined): string {
  switch (status) {
    case 'ok': return 'text-green-400';
    case 'partial': return 'text-yellow-400';
    case 'failed': return 'text-red-400';
    case 'running': return 'text-blue-400 animate-pulse';
    case 'waiting_user': return 'text-orange-400 animate-pulse';
    case 'cancelled': return 'text-zinc-600';
    default: return 'text-zinc-500';
  }
}
```

- [ ] **Step 2: Update `PipelineStatusToast` to show webSearch as first stage and show on `waiting_user`**

Replace `PipelineStatusToast.tsx` with:

```ts
import type { PipelineRun, StageStatus } from '@trading/shared';

const STAGE_LABELS = {
  webSearch: 'Web Search',
  news: 'Noticias',
  fundamentals: 'Fundamentales',
  analysis: 'Análisis',
  report: 'Reporte',
} as const;

function stageIcon(status: StageStatus): string {
  switch (status) {
    case 'ok': return '✅';
    case 'partial': return '⚠️';
    case 'failed': return '❌';
    case 'running': return '⏳';
    case 'skipped': return '⏭️';
    case 'waiting_user': return '⏸️';
    default: return '○';
  }
}

interface Props { run: PipelineRun; }

export function PipelineStatusToast({ run }: Props) {
  if (run.status !== 'running' && run.status !== 'waiting_user') return null;
  return (
    <div className="fixed bottom-4 right-4 z-50 min-w-[260px] rounded-lg border border-white/10 bg-zinc-900 p-3 shadow-xl">
      <div className="mb-2 text-[11px] font-medium text-zinc-300">
        {run.status === 'running' ? '🔄 Ejecutando pipeline...' : '⏸️ Pipeline pausado'}
      </div>
      {(['webSearch', 'news', 'fundamentals', 'analysis', 'report'] as const).map((stage) => {
        const s = run.stages[stage];
        return (
          <div key={stage} className="flex items-center gap-2 py-0.5 text-[11px]">
            <span>{stageIcon(s.status)}</span>
            <span className="text-zinc-400">{STAGE_LABELS[stage]}</span>
            {s.status === 'running' && <span className="text-zinc-500">en curso...</span>}
            {(s.status === 'ok' || s.status === 'partial') && s.detail && (
              <span className="text-zinc-500 truncate max-w-[150px]">{s.detail.split('.')[0]}</span>
            )}
          </div>
        );
      })}
    </div>
  );
}
```

- [ ] **Step 3: Commit**

```bash
git add apps/frontend/src/pipeline/PipelineStatusButton.tsx apps/frontend/src/pipeline/PipelineStatusToast.tsx
git commit -m "feat(pipeline-ui): add waiting_user/cancelled states, webSearch as first stage in toast"
```

---

## Task 13: Frontend — PipelineHistoryModal update

**Files:**
- Modify: `apps/frontend/src/pipeline/PipelineHistoryModal.tsx`

- [ ] **Step 1: Add `waiting_user` and `cancelled` to `overallBadge`**

```ts
function overallBadge(status: PipelineRun['status']) {
  switch (status) {
    case 'ok': return <Badge className="bg-green-500/20 text-green-400 border-green-500/30 text-[9px]">Completo</Badge>;
    case 'partial': return <Badge className="bg-yellow-500/20 text-yellow-400 border-yellow-500/30 text-[9px]">Parcial</Badge>;
    case 'failed': return <Badge className="bg-red-500/20 text-red-400 border-red-500/30 text-[9px]">Fallido</Badge>;
    case 'running': return <Badge className="bg-blue-500/20 text-blue-400 border-blue-500/30 text-[9px]">Ejecutando</Badge>;
    case 'waiting_user': return <Badge className="bg-orange-500/20 text-orange-400 border-orange-500/30 text-[9px]">Esperando</Badge>;
    case 'cancelled': return <Badge className="bg-zinc-500/20 text-zinc-400 border-zinc-500/30 text-[9px]">Cancelado</Badge>;
  }
}
```

- [ ] **Step 2: Add webSearch to stage list and STAGE_LABELS, update `onRerunStage` type**

Change `STAGE_LABELS`:
```ts
const STAGE_LABELS = {
  webSearch: 'Web Search',
  news: 'Noticias',
  fundamentals: 'Fundamentales',
  analysis: 'Análisis',
  report: 'Reporte',
} as const;
```

Change `onRerunStage` prop type:
```ts
onRerunStage: (stage: 'webSearch' | 'news' | 'fundamentals' | 'analysis' | 'report') => void;
```

Change the stage iteration array:
```ts
{(['webSearch', 'news', 'fundamentals', 'analysis', 'report'] as const).map((stage) => {
```

- [ ] **Step 3: Commit**

```bash
git add apps/frontend/src/pipeline/PipelineHistoryModal.tsx
git commit -m "feat(pipeline-ui): add webSearch to history modal, new status badges"
```

---

## Task 14: Frontend — WebSearchBlockedModal

**Files:**
- Create: `apps/frontend/src/pipeline/WebSearchBlockedModal.tsx`
- Modify: `apps/frontend/src/App.tsx`

- [ ] **Step 1: Create `WebSearchBlockedModal`**

Create `apps/frontend/src/pipeline/WebSearchBlockedModal.tsx`:

```tsx
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { usePipeline } from './usePipeline';

export function WebSearchBlockedModal() {
  const { isWaitingUser, resolveWebSearch } = usePipeline();

  return (
    <Dialog open={isWaitingUser}>
      <DialogContent
        className="max-w-sm bg-zinc-950 border-orange-500/30"
        onInteractOutside={(e) => e.preventDefault()}
      >
        <DialogHeader>
          <DialogTitle className="text-sm font-medium text-zinc-200 flex items-center gap-2">
            <span>⚠️</span>
            Web Search falló
          </DialogTitle>
          <DialogDescription className="text-[12px] text-zinc-400 pt-1">
            No se pudieron obtener datos frescos del mercado. El análisis podría estar
            desactualizado sin esta información.
          </DialogDescription>
        </DialogHeader>
        <div className="flex flex-col gap-2 mt-2">
          <Button
            variant="default"
            size="sm"
            className="w-full bg-orange-600 hover:bg-orange-500 text-white text-[12px]"
            onClick={() => resolveWebSearch('retry')}
          >
            🔄 Reintentar
          </Button>
          <Button
            variant="outline"
            size="sm"
            className="w-full border-white/10 text-zinc-300 text-[12px]"
            onClick={() => resolveWebSearch('skip')}
          >
            ⏭️ Continuar sin datos frescos
          </Button>
          <Button
            variant="ghost"
            size="sm"
            className="w-full text-zinc-500 hover:text-zinc-400 text-[12px]"
            onClick={() => resolveWebSearch('cancel')}
          >
            ✕ Cancelar
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
```

- [ ] **Step 2: Mount in App.tsx**

In `apps/frontend/src/App.tsx`, import and add `<WebSearchBlockedModal />` at the same level as `<PipelineStatusToast>`:

```tsx
import { WebSearchBlockedModal } from '@/pipeline/WebSearchBlockedModal';

// ... inside JSX, alongside PipelineStatusToast:
<WebSearchBlockedModal />
```

- [ ] **Step 3: Commit**

```bash
git add apps/frontend/src/pipeline/WebSearchBlockedModal.tsx apps/frontend/src/App.tsx
git commit -m "feat(pipeline-ui): add WebSearchBlockedModal for waiting_user state"
```

---

## Task 15: Environment variables + .env.example

**Files:**
- Modify: `.env.example`

- [ ] **Step 1: Add new API keys to .env.example**

Add to `.env.example`:

```
# Web Search (Tavily — primary, required for web search stage)
TAVILY_API_KEY=

# Web Search (Brave — optional fallback if Tavily fails)
BRAVE_API_KEY=
```

- [ ] **Step 2: Add your actual keys to .env (not committed)**

```bash
# In .env (not .env.example):
TAVILY_API_KEY=tvly-xxxxxxxxxxxx
BRAVE_API_KEY=BSAxxxxxxxxxxxx   # optional
```

- [ ] **Step 3: Commit .env.example only**

```bash
git add .env.example
git commit -m "chore: add TAVILY_API_KEY and BRAVE_API_KEY to .env.example"
```

---

## Task 16: End-to-end verification

- [ ] **Step 1: Start backend + frontend**

```bash
npm run dev
```

- [ ] **Step 2: Trigger pipeline from UI and verify web-search stage appears**

Open http://localhost:5173 → click Pipeline → click "Ejecutar". Verify:
- Toast shows `Web Search` as first stage with `⏳ en curso...`
- After completion, toast shows ✅ Web Search with article count

- [ ] **Step 3: Verify web search articles were saved**

```bash
cd apps/backend
node -e "
import('./src/db/index.js').then(({ db, schema }) => {
  const { eq } = require('drizzle-orm');
  const today = new Date().toISOString().split('T')[0];
  const rows = db.select().from(schema.webSearchArticles).all();
  console.log('Articles:', rows.length);
  console.log('Sample:', JSON.stringify(rows[0], null, 2));
});
"
```
Expected: rows with `layer: 'portfolio'` for each portfolio symbol.

- [ ] **Step 4: Test waiting_user flow**

Temporarily set `TAVILY_API_KEY=invalid` and `BRAVE_API_KEY=` in .env, run pipeline, verify:
- Pipeline status shows 🟠 orange pulsing
- `WebSearchBlockedModal` appears automatically
- Clicking "Continuar sin datos frescos" skips web-search and continues pipeline

Restore real API key after test.

- [ ] **Step 5: Final commit if any fixes needed**

```bash
git add -p
git commit -m "fix(web-search): post-integration fixes"
```
