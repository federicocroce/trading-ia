# Pipeline BD-First Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Encadenar los 3 procesos (Actualizar noticias → Analizar → Generar Reporte) en un pipeline orquestado con estado granular, persistencia en BD, y frontend con historial completo de ejecuciones y re-run por stage.

**Architecture:** Un nuevo `pipeline.service.ts` orquesta los 3 stages leyendo timestamps de `pipeline_runs`. El market-report refactorizado lee `newsArticles`, `opportunitySnapshots`, `sectorImpacts` y `fundamentalCache` de la BD en vez de re-fetchear APIs externas. Todo hardcoding (themes, keywords, sectors, feeds) pasa a tablas de configuración con seed inicial.

**Tech Stack:** TypeScript, Drizzle ORM + SQLite, tRPC, React + shadcn/ui, Zod

---

## File Map

### Backend — crear
- `apps/backend/src/intelligence/pipeline.service.ts` — orquesta los 3 stages, escribe/lee `pipeline_runs`
- `apps/backend/src/intelligence/pipeline.repository.ts` — CRUD para `pipeline_runs` y `market_reports`
- `apps/backend/src/db/seed-config.ts` — seed de tablas de configuración

### Backend — modificar
- `apps/backend/src/db/schema.ts` — 7 tablas nuevas + columna `status` en `opportunity_scans`
- `apps/backend/src/intelligence/intelligence.router.ts` — endpoints `pipelineRun`, `pipelineHistory`, `pipelineStatus`, `rerunStage`
- `apps/backend/src/intelligence/market-report.service.ts` — refactor BD-first completo
- `apps/backend/src/news/sources/rss.adapter.ts` — feeds desde `news_sources` BD
- `apps/backend/src/news/sources/newsapi.adapter.ts` — keywords desde `news_search_keywords` BD
- `apps/backend/src/news/news-aggregator.service.ts` — sector/argentina tickers desde `symbols` BD
- `apps/backend/src/news/news-intelligence.service.ts` — sentiment keywords desde `sentiment_keywords` BD
- `apps/backend/src/intelligence/sector-report.service.ts` — sector tickers desde `sector_tickers` BD
- `apps/backend/src/discovery/discovery-registry.ts` — sector_mappings desde BD
- `apps/backend/src/discovery/asset-classifier.ts` — exchange_mappings desde BD
- `apps/backend/src/db/repository.ts` — funciones helper para nuevas tablas

### Frontend — crear
- `apps/frontend/src/pipeline/usePipeline.ts` — hook central con polling + mutations
- `apps/frontend/src/pipeline/PipelineStatusButton.tsx` — botón header con color estado
- `apps/frontend/src/pipeline/PipelineHistoryModal.tsx` — modal historial + re-run
- `apps/frontend/src/pipeline/PipelineStatusToast.tsx` — toast flotante durante ejecución

### Frontend — modificar
- `apps/frontend/src/daily/MarketReportView.tsx` — usar `usePipeline().run()`
- `apps/frontend/src/App.tsx` — agregar `PipelineStatusButton` al header

### Shared — modificar
- `packages/shared/src/types/intelligence.ts` — tipos `PipelineRun`, `StageResult`, `StageStatus`

---

## Task 1: DB Schema — 7 tablas nuevas + migración

**Files:**
- Modify: `apps/backend/src/db/schema.ts`

- [ ] **Step 1: Agregar las 7 tablas nuevas y la columna status en opportunityScans**

Abrir `apps/backend/src/db/schema.ts` y agregar al final del archivo (antes del último export si hay uno):

```typescript
// --- Market themes (reemplaza THEMATIC_QUERIES hardcodeadas) ---
export const marketThemes = sqliteTable('market_themes', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  name: text('name').notNull(),
  queryKeywords: text('query_keywords').notNull(),
  active: integer('active', { mode: 'boolean' }).notNull().default(true),
  createdAt: text('created_at').notNull().default(sql`(datetime('now'))`),
});

// --- News sources configurables (reemplaza RSS_FEEDS hardcodeadas) ---
export const newsSources = sqliteTable('news_sources', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  name: text('name').notNull(),
  type: text('type', { enum: ['rss', 'newsapi', 'finnhub'] }).notNull(),
  url: text('url'),
  active: integer('active', { mode: 'boolean' }).notNull().default(true),
  priority: integer('priority').notNull().default(0),
  createdAt: text('created_at').notNull().default(sql`(datetime('now'))`),
});

// --- Keywords para búsqueda en NewsAPI ---
export const newsSearchKeywords = sqliteTable('news_search_keywords', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  keyword: text('keyword').notNull(),
  category: text('category'),
  priority: integer('priority').notNull().default(0),
  active: integer('active', { mode: 'boolean' }).notNull().default(true),
});

// --- Keywords para análisis de sentimiento ---
export const sentimentKeywords = sqliteTable('sentiment_keywords', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  keyword: text('keyword').notNull(),
  language: text('language', { enum: ['en', 'es'] }).notNull().default('en'),
  sentiment: text('sentiment', { enum: ['positive', 'negative'] }).notNull(),
  impactLevel: text('impact_level', { enum: ['high', 'medium'] }),
  weight: real('weight').notNull().default(1.0),
  active: integer('active', { mode: 'boolean' }).notNull().default(true),
});

// --- Tickers sugeridos por sector ---
export const sectorTickers = sqliteTable('sector_tickers', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  sector: text('sector').notNull(),
  ticker: text('ticker').notNull(),
  weight: real('weight').notNull().default(1.0),
  relevance: text('relevance', { enum: ['primary', 'secondary'] }).notNull().default('primary'),
  updatedAt: text('updated_at').notNull().default(sql`(datetime('now'))`),
});

// --- Reportes de mercado generados (persistencia) ---
export const marketReports = sqliteTable('market_reports', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  generatedAt: text('generated_at').notNull(),
  status: text('status', { enum: ['ok', 'partial', 'failed'] }).notNull(),
  macroContext: text('macro_context'),
  portfolioImpact: text('portfolio_impact'),
  themes: text('themes'),                      // JSON
  topRecommendations: text('top_recommendations'), // JSON
  alternatives: text('alternatives'),           // JSON
  scenarios: text('scenarios'),                 // JSON
  avoidList: text('avoid_list'),               // JSON
  engine: text('engine'),
  errors: text('errors'),                       // JSON array of error strings
  createdAt: text('created_at').notNull().default(sql`(datetime('now'))`),
});

// --- Historial de ejecuciones del pipeline ---
export const pipelineRuns = sqliteTable('pipeline_runs', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  date: text('date').notNull(),               // 'YYYY-MM-DD'
  status: text('status', { enum: ['running', 'ok', 'partial', 'failed'] }).notNull(),
  // Stage: news
  newsStatus: text('news_status', { enum: ['pending', 'running', 'ok', 'partial', 'failed', 'skipped'] }).notNull().default('pending'),
  newsDetail: text('news_detail'),
  newsErrors: text('news_errors'),             // JSON array
  newsStartedAt: text('news_started_at'),
  newsFinishedAt: text('news_finished_at'),
  // Stage: analysis
  analysisStatus: text('analysis_status', { enum: ['pending', 'running', 'ok', 'partial', 'failed', 'skipped'] }).notNull().default('pending'),
  analysisDetail: text('analysis_detail'),
  analysisErrors: text('analysis_errors'),     // JSON array
  analysisStartedAt: text('analysis_started_at'),
  analysisFinishedAt: text('analysis_finished_at'),
  // Stage: report
  reportStatus: text('report_status', { enum: ['pending', 'running', 'ok', 'partial', 'failed', 'skipped'] }).notNull().default('pending'),
  reportDetail: text('report_detail'),
  reportErrors: text('report_errors'),         // JSON array
  reportStartedAt: text('report_started_at'),
  reportFinishedAt: text('report_finished_at'),
  // Overall
  startedAt: text('started_at').notNull(),
  finishedAt: text('finished_at'),
  createdAt: text('created_at').notNull().default(sql`(datetime('now'))`),
});
```

Luego modificar la tabla `opportunityScans` existente agregando la columna `status` después de `engineDetail`:

```typescript
// En opportunityScans, agregar:
status: text('status', { enum: ['ok', 'partial', 'failed'] }).notNull().default('ok'),
```

- [ ] **Step 2: Correr migración Drizzle**

```bash
cd apps/backend && npx drizzle-kit push
```

Expected: migración aplicada sin errores. La BD en `data/trading.db` tiene las 7 tablas nuevas y la columna `status` en `opportunity_scans`.

Verificar:
```bash
cd apps/backend && npx tsx -e "import { db } from './src/db/index.js'; console.log(db.prepare(\"SELECT name FROM sqlite_master WHERE type='table'\").all())"
```

Expected: lista de tablas incluye `market_themes`, `news_sources`, `news_search_keywords`, `sentiment_keywords`, `sector_tickers`, `market_reports`, `pipeline_runs`.

- [ ] **Step 3: Commit**

```bash
cd /Users/federicocroce/Documents/Fede/trading
git add apps/backend/src/db/schema.ts
git commit -m "feat(db): add 7 config tables + pipeline_runs + market_reports schema"
```

---

## Task 2: Shared Types — PipelineRun, StageResult, StageStatus

**Files:**
- Modify: `packages/shared/src/types/intelligence.ts`

- [ ] **Step 1: Agregar los tipos al final del archivo**

Abrir `packages/shared/src/types/intelligence.ts` y agregar al final:

```typescript
// ============================================================
// PIPELINE TYPES
// ============================================================

export type StageStatus = 'pending' | 'running' | 'ok' | 'partial' | 'failed' | 'skipped'

export interface StageResult {
  status: StageStatus
  startedAt: string | null   // ISO datetime
  finishedAt: string | null  // ISO datetime
  detail: string             // "47 artículos. NewsAPI: OK. RSS: FALLÓ (timeout)."
  errors: string[]           // errores individuales no críticos
  criticalError?: string     // error que causó el fallo del stage
}

export interface PipelineRun {
  id: number
  date: string               // 'YYYY-MM-DD'
  status: 'running' | 'ok' | 'partial' | 'failed'
  stages: {
    news: StageResult
    analysis: StageResult
    report: StageResult
  }
  startedAt: string          // ISO datetime
  finishedAt: string | null  // ISO datetime
}
```

También asegurarse que `MarketReport` tenga campo `errors` y `status`. Buscar la interfaz `MarketReport` y agregar si no existe:

```typescript
// En MarketReport, agregar al final de los campos:
status?: 'ok' | 'partial' | 'failed'
errors?: string[]
```

- [ ] **Step 2: Verificar que los tipos compilan**

```bash
cd packages/shared && npx tsc --noEmit
```

Expected: 0 errores.

- [ ] **Step 3: Commit**

```bash
cd /Users/federicocroce/Documents/Fede/trading
git add packages/shared/src/types/intelligence.ts
git commit -m "feat(shared): add PipelineRun, StageResult, StageStatus types"
```

---

## Task 3: seed-config.ts — datos iniciales para tablas de configuración

**Files:**
- Create: `apps/backend/src/db/seed-config.ts`
- Modify: `apps/backend/src/db/index.ts` (o donde se llame el seed al iniciar)

- [ ] **Step 1: Crear seed-config.ts con todos los datos de configuración**

```typescript
// apps/backend/src/db/seed-config.ts
import { db, schema } from './index.js';
import { eq } from 'drizzle-orm';

export async function seedConfigTables() {
  // Solo ejecutar si las tablas están vacías
  const existingThemes = db.select().from(schema.marketThemes).all();
  if (existingThemes.length > 0) return;

  console.log('[Seed] Poblando tablas de configuración...');

  // --- Market Themes (reemplaza THEMATIC_QUERIES) ---
  const themes = [
    { name: 'Geopolítica y conflictos', queryKeywords: 'war conflict sanctions geopolitics military defense' },
    { name: 'Política monetaria', queryKeywords: 'Federal Reserve interest rate inflation central bank ECB' },
    { name: 'Tecnología e IA', queryKeywords: 'artificial intelligence AI semiconductor earnings tech NVIDIA' },
    { name: 'Energía y petróleo', queryKeywords: 'oil price OPEC crude energy natural gas renewable' },
    { name: 'Mercados emergentes y Argentina', queryKeywords: 'Argentina IMF emerging markets Latin America Brazil' },
    { name: 'Comercio y aranceles', queryKeywords: 'tariffs trade war China imports exports supply chain' },
    { name: 'Crypto y fintech', queryKeywords: 'Bitcoin cryptocurrency blockchain DeFi regulation SEC crypto' },
    { name: 'Salud y pharma', queryKeywords: 'FDA approval pharmaceutical biotech drug healthcare' },
    { name: 'Commodities', queryKeywords: 'gold copper lithium uranium commodities mining metals' },
    { name: 'M&A y earnings', queryKeywords: 'merger acquisition earnings report revenue guidance IPO' },
  ];
  for (const t of themes) {
    db.insert(schema.marketThemes).values(t).run();
  }

  // --- News Sources (reemplaza DEFAULT_RSS_FEEDS + adapters) ---
  const sources = [
    { name: 'CNBC Top News', type: 'rss' as const, url: 'https://www.cnbc.com/id/100003114/device/rss/rss.html', priority: 1 },
    { name: 'Yahoo Finance S&P', type: 'rss' as const, url: 'https://feeds.finance.yahoo.com/rss/2.0/headline?s=^GSPC&region=US&lang=en-US', priority: 2 },
    { name: 'MarketWatch', type: 'rss' as const, url: 'https://feeds.marketwatch.com/marketwatch/topstories/', priority: 3 },
    { name: 'Investing.com', type: 'rss' as const, url: 'https://www.investing.com/rss/news.rss', priority: 4 },
    { name: 'NewsAPI', type: 'newsapi' as const, url: undefined, priority: 5 },
    { name: 'Finnhub', type: 'finnhub' as const, url: undefined, priority: 6 },
  ];
  for (const s of sources) {
    db.insert(schema.newsSources).values(s).run();
  }

  // --- News Search Keywords (reemplaza FINANCIAL_KEYWORDS) ---
  const searchKeywords = [
    { keyword: 'stock market', category: 'general', priority: 1 },
    { keyword: 'oil price', category: 'energy', priority: 2 },
    { keyword: 'cryptocurrency', category: 'crypto', priority: 3 },
    { keyword: 'Argentina economy', category: 'argentina', priority: 4 },
    { keyword: 'Vaca Muerta', category: 'argentina', priority: 5 },
    { keyword: 'energy sector', category: 'energy', priority: 6 },
    { keyword: 'Federal Reserve', category: 'macro', priority: 7 },
    { keyword: 'interest rate', category: 'macro', priority: 8 },
    { keyword: 'S&P 500', category: 'general', priority: 9 },
    { keyword: 'Bitcoin', category: 'crypto', priority: 10 },
    { keyword: 'Ethereum', category: 'crypto', priority: 11 },
  ];
  for (const k of searchKeywords) {
    db.insert(schema.newsSearchKeywords).values(k).run();
  }

  // --- Sentiment Keywords (reemplaza POSITIVE_KEYWORDS, NEGATIVE_KEYWORDS, HIGH_IMPACT_KEYWORDS) ---
  const positiveEn = [
    'surge', 'surges', 'soar', 'soars', 'rally', 'rallies', 'gain', 'gains', 'jump', 'jumps',
    'rise', 'rises', 'climb', 'climbs', 'boost', 'record high', 'all-time high', 'breakout',
    'upgrade', 'upgrades', 'outperform', 'beat', 'beats', 'strong', 'bullish', 'upbeat',
    'recovery', 'recovers', 'profit', 'profits', 'dividend', 'buyback', 'growth',
    'positive', 'optimism', 'optimistic', 'momentum', 'opportunity', 'upside',
    'acquisition', 'merger', 'partnership', 'expansion', 'innovation',
    'revenue beat', 'earnings beat', 'guidance raise', 'margin expansion',
    'short squeeze', 'golden cross', 'accumulation', 'inflows', 'rebound',
    'approval', 'contract win', 'price target raise', 'overweight',
    'buyback program', 'special dividend', 'stock split',
  ];
  const positiveEs = [
    'sube', 'suba', 'alcista', 'récord', 'crece', 'crecimiento', 'ganancias',
    'mejora', 'repunte', 'impulso', 'oportunidad', 'recuperacion', 'expansion',
    'licitacion exitosa', 'flujo de capitales', 'superavit', 'desregulacion',
    'acuerdo comercial', 'inversion extranjera', 'produccion record',
  ];
  const negativeEn = [
    'crash', 'crashes', 'plunge', 'plunges', 'drop', 'drops', 'fall', 'falls', 'sink', 'sinks',
    'decline', 'declines', 'tumble', 'tumbles', 'slump', 'loss', 'losses', 'sell-off', 'selloff',
    'downgrade', 'downgrades', 'underperform', 'miss', 'misses', 'weak', 'bearish',
    'risk', 'risks', 'warning', 'warns', 'fear', 'fears', 'crisis', 'recession',
    'bankruptcy', 'default', 'layoff', 'layoffs', 'cut', 'cuts', 'fraud', 'investigation',
    'sanction', 'sanctions', 'tariff', 'tariffs', 'inflation', 'shutdown',
    'profit warning', 'guidance cut', 'margin compression', 'debt restructuring',
    'death cross', 'distribution', 'outflows', 'delisting', 'sec probe',
    'class action', 'recall', 'supply disruption', 'margin call',
    'price target cut', 'underweight', 'downside', 'headwinds',
  ];
  const negativeEs = [
    'baja', 'bajista', 'caída', 'pérdida', 'pérdidas', 'riesgo', 'crisis',
    'toma de ganancias', 'presion vendedora', 'riesgo pais', 'dolar blue',
    'brecha cambiaria', 'cepo', 'default', 'devaluacion', 'inflacion',
    'conflicto gremial', 'paro', 'embargo', 'deuda soberana',
  ];
  // High impact keywords (cross-listed with positive/negative, marked with impactLevel)
  const highImpactTerms = new Set([
    'crash', 'surge', 'record', 'all-time', 'bankruptcy', 'merger', 'acquisition',
    'fed', 'interest rate', 'earnings', 'guidance', 'tariff', 'sanction', 'war',
    'crisis', 'default', 'rally', 'breakout', 'plunge',
    'fed rate', 'rate cut', 'rate hike', 'quantitative', 'stimulus',
    'opec', 'embargo', 'invasion', 'ceasefire', 'election',
    'devaluation', 'devaluacion', 'riesgo pais',
  ]);

  for (const kw of positiveEn) {
    db.insert(schema.sentimentKeywords).values({
      keyword: kw, language: 'en', sentiment: 'positive',
      impactLevel: highImpactTerms.has(kw) ? 'high' : null,
    }).run();
  }
  for (const kw of positiveEs) {
    db.insert(schema.sentimentKeywords).values({
      keyword: kw, language: 'es', sentiment: 'positive',
      impactLevel: highImpactTerms.has(kw) ? 'high' : null,
    }).run();
  }
  for (const kw of negativeEn) {
    db.insert(schema.sentimentKeywords).values({
      keyword: kw, language: 'en', sentiment: 'negative',
      impactLevel: highImpactTerms.has(kw) ? 'high' : null,
    }).run();
  }
  for (const kw of negativeEs) {
    db.insert(schema.sentimentKeywords).values({
      keyword: kw, language: 'es', sentiment: 'negative',
      impactLevel: highImpactTerms.has(kw) ? 'high' : null,
    }).run();
  }

  // --- Sector Tickers (reemplaza hardcoding en sector-report.service.ts y market-report.service.ts) ---
  const sectorTickersData = [
    { sector: 'Defensa', ticker: 'LMT', relevance: 'primary' as const },
    { sector: 'Defensa', ticker: 'RTX', relevance: 'primary' as const },
    { sector: 'Defensa', ticker: 'NOC', relevance: 'primary' as const },
    { sector: 'Defensa', ticker: 'GD', relevance: 'secondary' as const },
    { sector: 'Defensa', ticker: 'BA', relevance: 'secondary' as const },
    { sector: 'Semiconductores', ticker: 'NVDA', relevance: 'primary' as const },
    { sector: 'Semiconductores', ticker: 'TSM', relevance: 'primary' as const },
    { sector: 'Semiconductores', ticker: 'AMD', relevance: 'primary' as const },
    { sector: 'Semiconductores', ticker: 'INTC', relevance: 'secondary' as const },
    { sector: 'Semiconductores', ticker: 'ASML', relevance: 'secondary' as const },
    { sector: 'Petroleo', ticker: 'XOM', relevance: 'primary' as const },
    { sector: 'Petroleo', ticker: 'CVX', relevance: 'primary' as const },
    { sector: 'Petroleo', ticker: 'COP', relevance: 'primary' as const },
    { sector: 'Petroleo', ticker: 'SLB', relevance: 'secondary' as const },
    { sector: 'Petroleo', ticker: 'OXY', relevance: 'secondary' as const },
    { sector: 'Banca', ticker: 'JPM', relevance: 'primary' as const },
    { sector: 'Banca', ticker: 'BAC', relevance: 'primary' as const },
    { sector: 'Banca', ticker: 'GS', relevance: 'primary' as const },
    { sector: 'Banca', ticker: 'GGAL', relevance: 'primary' as const },
    { sector: 'Banca', ticker: 'BMA', relevance: 'primary' as const },
    { sector: 'Tech/IA', ticker: 'MSFT', relevance: 'primary' as const },
    { sector: 'Tech/IA', ticker: 'GOOGL', relevance: 'primary' as const },
    { sector: 'Tech/IA', ticker: 'AMZN', relevance: 'primary' as const },
    { sector: 'Tech/IA', ticker: 'META', relevance: 'primary' as const },
    { sector: 'Tech/IA', ticker: 'AAPL', relevance: 'primary' as const },
    { sector: 'Crypto', ticker: 'COIN', relevance: 'primary' as const },
    { sector: 'Crypto', ticker: 'MARA', relevance: 'primary' as const },
    { sector: 'Crypto', ticker: 'RIOT', relevance: 'secondary' as const },
    { sector: 'Crypto', ticker: 'MSTR', relevance: 'secondary' as const },
    { sector: 'Pharma', ticker: 'PFE', relevance: 'primary' as const },
    { sector: 'Pharma', ticker: 'JNJ', relevance: 'primary' as const },
    { sector: 'Pharma', ticker: 'LLY', relevance: 'primary' as const },
    { sector: 'Pharma', ticker: 'ABBV', relevance: 'secondary' as const },
    { sector: 'Pharma', ticker: 'MRK', relevance: 'secondary' as const },
    { sector: 'Cybersecurity', ticker: 'CRWD', relevance: 'primary' as const },
    { sector: 'Cybersecurity', ticker: 'PANW', relevance: 'primary' as const },
    { sector: 'Cybersecurity', ticker: 'FTNT', relevance: 'secondary' as const },
    { sector: 'Cybersecurity', ticker: 'ZS', relevance: 'secondary' as const },
  ];
  for (const st of sectorTickersData) {
    db.insert(schema.sectorTickers).values(st).run();
  }

  console.log('[Seed] Tablas de configuración pobladas.');
}
```

- [ ] **Step 2: Llamar seedConfigTables al iniciar el backend**

Abrir el archivo donde se inicializa la BD (probablemente `apps/backend/src/db/index.ts` o `apps/backend/src/index.ts`). Buscar la llamada al seed existente y agregar:

```typescript
import { seedConfigTables } from './db/seed-config.js';
// ... después de la inicialización de la BD:
await seedConfigTables();
```

- [ ] **Step 3: Verificar que el seed corre sin errores**

```bash
cd apps/backend && npx tsx src/db/seed-config.ts
```

Expected: `[Seed] Tablas de configuración pobladas.` sin errores.

- [ ] **Step 4: Commit**

```bash
cd /Users/federicocroce/Documents/Fede/trading
git add apps/backend/src/db/seed-config.ts apps/backend/src/db/index.ts
git commit -m "feat(db): seed config tables — themes, keywords, sources, sector tickers"
```

---

## Task 4: pipeline.repository.ts — CRUD para pipeline_runs y market_reports

**Files:**
- Create: `apps/backend/src/intelligence/pipeline.repository.ts`

- [ ] **Step 1: Crear el archivo**

```typescript
// apps/backend/src/intelligence/pipeline.repository.ts
import { eq, desc, and } from 'drizzle-orm';
import { db, schema } from '../db/index.js';
import type { PipelineRun, StageResult, StageStatus } from '@trading/shared';

function stageResultFromRow(
  status: string,
  detail: string | null,
  errors: string | null,
  startedAt: string | null,
  finishedAt: string | null,
): StageResult {
  return {
    status: (status ?? 'pending') as StageStatus,
    detail: detail ?? '',
    errors: errors ? (JSON.parse(errors) as string[]) : [],
    startedAt: startedAt ?? null,
    finishedAt: finishedAt ?? null,
  };
}

function rowToPipelineRun(row: typeof schema.pipelineRuns.$inferSelect): PipelineRun {
  return {
    id: row.id,
    date: row.date,
    status: row.status,
    startedAt: row.startedAt,
    finishedAt: row.finishedAt ?? null,
    stages: {
      news: stageResultFromRow(row.newsStatus, row.newsDetail, row.newsErrors, row.newsStartedAt, row.newsFinishedAt),
      analysis: stageResultFromRow(row.analysisStatus, row.analysisDetail, row.analysisErrors, row.analysisStartedAt, row.analysisFinishedAt),
      report: stageResultFromRow(row.reportStatus, row.reportDetail, row.reportErrors, row.reportStartedAt, row.reportFinishedAt),
    },
  };
}

export function createPipelineRun(date: string): PipelineRun {
  const now = new Date().toISOString();
  const result = db.insert(schema.pipelineRuns).values({
    date,
    status: 'running',
    newsStatus: 'pending',
    analysisStatus: 'pending',
    reportStatus: 'pending',
    startedAt: now,
  }).returning().get();
  return rowToPipelineRun(result);
}

export function getPipelineRunByDate(date: string): PipelineRun | null {
  const row = db.select().from(schema.pipelineRuns)
    .where(eq(schema.pipelineRuns.date, date))
    .orderBy(desc(schema.pipelineRuns.createdAt))
    .get();
  return row ? rowToPipelineRun(row) : null;
}

export function getActivePipelineRun(): PipelineRun | null {
  const row = db.select().from(schema.pipelineRuns)
    .where(eq(schema.pipelineRuns.status, 'running'))
    .orderBy(desc(schema.pipelineRuns.createdAt))
    .get();
  return row ? rowToPipelineRun(row) : null;
}

export function getPipelineHistory(limit = 7): PipelineRun[] {
  const rows = db.select().from(schema.pipelineRuns)
    .orderBy(desc(schema.pipelineRuns.createdAt))
    .limit(limit)
    .all();
  return rows.map(rowToPipelineRun);
}

export function updatePipelineStage(
  runId: number,
  stage: 'news' | 'analysis' | 'report',
  result: Partial<StageResult>,
) {
  const prefix = stage;
  const updates: Record<string, unknown> = {};
  if (result.status !== undefined) updates[`${prefix}Status`] = result.status;
  if (result.detail !== undefined) updates[`${prefix}Detail`] = result.detail;
  if (result.errors !== undefined) updates[`${prefix}Errors`] = JSON.stringify(result.errors);
  if (result.startedAt !== undefined) updates[`${prefix}StartedAt`] = result.startedAt;
  if (result.finishedAt !== undefined) updates[`${prefix}FinishedAt`] = result.finishedAt;
  db.update(schema.pipelineRuns).set(updates).where(eq(schema.pipelineRuns.id, runId)).run();
}

export function finishPipelineRun(runId: number, status: 'ok' | 'partial' | 'failed') {
  db.update(schema.pipelineRuns).set({
    status,
    finishedAt: new Date().toISOString(),
  }).where(eq(schema.pipelineRuns.id, runId)).run();
}

export function markOrphanedRunsFailed() {
  const fifteenMinutesAgo = new Date(Date.now() - 15 * 60 * 1000).toISOString();
  db.update(schema.pipelineRuns)
    .set({ status: 'failed', reportErrors: JSON.stringify(['Proceso interrumpido (reinicio del servidor)']), finishedAt: new Date().toISOString() })
    .where(and(
      eq(schema.pipelineRuns.status, 'running'),
    ))
    .run();
  // Solo los que llevan más de 15 min corriendo
  const orphans = db.select().from(schema.pipelineRuns)
    .where(eq(schema.pipelineRuns.status, 'running'))
    .all()
    .filter(r => r.startedAt < fifteenMinutesAgo);
  for (const o of orphans) {
    db.update(schema.pipelineRuns).set({
      status: 'failed',
      finishedAt: new Date().toISOString(),
    }).where(eq(schema.pipelineRuns.id, o.id)).run();
  }
}

// --- Market Reports ---

export function saveMarketReport(data: {
  status: 'ok' | 'partial' | 'failed';
  macroContext?: string;
  portfolioImpact?: string;
  themes?: unknown;
  topRecommendations?: unknown;
  alternatives?: unknown;
  scenarios?: unknown;
  avoidList?: unknown;
  engine?: string;
  errors?: string[];
}) {
  return db.insert(schema.marketReports).values({
    generatedAt: new Date().toISOString(),
    status: data.status,
    macroContext: data.macroContext,
    portfolioImpact: data.portfolioImpact,
    themes: data.themes ? JSON.stringify(data.themes) : null,
    topRecommendations: data.topRecommendations ? JSON.stringify(data.topRecommendations) : null,
    alternatives: data.alternatives ? JSON.stringify(data.alternatives) : null,
    scenarios: data.scenarios ? JSON.stringify(data.scenarios) : null,
    avoidList: data.avoidList ? JSON.stringify(data.avoidList) : null,
    engine: data.engine,
    errors: data.errors ? JSON.stringify(data.errors) : null,
  }).returning().get();
}

export function getLatestMarketReport() {
  const row = db.select().from(schema.marketReports)
    .orderBy(desc(schema.marketReports.createdAt))
    .get();
  if (!row) return null;
  return {
    ...row,
    themes: row.themes ? JSON.parse(row.themes) : null,
    topRecommendations: row.topRecommendations ? JSON.parse(row.topRecommendations) : null,
    alternatives: row.alternatives ? JSON.parse(row.alternatives) : null,
    scenarios: row.scenarios ? JSON.parse(row.scenarios) : null,
    avoidList: row.avoidList ? JSON.parse(row.avoidList) : null,
    errors: row.errors ? JSON.parse(row.errors) : [],
  };
}

export function getTodayMarketReport() {
  const today = new Date().toISOString().split('T')[0];
  const row = db.select().from(schema.marketReports)
    .where(eq(schema.marketReports.generatedAt, today))
    .orderBy(desc(schema.marketReports.createdAt))
    .get();
  if (!row) return null;
  return {
    ...row,
    themes: row.themes ? JSON.parse(row.themes) : null,
    topRecommendations: row.topRecommendations ? JSON.parse(row.topRecommendations) : null,
    alternatives: row.alternatives ? JSON.parse(row.alternatives) : null,
    scenarios: row.scenarios ? JSON.parse(row.scenarios) : null,
    avoidList: row.avoidList ? JSON.parse(row.avoidList) : null,
    errors: row.errors ? JSON.parse(row.errors) : [],
  };
}
```

- [ ] **Step 2: Verificar que compila**

```bash
cd apps/backend && npx tsc --noEmit
```

Expected: 0 errores relacionados con `pipeline.repository.ts`.

- [ ] **Step 3: Commit**

```bash
cd /Users/federicocroce/Documents/Fede/trading
git add apps/backend/src/intelligence/pipeline.repository.ts
git commit -m "feat(intelligence): add pipeline.repository — CRUD for pipeline_runs and market_reports"
```

---

## Task 5: DB repository helpers para tablas de configuración

**Files:**
- Modify: `apps/backend/src/db/repository.ts`

- [ ] **Step 1: Agregar funciones helper al final de repository.ts**

Abrir `apps/backend/src/db/repository.ts` y agregar al final:

```typescript
// ==================== CONFIG TABLES ====================

export function getActiveMarketThemes() {
  return db.select().from(schema.marketThemes)
    .where(eq(schema.marketThemes.active, true))
    .all();
}

export function getActiveNewsSources(type?: 'rss' | 'newsapi' | 'finnhub') {
  if (type) {
    return db.select().from(schema.newsSources)
      .where(and(eq(schema.newsSources.active, true), eq(schema.newsSources.type, type)))
      .orderBy(schema.newsSources.priority)
      .all();
  }
  return db.select().from(schema.newsSources)
    .where(eq(schema.newsSources.active, true))
    .orderBy(schema.newsSources.priority)
    .all();
}

export function getActiveNewsSearchKeywords() {
  return db.select().from(schema.newsSearchKeywords)
    .where(eq(schema.newsSearchKeywords.active, true))
    .orderBy(schema.newsSearchKeywords.priority)
    .all();
}

export function getActiveSentimentKeywords() {
  return db.select().from(schema.sentimentKeywords)
    .where(eq(schema.sentimentKeywords.active, true))
    .all();
}

export function getSectorTickersBySector(sector: string) {
  return db.select().from(schema.sectorTickers)
    .where(eq(schema.sectorTickers.sector, sector))
    .orderBy(desc(schema.sectorTickers.weight))
    .all();
}

export function getAllSectorTickers() {
  return db.select().from(schema.sectorTickers).all();
}

export function getSymbolsByType(type: 'adr' | 'us' | 'crypto') {
  return db.select().from(schema.symbols)
    .where(and(eq(schema.symbols.type, type), eq(schema.symbols.active, true)))
    .all();
}

export function getSymbolsByMarket(market: string) {
  // market se infiere del campo plaza: 'argentina-*' = argentina
  const argPlazas = ['argentina-energy', 'argentina-finance', 'argentina-cedears'];
  return db.select().from(schema.symbols)
    .where(eq(schema.symbols.active, true))
    .all()
    .filter(s => market === 'argentina'
      ? argPlazas.includes(s.plaza)
      : !argPlazas.includes(s.plaza));
}

export function getNewsArticlesForToday(minImpact?: 'high' | 'medium') {
  const today = new Date().toISOString().split('T')[0];
  const rows = db.select().from(schema.newsArticles)
    .where(gte(schema.newsArticles.publishedAt, today))
    .orderBy(desc(schema.newsArticles.publishedAt))
    .all();
  if (!minImpact) return rows;
  const order = { high: 2, medium: 1, low: 0 };
  const minLevel = order[minImpact] ?? 0;
  return rows.filter(r => {
    const level = order[(r.impact ?? 'low') as keyof typeof order] ?? 0;
    return level >= minLevel;
  });
}

export function getSectorImpactsForToday() {
  const today = new Date().toISOString().split('T')[0];
  return db.select().from(schema.sectorImpacts)
    .where(eq(schema.sectorImpacts.reportDate, today))
    .all();
}

export function getOpportunitySnapshotsForLatestScan() {
  // Obtener el scan más reciente
  const latestScan = db.select().from(schema.opportunityScans)
    .orderBy(desc(schema.opportunityScans.createdAt))
    .get();
  if (!latestScan) return [];
  return db.select().from(schema.opportunitySnapshots)
    .where(eq(schema.opportunitySnapshots.scanId, latestScan.id))
    .all();
}

export function updateOpportunityScanStatus(scanId: number, status: 'ok' | 'partial' | 'failed') {
  return db.update(schema.opportunityScans)
    .set({ status } as any)
    .where(eq(schema.opportunityScans.id, scanId))
    .run();
}

export function getTodayOpportunityScan() {
  const today = new Date().toISOString().split('T')[0];
  return db.select().from(schema.opportunityScans)
    .where(gte(schema.opportunityScans.scannedAt, today))
    .orderBy(desc(schema.opportunityScans.createdAt))
    .get();
}
```

- [ ] **Step 2: Verificar que compila**

```bash
cd apps/backend && npx tsc --noEmit
```

Expected: 0 errores.

- [ ] **Step 3: Commit**

```bash
cd /Users/federicocroce/Documents/Fede/trading
git add apps/backend/src/db/repository.ts
git commit -m "feat(db): add repository helpers for config tables and pipeline queries"
```

---

## Task 6: Eliminar hardcoding — news adapters y news-intelligence

**Files:**
- Modify: `apps/backend/src/news/sources/rss.adapter.ts`
- Modify: `apps/backend/src/news/sources/newsapi.adapter.ts`
- Modify: `apps/backend/src/news/news-intelligence.service.ts`
- Modify: `apps/backend/src/news/news-aggregator.service.ts`

- [ ] **Step 1: rss.adapter.ts — leer feeds de BD**

Reemplazar la función `getFeeds()` y la constante `DEFAULT_RSS_FEEDS`:

```typescript
// Eliminar DEFAULT_RSS_FEEDS array hardcodeado (líneas 6-11)
// Reemplazar getFeeds() con:

import { getActiveNewsSources } from '../../db/repository.js';

function getFeeds(): string[] {
  const envFeeds = process.env.RSS_FEEDS;
  if (envFeeds) {
    return envFeeds.split(',').map((f) => f.trim()).filter(Boolean);
  }
  const dbSources = getActiveNewsSources('rss');
  if (dbSources.length > 0) {
    return dbSources.map(s => s.url!).filter(Boolean);
  }
  // Fallback si BD vacía (primer arranque antes del seed)
  return [
    'https://www.cnbc.com/id/100003114/device/rss/rss.html',
    'https://feeds.finance.yahoo.com/rss/2.0/headline?s=^GSPC&region=US&lang=en-US',
    'https://feeds.marketwatch.com/marketwatch/topstories/',
  ];
}
```

También en `findRelatedSymbols` dentro de `rss.adapter.ts`, reemplazar los aliases hardcodeados de crypto:

```typescript
// Eliminar:
// if (s === 'BTC-USD') variants.push('BTC', 'BITCOIN');
// if (s === 'ETH-USD') variants.push('ETH', 'ETHEREUM');

// Reemplazar por consulta dinámica — los aliases vienen del campo name del symbol:
// La lógica queda igual pero usando el nombre real del símbolo como alias
// Por ahora mantener los aliases comunes como fallback hasta Task 7
```

- [ ] **Step 2: newsapi.adapter.ts — leer keywords de BD**

Reemplazar `FINANCIAL_KEYWORDS` y `buildQuery()`:

```typescript
// Eliminar FINANCIAL_KEYWORDS array hardcodeado (líneas 28-33)
// Agregar import:
import { getActiveNewsSearchKeywords } from '../../db/repository.js';

// Reemplazar buildQuery():
function buildQuery(symbols: string[]): string {
  const dbKeywords = getActiveNewsSearchKeywords();
  const keywords = dbKeywords.length > 0
    ? dbKeywords.slice(0, 3).map(k => k.keyword)
    : ['stock market', 'oil price', 'cryptocurrency']; // fallback

  const tickerNames = symbols
    .filter((s) => !s.includes('-'))
    .slice(0, 5)
    .map((s) => `"${s}"`);

  const parts = [...tickerNames.slice(0, 3), ...keywords];
  return parts.join(' OR ');
}
```

- [ ] **Step 3: news-intelligence.service.ts — leer sentiment keywords de BD**

Reemplazar las constantes `POSITIVE_KEYWORDS`, `NEGATIVE_KEYWORDS`, `HIGH_IMPACT_KEYWORDS` y la función `keywordSentimentAnalysis`:

```typescript
// Eliminar las 3 constantes (líneas 30-75) y reemplazar con:
import { getActiveSentimentKeywords } from '../db/repository.js';

// Cache en memoria para evitar query en cada artículo
let _sentimentCache: {
  positive: Set<string>;
  negative: Set<string>;
  highImpact: Set<string>;
} | null = null;

function getSentimentSets() {
  if (_sentimentCache) return _sentimentCache;
  const keywords = getActiveSentimentKeywords();
  _sentimentCache = {
    positive: new Set(keywords.filter(k => k.sentiment === 'positive').map(k => k.keyword.toLowerCase())),
    negative: new Set(keywords.filter(k => k.sentiment === 'negative').map(k => k.keyword.toLowerCase())),
    highImpact: new Set(keywords.filter(k => k.impactLevel === 'high').map(k => k.keyword.toLowerCase())),
  };
  return _sentimentCache;
}

function keywordSentimentAnalysis(title: string): { sentiment: SentimentType; impact: 'high' | 'medium' | 'low' } {
  const lower = title.toLowerCase();
  const { positive, negative, highImpact } = getSentimentSets();
  let posScore = 0;
  let negScore = 0;

  for (const kw of positive) {
    if (lower.includes(kw)) posScore++;
  }
  for (const kw of negative) {
    if (lower.includes(kw)) negScore++;
  }

  const sentiment: SentimentType = posScore > negScore ? 'positive'
    : negScore > posScore ? 'negative'
    : 'neutral';

  let impact: 'high' | 'medium' | 'low' = 'low';
  for (const kw of highImpact) {
    if (lower.includes(kw)) { impact = 'high'; break; }
  }
  if (impact === 'low' && (posScore + negScore) >= 2) impact = 'medium';

  return { sentiment, impact };
}
```

- [ ] **Step 4: news-aggregator.service.ts — sector y argentina tickers desde BD**

Reemplazar `classifySectors()` y la constante `argTickers`:

```typescript
// Eliminar sectorMap y argTickers hardcodeados (líneas 65-71)
// Agregar import:
import { getSymbolsByMarket } from '../db/repository.js';

function classifySectors(relatedTickers: string[]): string[] {
  const sectors = new Set<string>();
  // Obtener tickers argentinos dinámicamente
  const argSymbols = getSymbolsByMarket('argentina').map(s => s.symbol);

  for (const ticker of relatedTickers) {
    if (ticker === 'BTC-USD' || ticker === 'ETH-USD') sectors.add('crypto');
    if (argSymbols.includes(ticker)) sectors.add('argentina');
  }
  if (sectors.size === 0) sectors.add('global');
  return Array.from(sectors);
}
```

- [ ] **Step 5: Verificar que compila**

```bash
cd apps/backend && npx tsc --noEmit
```

Expected: 0 errores.

- [ ] **Step 6: Commit**

```bash
cd /Users/federicocroce/Documents/Fede/trading
git add apps/backend/src/news/
git commit -m "refactor(news): replace hardcoded keywords/feeds/sectors with DB queries"
```

---

## Task 7: Eliminar hardcoding — sector-report, discovery, scoring

**Files:**
- Modify: `apps/backend/src/intelligence/sector-report.service.ts`
- Modify: `apps/backend/src/discovery/discovery-registry.ts`
- Modify: `apps/backend/src/discovery/asset-classifier.ts`

- [ ] **Step 1: sector-report.service.ts — sector tickers desde BD**

Encontrar el bloque de LLM prompt con los ejemplos hardcodeados (líneas ~67-75) y reemplazar la parte estática con datos dinámicos:

```typescript
import { getAllSectorTickers } from '../db/repository.js';

// En la función que construye el prompt, reemplazar el bloque hardcodeado de ejemplos:
// Eliminar: "- Defensa: LMT, RTX, NOC, GD, BA\n- Semiconductores: ..."

// Reemplazar con:
const allSectorTickers = getAllSectorTickers();
const sectorExamples = Object.entries(
  allSectorTickers.reduce((acc, st) => {
    if (!acc[st.sector]) acc[st.sector] = [];
    acc[st.sector].push(st.ticker);
    return acc;
  }, {} as Record<string, string[]>)
).map(([sector, tickers]) => `- ${sector}: ${tickers.join(', ')}`).join('\n');

// Usar sectorExamples en el prompt en lugar del string hardcodeado
```

- [ ] **Step 2: discovery-registry.ts — sector classifications desde BD**

En `mapClassificationToSector()` (líneas ~187-189), reemplazar la lógica hardcodeada de sectores argentinos:

```typescript
import { getAllSectorTickers } from '../db/repository.js';

// Las sector classifications para Argentina (Petróleo, Energía → argentina-energy)
// se mantienen en código porque son mappings de nombres de industria a plaza,
// no de tickers a sectores. Estos son estables y correctos.
// Lo que SÍ se elimina es la lista hardcodeada de sector_tickers en los prompts.
// No modificar esta función — ya es correcta y dinámica en su lógica.
```

> Nota: La función `mapClassificationToSector` en discovery-registry.ts es lógica de clasificación de activos, no una lista hardcodeada de tickers. Se puede dejar como está — es correcto y estable.

- [ ] **Step 3: asset-classifier.ts — exchange mappings como constante documentada**

Las listas `argExchanges` y `usExchanges` (líneas 158-161) son mappings estándar de códigos de bolsa. Son datos de referencia que no cambian con el portfolio del usuario. Documentarlos como constantes permanentes en lugar de moverlos a BD (son lookup tables de infraestructura, no configuración de usuario):

```typescript
// En asset-classifier.ts, agregar comentario encima de las constantes:
// Exchange codes son estándar ISO — no dependen del portfolio del usuario.
// Actualizarlos requeriría un nuevo exchange, lo cual es un cambio de infraestructura.
const ARG_EXCHANGES = ['BUE', 'BCBA', 'BA'] as const;
const US_EXCHANGES = ['NMS', 'NYQ', 'NGM', 'NCM', 'PCX', 'BTS', 'ASE'] as const;
// (renombrar las variables locales para que sean constantes de módulo)
```

- [ ] **Step 4: Verificar que compila**

```bash
cd apps/backend && npx tsc --noEmit
```

Expected: 0 errores.

- [ ] **Step 5: Commit**

```bash
cd /Users/federicocroce/Documents/Fede/trading
git add apps/backend/src/intelligence/sector-report.service.ts apps/backend/src/discovery/
git commit -m "refactor(intelligence): replace hardcoded sector tickers with DB queries"
```

---

## Task 8: market-report.service.ts — refactor BD-first completo

**Files:**
- Modify: `apps/backend/src/intelligence/market-report.service.ts`

- [ ] **Step 1: Reemplazar fetchThematicNews para usar BD + market_themes como fallback**

Reemplazar la función `fetchThematicNews` completa (líneas ~33-75):

```typescript
import {
  getActiveMarketThemes,
  getNewsArticlesForToday,
  getSectorImpactsForToday,
  getOpportunitySnapshotsForLatestScan,
} from '../db/repository.js';
import { saveMarketReport, getLatestMarketReport, getTodayMarketReport } from './pipeline.repository.js';

// Eliminar cachedReport en memoria — ahora persiste en BD
// export function getCachedMarketReport() → leer de BD

export function getCachedMarketReport() {
  return getTodayMarketReport();
}

// Reemplazar fetchThematicNews — ahora usa noticias de BD
async function getNewsContext(): Promise<{
  dbHeadlines: string[];
  thematicContext: Array<{ theme: string; headlines: string[] }>;
}> {
  // 1. Noticias de BD de hoy (alta y media prioridad)
  const todayArticles = getNewsArticlesForToday('medium');
  const dbHeadlines = todayArticles.map(a => a.title).slice(0, 30);

  // 2. Temas activos de BD (reemplaza THEMATIC_QUERIES hardcodeadas)
  const themes = getActiveMarketThemes();

  // 3. Clasificar las noticias de BD por tema
  const thematicContext = themes.map(theme => {
    const keywords = theme.queryKeywords.toLowerCase().split(' ');
    const matchingHeadlines = todayArticles
      .filter(a => keywords.some(kw => a.title.toLowerCase().includes(kw)))
      .map(a => a.title)
      .slice(0, 5);
    return { theme: theme.name, headlines: matchingHeadlines };
  }).filter(t => t.headlines.length > 0);

  // 4. Si hay muy pocas noticias en BD, intentar NewsAPI como suplemento
  if (todayArticles.length < 10) {
    console.warn('[MarketReport] Pocas noticias en BD, intentando NewsAPI...');
    // fetchThematicNewsFromAPI() como fallback opcional
    const apiContext = await fetchThematicNewsFromAPI();
    return { dbHeadlines, thematicContext: [...thematicContext, ...apiContext] };
  }

  return { dbHeadlines, thematicContext };
}

// Mantener fetchThematicNews como fallback (renombrar a fetchThematicNewsFromAPI)
async function fetchThematicNewsFromAPI(): Promise<Array<{ theme: string; headlines: string[] }>> {
  const newsapiKey = process.env.NEWSAPI_API_KEY;
  if (!newsapiKey) return [];
  const themes = getActiveMarketThemes(); // usar BD, no hardcoding
  const results: Array<{ theme: string; headlines: string[] }> = [];

  for (let i = 0; i < themes.length; i += 3) {
    const batch = themes.slice(i, i + 3);
    const fetches = await Promise.allSettled(
      batch.map(async ({ name, queryKeywords }) => {
        const url = `https://newsapi.org/v2/everything?q=${encodeURIComponent(queryKeywords)}&language=en&sortBy=publishedAt&pageSize=8&apiKey=${newsapiKey}`;
        try {
          const res = await fetch(url);
          if (!res.ok) return { theme: name, headlines: [] as string[] };
          const data = (await res.json()) as any;
          if (data.status !== 'ok') return { theme: name, headlines: [] as string[] };
          const headlines = (data.articles ?? [])
            .filter((a: any) => a.title && a.title !== '[Removed]')
            .map((a: any) => a.title as string)
            .slice(0, 5);
          return { theme: name, headlines };
        } catch {
          return { theme: name, headlines: [] as string[] };
        }
      }),
    );
    for (const r of fetches) {
      if (r.status === 'fulfilled' && r.value.headlines.length > 0) results.push(r.value);
    }
  }
  return results;
}
```

- [ ] **Step 2: Refactorizar identifyActiveThemes para usar opportunitySnapshots + sectorImpacts**

En la función `identifyActiveThemes`, después de obtener los temas vía Groq, enriquecerlos con los snapshots ya calculados:

```typescript
async function identifyActiveThemes(
  dbHeadlines: string[],
  thematicNews: Array<{ theme: string; headlines: string[] }>,
): Promise<ThemeAnalysis[]> {
  // Obtener datos de BD para enriquecer el contexto del LLM
  const sectorImpacts = getSectorImpactsForToday();
  const snapshots = getOpportunitySnapshotsForLatestScan();

  // Construir contexto adicional de sectores para el LLM
  const sectorContext = sectorImpacts.length > 0
    ? '\nSECTORES CON ANÁLISIS HOY:\n' + sectorImpacts
        .map(si => `- ${si.sector}: ${si.impact} — ${si.event}`)
        .join('\n')
    : '';

  // Agregar top opportunities al contexto
  const topOpportunities = snapshots
    .filter(s => s.opportunityScore >= 70 && s.recommendation === 'COMPRAR')
    .slice(0, 10)
    .map(s => `${s.symbol} (score: ${s.opportunityScore}, sector: ${s.sector})`)
    .join(', ');
  const opportunityContext = topOpportunities
    ? `\nOPORTUNIDADES IDENTIFICADAS POR ANÁLISIS TÉCNICO:\n${topOpportunities}`
    : '';

  // El resto de la función igual, pero pasando sectorContext + opportunityContext al prompt
  // ... (mantener el prompt LLM existente y agregarle estos contextos)
}
```

- [ ] **Step 3: Refactorizar getFundamentals para usar fundamentalCache primero**

En la función de enriquecimiento (Pasada 3), antes de llamar `getFundamentals`:

```typescript
import { getFundamentalFromCache, saveFundamentalToCache } from '../db/repository.js';

// Reemplazar el loop de getFundamentals con:
async function getEnrichedFundamentals(tickers: string[]): Promise<Record<string, FundamentalData>> {
  const result: Record<string, FundamentalData> = {};
  const toFetch: string[] = [];

  // Primero intentar desde cache de BD
  for (const ticker of tickers) {
    const cached = getFundamentalFromCache(ticker);
    if (cached) {
      result[ticker] = JSON.parse(cached.data) as FundamentalData;
    } else {
      toFetch.push(ticker);
    }
  }

  // Solo fetchear los que no están en cache
  if (toFetch.length > 0) {
    console.log(`[MarketReport] Fetching fundamentals para ${toFetch.length} tickers sin cache`);
    for (const ticker of toFetch) {
      try {
        const fund = await getFundamentals(ticker);
        if (fund) {
          result[ticker] = fund;
          saveFundamentalToCache(ticker, JSON.stringify(fund));
        }
      } catch {
        console.warn(`[MarketReport] No se pudo obtener fundamentals para ${ticker}`);
      }
    }
  }
  return result;
}
```

- [ ] **Step 4: Reemplazar CEDEAR list hardcodeada en prompt**

Buscar el bloque donde se lista CEDEARs en el prompt (línea ~125) y reemplazar:

```typescript
import { getSymbolsByType } from '../db/repository.js';

// En vez de hardcodear:
// "CEDEARs disponibles: LMT, RTX, NOC, ..."
// Usar:
const cedrSymbols = getSymbolsByType('adr').map(s => s.symbol).join(', ');
// Luego en el prompt: `CEDEARs disponibles en portfolio: ${cedrSymbols}`
```

- [ ] **Step 5: Persistir el reporte al final de generateMarketReport**

Al final de `generateMarketReport()`, reemplazar la asignación a `cachedReport`:

```typescript
// Eliminar: cachedReport = report;
// Reemplazar con:
const savedReport = saveMarketReport({
  status: report.status ?? 'ok',
  macroContext: report.macroContext,
  portfolioImpact: report.portfolioImpact,
  themes: report.themes,
  topRecommendations: report.topRecommendations,
  alternatives: report.alternatives,
  scenarios: report.scenarios,
  avoidList: report.avoidList,
  engine: report.engine,
  errors: report.errors ?? [],
});
return { ...report, id: savedReport.id };
```

- [ ] **Step 6: Verificar que compila**

```bash
cd apps/backend && npx tsc --noEmit
```

Expected: 0 errores en market-report.service.ts.

- [ ] **Step 7: Commit**

```bash
cd /Users/federicocroce/Documents/Fede/trading
git add apps/backend/src/intelligence/market-report.service.ts
git commit -m "refactor(market-report): BD-first — read newsArticles/snapshots/fundamentalCache, persist report"
```

---

## Task 9: pipeline.service.ts — orquestador principal

**Files:**
- Create: `apps/backend/src/intelligence/pipeline.service.ts`

- [ ] **Step 1: Crear el archivo**

```typescript
// apps/backend/src/intelligence/pipeline.service.ts
import {
  createPipelineRun,
  getPipelineRunByDate,
  getActivePipelineRun,
  updatePipelineStage,
  finishPipelineRun,
  markOrphanedRunsFailed,
  getPipelineHistory,
} from './pipeline.repository.js';
import { refreshNewsProcess } from '../opportunities/opportunities.service.js';
import { runAnalysis } from '../opportunities/opportunities.service.js';
import { generateMarketReport } from './market-report.service.js';
import { getNewsArticlesForToday, getTodayOpportunityScan } from '../db/repository.js';
import type { PipelineRun, StageResult } from '@trading/shared';

// Inicializar al arrancar el backend
export function initPipeline() {
  markOrphanedRunsFailed();
}

function getToday(): string {
  return new Date().toISOString().split('T')[0];
}

// Verificar si el stage de noticias es válido para hoy
function isNewsStageValid(): boolean {
  const today = getToday();
  const todayArticles = getNewsArticlesForToday();
  if (todayArticles.length < 5) return false;
  const run = getPipelineRunByDate(today);
  if (!run) return false;
  return run.stages.news.status === 'ok' || run.stages.news.status === 'partial';
}

// Verificar si el stage de análisis es válido para hoy
function isAnalysisStageValid(): boolean {
  const today = getToday();
  const scan = getTodayOpportunityScan();
  if (!scan) return false;
  const run = getPipelineRunByDate(today);
  if (!run) return false;
  return run.stages.analysis.status === 'ok' || run.stages.analysis.status === 'partial';
}

// Ejecutar stage de noticias con tracking de errores
async function runNewsStage(runId: number): Promise<StageResult> {
  const startedAt = new Date().toISOString();
  updatePipelineStage(runId, 'news', { status: 'running', startedAt });

  const errors: string[] = [];
  let articleCount = 0;

  try {
    const result = await refreshNewsProcess();
    articleCount = result?.totalArticles ?? 0;

    if (articleCount === 0) {
      const stageResult: StageResult = {
        status: 'failed',
        startedAt,
        finishedAt: new Date().toISOString(),
        detail: 'Sin artículos obtenidos de ninguna fuente.',
        errors: [],
        criticalError: '0 artículos obtenidos — fuentes no disponibles',
      };
      updatePipelineStage(runId, 'news', stageResult);
      return stageResult;
    }

    // Recopilar errores no críticos del resultado
    if (result?.sourceErrors) errors.push(...result.sourceErrors);

    const stageResult: StageResult = {
      status: errors.length > 0 ? 'partial' : 'ok',
      startedAt,
      finishedAt: new Date().toISOString(),
      detail: `${articleCount} artículos obtenidos.${errors.length > 0 ? ` ${errors.length} fuentes con errores.` : ''}`,
      errors,
    };
    updatePipelineStage(runId, 'news', stageResult);
    return stageResult;
  } catch (err) {
    const stageResult: StageResult = {
      status: 'failed',
      startedAt,
      finishedAt: new Date().toISOString(),
      detail: 'Error ejecutando actualización de noticias.',
      errors: [],
      criticalError: (err as Error).message.slice(0, 200),
    };
    updatePipelineStage(runId, 'news', stageResult);
    return stageResult;
  }
}

// Ejecutar stage de análisis con tracking de errores
async function runAnalysisStage(runId: number): Promise<StageResult> {
  const startedAt = new Date().toISOString();
  updatePipelineStage(runId, 'analysis', { status: 'running', startedAt });

  try {
    const result = await runAnalysis();
    const symbolCount = result?.totalSymbolsScanned ?? 0;

    const stageResult: StageResult = {
      status: 'ok',
      startedAt,
      finishedAt: new Date().toISOString(),
      detail: `${symbolCount} símbolos analizados. ${result?.opportunityCount ?? 0} oportunidades encontradas.`,
      errors: [],
    };
    updatePipelineStage(runId, 'analysis', stageResult);
    return stageResult;
  } catch (err) {
    const stageResult: StageResult = {
      status: 'failed',
      startedAt,
      finishedAt: new Date().toISOString(),
      detail: 'Error ejecutando análisis técnico.',
      errors: [],
      criticalError: (err as Error).message.slice(0, 200),
    };
    updatePipelineStage(runId, 'analysis', stageResult);
    return stageResult;
  }
}

// Ejecutar stage de reporte con tracking de errores
async function runReportStage(runId: number): Promise<StageResult> {
  const startedAt = new Date().toISOString();
  updatePipelineStage(runId, 'report', { status: 'running', startedAt });

  try {
    const report = await generateMarketReport();
    const themeCount = (report as any)?.themes?.length ?? 0;
    const reportErrors: string[] = (report as any)?.errors ?? [];

    const stageResult: StageResult = {
      status: reportErrors.length > 0 ? 'partial' : 'ok',
      startedAt,
      finishedAt: new Date().toISOString(),
      detail: `Reporte generado con ${themeCount} temas.${reportErrors.length > 0 ? ` ${reportErrors.length} advertencias.` : ''}`,
      errors: reportErrors,
    };
    updatePipelineStage(runId, 'report', stageResult);
    return stageResult;
  } catch (err) {
    const stageResult: StageResult = {
      status: 'failed',
      startedAt,
      finishedAt: new Date().toISOString(),
      detail: 'Error generando reporte de mercado.',
      errors: [],
      criticalError: (err as Error).message.slice(0, 200),
    };
    updatePipelineStage(runId, 'report', stageResult);
    return stageResult;
  }
}

// Pipeline principal
export async function checkOrRunPipeline(force = false): Promise<PipelineRun> {
  const today = getToday();

  // Evitar concurrencia: si ya hay un run activo, devolverlo
  const activeRun = getActivePipelineRun();
  if (activeRun) return activeRun;

  // Crear nuevo run
  const run = createPipelineRun(today);
  const runId = run.id;

  try {
    // Stage 1: News
    if (!force && isNewsStageValid()) {
      updatePipelineStage(runId, 'news', {
        status: 'skipped',
        startedAt: new Date().toISOString(),
        finishedAt: new Date().toISOString(),
        detail: 'Noticias del día ya disponibles en BD.',
        errors: [],
      });
    } else {
      const newsResult = await runNewsStage(runId);
      if (newsResult.status === 'failed') {
        updatePipelineStage(runId, 'analysis', { status: 'skipped', detail: 'Saltado: noticias fallaron.', errors: [], startedAt: null, finishedAt: null });
        updatePipelineStage(runId, 'report', { status: 'skipped', detail: 'Saltado: noticias fallaron.', errors: [], startedAt: null, finishedAt: null });
        finishPipelineRun(runId, 'failed');
        return getPipelineRunByDate(today)!;
      }
    }

    // Stage 2: Analysis
    if (!force && isAnalysisStageValid()) {
      updatePipelineStage(runId, 'analysis', {
        status: 'skipped',
        startedAt: new Date().toISOString(),
        finishedAt: new Date().toISOString(),
        detail: 'Análisis del día ya disponible en BD.',
        errors: [],
      });
    } else {
      const analysisResult = await runAnalysisStage(runId);
      if (analysisResult.status === 'failed') {
        updatePipelineStage(runId, 'report', { status: 'skipped', detail: 'Saltado: análisis falló.', errors: [], startedAt: null, finishedAt: null });
        finishPipelineRun(runId, 'failed');
        return getPipelineRunByDate(today)!;
      }
    }

    // Stage 3: Report
    await runReportStage(runId);

    // Calcular estado final
    const finalRun = getPipelineRunByDate(today)!;
    const stages = finalRun.stages;
    const allOk = [stages.news, stages.analysis, stages.report].every(s => s.status === 'ok' || s.status === 'skipped');
    const anyFailed = [stages.news, stages.analysis, stages.report].some(s => s.status === 'failed');
    const overallStatus = anyFailed ? 'failed' : allOk ? 'ok' : 'partial';
    finishPipelineRun(runId, overallStatus);

    return getPipelineRunByDate(today)!;
  } catch (err) {
    finishPipelineRun(runId, 'failed');
    throw err;
  }
}

// Re-correr un stage específico
export async function rerunPipelineStage(stage: 'news' | 'analysis' | 'report'): Promise<PipelineRun> {
  const today = getToday();
  const activeRun = getActivePipelineRun();
  if (activeRun) return activeRun;

  const existingRun = getPipelineRunByDate(today);
  const run = existingRun ?? createPipelineRun(today);
  const runId = run.id;

  // Invalidar stages dependientes
  if (stage === 'news') {
    updatePipelineStage(runId, 'analysis', { status: 'pending', detail: 'Pendiente re-run de noticias.', errors: [], startedAt: null, finishedAt: null });
    updatePipelineStage(runId, 'report', { status: 'pending', detail: 'Pendiente re-run de noticias.', errors: [], startedAt: null, finishedAt: null });
    await runNewsStage(runId);
    await runAnalysisStage(runId);
    await runReportStage(runId);
  } else if (stage === 'analysis') {
    updatePipelineStage(runId, 'report', { status: 'pending', detail: 'Pendiente re-run de análisis.', errors: [], startedAt: null, finishedAt: null });
    await runAnalysisStage(runId);
    await runReportStage(runId);
  } else {
    await runReportStage(runId);
  }

  const finalRun = getPipelineRunByDate(today)!;
  const stages = finalRun.stages;
  const allOk = [stages.news, stages.analysis, stages.report].every(s => s.status === 'ok' || s.status === 'skipped');
  const anyFailed = [stages.news, stages.analysis, stages.report].some(s => s.status === 'failed');
  finishPipelineRun(runId, anyFailed ? 'failed' : allOk ? 'ok' : 'partial');

  return getPipelineRunByDate(today)!;
}

export { getPipelineRunByDate, getActivePipelineRun, getPipelineHistory };
```

- [ ] **Step 2: Llamar initPipeline() al arrancar el backend**

En el archivo de entry point del backend (`apps/backend/src/index.ts`):

```typescript
import { initPipeline } from './intelligence/pipeline.service.js';
// Después de inicializar la BD:
initPipeline();
```

- [ ] **Step 3: Verificar que compila**

```bash
cd apps/backend && npx tsc --noEmit
```

Expected: 0 errores.

- [ ] **Step 4: Commit**

```bash
cd /Users/federicocroce/Documents/Fede/trading
git add apps/backend/src/intelligence/pipeline.service.ts apps/backend/src/index.ts
git commit -m "feat(intelligence): add pipeline.service — orchestrates 3-stage pipeline with state tracking"
```

---

## Task 10: intelligence.router.ts — nuevos endpoints

**Files:**
- Modify: `apps/backend/src/intelligence/intelligence.router.ts`

- [ ] **Step 1: Reemplazar el router completo**

```typescript
// apps/backend/src/intelligence/intelligence.router.ts
import { z } from 'zod';
import { router, publicProcedure } from '../trpc.js';
import { getStoredDailyReport } from './daily-report.service.js';
import { getMarketDigest } from '../opportunities/opportunities.service.js';
import { getCachedMarketReport } from './market-report.service.js';
import { getStoredSectorReports } from './sector-report.service.js';
import {
  checkOrRunPipeline,
  rerunPipelineStage,
  getPipelineRunByDate,
  getActivePipelineRun,
  getPipelineHistory,
} from './pipeline.service.js';

export const intelligenceRouter = router({
  dailyReport: publicProcedure.query(() => {
    return getStoredDailyReport();
  }),

  marketDigest: publicProcedure.query(() => {
    return getMarketDigest();
  }),

  marketReport: publicProcedure.query(() => {
    return getCachedMarketReport();
  }),

  // Reemplaza generateMarketReport — ahora dispara el pipeline completo
  generateMarketReport: publicProcedure
    .input(z.object({ force: z.boolean().optional() }).optional())
    .mutation(async ({ input }) => {
      return checkOrRunPipeline(input?.force ?? false);
    }),

  // Estado actual del pipeline (para polling)
  pipelineStatus: publicProcedure.query(() => {
    const today = new Date().toISOString().split('T')[0];
    const active = getActivePipelineRun();
    if (active) return active;
    return getPipelineRunByDate(today);
  }),

  // Historial de runs (últimos 7 días)
  pipelineHistory: publicProcedure
    .input(z.object({ limit: z.number().min(1).max(30).default(7) }).optional())
    .query(({ input }) => {
      return getPipelineHistory(input?.limit ?? 7);
    }),

  // Re-correr un stage específico
  rerunStage: publicProcedure
    .input(z.object({ stage: z.enum(['news', 'analysis', 'report']) }))
    .mutation(async ({ input }) => {
      return rerunPipelineStage(input.stage);
    }),

  sectorReports: publicProcedure.query(() => {
    return getStoredSectorReports();
  }),
});
```

- [ ] **Step 2: Verificar que compila**

```bash
cd apps/backend && npx tsc --noEmit
```

Expected: 0 errores.

- [ ] **Step 3: Iniciar backend y verificar endpoints**

```bash
cd apps/backend && npm run dev
```

En otra terminal:
```bash
curl -s "http://localhost:3001/trpc/intelligence.pipelineStatus?batch=1&input={}" | head -c 200
```

Expected: respuesta JSON (puede ser `null` si no hay runs todavía — eso es correcto).

- [ ] **Step 4: Commit**

```bash
cd /Users/federicocroce/Documents/Fede/trading
git add apps/backend/src/intelligence/intelligence.router.ts
git commit -m "feat(intelligence): add pipelineStatus, pipelineHistory, rerunStage endpoints"
```

---

## Task 11: usePipeline.ts — hook frontend

**Files:**
- Create: `apps/frontend/src/pipeline/usePipeline.ts`

- [ ] **Step 1: Crear el hook**

```typescript
// apps/frontend/src/pipeline/usePipeline.ts
import { useState, useEffect, useRef } from 'react';
import { trpc } from '../trpc';
import type { PipelineRun } from '@trading/shared';

const POLL_INTERVAL_MS = 2000;

export function usePipeline() {
  const utils = trpc.useUtils();
  const [isPolling, setIsPolling] = useState(false);
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);

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
    onSuccess: () => {
      setIsPolling(true);
      utils.intelligence.pipelineStatus.invalidate();
    },
  });

  // Detectar cuando el pipeline termina y parar polling
  useEffect(() => {
    const status = statusQuery.data?.status;
    if (status && status !== 'running') {
      setIsPolling(false);
      utils.intelligence.marketReport.invalidate();
      utils.opportunities.scan.invalidate();
      utils.intelligence.pipelineHistory.invalidate();
    }
  }, [statusQuery.data?.status]);

  const todayRun = statusQuery.data ?? null;
  const isRunning = todayRun?.status === 'running';

  return {
    run: (force = false) => runMutation.mutate({ force }),
    rerunStage: (stage: 'news' | 'analysis' | 'report') => rerunMutation.mutate({ stage }),
    status: todayRun,
    history: historyQuery.data ?? [],
    isRunning,
    todayRun,
    isLoading: statusQuery.isLoading,
  };
}
```

- [ ] **Step 2: Verificar que compila**

```bash
cd apps/frontend && npx tsc --noEmit
```

Expected: 0 errores.

- [ ] **Step 3: Commit**

```bash
cd /Users/federicocroce/Documents/Fede/trading
git add apps/frontend/src/pipeline/usePipeline.ts
git commit -m "feat(frontend): add usePipeline hook with polling and stage re-run"
```

---

## Task 12: PipelineStatusToast.tsx

**Files:**
- Create: `apps/frontend/src/pipeline/PipelineStatusToast.tsx`

- [ ] **Step 1: Crear el componente**

```typescript
// apps/frontend/src/pipeline/PipelineStatusToast.tsx
import type { PipelineRun, StageStatus } from '@trading/shared';

const STAGE_LABELS = {
  news: 'Noticias',
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
    default: return '○';
  }
}

interface Props {
  run: PipelineRun;
}

export function PipelineStatusToast({ run }: Props) {
  if (run.status !== 'running') return null;

  return (
    <div className="fixed bottom-4 right-4 z-50 min-w-[260px] rounded-lg border border-white/10 bg-zinc-900 p-3 shadow-xl">
      <div className="mb-2 text-[11px] font-medium text-zinc-300">
        🔄 Ejecutando pipeline...
      </div>
      {(['news', 'analysis', 'report'] as const).map((stage) => {
        const stageData = run.stages[stage];
        return (
          <div key={stage} className="flex items-center gap-2 py-0.5 text-[11px]">
            <span>{stageIcon(stageData.status)}</span>
            <span className="text-zinc-400">{STAGE_LABELS[stage]}</span>
            {stageData.status === 'running' && (
              <span className="text-zinc-500">en curso...</span>
            )}
            {(stageData.status === 'ok' || stageData.status === 'partial') && stageData.detail && (
              <span className="text-zinc-500 truncate max-w-[150px]">{stageData.detail.split('.')[0]}</span>
            )}
          </div>
        );
      })}
    </div>
  );
}
```

- [ ] **Step 2: Commit**

```bash
cd /Users/federicocroce/Documents/Fede/trading
git add apps/frontend/src/pipeline/PipelineStatusToast.tsx
git commit -m "feat(frontend): add PipelineStatusToast component"
```

---

## Task 13: PipelineHistoryModal.tsx

**Files:**
- Create: `apps/frontend/src/pipeline/PipelineHistoryModal.tsx`

- [ ] **Step 1: Crear el componente**

```typescript
// apps/frontend/src/pipeline/PipelineHistoryModal.tsx
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import type { PipelineRun, StageStatus } from '@trading/shared';

const STAGE_LABELS = {
  news: 'Noticias',
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
    default: return '○';
  }
}

function overallBadge(status: PipelineRun['status']) {
  switch (status) {
    case 'ok': return <Badge className="bg-green-500/20 text-green-400 border-green-500/30">Completo</Badge>;
    case 'partial': return <Badge className="bg-yellow-500/20 text-yellow-400 border-yellow-500/30">Parcial</Badge>;
    case 'failed': return <Badge className="bg-red-500/20 text-red-400 border-red-500/30">Fallido</Badge>;
    case 'running': return <Badge className="bg-blue-500/20 text-blue-400 border-blue-500/30">Ejecutando</Badge>;
  }
}

function formatTime(iso: string | null): string {
  if (!iso) return '—';
  return new Date(iso).toLocaleTimeString('es-AR', { hour: '2-digit', minute: '2-digit' });
}

function formatDate(dateStr: string): string {
  const [, month, day] = dateStr.split('-');
  return `${day}/${month}`;
}

interface Props {
  open: boolean;
  onClose: () => void;
  history: PipelineRun[];
  onRerunStage: (stage: 'news' | 'analysis' | 'report') => void;
  onRerunAll: () => void;
  isRunning: boolean;
}

export function PipelineHistoryModal({ open, onClose, history, onRerunStage, onRerunAll, isRunning }: Props) {
  const today = new Date().toISOString().split('T')[0];

  return (
    <Dialog open={open} onOpenChange={(v) => !v && onClose()}>
      <DialogContent className="max-w-lg max-h-[80vh] overflow-y-auto bg-zinc-950 border-white/10">
        <DialogHeader>
          <DialogTitle className="text-sm font-medium text-zinc-200">
            Historial del Pipeline
          </DialogTitle>
        </DialogHeader>

        <div className="space-y-3 mt-2">
          {history.length === 0 && (
            <p className="text-[11px] text-zinc-500 text-center py-4">Sin ejecuciones registradas.</p>
          )}

          {history.map((run) => {
            const isToday = run.date === today;
            const hasAnyFailed = Object.values(run.stages).some(s => s.status === 'failed');
            const hasAnyPartial = Object.values(run.stages).some(s => s.status === 'partial');

            return (
              <div key={run.id} className="rounded-md border border-white/5 bg-zinc-900/50 p-3">
                {/* Run header */}
                <div className="flex items-center justify-between mb-2">
                  <div className="flex items-center gap-2">
                    <span className="text-[11px] font-medium text-zinc-300">
                      {isToday ? 'Hoy' : ''} {formatDate(run.date)}
                    </span>
                    {overallBadge(run.status)}
                  </div>
                  {(hasAnyFailed || hasAnyPartial) && !isRunning && (
                    <Button
                      size="sm"
                      variant="outline"
                      className="h-6 text-[10px] border-white/10"
                      onClick={onRerunAll}
                    >
                      Re-correr todo
                    </Button>
                  )}
                </div>

                {/* Stages */}
                <div className="space-y-1">
                  {(['news', 'analysis', 'report'] as const).map((stage) => {
                    const s = run.stages[stage];
                    const canRerun = (s.status === 'failed' || s.status === 'partial') && !isRunning;

                    return (
                      <div key={stage} className="flex items-start gap-2 text-[10px]">
                        <span className="mt-0.5 flex-shrink-0">{stageIcon(s.status)}</span>
                        <div className="flex-1 min-w-0">
                          <span className="text-zinc-400 font-medium">{STAGE_LABELS[stage]}</span>
                          {s.startedAt && (
                            <span className="text-zinc-600 ml-1">{formatTime(s.startedAt)}</span>
                          )}
                          {s.detail && (
                            <span className="text-zinc-500 ml-1 truncate block">{s.detail}</span>
                          )}
                          {s.criticalError && (
                            <span className="text-red-400 block mt-0.5">{s.criticalError.slice(0, 80)}</span>
                          )}
                          {s.errors.length > 0 && (
                            <div className="text-yellow-500/70 mt-0.5">
                              {s.errors.slice(0, 2).map((e, i) => (
                                <div key={i}>{e.slice(0, 60)}</div>
                              ))}
                            </div>
                          )}
                        </div>
                        {canRerun && (
                          <Button
                            size="sm"
                            variant="ghost"
                            className="h-5 text-[9px] px-1.5 flex-shrink-0 text-blue-400 hover:text-blue-300"
                            onClick={() => onRerunStage(stage)}
                          >
                            Re-correr ▶
                          </Button>
                        )}
                      </div>
                    );
                  })}
                </div>
              </div>
            );
          })}
        </div>
      </DialogContent>
    </Dialog>
  );
}
```

- [ ] **Step 2: Commit**

```bash
cd /Users/federicocroce/Documents/Fede/trading
git add apps/frontend/src/pipeline/PipelineHistoryModal.tsx
git commit -m "feat(frontend): add PipelineHistoryModal with per-stage re-run"
```

---

## Task 14: PipelineStatusButton.tsx

**Files:**
- Create: `apps/frontend/src/pipeline/PipelineStatusButton.tsx`

- [ ] **Step 1: Crear el componente**

```typescript
// apps/frontend/src/pipeline/PipelineStatusButton.tsx
import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import { usePipeline } from './usePipeline';
import { PipelineHistoryModal } from './PipelineHistoryModal';
import { PipelineStatusToast } from './PipelineStatusToast';

function statusColor(status: string | undefined): string {
  switch (status) {
    case 'ok': return 'text-green-400';
    case 'partial': return 'text-yellow-400';
    case 'failed': return 'text-red-400';
    case 'running': return 'text-blue-400 animate-pulse';
    default: return 'text-zinc-500';
  }
}

function statusDot(status: string | undefined): string {
  switch (status) {
    case 'ok': return '🟢';
    case 'partial': return '🟡';
    case 'failed': return '🔴';
    case 'running': return '🔵';
    default: return '⚪';
  }
}

export function PipelineStatusButton() {
  const [modalOpen, setModalOpen] = useState(false);
  const { status, history, isRunning, run, rerunStage } = usePipeline();

  return (
    <>
      <Tooltip>
        <TooltipTrigger asChild>
          <Button
            variant="ghost"
            size="sm"
            className={`h-7 gap-1.5 text-[11px] px-2 ${statusColor(status?.status)}`}
            onClick={() => setModalOpen(true)}
          >
            <span>{statusDot(status?.status)}</span>
            <span>Pipeline</span>
          </Button>
        </TooltipTrigger>
        <TooltipContent side="bottom" className="text-[10px]">
          {status ? `Último run: ${status.date}` : 'Sin ejecuciones hoy'}
        </TooltipContent>
      </Tooltip>

      <PipelineHistoryModal
        open={modalOpen}
        onClose={() => setModalOpen(false)}
        history={history}
        onRerunStage={rerunStage}
        onRerunAll={() => run(false)}
        isRunning={isRunning}
      />

      {status && isRunning && <PipelineStatusToast run={status} />}
    </>
  );
}
```

- [ ] **Step 2: Commit**

```bash
cd /Users/federicocroce/Documents/Fede/trading
git add apps/frontend/src/pipeline/PipelineStatusButton.tsx
git commit -m "feat(frontend): add PipelineStatusButton with modal and toast integration"
```

---

## Task 15: Integrar PipelineStatusButton en header + actualizar MarketReportView

**Files:**
- Modify: `apps/frontend/src/App.tsx`
- Modify: `apps/frontend/src/daily/MarketReportView.tsx`

- [ ] **Step 1: Agregar PipelineStatusButton al header en App.tsx**

Abrir `apps/frontend/src/App.tsx`. Buscar el bloque del header (donde están los botones de iconos y el `InfraBar` / `ServiceHealthBar`). Agregar el import y el componente:

```typescript
import { PipelineStatusButton } from './pipeline/PipelineStatusButton';

// En el JSX del header, junto a los otros botones del header:
<PipelineStatusButton />
```

- [ ] **Step 2: Actualizar MarketReportView para usar usePipeline**

Abrir `apps/frontend/src/daily/MarketReportView.tsx`. Reemplazar la mutation de `generateMarketReport` por el hook del pipeline:

```typescript
// Eliminar:
// const generate = trpc.intelligence.generateMarketReport.useMutation({ ... });

// Agregar import:
import { usePipeline } from '../pipeline/usePipeline';

// En el componente, reemplazar:
const { run, isRunning } = usePipeline();

// El botón queda:
<Button
  size="sm"
  variant="secondary"
  onClick={() => run()}
  disabled={isRunning}
  className="h-8"
>
  {isRunning ? 'Ejecutando pipeline...' : 'Generar reporte'}
</Button>
```

- [ ] **Step 3: Verificar que compila**

```bash
cd apps/frontend && npx tsc --noEmit
```

Expected: 0 errores.

- [ ] **Step 4: Verificar en el browser**

```bash
cd /Users/federicocroce/Documents/Fede/trading && npm run dev
```

Abrir `http://localhost:5173`. Verificar:
1. Botón "Pipeline" visible en el header con color ⚪ (sin runs)
2. Click en "Pipeline" abre el modal vacío
3. Click en "Generar reporte" muestra el toast flotante
4. El toast desaparece al terminar y el modal muestra el historial

- [ ] **Step 5: Commit final**

```bash
cd /Users/federicocroce/Documents/Fede/trading
git add apps/frontend/src/App.tsx apps/frontend/src/daily/MarketReportView.tsx
git commit -m "feat(frontend): integrate PipelineStatusButton in header, wire MarketReportView to pipeline"
```

---

## Self-Review vs Spec

### Cobertura del spec:

| Requisito | Task |
|---|---|
| Pipeline encadenado (3 stages) | Task 9 |
| Staleness check (corrió hoy + sin errores) | Task 9 |
| Polling con pipelineStatus query | Task 10, 11 |
| PipelineRun types | Task 2 |
| 7 tablas nuevas + status en opportunityScans | Task 1 |
| seed-config.ts con todos los datos | Task 3 |
| repository helpers | Task 5 |
| rss/newsapi leen de BD | Task 6 |
| news-intelligence lee keywords de BD | Task 6 |
| sector-report lee sector_tickers de BD | Task 7 |
| market-report BD-first (newsArticles, snapshots, fundamentalCache) | Task 8 |
| CEDEAR list dinámica desde BD | Task 8 |
| market report persiste en market_reports | Task 8 |
| pipeline.repository CRUD | Task 4 |
| pipeline.service orquestador | Task 9 |
| intelligence.router nuevos endpoints | Task 10 |
| Run huérfano markOrphanedRunsFailed | Task 9 |
| usePipeline hook | Task 11 |
| PipelineStatusToast | Task 12 |
| PipelineHistoryModal con re-run por stage | Task 13 |
| PipelineStatusButton en header | Task 14, 15 |
| Re-run con invalidación en cadena | Task 9 |
| Concurrencia (evitar doble run) | Task 9 |
| Primer uso / BD vacía | Task 8 (fallback a API) |
| Errores críticos vs no críticos | Task 9 |

### Gaps identificados y resueltos:
- `getFundamentalFromCache` y `saveFundamentalToCache` se mencionan en Task 8 — estas funciones ya existen en `repository.ts` según el audit. Verificar en Task 8 que los nombres coincidan exactamente antes de usarlos.
- `refreshNewsProcess` devuelve un resultado con `totalArticles` y `sourceErrors` — si la interfaz actual no incluye esos campos, Task 9 debe adaptarse al shape real del retorno. Verificar al implementar Task 9.
