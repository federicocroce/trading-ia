# Trading Dashboard Audit Fixes - Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Fix all critical bugs, reliability issues, and UX problems identified in the v3 audit to make the trading dashboard production-ready.

**Architecture:** Fix data layer first (positions, news, indexes), then reliability (retry, error propagation, env validation), then frontend (error boundaries, mobile, charts, accessibility). Each phase produces independently valuable improvements.

**Tech Stack:** Hono + tRPC + Drizzle ORM + SQLite (backend), React 19 + Vite + shadcn/ui v4 + TailwindCSS v4 (frontend), Cloudflare Pages + Tunnel (deployment)

---

## Phase 1: Critical Backend Data Fixes

### Task 1: Fix transaction ordering in position rebuild

**Files:**
- Modify: `apps/backend/src/db/repository.ts:208-247`

- [ ] **Step 1: Add ORDER BY to transaction query**

In `rebuildPositionsFromTransactions()`, the transactions query has no ordering. Add `.orderBy(asc(schema.transactions.date))`:

```typescript
// repository.ts line 209 — CHANGE FROM:
const txs = db.select().from(schema.transactions).all();

// TO:
const txs = db.select().from(schema.transactions).orderBy(asc(schema.transactions.date)).all();
```

Ensure `asc` is imported from `drizzle-orm` at the top of the file.

- [ ] **Step 2: Wrap rebuild in a DB transaction**

Wrap the delete + insert loop in a Drizzle transaction to prevent race conditions:

```typescript
export function rebuildPositionsFromTransactions() {
  const txs = db.select().from(schema.transactions).orderBy(asc(schema.transactions.date)).all();

  const map = new Map<string, { quantity: number; totalCost: number }>();

  for (const tx of txs) {
    const entry = map.get(tx.symbol) ?? { quantity: 0, totalCost: 0 };

    if (tx.type === 'BUY') {
      const cost = tx.totalAmount ?? tx.quantity * tx.price;
      entry.totalCost += cost;
      entry.quantity += tx.quantity;
    } else if (tx.type === 'DIVIDEND') {
      entry.quantity += tx.quantity;
    } else if (tx.type === 'SELL') {
      const avgCostBefore = entry.quantity > 0 ? entry.totalCost / entry.quantity : 0;
      entry.quantity -= tx.quantity;
      entry.totalCost = entry.quantity * avgCostBefore;
    }

    map.set(tx.symbol, entry);
  }

  // Atomic: delete all + insert new in single transaction
  db.transaction((trx) => {
    trx.delete(schema.positions).run();
    for (const [symbol, data] of map) {
      if (data.quantity <= 0) continue;
      const avgCost = data.totalCost / data.quantity;
      trx.insert(schema.positions).values({ symbol, quantity: data.quantity, avgCost }).run();
    }
  });

  return map.size;
}
```

- [ ] **Step 3: Verify the backend compiles**

Run: `cd /Users/federicocroce/Documents/Fede/trading && npm run build --workspace=apps/backend`
Expected: Build succeeds

- [ ] **Step 4: Commit**

```bash
git add apps/backend/src/db/repository.ts
git commit -m "fix: add ORDER BY and atomic transaction to position rebuild"
```

---

### Task 2: Fix news insert N+1 query

**Files:**
- Modify: `apps/backend/src/db/repository.ts:286-318`

- [ ] **Step 1: Rewrite insertNewsArticles to use batch dedup**

The function already has `getExistingExternalIds()` at line 327 but doesn't use it. Rewrite:

```typescript
export function insertNewsArticles(articles: Array<{
  externalId: string;
  source: string;
  sourceType: string;
  title: string;
  summary?: string;
  url?: string;
  publishedAt: string;
  relatedSymbols: string[];
}>): number {
  if (articles.length === 0) return 0;

  // Batch check existing IDs instead of N+1 queries
  const existingIds = getExistingExternalIds(articles.map(a => a.externalId));

  let inserted = 0;
  for (const a of articles) {
    if (existingIds.has(a.externalId)) continue;

    db.insert(schema.newsArticles).values({
      externalId: a.externalId,
      source: a.source,
      sourceType: a.sourceType,
      title: a.title,
      summary: a.summary ?? null,
      url: a.url ?? null,
      publishedAt: a.publishedAt,
      relatedSymbols: JSON.stringify(a.relatedSymbols),
    }).run();
    inserted++;
  }
  return inserted;
}
```

- [ ] **Step 2: Verify build**

Run: `npm run build --workspace=apps/backend`

- [ ] **Step 3: Commit**

```bash
git add apps/backend/src/db/repository.ts
git commit -m "perf: batch dedup news articles instead of N+1 queries"
```

---

### Task 3: Add critical database indexes

**Files:**
- Modify: `apps/backend/src/db/schema.ts`

- [ ] **Step 1: Add indexes to schema**

After the table definitions, add Drizzle index definitions. At the end of schema.ts, add:

```typescript
import { index } from 'drizzle-orm/sqlite-core';

// Indexes for performance
export const newsArticlesExternalIdIdx = index('idx_news_external_id').on(newsArticles.externalId);
export const newsArticlesPublishedAtIdx = index('idx_news_published_at').on(newsArticles.publishedAt);
export const transactionsSymbolIdx = index('idx_transactions_symbol').on(transactions.symbol);
export const transactionsDateIdx = index('idx_transactions_date').on(transactions.date);
export const opportunitySnapshotsSymbolIdx = index('idx_opp_snapshots_symbol').on(opportunitySnapshots.symbol);
export const opportunitySnapshotsScannedAtIdx = index('idx_opp_snapshots_scanned').on(opportunitySnapshots.scannedAt);
export const signalTrackingSymbolIdx = index('idx_signal_tracking_symbol').on(signalTracking.symbol);
export const signalTrackingOutcomeIdx = index('idx_signal_tracking_outcome').on(signalTracking.outcome);
export const discoveredSymbolsActiveIdx = index('idx_discovered_active').on(discoveredSymbols.active);
```

NOTE: Drizzle may require indexes to be defined inline in the table or via a migration. If inline indexes are needed, add `.indexes()` to each table. Otherwise, generate a migration.

- [ ] **Step 2: Generate migration**

Run: `cd /Users/federicocroce/Documents/Fede/trading && npx drizzle-kit generate --name add_performance_indexes`

- [ ] **Step 3: Verify migration SQL looks correct**

Check the generated SQL file in `apps/backend/drizzle/` for CREATE INDEX statements.

- [ ] **Step 4: Commit**

```bash
git add apps/backend/src/db/schema.ts apps/backend/drizzle/
git commit -m "perf: add database indexes for news, transactions, signals"
```

---

### Task 4: Fix signal tracking upsert (delete+insert → ON CONFLICT)

**Files:**
- Modify: `apps/backend/src/db/repository.ts:503-537`

- [ ] **Step 1: Replace delete+insert with onConflictDoUpdate or atomic transaction**

Since SQLite ON CONFLICT requires a unique constraint and we don't have one on (symbol, signalDate, outcome='pending'), wrap in transaction instead:

```typescript
export function insertSignalTracking(data: {
  symbol: string;
  signalDate: string;
  action: string;
  entryPrice: number;
  targetPrice?: number | null;
  stopLoss?: number | null;
  confidence: number;
  opportunityScore: number;
  sector?: string | null;
  techScore?: number | null;
  fundScore?: number | null;
  sentScore?: number | null;
  hadDivergences?: boolean | null;
  enrichedByLlm?: boolean | null;
  shortTermScore?: number | null;
  mediumTermScore?: number | null;
  rsiAtSignal?: number | null;
  predictedReturnMid?: number | null;
}) {
  return db.transaction((trx) => {
    trx.delete(schema.signalTracking)
      .where(and(
        eq(schema.signalTracking.symbol, data.symbol),
        eq(schema.signalTracking.signalDate, data.signalDate),
        eq(schema.signalTracking.outcome, 'pending'),
      ))
      .run();

    return trx.insert(schema.signalTracking).values({
      ...data,
      outcome: 'pending',
    }).run();
  });
}
```

- [ ] **Step 2: Verify build**

Run: `npm run build --workspace=apps/backend`

- [ ] **Step 3: Commit**

```bash
git add apps/backend/src/db/repository.ts
git commit -m "fix: atomic transaction for signal tracking upsert"
```

---

### Task 5: Add env validation with Zod

**Files:**
- Create: `apps/backend/src/shared/env.ts`
- Modify: `apps/backend/src/index.ts:1-6`

- [ ] **Step 1: Create env validation file**

```typescript
// apps/backend/src/shared/env.ts
import { z } from 'zod';

const envSchema = z.object({
  PORT: z.coerce.number().default(3001),
  FRONTEND_URL: z.string().default('http://localhost:5173'),

  // AI providers (at least one should be available)
  LMSTUDIO_BASE_URL: z.string().default('http://127.0.0.1:1234/v1'),
  LMSTUDIO_MODEL: z.string().default('local-model'),
  ANTHROPIC_API_KEY: z.string().optional(),
  GROQ_API_KEY: z.string().optional(),
  OPENROUTER_API_KEY: z.string().optional(),

  // Data sources
  FMP_API_KEY: z.string().optional(),
  FINNHUB_API_KEY: z.string().optional(),
  NEWSAPI_API_KEY: z.string().optional(),

  // Database
  DB_PATH: z.string().default('../../data/trading.db'),
});

export type Env = z.infer<typeof envSchema>;

let _env: Env | null = null;

export function validateEnv(): Env {
  const result = envSchema.safeParse(process.env);
  if (!result.success) {
    console.error('Invalid environment variables:');
    for (const issue of result.error.issues) {
      console.error(`  ${issue.path.join('.')}: ${issue.message}`);
    }
    process.exit(1);
  }
  _env = result.data;
  return result.data;
}

export function getEnv(): Env {
  if (!_env) throw new Error('Env not validated. Call validateEnv() first.');
  return _env;
}
```

- [ ] **Step 2: Integrate env validation in index.ts**

Replace the dotenv loading in `apps/backend/src/index.ts` lines 1-6:

```typescript
import dotenv from 'dotenv';
import { resolve } from 'path';

dotenv.config({ path: resolve(process.cwd(), '../../.env') });
dotenv.config();

import { validateEnv } from './shared/env.js';
const env = validateEnv();
```

- [ ] **Step 3: Verify build and startup**

Run: `npm run build --workspace=apps/backend`

- [ ] **Step 4: Commit**

```bash
git add apps/backend/src/shared/env.ts apps/backend/src/index.ts
git commit -m "feat: add Zod env validation at startup"
```

---

### Task 6: Fix portfolio price=0 fallback

**Files:**
- Modify: `apps/backend/src/portfolio/portfolio.service.ts:19`

- [ ] **Step 1: Skip positions with missing prices instead of using 0**

```typescript
// In getPortfolio(), change the position mapping:
const positions: PortfolioPosition[] = [];

for (const pos of dbPositions) {
  const currentPrice = priceMap.get(pos.symbol);
  if (currentPrice === undefined || currentPrice === 0) {
    // Skip positions without valid price data — don't show $0 value
    console.warn(`[Portfolio] No price data for ${pos.symbol}, using avgCost as fallback`);
    const fallbackPrice = pos.avgCost; // Use avgCost as fallback instead of 0
    const value = pos.quantity * fallbackPrice;
    const cost = pos.quantity * pos.avgCost;
    positions.push({
      symbol: pos.symbol,
      quantity: pos.quantity,
      avgCost: pos.avgCost,
      currentPrice: fallbackPrice,
      value,
      pnl: 0,
      pnlPercent: 0,
    });
    totalValue += value;
    totalCost += cost;
    continue;
  }
  const value = pos.quantity * currentPrice;
  const cost = pos.quantity * pos.avgCost;
  const pnl = value - cost;
  const pnlPercent = cost > 0 ? (pnl / cost) * 100 : 0;
  totalValue += value;
  totalCost += cost;
  positions.push({
    symbol: pos.symbol,
    quantity: pos.quantity,
    avgCost: pos.avgCost,
    currentPrice,
    value,
    pnl,
    pnlPercent,
  });
}
```

- [ ] **Step 2: Verify build**

Run: `npm run build --workspace=apps/backend`

- [ ] **Step 3: Commit**

```bash
git add apps/backend/src/portfolio/portfolio.service.ts
git commit -m "fix: use avgCost fallback instead of 0 when price API fails"
```

---

### Task 7: Remove dead code and hardcoded portfolio

**Files:**
- Modify: `packages/shared/src/constants/opportunities.ts`
- Modify: `packages/shared/src/constants/portfolio.ts`
- Modify: `packages/shared/src/constants/index.ts`

- [ ] **Step 1: Clean up opportunities.ts**

Remove deprecated empty arrays and null-returning functions. Keep only what's actively used (OPPORTUNITY_UNIVERSE if used for sector labels):

```typescript
// packages/shared/src/constants/opportunities.ts
// Keep sector labels if used by UI, remove dead symbol arrays
export const OPPORTUNITY_SECTORS = [
  'argentina-finance',
  'argentina-cedears',
  'argentina-energy',
  'us-tech',
  'us-energy',
  'us-finance',
  'crypto',
  'emerging-markets',
  'global',
  'commodities',
] as const;

export type OpportunitySector = (typeof OPPORTUNITY_SECTORS)[number];
```

- [ ] **Step 2: Remove hardcoded portfolio from constants**

The portfolio should come from the database. Check if `PORTFOLIO_POSITIONS` from `portfolio.ts` is actually imported anywhere. If not, delete the file. If it's used as a seed, add a comment.

Search for imports: `grep -r "PORTFOLIO_POSITIONS\|from.*constants/portfolio" apps/ packages/`

If unused, delete `packages/shared/src/constants/portfolio.ts` and remove its export from `packages/shared/src/constants/index.ts`.

- [ ] **Step 3: Verify build across all workspaces**

Run: `npm run build`

- [ ] **Step 4: Commit**

```bash
git add packages/shared/src/constants/
git commit -m "refactor: remove dead code and hardcoded portfolio from shared constants"
```

---

## Phase 2: Backend Reliability

### Task 8: Add retry logic with exponential backoff for external APIs

**Files:**
- Create: `apps/backend/src/shared/retry.ts`
- Modify: `apps/backend/src/shared/yahoo.ts`

- [ ] **Step 1: Create generic retry utility**

```typescript
// apps/backend/src/shared/retry.ts
export interface RetryOptions {
  maxRetries?: number;
  baseDelayMs?: number;
  maxDelayMs?: number;
}

export async function withRetry<T>(
  fn: () => Promise<T>,
  label: string,
  opts: RetryOptions = {},
): Promise<T> {
  const { maxRetries = 3, baseDelayMs = 1000, maxDelayMs = 10000 } = opts;

  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    try {
      return await fn();
    } catch (err) {
      const isLast = attempt === maxRetries;
      if (isLast) throw err;

      const delay = Math.min(baseDelayMs * 2 ** attempt, maxDelayMs);
      console.warn(`[${label}] Attempt ${attempt + 1} failed, retrying in ${delay}ms...`);
      await new Promise((r) => setTimeout(r, delay));
    }
  }
  throw new Error('Unreachable');
}
```

- [ ] **Step 2: Apply retry to Yahoo Finance**

Wrap `getQuote` fetch call in retry:

```typescript
// In yahoo.ts getQuote function, wrap the fetch:
import { withRetry } from './retry.js';

// Inside getQuote:
const res = await withRetry(
  () => fetch(url, { headers: YAHOO_HEADERS }),
  `Yahoo:${symbol}`,
  { maxRetries: 2, baseDelayMs: 1000 },
);
```

- [ ] **Step 3: Verify build**

Run: `npm run build --workspace=apps/backend`

- [ ] **Step 4: Commit**

```bash
git add apps/backend/src/shared/retry.ts apps/backend/src/shared/yahoo.ts
git commit -m "feat: add exponential backoff retry for external API calls"
```

---

### Task 9: Propagate data quality indicators to frontend

**Files:**
- Modify: `packages/shared/src/types/opportunity.ts` (add `dataQuality` field)
- Modify: `apps/backend/src/opportunities/opportunities.service.ts`

- [ ] **Step 1: Add dataQuality to Opportunity type**

Add to the Opportunity interface in shared types:

```typescript
dataQuality?: {
  enrichedByLlm: boolean;
  llmProvider?: string; // 'lmstudio' | 'groq' | 'openrouter' | 'algorithmic'
  priceAge?: number; // seconds since last price update
  newsCount?: number; // articles analyzed
};
```

- [ ] **Step 2: Populate dataQuality in opportunities service**

When building opportunity objects, include the data quality metadata from the enrichment step.

- [ ] **Step 3: Verify build**

Run: `npm run build`

- [ ] **Step 4: Commit**

```bash
git add packages/shared/src/types/opportunity.ts apps/backend/src/opportunities/opportunities.service.ts
git commit -m "feat: propagate data quality indicators to frontend"
```

---

### Task 10: Fix discovered symbols DB-side filtering

**Files:**
- Modify: `apps/backend/src/db/repository.ts` (getActiveDiscoveredSymbols function)

- [ ] **Step 1: Move expiry filter from JS to SQL WHERE clause**

```typescript
export function getActiveDiscoveredSymbols() {
  const now = new Date().toISOString();
  return db.select().from(schema.discoveredSymbols)
    .where(and(
      eq(schema.discoveredSymbols.active, true),
      gt(schema.discoveredSymbols.expiresAt, now),
    ))
    .all();
}
```

Make sure `gt` is imported from `drizzle-orm`.

- [ ] **Step 2: Verify build**

Run: `npm run build --workspace=apps/backend`

- [ ] **Step 3: Commit**

```bash
git add apps/backend/src/db/repository.ts
git commit -m "perf: filter discovered symbols in SQL instead of JS"
```

---

## Phase 3: Frontend Fundamentals

### Task 11: Add global Error Boundary

**Files:**
- Create: `apps/frontend/src/shared/ErrorBoundary.tsx`
- Modify: `apps/frontend/src/main.tsx`

- [ ] **Step 1: Create ErrorBoundary component**

```tsx
// apps/frontend/src/shared/ErrorBoundary.tsx
import { Component, type ReactNode, type ErrorInfo } from 'react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';

interface Props {
  children: ReactNode;
  fallback?: ReactNode;
}

interface State {
  hasError: boolean;
  error: Error | null;
}

export class ErrorBoundary extends Component<Props, State> {
  state: State = { hasError: false, error: null };

  static getDerivedStateFromError(error: Error): State {
    return { hasError: true, error };
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error('[ErrorBoundary]', error, info.componentStack);
  }

  render() {
    if (this.state.hasError) {
      return this.props.fallback ?? (
        <div className="flex items-center justify-center min-h-screen bg-background p-4">
          <Card className="max-w-md w-full">
            <CardHeader>
              <CardTitle className="text-destructive">Error inesperado</CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              <p className="text-sm text-muted-foreground">
                {this.state.error?.message ?? 'Algo salio mal'}
              </p>
              <Button onClick={() => { this.setState({ hasError: false, error: null }); window.location.reload(); }}>
                Recargar pagina
              </Button>
            </CardContent>
          </Card>
        </div>
      );
    }
    return this.props.children;
  }
}
```

- [ ] **Step 2: Wrap App in ErrorBoundary in main.tsx**

```tsx
import { ErrorBoundary } from './shared/ErrorBoundary';

// In the render tree, wrap <App /> with <ErrorBoundary>:
<ErrorBoundary>
  <App />
</ErrorBoundary>
```

- [ ] **Step 3: Verify frontend compiles**

Run: `npm run build --workspace=apps/frontend`

- [ ] **Step 4: Commit**

```bash
git add apps/frontend/src/shared/ErrorBoundary.tsx apps/frontend/src/main.tsx
git commit -m "feat: add global ErrorBoundary with recovery UI"
```

---

### Task 12: Make Sidebar collapsible for mobile

**Files:**
- Modify: `apps/frontend/src/layout/Sidebar.tsx`
- Modify: `apps/frontend/src/App.tsx`

- [ ] **Step 1: Add collapse state to App.tsx**

Add a `sidebarOpen` state and toggle button:

```tsx
const [sidebarOpen, setSidebarOpen] = useState(true);
```

Pass `sidebarOpen` and `setSidebarOpen` as props to Sidebar and add a hamburger toggle in the header area.

- [ ] **Step 2: Make Sidebar responsive**

```tsx
// Sidebar.tsx — wrap the outer div with conditional classes:
<div className={cn(
  'border-r border-border bg-card flex flex-col transition-all duration-200',
  open ? 'w-64' : 'w-0 overflow-hidden',
  'lg:w-64', // Always show on large screens
)}>
```

- [ ] **Step 3: Add mobile overlay backdrop**

When sidebar is open on mobile, show a backdrop overlay:

```tsx
{open && (
  <div
    className="fixed inset-0 bg-black/50 z-40 lg:hidden"
    onClick={() => setOpen(false)}
  />
)}
```

- [ ] **Step 4: Add hamburger button to Header**

```tsx
<Button variant="ghost" size="icon" className="lg:hidden" onClick={() => setSidebarOpen(!sidebarOpen)}>
  <Menu className="h-5 w-5" />
</Button>
```

Import `Menu` from `lucide-react`.

- [ ] **Step 5: Verify frontend compiles and layout works**

Run: `npm run dev --workspace=apps/frontend` and test on narrow viewport.

- [ ] **Step 6: Commit**

```bash
git add apps/frontend/src/layout/Sidebar.tsx apps/frontend/src/App.tsx apps/frontend/src/layout/Header.tsx
git commit -m "feat: collapsible sidebar with mobile hamburger menu"
```

---

### Task 13: Add skeleton loaders for main views

**Files:**
- Create: `apps/frontend/src/shared/Skeleton.tsx`
- Modify: `apps/frontend/src/portfolio/PortfolioTable.tsx`
- Modify: `apps/frontend/src/opportunities/OpportunityDashboard.tsx`

- [ ] **Step 1: Create skeleton components**

```tsx
// apps/frontend/src/shared/Skeleton.tsx
export function TableSkeleton({ rows = 5, cols = 6 }: { rows?: number; cols?: number }) {
  return (
    <div className="space-y-2 p-4">
      {Array.from({ length: rows }).map((_, i) => (
        <div key={i} className="flex gap-4">
          {Array.from({ length: cols }).map((_, j) => (
            <div key={j} className="h-4 bg-muted animate-pulse rounded flex-1" />
          ))}
        </div>
      ))}
    </div>
  );
}

export function CardSkeleton() {
  return (
    <div className="rounded-lg border border-border bg-card p-4 space-y-3">
      <div className="flex justify-between">
        <div className="h-5 w-24 bg-muted animate-pulse rounded" />
        <div className="h-5 w-16 bg-muted animate-pulse rounded" />
      </div>
      <div className="h-3 w-full bg-muted animate-pulse rounded" />
      <div className="h-3 w-3/4 bg-muted animate-pulse rounded" />
      <div className="flex gap-2">
        <div className="h-6 w-20 bg-muted animate-pulse rounded" />
        <div className="h-6 w-20 bg-muted animate-pulse rounded" />
        <div className="h-6 w-20 bg-muted animate-pulse rounded" />
      </div>
    </div>
  );
}

export function CardGridSkeleton({ count = 6 }: { count?: number }) {
  return (
    <div className="grid grid-cols-1 md:grid-cols-2 gap-4 p-4">
      {Array.from({ length: count }).map((_, i) => (
        <CardSkeleton key={i} />
      ))}
    </div>
  );
}
```

- [ ] **Step 2: Replace "Cargando..." text in PortfolioTable**

```tsx
// In PortfolioTable.tsx, replace loading state:
if (portfolioQuery.isLoading) return <TableSkeleton rows={5} cols={8} />;
```

- [ ] **Step 3: Replace loading in OpportunityDashboard**

```tsx
if (isLoading) return <CardGridSkeleton count={6} />;
```

- [ ] **Step 4: Verify frontend compiles**

Run: `npm run build --workspace=apps/frontend`

- [ ] **Step 5: Commit**

```bash
git add apps/frontend/src/shared/Skeleton.tsx apps/frontend/src/portfolio/PortfolioTable.tsx apps/frontend/src/opportunities/OpportunityDashboard.tsx
git commit -m "feat: add skeleton loaders for portfolio table and opportunity cards"
```

---

### Task 14: Integrate WebSocket for real-time prices

**Files:**
- Modify: `apps/frontend/src/layout/Sidebar.tsx`
- Modify: `apps/frontend/src/shared/useWebSocket.ts`

- [ ] **Step 1: Verify WebSocket hook returns usable price data**

Read `useWebSocket.ts` to confirm it parses price messages. The hook already exists and returns `{ prices, connected }`.

- [ ] **Step 2: Use WebSocket prices in Sidebar**

Instead of polling every 60s, merge WebSocket real-time prices with the initial tRPC query:

```tsx
// In Sidebar.tsx:
import { useWebSocket } from '@/shared/useWebSocket';

// Inside component:
const { prices: wsPrices, connected } = useWebSocket();

// Merge WS prices with tRPC prices:
const mergedPrices = useMemo(() => {
  if (!data) return [];
  return data.map(stock => {
    const wsPrice = wsPrices.get(stock.symbol);
    if (wsPrice) {
      return { ...stock, current: wsPrice.current, change: wsPrice.change, changePercent: wsPrice.changePercent };
    }
    return stock;
  });
}, [data, wsPrices]);
```

- [ ] **Step 3: Show connection status indicator**

Add a small dot indicator showing WebSocket connection status:

```tsx
<div className={cn('h-2 w-2 rounded-full', connected ? 'bg-trading-green' : 'bg-trading-red')} />
```

- [ ] **Step 4: Reduce HTTP polling interval since WS provides real-time**

Change `refetchInterval: 60_000` to `refetchInterval: 5 * 60_000` (5 min as fallback only).

- [ ] **Step 5: Verify and commit**

```bash
git add apps/frontend/src/layout/Sidebar.tsx apps/frontend/src/shared/useWebSocket.ts
git commit -m "feat: integrate WebSocket for real-time prices, reduce HTTP polling"
```

---

### Task 15: Add progressive disclosure to OpportunityCards

**Files:**
- Modify: `apps/frontend/src/opportunities/OpportunityCard.tsx`

- [ ] **Step 1: Split card into summary and details sections**

Add an `expanded` state. Show only essential info by default (symbol, action, score, conviction), hide the rest behind "Ver mas":

```tsx
const [expanded, setExpanded] = useState(false);
```

Top section (always visible):
- Symbol + action badge + score
- Conviction tier
- Short-term return estimate (one line)

Collapsed section (behind button):
- Signal breakdowns (technical/fundamental/sentiment)
- Reasoning, catalysts, risks
- Trade levels, timing
- Deep analysis

```tsx
<Button
  variant="ghost"
  size="sm"
  onClick={() => setExpanded(!expanded)}
  className="w-full text-xs text-muted-foreground"
>
  {expanded ? 'Ver menos' : 'Ver mas detalles'}
</Button>
```

- [ ] **Step 2: Verify the card is scannable**

Each card should be readable in under 3 seconds without expanding. Test by visual inspection.

- [ ] **Step 3: Commit**

```bash
git add apps/frontend/src/opportunities/OpportunityCard.tsx
git commit -m "feat: progressive disclosure on opportunity cards"
```

---

## Phase 4: Chart & Visualization Upgrades

### Task 16: Replace Recharts with TradingView Lightweight Charts

**Files:**
- Modify: `apps/frontend/package.json` (add `lightweight-charts`)
- Modify: `apps/frontend/src/prices/PriceChart.tsx`

- [ ] **Step 1: Install lightweight-charts**

Run: `cd /Users/federicocroce/Documents/Fede/trading && npm install lightweight-charts --workspace=apps/frontend`

- [ ] **Step 2: Rewrite PriceChart with TradingView**

Replace the Recharts implementation with lightweight-charts. Create a candlestick chart with volume subplot:

```tsx
import { createChart, type IChartApi, type ISeriesApi, ColorType } from 'lightweight-charts';
import { useEffect, useRef } from 'react';

interface PriceChartProps {
  symbol: string;
  data: Array<{ time: string; open: number; high: number; low: number; close: number; volume?: number }>;
}

export function PriceChart({ symbol, data }: PriceChartProps) {
  const chartContainerRef = useRef<HTMLDivElement>(null);
  const chartRef = useRef<IChartApi | null>(null);

  useEffect(() => {
    if (!chartContainerRef.current || data.length === 0) return;

    const chart = createChart(chartContainerRef.current, {
      layout: {
        background: { type: ColorType.Solid, color: 'transparent' },
        textColor: 'oklch(0.7 0 0)',
      },
      grid: {
        vertLines: { color: 'oklch(0.25 0 0)' },
        horzLines: { color: 'oklch(0.25 0 0)' },
      },
      width: chartContainerRef.current.clientWidth,
      height: 400,
      crosshair: { mode: 0 },
      timeScale: { timeVisible: true },
    });

    const candleSeries = chart.addCandlestickSeries({
      upColor: 'oklch(0.7 0.17 145)',
      downColor: 'oklch(0.65 0.2 25)',
      borderVisible: false,
    });

    candleSeries.setData(data.map(d => ({
      time: d.time,
      open: d.open,
      high: d.high,
      low: d.low,
      close: d.close,
    })));

    // Volume histogram
    if (data.some(d => d.volume)) {
      const volumeSeries = chart.addHistogramSeries({
        priceFormat: { type: 'volume' },
        priceScaleId: 'volume',
      });
      chart.priceScale('volume').applyOptions({
        scaleMargins: { top: 0.8, bottom: 0 },
      });
      volumeSeries.setData(data.filter(d => d.volume).map(d => ({
        time: d.time,
        value: d.volume!,
        color: d.close >= d.open ? 'oklch(0.7 0.17 145 / 0.4)' : 'oklch(0.65 0.2 25 / 0.4)',
      })));
    }

    chartRef.current = chart;

    const handleResize = () => {
      if (chartContainerRef.current) {
        chart.applyOptions({ width: chartContainerRef.current.clientWidth });
      }
    };
    window.addEventListener('resize', handleResize);

    return () => {
      window.removeEventListener('resize', handleResize);
      chart.remove();
    };
  }, [data]);

  return <div ref={chartContainerRef} className="w-full" />;
}
```

- [ ] **Step 3: Remove recharts dependency if no longer needed elsewhere**

Check: `grep -r "from 'recharts'" apps/frontend/src/`

If no other files use recharts: `npm uninstall recharts --workspace=apps/frontend`

- [ ] **Step 4: Verify build**

Run: `npm run build --workspace=apps/frontend`

- [ ] **Step 5: Commit**

```bash
git add apps/frontend/src/prices/PriceChart.tsx apps/frontend/package.json
git commit -m "feat: replace Recharts with TradingView Lightweight Charts (candlestick + volume)"
```

---

### Task 17: Make PortfolioTable responsive

**Files:**
- Modify: `apps/frontend/src/portfolio/PortfolioTable.tsx`

- [ ] **Step 1: Add responsive card layout for mobile**

Show table on desktop (lg+), card layout on mobile:

```tsx
// Desktop: existing table
<div className="hidden lg:block">
  <Table>...</Table>
</div>

// Mobile: card layout
<div className="lg:hidden space-y-2 p-2">
  {positions.map(pos => (
    <Card key={pos.symbol} className="p-3">
      <div className="flex justify-between items-center">
        <span className="font-bold">{pos.symbol}</span>
        <span className={pos.pnl >= 0 ? 'text-trading-green' : 'text-trading-red'}>
          {pos.pnlPercent.toFixed(1)}%
        </span>
      </div>
      <div className="flex justify-between text-xs text-muted-foreground mt-1">
        <span>{pos.quantity} @ ${pos.avgCost.toFixed(2)}</span>
        <span>${pos.value.toFixed(0)}</span>
      </div>
    </Card>
  ))}
</div>
```

- [ ] **Step 2: Verify on narrow viewport**

Run dev server and test at 375px width.

- [ ] **Step 3: Commit**

```bash
git add apps/frontend/src/portfolio/PortfolioTable.tsx
git commit -m "feat: responsive portfolio table with mobile card layout"
```

---

### Task 18: Accessibility quick-wins

**Files:**
- Modify: Multiple frontend files

- [ ] **Step 1: Add aria-labels to icon-only buttons in Header**

```tsx
// Header.tsx — change single-letter buttons:
<Button aria-label="Actualizar noticias" ...>N</Button>
<Button aria-label="Actualizar fundamentales" ...>F</Button>
<Button aria-label="Actualizar analisis" ...>A</Button>
```

- [ ] **Step 2: Add color-not-only indicators**

For P&L values, add arrow icons alongside color:

```tsx
import { TrendingUp, TrendingDown } from 'lucide-react';

{pnl >= 0 ? <TrendingUp className="h-3 w-3 inline" /> : <TrendingDown className="h-3 w-3 inline" />}
```

- [ ] **Step 3: Add focus-visible ring to interactive elements in globals.css**

```css
/* In globals.css @layer base */
*:focus-visible {
  outline: 2px solid oklch(0.65 0.15 250);
  outline-offset: 2px;
}
```

- [ ] **Step 4: Add skip-to-content link**

```tsx
// In App.tsx, as first child of the layout:
<a href="#main-content" className="sr-only focus:not-sr-only focus:absolute focus:top-2 focus:left-2 focus:z-50 focus:bg-primary focus:text-primary-foreground focus:px-4 focus:py-2 focus:rounded">
  Ir al contenido principal
</a>
// And add id="main-content" to the main content area
```

- [ ] **Step 5: Verify and commit**

```bash
git add apps/frontend/src/
git commit -m "feat: accessibility improvements (aria-labels, focus rings, skip-to-content)"
```

---

## Phase 5: Deployment

### Task 19: Setup Cloudflare Pages deployment

**Files:**
- Create: `apps/frontend/.cloudflare/` config (if needed)
- Modify: `apps/frontend/vite.config.ts` (production API URL)

- [ ] **Step 1: Add environment-aware API URL**

```typescript
// vite.config.ts — update proxy config for production:
// The proxy is dev-only. For production, frontend needs absolute URL to backend.
// Add to vite.config.ts:
define: {
  'import.meta.env.VITE_API_URL': JSON.stringify(process.env.VITE_API_URL || ''),
},
```

- [ ] **Step 2: Update tRPC client to use configurable URL**

```typescript
// shared/trpc.ts
export function getTRPCClient() {
  const baseUrl = import.meta.env.VITE_API_URL || '';
  return trpc.createClient({
    links: [
      httpBatchLink({
        url: `${baseUrl}/trpc`,
      }),
    ],
  });
}
```

- [ ] **Step 3: Create _redirects file for SPA routing**

```
# apps/frontend/public/_redirects
/* /index.html 200
```

- [ ] **Step 4: Test production build locally**

```bash
cd /Users/federicocroce/Documents/Fede/trading
npm run build --workspace=apps/frontend
npx serve apps/frontend/dist
```

- [ ] **Step 5: Commit**

```bash
git add apps/frontend/
git commit -m "feat: prepare frontend for Cloudflare Pages deployment"
```

---

### Task 20: Create Cloudflare Tunnel setup script

**Files:**
- Create: `scripts/setup-tunnel.sh`

- [ ] **Step 1: Create setup script**

```bash
#!/bin/bash
# scripts/setup-tunnel.sh
# Setup Cloudflare Tunnel to expose local backend

echo "=== Cloudflare Tunnel Setup ==="
echo ""
echo "Prerequisites:"
echo "  1. Install cloudflared: brew install cloudflared"
echo "  2. Login: cloudflared tunnel login"
echo "  3. Create tunnel: cloudflared tunnel create trading-dashboard"
echo ""
echo "After creating the tunnel, run:"
echo "  cloudflared tunnel route dns trading-dashboard api.yourdomain.com"
echo ""
echo "Then start the tunnel:"
echo "  cloudflared tunnel run --url http://localhost:3001 trading-dashboard"
echo ""
echo "Set VITE_API_URL=https://api.yourdomain.com when building frontend"
```

- [ ] **Step 2: Make executable and commit**

```bash
chmod +x scripts/setup-tunnel.sh
git add scripts/setup-tunnel.sh
git commit -m "docs: add Cloudflare Tunnel setup script"
```

---

## Verification Checklist

After all tasks are complete:

- [ ] Backend builds: `npm run build --workspace=apps/backend`
- [ ] Frontend builds: `npm run build --workspace=apps/frontend`
- [ ] Shared builds: `npm run build --workspace=packages/shared`
- [ ] Backend starts without env errors
- [ ] Portfolio shows correct P&L (test with known transaction)
- [ ] Mobile sidebar collapses
- [ ] OpportunityCards show summary by default
- [ ] Chart shows candlesticks with volume
- [ ] WebSocket connection indicator visible
- [ ] Error boundary catches thrown errors
- [ ] Skeleton loaders show during data fetch
