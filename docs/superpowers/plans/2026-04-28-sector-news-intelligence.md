# Sector News Intelligence Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Rewrite sector synthesis to be news-first: take filtered/triangulated articles (high/medium confidence) as input, synthesize per-sector causal impact in a single LLM call, and surface the result prominently in the UI before portfolio analysis.

**Architecture:** New DB query fetches rich article data → `sector-report.service.ts` rewritten with single-call prompt → new `runSectorIntelligenceStage()` in pipeline replaces `runSectorAnalysis()` call in `refreshNewsProcess()` → frontend `SectorImpactsSection` upgraded to show catalysts/riskFactors/tension.

**Tech Stack:** TypeScript, Drizzle ORM (SQLite), tRPC, React + Tailwind, `callAI` from `ai-router.ts`

---

## File Map

| File | Action | Responsibility |
|------|--------|---------------|
| `apps/backend/src/db/schema.ts` | Modify | Add `catalysts`/`conviccion`/`tension` columns to `sectorImpacts` table |
| `apps/backend/drizzle/meta/_journal.json` | Modify | Register new migration entry |
| `apps/backend/drizzle/0027_sector_news_intel.sql` | Create | SQL migration for new columns |
| `apps/backend/src/db/repository.ts` | Modify | Add `getFilteredArticlesForSectorSynthesis()`, update `insertSectorImpacts`/`getSectorImpactsByDate` |
| `packages/shared/src/types/intelligence.ts` | Modify | Extend `SectorReport` with `catalysts`/`conviccion`/`tension`, add `sectorIntelligence` to `PipelineRun.stages` |
| `apps/backend/src/intelligence/sector-report.service.ts` | Rewrite | Single-call synthesis using rich article data; delete 2-step approach |
| `apps/backend/src/intelligence/pipeline.service.ts` | Modify | Add `runSectorIntelligenceStage()`, wire into `runRemainingStages()`; update `updatePipelineStage` call sites to include `sectorIntelligence` |
| `apps/backend/src/intelligence/pipeline.repository.ts` | Modify | Add `sectorIntelligence` stage columns to `updatePipelineStage` type union |
| `apps/backend/src/opportunities/opportunities.service.ts` | Modify | Remove `runSectorAnalysis` call from `refreshNewsProcess()` |
| `apps/frontend/src/daily/DailySummary.tsx` | Modify | Upgrade `SectorImpactsSection` to render `catalysts`/`tension`/`conviccion` |

---

## Task 1: DB Schema — add columns + Drizzle migration

**Files:**
- Modify: `apps/backend/src/db/schema.ts:224-236`
- Create: `apps/backend/drizzle/0027_sector_news_intel.sql`
- Modify: `apps/backend/drizzle/meta/_journal.json`

- [ ] **Step 1: Add columns to `sectorImpacts` table in schema.ts**

In `apps/backend/src/db/schema.ts`, replace the `sectorImpacts` table definition (lines 224-236) with:

```typescript
export const sectorImpacts = sqliteTable('sector_impacts', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  reportDate: text('report_date').notNull(),
  sector: text('sector').notNull(),
  impact: text('impact').notNull(),              // 'positive' | 'negative' | 'mixed'
  event: text('event').notNull(),
  summary: text('summary').notNull(),
  keyNews: text('key_news').notNull(),           // JSON array
  suggestedTickers: text('suggested_tickers').notNull(), // JSON array
  riskFactors: text('risk_factors').notNull(),   // JSON array
  catalysts: text('catalysts').notNull().default('[]'),   // JSON array — new
  conviccion: text('conviccion').notNull().default('media'), // 'alta' | 'media' | 'baja' — new
  tension: text('tension'),                      // nullable string — new
  confidence: text('confidence').notNull(),
  createdAt: text('created_at').notNull().default(sql`(datetime('now'))`),
});
```

- [ ] **Step 2: Create migration SQL file**

Create `apps/backend/drizzle/0027_sector_news_intel.sql`:

```sql
ALTER TABLE sector_impacts ADD COLUMN catalysts TEXT NOT NULL DEFAULT '[]';
ALTER TABLE sector_impacts ADD COLUMN conviccion TEXT NOT NULL DEFAULT 'media';
ALTER TABLE sector_impacts ADD COLUMN tension TEXT;
```

- [ ] **Step 3: Register migration in journal**

In `apps/backend/drizzle/meta/_journal.json`, add entry at the end of the `entries` array (before the closing `]`):

```json
,{
  "idx": 27,
  "version": "6",
  "when": 1745700000000,
  "tag": "0027_sector_news_intel",
  "breakpoints": true
}
```

- [ ] **Step 4: Verify backend starts without error**

```bash
cd apps/backend && npx tsx src/index.ts
```

Expected: server starts, no migration errors in output. Kill with Ctrl+C.

- [ ] **Step 5: Commit**

```bash
git add apps/backend/src/db/schema.ts apps/backend/drizzle/0027_sector_news_intel.sql apps/backend/drizzle/meta/_journal.json
git commit -m "feat(db): add catalysts/conviccion/tension to sector_impacts"
```

---

## Task 2: Shared types — extend SectorReport + PipelineRun

**Files:**
- Modify: `packages/shared/src/types/intelligence.ts:117-125` (SectorReport)
- Modify: `packages/shared/src/types/intelligence.ts:168-183` (PipelineRun stages)

- [ ] **Step 1: Extend SectorReport**

In `packages/shared/src/types/intelligence.ts`, replace the `SectorReport` interface:

```typescript
export interface SectorReport {
  sector: string;
  impact: 'positive' | 'negative' | 'mixed';
  summary: string;
  keyNews: string[];
  suggestedTickers: string[];
  riskFactors: string[];
  catalysts: string[];
  conviccion: 'alta' | 'media' | 'baja';
  tension: string | null;
  generatedAt: number;
}
```

- [ ] **Step 2: Add sectorIntelligence to PipelineRun.stages**

In `packages/shared/src/types/intelligence.ts`, replace the `stages` block inside `PipelineRun`:

```typescript
stages: {
  webSearch: StageResult
  news: StageResult
  macroIntelligence: StageResult
  sectorIntelligence: StageResult
  fundamentals: StageResult
  analysis: StageResult
  quant?: StageResult
  report: StageResult
}
```

- [ ] **Step 3: Verify TypeScript compiles**

```bash
cd packages/shared && npx tsc --noEmit
```

Expected: no errors.

- [ ] **Step 4: Commit**

```bash
git add packages/shared/src/types/intelligence.ts
git commit -m "feat(types): extend SectorReport with catalysts/conviccion/tension, add sectorIntelligence stage"
```

---

## Task 3: Repository — new query + update insert/get for new columns

**Files:**
- Modify: `apps/backend/src/db/repository.ts` (SECTOR IMPACTS section, lines ~870-920)

- [ ] **Step 1: Add `getFilteredArticlesForSectorSynthesis()`**

In `apps/backend/src/db/repository.ts`, add after `getLatestSectorImpacts()` (around line 920):

```typescript
export function getFilteredArticlesForSectorSynthesis(limit = 60) {
  return db.select({
    title: schema.newsArticles.title,
    summary: schema.newsArticles.summary,
    sentiment: schema.newsArticles.sentiment,
    impact: schema.newsArticles.impact,
    triangulationConfidence: schema.newsArticles.triangulationConfidence,
    source: schema.newsArticles.source,
    publishedAt: schema.newsArticles.publishedAt,
  })
    .from(schema.newsArticles)
    .where(
      inArray(schema.newsArticles.triangulationConfidence, ['high', 'medium'])
    )
    .orderBy(desc(schema.newsArticles.createdAt))
    .limit(limit)
    .all();
}
```

Note: `inArray` is already imported at the top of `repository.ts`.

- [ ] **Step 2: Update `insertSectorImpacts` to accept new fields**

Replace the existing `insertSectorImpacts` function signature and body:

```typescript
export function insertSectorImpacts(date: string, impacts: Array<{
  sector: string;
  impact: string;
  event: string;
  summary: string;
  keyNews: string[];
  suggestedTickers: string[];
  riskFactors: string[];
  catalysts: string[];
  conviccion: string;
  tension: string | null;
  confidence: string;
}>) {
  for (const i of impacts) {
    db.insert(schema.sectorImpacts).values({
      reportDate: date,
      sector: i.sector,
      impact: i.impact,
      event: i.event,
      summary: i.summary,
      keyNews: JSON.stringify(i.keyNews),
      suggestedTickers: JSON.stringify(i.suggestedTickers),
      riskFactors: JSON.stringify(i.riskFactors),
      catalysts: JSON.stringify(i.catalysts),
      conviccion: i.conviccion,
      tension: i.tension ?? null,
      confidence: i.confidence,
    }).run();
  }
}
```

- [ ] **Step 3: Update `getSectorImpactsByDate` to parse new JSON columns**

Replace the existing `getSectorImpactsByDate` function:

```typescript
export function getSectorImpactsByDate(date: string) {
  return db.select().from(schema.sectorImpacts)
    .where(eq(schema.sectorImpacts.reportDate, date))
    .all()
    .map(r => ({
      ...r,
      keyNews: JSON.parse(r.keyNews) as string[],
      suggestedTickers: JSON.parse(r.suggestedTickers) as string[],
      riskFactors: JSON.parse(r.riskFactors) as string[],
      catalysts: JSON.parse(r.catalysts ?? '[]') as string[],
    }));
}
```

- [ ] **Step 4: Verify TypeScript compiles**

```bash
cd apps/backend && npx tsc --noEmit
```

Expected: no errors.

- [ ] **Step 5: Commit**

```bash
git add apps/backend/src/db/repository.ts
git commit -m "feat(db): add getFilteredArticlesForSectorSynthesis, update sector impact insert/get"
```

---

## Task 4: Rewrite sector-report.service.ts — news-first single-call synthesis

**Files:**
- Rewrite: `apps/backend/src/intelligence/sector-report.service.ts`

This task replaces the 2-step (identifySectorImpacts → generateSectorReports) approach with a single LLM call that receives rich article data (title + summary + confidence + sentiment).

- [ ] **Step 1: Rewrite the service file**

Replace the entire content of `apps/backend/src/intelligence/sector-report.service.ts`:

```typescript
import type { SectorReport } from '@trading/shared';
import { callAI } from '../shared/ai-router.js';
import {
  insertSectorImpacts,
  deleteSectorImpactsByDate,
  getSectorImpactsByDate,
  getFilteredArticlesForSectorSynthesis,
  getAllSectorTickers,
} from '../db/repository.js';

interface ArticleInput {
  title: string;
  summary: string | null;
  sentiment: string | null;
  impact: string | null;
  triangulationConfidence: string | null;
  source: string;
}

function buildArticleBlock(articles: ArticleInput[]): string {
  return articles.map((a, i) => {
    const conf = a.triangulationConfidence === 'high' ? '[ALTA]' : '[MEDIA]';
    const sentiment = a.sentiment ? ` | sentimiento: ${a.sentiment}` : '';
    const summary = a.summary ? `\n  Resumen: ${a.summary.slice(0, 200)}` : '';
    return `${i + 1}. ${conf} ${a.title} (${a.source}${sentiment})${summary}`;
  }).join('\n');
}

/**
 * Single-call sector synthesis from filtered/triangulated articles.
 * Returns up to 8 sector reports with causal analysis.
 */
export async function synthesizeSectorIntelligence(articles: ArticleInput[]): Promise<SectorReport[]> {
  if (articles.length === 0) return [];

  const allSectorTickers = getAllSectorTickers();
  const sectorExamples = Object.entries(
    allSectorTickers.reduce((acc, st) => {
      if (!acc[st.sector]) acc[st.sector] = [];
      acc[st.sector].push(st.ticker);
      return acc;
    }, {} as Record<string, string[]>),
  ).map(([sector, tickers]) => `- ${sector}: ${tickers.join(', ')}`).join('\n');

  const prompt = `IMPORTANTE: Responde EXCLUSIVAMENTE en español. Todos los textos deben estar en español. Prohibido usar inglés.

Sos un analista de mercado senior. Te doy artículos de noticias financieras filtrados por calidad (marcados [ALTA] = 3+ fuentes, [MEDIA] = 2 fuentes).

Tu trabajo: identificar los sectores financieros más impactados y generar un análisis causal completo de CADA UNO.

Para cada sector impactado, genera un objeto con:
- "sector": nombre en español (ej: "Defensa", "Petróleo y Gas", "Semiconductores", "Banca", "Crypto", "Tech/IA", "Salud/Pharma", "Commodities", "Energía Renovable", "E-commerce", "Automotriz", "Ciberseguridad")
- "impact": "positive" | "negative" | "mixed"
- "event": evento principal que causa el impacto (1 oración)
- "summary": 2-3 oraciones explicando QUÉ pasa y POR QUÉ importa para invertir. Sé específico.
- "catalysts": lista de 2-3 catalizadores concretos que impulsan el movimiento (ej: "Datos de empleo mejores de lo esperado", "Tensión arancelaria con China")
- "keyNews": los 2-3 titulares más relevantes del sector (copiar literalmente de las noticias)
- "suggestedTickers": 3-5 tickers reales (NYSE/NASDAQ) que se benefician o perjudican
- "riskFactors": 1-2 riesgos específicos de este sector ahora mismo
- "conviccion": "alta" si múltiples noticias [ALTA] confirman | "media" si mezcla de [ALTA]+[MEDIA] | "baja" si solo [MEDIA]
- "tension": si hay señales contradictorias en el sector, describir en 1 oración. null si no hay tensión.
- "confidence": "high" | "medium"

REGLAS:
- Solo incluir sectores con impacto REAL y VERIFICABLE en las noticias
- No inventar impactos que no estén en los artículos
- Máximo 8 sectores, ordenados por relevancia
- Los catalizadores deben ser causas concretas, no genéricas

REFERENCIA DE TICKERS POR SECTOR:
${sectorExamples || '(usar conocimiento propio)'}

Responde SOLO con JSON válido:
{"sectors":[{"sector":"Semiconductores","impact":"positive","event":"...","summary":"...","catalysts":["..."],"keyNews":["..."],"suggestedTickers":["NVDA","AMD"],"riskFactors":["..."],"conviccion":"alta","tension":null,"confidence":"high"}]}`;

  const userMsg = `ARTÍCULOS FILTRADOS (${articles.length} con confianza alta/media):\n\n${buildArticleBlock(articles)}`;

  try {
    const raw = await callAI('reasoning', userMsg, prompt, 6000);
    const parsed = JSON.parse(raw);
    const now = Date.now();
    return (parsed.sectors ?? []).map((r: any): SectorReport => ({
      sector: r.sector ?? '',
      impact: (r.impact ?? 'mixed') as SectorReport['impact'],
      summary: r.summary ?? '',
      keyNews: Array.isArray(r.keyNews) ? r.keyNews : [],
      suggestedTickers: Array.isArray(r.suggestedTickers) ? r.suggestedTickers : [],
      riskFactors: Array.isArray(r.riskFactors) ? r.riskFactors : [],
      catalysts: Array.isArray(r.catalysts) ? r.catalysts : [],
      conviccion: (['alta', 'media', 'baja'].includes(r.conviccion) ? r.conviccion : 'media') as SectorReport['conviccion'],
      tension: r.tension ?? null,
      generatedAt: now,
    }));
  } catch (err) {
    console.warn('[SectorIntelligence] Synthesis failed:', (err as Error).message?.slice(0, 100));
    return [];
  }
}

/**
 * Full sector intelligence pipeline: fetch filtered articles → synthesize → persist.
 * Called by pipeline.service.ts runSectorIntelligenceStage().
 */
export async function runSectorIntelligence(): Promise<{ reports: SectorReport[]; articleCount: number }> {
  console.log('[SectorIntelligence] Fetching filtered articles...');
  const articles = getFilteredArticlesForSectorSynthesis(60);
  console.log(`[SectorIntelligence] ${articles.length} high/medium confidence articles`);

  if (articles.length === 0) {
    return { reports: [], articleCount: 0 };
  }

  const reports = await synthesizeSectorIntelligence(articles);
  console.log(`[SectorIntelligence] ${reports.length} sector reports generated`);

  if (reports.length > 0) {
    const today = new Date().toISOString().split('T')[0];
    try {
      deleteSectorImpactsByDate(today);
      insertSectorImpacts(today, reports.map(r => ({
        sector: r.sector,
        impact: r.impact,
        event: r.summary.split('.')[0] ?? r.summary,
        summary: r.summary,
        keyNews: r.keyNews,
        suggestedTickers: r.suggestedTickers,
        riskFactors: r.riskFactors,
        catalysts: r.catalysts,
        conviccion: r.conviccion,
        tension: r.tension,
        confidence: r.conviccion === 'alta' ? 'high' : 'medium',
      })));
    } catch (err) {
      console.warn('[SectorIntelligence] Persist failed:', err);
    }
  }

  return { reports, articleCount: articles.length };
}

/**
 * Get sector reports from DB (for today).
 */
export function getStoredSectorReports(): SectorReport[] {
  const today = new Date().toISOString().split('T')[0];
  const rows = getSectorImpactsByDate(today);
  return rows.map(r => ({
    sector: r.sector,
    impact: r.impact as SectorReport['impact'],
    summary: r.summary,
    keyNews: r.keyNews,
    suggestedTickers: r.suggestedTickers,
    riskFactors: r.riskFactors,
    catalysts: r.catalysts,
    conviccion: (r.conviccion ?? 'media') as SectorReport['conviccion'],
    tension: r.tension ?? null,
    generatedAt: new Date(r.createdAt).getTime(),
  }));
}

/**
 * Get all suggested tickers from sector reports (for discovery).
 */
export function getTickersFromSectorReports(): string[] {
  const reports = getStoredSectorReports();
  return [...new Set(reports.flatMap(r => r.suggestedTickers))];
}
```

- [ ] **Step 2: Verify TypeScript compiles**

```bash
cd apps/backend && npx tsc --noEmit
```

Expected: no errors.

- [ ] **Step 3: Commit**

```bash
git add apps/backend/src/intelligence/sector-report.service.ts
git commit -m "feat(sector): rewrite sector synthesis — news-first single LLM call with filtered articles"
```

---

## Task 5: Pipeline — add sectorIntelligence stage, remove from refreshNewsProcess

**Files:**
- Modify: `apps/backend/src/intelligence/pipeline.service.ts`
- Modify: `apps/backend/src/intelligence/pipeline.repository.ts`
- Modify: `apps/backend/src/db/schema.ts` (pipelineRuns table)
- Modify: `apps/backend/src/opportunities/opportunities.service.ts`

**Sub-task A: DB schema for pipelineRuns new stage columns**

- [ ] **Step 1: Add sectorIntelligence columns to pipelineRuns in schema.ts**

In `apps/backend/src/db/schema.ts`, in the `pipelineRuns` table, add after the `macroIntelligenceFinishedAt` line (after line ~391) and before the `// Stage: fundamentals` comment:

```typescript
  // Stage: sectorIntelligence (runs after macroIntelligence, before fundamentals)
  sectorIntelligenceStatus: text('sector_intelligence_status', { enum: ['pending', 'running', 'ok', 'partial', 'failed', 'skipped'] }).notNull().default('pending'),
  sectorIntelligenceDetail: text('sector_intelligence_detail'),
  sectorIntelligenceErrors: text('sector_intelligence_errors'),
  sectorIntelligenceStartedAt: text('sector_intelligence_started_at'),
  sectorIntelligenceFinishedAt: text('sector_intelligence_finished_at'),
```

- [ ] **Step 2: Create migration SQL for pipelineRuns new columns**

Add to `apps/backend/drizzle/0027_sector_news_intel.sql` (append to existing file):

```sql
ALTER TABLE pipeline_runs ADD COLUMN sector_intelligence_status TEXT NOT NULL DEFAULT 'pending';
ALTER TABLE pipeline_runs ADD COLUMN sector_intelligence_detail TEXT;
ALTER TABLE pipeline_runs ADD COLUMN sector_intelligence_errors TEXT;
ALTER TABLE pipeline_runs ADD COLUMN sector_intelligence_started_at TEXT;
ALTER TABLE pipeline_runs ADD COLUMN sector_intelligence_finished_at TEXT;
```

**Sub-task B: Update pipeline.repository.ts**

- [ ] **Step 3: Add sectorIntelligence to rowToPipelineRun and updatePipelineStage**

In `apps/backend/src/intelligence/pipeline.repository.ts`:

In `rowToPipelineRun`, add `sectorIntelligence` to the stages object (after `macroIntelligence`):

```typescript
sectorIntelligence: stageResultFromRow(row.sectorIntelligenceStatus, row.sectorIntelligenceDetail, row.sectorIntelligenceErrors, row.sectorIntelligenceStartedAt, row.sectorIntelligenceFinishedAt),
```

In `createPipelineRun`, add to the `.values({...})` call:

```typescript
sectorIntelligenceStatus: 'pending',
```

In `updatePipelineStage`, extend the stage type union:

```typescript
stage: 'webSearch' | 'news' | 'macroIntelligence' | 'sectorIntelligence' | 'fundamentals' | 'analysis' | 'quant' | 'report',
```

**Sub-task C: Add runSectorIntelligenceStage to pipeline.service.ts**

- [ ] **Step 4: Add import and stage function**

In `apps/backend/src/intelligence/pipeline.service.ts`, add to the imports at the top:

```typescript
import { runSectorIntelligence } from './sector-report.service.js';
```

Then add the stage function after `runMacroIntelligenceStage`:

```typescript
async function runSectorIntelligenceStage(runId: number): Promise<StageResult> {
  const startedAt = new Date().toISOString();
  updatePipelineStage(runId, 'sectorIntelligence', { status: 'running', startedAt });
  try {
    const { reports, articleCount } = await runSectorIntelligence();
    if (reports.length === 0) {
      const sr: StageResult = {
        status: 'failed',
        startedAt,
        finishedAt: new Date().toISOString(),
        detail: `Sin artículos con confianza alta/media para sintetizar sectores.`,
        errors: [],
        criticalError: '0 artículos filtrados disponibles',
      };
      updatePipelineStage(runId, 'sectorIntelligence', sr);
      return sr;
    }
    const sr: StageResult = {
      status: 'ok',
      startedAt,
      finishedAt: new Date().toISOString(),
      detail: `${reports.length} sectores sintetizados desde ${articleCount} artículos.`,
      errors: [],
    };
    updatePipelineStage(runId, 'sectorIntelligence', sr);
    return sr;
  } catch (err) {
    const errMsg = (err as Error).message ?? String(err);
    console.error('[pipeline] runSectorIntelligenceStage error:', errMsg);
    const sr: StageResult = {
      status: 'failed',
      startedAt,
      finishedAt: new Date().toISOString(),
      detail: 'Error en sector intelligence.',
      errors: [],
      criticalError: errMsg.slice(0, 200),
    };
    updatePipelineStage(runId, 'sectorIntelligence', sr);
    return sr;
  }
}
```

- [ ] **Step 5: Wire sectorIntelligence into runRemainingStages**

In `runRemainingStages`, after the `macroIntelligence` block (after the closing `}` of the `if (!isMacroIntelligenceStageValid())` block), add:

```typescript
  // sectorIntelligence stage — non-blocking (failure doesn't stop pipeline)
  await runSectorIntelligenceStage(runId);
```

- [ ] **Step 6: Update stageList in runRemainingStages**

In `runRemainingStages`, find the `stageList` line near the end and add `sectorIntelligence`:

```typescript
const stageList = [finalRun.stages.webSearch, finalRun.stages.news, finalRun.stages.macroIntelligence, finalRun.stages.sectorIntelligence, finalRun.stages.fundamentals, finalRun.stages.analysis, finalRun.stages.report];
```

**Sub-task D: Remove runSectorAnalysis from refreshNewsProcess**

- [ ] **Step 7: Find and remove runSectorAnalysis call in opportunities.service.ts**

In `apps/backend/src/opportunities/opportunities.service.ts`, find the `refreshNewsProcess` function. Remove the call to `runSectorAnalysis(headlines)` and any related variables/imports that become unused.

The call looks like:
```typescript
const sectorReports = await runSectorAnalysis(headlines);
```
or similar. Remove it entirely (sector analysis is now a dedicated pipeline stage).

Also remove the import of `runSectorAnalysis` from `sector-report.service.js` if it's the only import from that module. If other functions from that module are imported (like `getTickersFromSectorReports`), keep those.

- [ ] **Step 8: Verify TypeScript compiles**

```bash
cd apps/backend && npx tsc --noEmit
```

Expected: no errors.

- [ ] **Step 9: Verify backend starts**

```bash
cd apps/backend && npx tsx src/index.ts
```

Expected: server starts, no migration errors. Kill with Ctrl+C.

- [ ] **Step 10: Commit**

```bash
git add apps/backend/src/db/schema.ts apps/backend/drizzle/0027_sector_news_intel.sql apps/backend/src/intelligence/pipeline.service.ts apps/backend/src/intelligence/pipeline.repository.ts apps/backend/src/opportunities/opportunities.service.ts
git commit -m "feat(pipeline): add sectorIntelligence stage after macroIntelligence, remove from refreshNewsProcess"
```

---

## Task 6: Frontend — upgrade SectorImpactsSection

**Files:**
- Modify: `apps/frontend/src/daily/DailySummary.tsx:16-104` (SectorImpactsSection component)

The section currently shows: sector name, impact badge, summary, keyNews, suggestedTickers, riskFactors.

New design adds: `catalysts` (green block, before keyNews), `conviccion` badge (replaces confidence), `tension` (amber warning if present).

- [ ] **Step 1: Update SectorImpactsSection**

In `apps/frontend/src/daily/DailySummary.tsx`, replace the `SectorImpactsSection` function (lines 16-104):

```tsx
function SectorImpactsSection() {
  const { data: sectors } = trpc.intelligence.sectorReports.useQuery(undefined, {
    staleTime: 5 * 60_000,
  });

  const utils = trpc.useUtils();
  const addToWatchlist = trpc.opportunities.addToWatchlist.useMutation({
    onSuccess: () => utils.opportunities.scan.invalidate(),
  });

  if (!sectors || sectors.length === 0) return null;

  const impactColor = {
    positive: 'border-l-green-500',
    negative: 'border-l-red-500',
    mixed: 'border-l-yellow-500',
  };

  const impactBadge = {
    positive: 'bg-green-500/20 text-green-400',
    negative: 'bg-red-500/20 text-red-400',
    mixed: 'bg-yellow-500/20 text-yellow-400',
  };

  const impactLabel = {
    positive: 'Positivo',
    negative: 'Negativo',
    mixed: 'Mixto',
  };

  const conviccionBadge = {
    alta: 'bg-blue-500/20 text-blue-400',
    media: 'bg-muted text-muted-foreground',
    baja: 'bg-gray-500/10 text-gray-500',
  };

  return (
    <div className="space-y-2">
      <span className="text-[10px] text-muted-foreground uppercase tracking-wider font-medium">
        Sectores impactados por noticias ({sectors.length})
      </span>
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-3">
        {sectors.map((s, i) => (
          <Card key={i} size="sm" className={`border-l-4 ${impactColor[s.impact as keyof typeof impactColor] ?? 'border-l-muted'}`}>
            <CardHeader>
              <div className="flex items-center justify-between">
                <span className="text-xs font-semibold">{s.sector}</span>
                <div className="flex items-center gap-1.5">
                  {(s as any).conviccion && (
                    <Badge className={`text-[8px] ${conviccionBadge[(s as any).conviccion as keyof typeof conviccionBadge] ?? conviccionBadge.media}`}>
                      Conv. {(s as any).conviccion}
                    </Badge>
                  )}
                  <Badge className={`text-[8px] ${impactBadge[s.impact as keyof typeof impactBadge] ?? ''}`}>
                    {impactLabel[s.impact as keyof typeof impactLabel] ?? s.impact}
                  </Badge>
                </div>
              </div>
            </CardHeader>
            <CardContent className="space-y-2">
              <p className="text-[10px] text-foreground leading-relaxed">{s.summary}</p>

              {/* Tension warning */}
              {(s as any).tension && (
                <div className="rounded bg-amber-500/10 border border-amber-500/20 px-2 py-1">
                  <p className="text-[9px] text-amber-400">⚡ {(s as any).tension}</p>
                </div>
              )}

              {/* Catalysts */}
              {(s as any).catalysts?.length > 0 && (
                <div className="rounded bg-green-500/5 border border-green-500/20 px-2 py-1.5 space-y-0.5">
                  <span className="text-[8px] text-green-400 uppercase tracking-wider font-medium">Catalizadores</span>
                  {(s as any).catalysts.map((c: string, j: number) => (
                    <p key={j} className="text-[9px] text-foreground/80">+ {c}</p>
                  ))}
                </div>
              )}

              {s.keyNews.length > 0 && (
                <div className="space-y-0.5">
                  <span className="text-[8px] text-muted-foreground uppercase">Noticias clave</span>
                  {s.keyNews.slice(0, 2).map((n, j) => (
                    <p key={j} className="text-[9px] text-muted-foreground">- {n}</p>
                  ))}
                </div>
              )}

              {s.suggestedTickers.length > 0 && (
                <div className="flex flex-wrap gap-1 pt-1">
                  {s.suggestedTickers.map((t, j) => (
                    <Button
                      key={j}
                      size="sm"
                      variant="outline"
                      className="h-5 text-[9px] px-1.5 font-mono"
                      onClick={() => addToWatchlist.mutate({ symbol: t })}
                    >
                      {t} +
                    </Button>
                  ))}
                </div>
              )}

              {s.riskFactors.length > 0 && (
                <div className="space-y-0.5">
                  <span className="text-[8px] text-red-500 uppercase">Riesgos</span>
                  {s.riskFactors.map((r, j) => (
                    <p key={j} className="text-[9px] text-muted-foreground">- {r}</p>
                  ))}
                </div>
              )}
            </CardContent>
          </Card>
        ))}
      </div>
    </div>
  );
}
```

- [ ] **Step 2: Move SectorImpactsSection to appear before MarketReportSection in DailySummary**

In the `DailySummary` return JSX (around line 633), reorder:

```tsx
<MarketReportSection date={selectedDate} />
{isToday && <SectorImpactsSection />}
{isToday && <MarketDigestPanel />}
```

Change to:

```tsx
{isToday && <SectorImpactsSection />}
<MarketReportSection date={selectedDate} />
{isToday && <MarketDigestPanel />}
```

- [ ] **Step 3: Verify frontend TypeScript compiles**

```bash
cd apps/frontend && npx tsc --noEmit
```

Expected: no errors.

- [ ] **Step 4: Start dev server and verify visually**

```bash
npm run dev
```

Navigate to the Resumen del día tab. Confirm:
- Sector cards appear at the top (before market report)
- Each card shows: impact badge + convicción badge, summary, tension warning (if any), catalysts block (green), keyNews, ticker buttons, riskFactors
- Existing ticker add-to-watchlist buttons still work

- [ ] **Step 5: Commit**

```bash
git add apps/frontend/src/daily/DailySummary.tsx
git commit -m "feat(ui): upgrade SectorImpactsSection with catalysts/tension/conviccion, move before market report"
```

---

## Self-Review

**Spec coverage:**
- [x] New `getFilteredArticlesForSectorSynthesis()` query — Task 3
- [x] Extend `SectorReport` with `catalysts`/`conviccion`/`tension` — Task 2
- [x] DB migration for new columns — Task 1 + Task 5 Step 2
- [x] Rewrite prompt (single call, rich article input) — Task 4
- [x] `sectorIntelligence` as pipeline stage after macroIntelligence — Task 5
- [x] Remove `runSectorAnalysis` from `refreshNewsProcess` — Task 5 Step 7
- [x] `sectorIntelligence` added to `PipelineRun.stages` — Task 2
- [x] Frontend catalysts/tension/conviccion UI — Task 6
- [x] Frontend position moved before market report — Task 6 Step 2

**Placeholder scan:** None found. All steps include exact code.

**Type consistency:**
- `SectorReport.catalysts: string[]` used consistently in Task 2 type, Task 3 insert/get, Task 4 service, Task 6 UI
- `SectorReport.conviccion: 'alta' | 'media' | 'baja'` used consistently
- `sectorIntelligence` stage key used in Task 2 (PipelineRun type), Task 5 (schema + repository + service)
- `updatePipelineStage` union extended in Task 5 Step 3 before it's called in Task 5 Step 4
