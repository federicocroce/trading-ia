# ETF Watchlist & Pipeline Integration — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add ETFs as first-class citizens in the recommendation pipeline with a dedicated watchlist table, a new "ETFs" tab in the UI, instrument-type filters in the Opportunities view, and tabbed search in the Watchlist.

**Architecture:** New `etf_watchlist` DB table seeded with ~60 ETFs, completely separate from the `symbols` table (no portfolio/P&L impact). ETF symbols flow into the news aggregator, evidence signals scanner, and opportunity scoring via three additive one-or-two-line changes. New `etf.router.ts` exposes CRUD for the watchlist. Frontend gets an ETF tab and filters.

**Tech Stack:** Drizzle ORM (SQLite), Hono + tRPC, React + Vite, shadcn/ui, TailwindCSS v4

---

## File Map

**Create:**
- `apps/backend/drizzle/0028_etf_watchlist.sql` — migration: table + seed data
- `apps/backend/src/etf/etf.router.ts` — tRPC CRUD router for etf_watchlist
- `apps/frontend/src/etf/ETFWatchlistPage.tsx` — main ETF tab page
- `apps/frontend/src/etf/ETFCard.tsx` — individual ETF card component
- `apps/frontend/src/etf/AddETFModal.tsx` — modal to add a new ETF

**Modify:**
- `apps/backend/src/db/schema.ts` — add `etfWatchlist` table definition
- `apps/backend/src/db/repository.ts` — add 4 ETF watchlist functions
- `apps/backend/src/router.ts` — register `etfRouter`
- `apps/backend/src/news/news-aggregator.service.ts:145` — include ETF symbols
- `apps/backend/src/evidence-signals/symbol-screener.service.ts:61-63` — replace hardcoded array with DB call
- `apps/backend/src/evidence-signals/evidence-signals.service.ts:9,200` — use `getEtfSymbols()` instead of `CURATED_ETF_SYMBOLS`
- `apps/backend/src/opportunities/opportunities.service.ts:264` — add ETF symbols to universe
- `apps/frontend/src/App.tsx` — add "ETFs" tab
- `apps/frontend/src/opportunities/OpportunityDashboard.tsx` — add instrument type filter
- `apps/frontend/src/portfolio/PortfolioTable.tsx` — add tabs + search bar

---

## Task 1: DB Migration — create etf_watchlist table + seed

**Files:**
- Create: `apps/backend/drizzle/0028_etf_watchlist.sql`
- Modify: `apps/backend/drizzle/meta/_journal.json`
- Modify: `apps/backend/src/db/schema.ts`

- [ ] **Step 1: Add table to schema.ts**

Open `apps/backend/src/db/schema.ts`. After the `symbols` table definition (around line 15), add:

```ts
// --- ETF Watchlist (separate from portfolio symbols) ---
export const etfWatchlist = sqliteTable('etf_watchlist', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  symbol: text('symbol').notNull().unique(),
  name: text('name').notNull(),
  category: text('category', {
    enum: ['indices', 'sectores', 'bonos', 'commodities', 'latam', 'internacional', 'crypto', 'factor'],
  }).notNull(),
  description: text('description'),
  active: integer('active', { mode: 'boolean' }).notNull().default(true),
  createdAt: text('created_at').notNull().default(sql`(datetime('now'))`),
});
```

- [ ] **Step 2: Create migration SQL file**

Create `apps/backend/drizzle/0028_etf_watchlist.sql` with this content:

```sql
CREATE TABLE `etf_watchlist` (
  `id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
  `symbol` text NOT NULL,
  `name` text NOT NULL,
  `category` text NOT NULL,
  `description` text,
  `active` integer DEFAULT true NOT NULL,
  `created_at` text DEFAULT (datetime('now')) NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `etf_watchlist_symbol_unique` ON `etf_watchlist` (`symbol`);
--> statement-breakpoint
INSERT INTO `etf_watchlist` (`symbol`, `name`, `category`, `description`) VALUES
  ('SPY', 'SPDR S&P 500 ETF Trust', 'indices', 'Replica las 500 empresas más grandes de EEUU'),
  ('QQQ', 'Invesco QQQ Trust', 'indices', 'Replica el Nasdaq 100, dominado por tecnología'),
  ('IWM', 'iShares Russell 2000 ETF', 'indices', 'Empresas de pequeña capitalización de EEUU'),
  ('DIA', 'SPDR Dow Jones Industrial Average ETF', 'indices', 'Replica el índice Dow Jones de 30 empresas'),
  ('VT', 'Vanguard Total World Stock ETF', 'indices', 'Mercado global completo en un solo ETF'),
  ('VTI', 'Vanguard Total Stock Market ETF', 'indices', 'Mercado de acciones de EEUU completo'),
  ('XLK', 'Technology Select Sector SPDR Fund', 'sectores', 'Sector tecnología del S&P 500'),
  ('XLE', 'Energy Select Sector SPDR Fund', 'sectores', 'Sector energía del S&P 500'),
  ('XLF', 'Financial Select Sector SPDR Fund', 'sectores', 'Sector financiero del S&P 500'),
  ('XLV', 'Health Care Select Sector SPDR Fund', 'sectores', 'Sector salud del S&P 500'),
  ('XLI', 'Industrial Select Sector SPDR Fund', 'sectores', 'Sector industrial del S&P 500'),
  ('XLY', 'Consumer Discretionary Select Sector SPDR Fund', 'sectores', 'Consumo discrecional del S&P 500'),
  ('XLP', 'Consumer Staples Select Sector SPDR Fund', 'sectores', 'Consumo básico del S&P 500'),
  ('XLU', 'Utilities Select Sector SPDR Fund', 'sectores', 'Sector utilities del S&P 500'),
  ('XLB', 'Materials Select Sector SPDR Fund', 'sectores', 'Sector materiales del S&P 500'),
  ('XLRE', 'Real Estate Select Sector SPDR Fund', 'sectores', 'Real estate del S&P 500'),
  ('XLC', 'Communication Services Select Sector SPDR Fund', 'sectores', 'Comunicaciones del S&P 500'),
  ('SMH', 'VanEck Semiconductor ETF', 'sectores', 'Sector semiconductores global'),
  ('SOXX', 'iShares Semiconductor ETF', 'sectores', 'Semiconductores con mayor diversificación'),
  ('IBB', 'iShares Biotechnology ETF', 'sectores', 'Sector biotecnología de EEUU'),
  ('TLT', 'iShares 20+ Year Treasury Bond ETF', 'bonos', 'Bonos del tesoro de EEUU a largo plazo'),
  ('IEF', 'iShares 7-10 Year Treasury Bond ETF', 'bonos', 'Bonos del tesoro de EEUU a mediano plazo'),
  ('SHY', 'iShares 1-3 Year Treasury Bond ETF', 'bonos', 'Bonos del tesoro de EEUU a corto plazo'),
  ('AGG', 'iShares Core U.S. Aggregate Bond ETF', 'bonos', 'Mercado de bonos de EEUU completo'),
  ('HYG', 'iShares iBoxx High Yield Corporate Bond ETF', 'bonos', 'Bonos corporativos de alto rendimiento'),
  ('LQD', 'iShares iBoxx Investment Grade Corporate Bond ETF', 'bonos', 'Bonos corporativos investment grade'),
  ('EMB', 'iShares JP Morgan USD Emerging Markets Bond ETF', 'bonos', 'Bonos de mercados emergentes en USD'),
  ('TIP', 'iShares TIPS Bond ETF', 'bonos', 'Bonos indexados a inflación de EEUU'),
  ('GLD', 'SPDR Gold Shares', 'commodities', 'Precio del oro físico'),
  ('SLV', 'iShares Silver Trust', 'commodities', 'Precio de la plata física'),
  ('USO', 'United States Oil Fund', 'commodities', 'Precio del petróleo crudo WTI'),
  ('UNG', 'United States Natural Gas Fund', 'commodities', 'Precio del gas natural'),
  ('CORN', 'Teucrium Corn Fund', 'commodities', 'Precio del maíz'),
  ('WEAT', 'Teucrium Wheat Fund', 'commodities', 'Precio del trigo'),
  ('SOYB', 'Teucrium Soybean Fund', 'commodities', 'Precio de la soja'),
  ('EWZ', 'iShares MSCI Brazil ETF', 'latam', 'Mercado de acciones de Brasil'),
  ('ILF', 'iShares Latin America 40 ETF', 'latam', 'Las 40 mayores empresas de Latinoamérica'),
  ('ARGT', 'Global X MSCI Argentina ETF', 'latam', 'Mercado de acciones de Argentina'),
  ('GXG', 'Global X MSCI Colombia ETF', 'latam', 'Mercado de acciones de Colombia'),
  ('ECH', 'iShares MSCI Chile ETF', 'latam', 'Mercado de acciones de Chile'),
  ('EFA', 'iShares MSCI EAFE ETF', 'internacional', 'Mercados desarrollados fuera de EEUU y Canadá'),
  ('EEM', 'iShares MSCI Emerging Markets ETF', 'internacional', 'Mercados emergentes globales'),
  ('EWJ', 'iShares MSCI Japan ETF', 'internacional', 'Mercado de acciones de Japón'),
  ('EWG', 'iShares MSCI Germany ETF', 'internacional', 'Mercado de acciones de Alemania'),
  ('EWU', 'iShares MSCI United Kingdom ETF', 'internacional', 'Mercado de acciones del Reino Unido'),
  ('FXI', 'iShares China Large-Cap ETF', 'internacional', 'Las mayores empresas de China'),
  ('KWEB', 'KraneShares CSI China Internet ETF', 'internacional', 'Internet y tecnología de China'),
  ('INDA', 'iShares MSCI India ETF', 'internacional', 'Mercado de acciones de India'),
  ('IBIT', 'iShares Bitcoin Trust ETF', 'crypto', 'Bitcoin via ETF aprobado por la SEC'),
  ('FBTC', 'Fidelity Wise Origin Bitcoin Fund', 'crypto', 'Bitcoin via ETF de Fidelity'),
  ('ETHA', 'iShares Ethereum Trust ETF', 'crypto', 'Ethereum via ETF aprobado por la SEC'),
  ('VTV', 'Vanguard Value ETF', 'factor', 'Acciones de valor del mercado EEUU'),
  ('VUG', 'Vanguard Growth ETF', 'factor', 'Acciones de crecimiento del mercado EEUU'),
  ('VIG', 'Vanguard Dividend Appreciation ETF', 'factor', 'Empresas con historial de dividendos crecientes'),
  ('MTUM', 'iShares MSCI USA Momentum Factor ETF', 'factor', 'Acciones con mayor momentum de precio');
```

- [ ] **Step 3: Update migration journal**

Open `apps/backend/drizzle/meta/_journal.json`. Add this entry to the `entries` array:

```json
{
  "idx": 28,
  "version": "6",
  "when": 1746403200000,
  "tag": "0028_etf_watchlist",
  "breakpoints": true
}
```

- [ ] **Step 4: Restart backend and verify**

```bash
cd apps/backend && npm run dev
```

Expected output includes no migration errors. Then verify:

```bash
sqlite3 data/trading.db "SELECT COUNT(*) FROM etf_watchlist;"
```

Expected: `54`

- [ ] **Step 5: Commit**

```bash
git add apps/backend/drizzle/0028_etf_watchlist.sql apps/backend/drizzle/meta/_journal.json apps/backend/src/db/schema.ts
git commit -m "feat(db): add etf_watchlist table with 54 seed ETFs"
```

---

## Task 2: Repository functions for etf_watchlist

**Files:**
- Modify: `apps/backend/src/db/repository.ts`

- [ ] **Step 1: Add import for etfWatchlist schema**

At the top of `apps/backend/src/db/repository.ts`, the import from schema already exists. Ensure `etfWatchlist` is included:

```ts
import { symbols, positions, transactions, etfWatchlist, /* ...rest */ } from './schema.js';
```

- [ ] **Step 2: Add 4 ETF watchlist functions**

At the end of `apps/backend/src/db/repository.ts`, add:

```ts
// ─── ETF Watchlist ────────────────────────────────────────────────────────────

export interface EtfWatchlistEntry {
  id: number;
  symbol: string;
  name: string;
  category: 'indices' | 'sectores' | 'bonos' | 'commodities' | 'latam' | 'internacional' | 'crypto' | 'factor';
  description: string | null;
  active: boolean;
  createdAt: string;
}

export function getEtfWatchlist(): EtfWatchlistEntry[] {
  return db.select().from(etfWatchlist).where(eq(etfWatchlist.active, true)).all() as EtfWatchlistEntry[];
}

export function getEtfSymbols(): string[] {
  return getEtfWatchlist().map((e) => e.symbol);
}

export function addEtfToWatchlist(
  symbol: string,
  name: string,
  category: EtfWatchlistEntry['category'],
  description?: string,
): void {
  db.insert(etfWatchlist).values({ symbol: symbol.toUpperCase(), name, category, description: description ?? null }).run();
}

export function removeEtfFromWatchlist(symbol: string): void {
  db.update(etfWatchlist).set({ active: false }).where(eq(etfWatchlist.symbol, symbol.toUpperCase())).run();
}
```

- [ ] **Step 3: Verify functions compile**

```bash
cd apps/backend && npx tsc --noEmit 2>&1 | head -20
```

Expected: no errors related to repository.ts

- [ ] **Step 4: Commit**

```bash
git add apps/backend/src/db/repository.ts
git commit -m "feat(db): add getEtfWatchlist, getEtfSymbols, addEtfToWatchlist, removeEtfFromWatchlist"
```

---

## Task 3: Pipeline integration — news + evidence signals + opportunities

**Files:**
- Modify: `apps/backend/src/news/news-aggregator.service.ts`
- Modify: `apps/backend/src/evidence-signals/symbol-screener.service.ts`
- Modify: `apps/backend/src/evidence-signals/evidence-signals.service.ts`
- Modify: `apps/backend/src/opportunities/opportunities.service.ts`

- [ ] **Step 1: Add ETF symbols to news aggregator**

In `apps/backend/src/news/news-aggregator.service.ts`, find the import at the top and add `getEtfSymbols`:

```ts
import { getActiveSymbolList, getAllSymbols, getWebSearchArticlesForDate, getEtfSymbols } from '../db/repository.js';
```

Then on line ~145, change:

```ts
// Before
const symbols = getActiveSymbolList();

// After
const symbols = [...new Set([...getActiveSymbolList(), ...getEtfSymbols()])];
```

- [ ] **Step 2: Replace hardcoded CURATED_ETF_SYMBOLS in symbol-screener.service.ts**

In `apps/backend/src/evidence-signals/symbol-screener.service.ts`:

Add import:
```ts
import { getEtfSymbols } from '../db/repository.js';
```

Replace the hardcoded constant (lines 60-63):
```ts
// Remove this:
// export const CURATED_ETF_SYMBOLS: string[] = [
//   'SPY', 'QQQ', 'IWM', 'XLE', 'XLF', 'XLK', 'XLV', 'XLI', 'XLY', 'GLD', 'TLT',
// ];

// Add this:
export function getCuratedEtfSymbols(): string[] {
  return getEtfSymbols();
}
```

- [ ] **Step 3: Update evidence-signals.service.ts to use new function**

In `apps/backend/src/evidence-signals/evidence-signals.service.ts`:

Change the import on line 9:
```ts
// Before
import { getScreenedSymbols, invalidateScreenerCache, getPeadOverrides, CURATED_ETF_SYMBOLS, type PeadOverride } from './symbol-screener.service.js';

// After
import { getScreenedSymbols, invalidateScreenerCache, getPeadOverrides, getCuratedEtfSymbols, type PeadOverride } from './symbol-screener.service.js';
```

Change line 200:
```ts
// Before
const isEtf = CURATED_ETF_SYMBOLS.includes(symbol);

// After
const isEtf = getCuratedEtfSymbols().includes(symbol);
```

- [ ] **Step 4: Add ETF symbols to opportunity universe**

In `apps/backend/src/opportunities/opportunities.service.ts`, find the import block at top and add:

```ts
import { getPortfolioPositions, getActiveSymbolList, getCausalTickersByDate, getDiscoveredTickers, getEtfSymbols } from '../db/repository.js';
```

Find line ~264:
```ts
// Before
const allSymbols = [...new Set([...portfolioSymbolsList, ...causalTickers, ...discovered])];
console.log(`[opportunities] ${allSymbols.length} simbolos (${portfolioSymbolsList.length} portfolio + ${causalTickers.length} causal + ${discovered.length} descubiertos)`);

// After
const etfSymbols = getEtfSymbols();
const allSymbols = [...new Set([...portfolioSymbolsList, ...causalTickers, ...discovered, ...etfSymbols])];
console.log(`[opportunities] ${allSymbols.length} simbolos (${portfolioSymbolsList.length} portfolio + ${causalTickers.length} causal + ${discovered.length} descubiertos + ${etfSymbols.length} ETFs)`);
```

- [ ] **Step 5: Verify no TypeScript errors**

```bash
cd apps/backend && npx tsc --noEmit 2>&1 | head -20
```

Expected: 0 errors

- [ ] **Step 6: Commit**

```bash
git add apps/backend/src/news/news-aggregator.service.ts apps/backend/src/evidence-signals/symbol-screener.service.ts apps/backend/src/evidence-signals/evidence-signals.service.ts apps/backend/src/opportunities/opportunities.service.ts
git commit -m "feat(pipeline): include ETF watchlist in news, evidence signals, and opportunity scoring"
```

---

## Task 4: tRPC router for ETF watchlist CRUD

**Files:**
- Create: `apps/backend/src/etf/etf.router.ts`
- Modify: `apps/backend/src/router.ts`

- [ ] **Step 1: Create etf.router.ts**

Create `apps/backend/src/etf/etf.router.ts`:

```ts
import { z } from 'zod';
import { TRPCError } from '@trpc/server';
import { router, publicProcedure } from '../trpc.js';
import { getEtfWatchlist, addEtfToWatchlist, removeEtfFromWatchlist } from '../db/repository.js';
import { getAssetProfile } from '../shared/yahoo.js';

const ETF_CATEGORIES = ['indices', 'sectores', 'bonos', 'commodities', 'latam', 'internacional', 'crypto', 'factor'] as const;

export const etfRouter = router({
  getWatchlist: publicProcedure.query(() => getEtfWatchlist()),

  getCategories: publicProcedure.query(() => ETF_CATEGORIES),

  addToWatchlist: publicProcedure
    .input(z.object({
      symbol: z.string().min(1).max(10),
      category: z.enum(ETF_CATEGORIES),
      description: z.string().optional(),
    }))
    .mutation(async ({ input }) => {
      const symbol = input.symbol.toUpperCase();
      const profile = await getAssetProfile(symbol);
      if (!profile) {
        throw new TRPCError({ code: 'BAD_REQUEST', message: `Símbolo ${symbol} no encontrado en Yahoo Finance` });
      }
      const name = profile.longName ?? symbol;
      addEtfToWatchlist(symbol, name, input.category, input.description);
      return { success: true, symbol, name };
    }),

  removeFromWatchlist: publicProcedure
    .input(z.object({ symbol: z.string().min(1).max(10) }))
    .mutation(({ input }) => {
      removeEtfFromWatchlist(input.symbol.toUpperCase());
      return { success: true };
    }),
});
```

- [ ] **Step 2: Register etfRouter in router.ts**

In `apps/backend/src/router.ts`, add the import:

```ts
import { etfRouter } from './etf/etf.router.js';
```

Add to the `appRouter` object:

```ts
export const appRouter = router({
  // ...existing routers...
  etf: etfRouter,
  health: publicProcedure.query(() => getHealthReport()),
});
```

- [ ] **Step 3: Verify TypeScript**

```bash
cd apps/backend && npx tsc --noEmit 2>&1 | head -20
```

Expected: 0 errors

- [ ] **Step 5: Commit**

```bash
git add apps/backend/src/etf/etf.router.ts apps/backend/src/router.ts
git commit -m "feat(api): add etf tRPC router with getWatchlist, addToWatchlist, removeFromWatchlist"
```

---

## Task 5: Frontend — OpportunityDashboard instrument type filter

**Files:**
- Modify: `apps/frontend/src/opportunities/OpportunityDashboard.tsx`

- [ ] **Step 1: Add instrumentType filter state**

In `apps/frontend/src/opportunities/OpportunityDashboard.tsx`, after the existing filter states (around line 74-77), add:

```ts
const [instrumentFilter, setInstrumentFilter] = useState<'accion' | 'cedear' | 'etf' | 'crypto' | 'bono' | 'commodity' | null>(null);
```

- [ ] **Step 2: Apply filter to the filtered opportunities**

Find the section where `filtered` is built from `opportunities` (around line 148-370). After the existing filters, add:

```ts
if (instrumentFilter !== null) {
  filtered = filtered.filter((o) => o.instrumentType === instrumentFilter);
}
```

- [ ] **Step 3: Add filter chips to the UI**

Find the filter chips section (around line 279 where BUY/SELL/WATCH chips are rendered). Add instrument type chips below the existing action chips:

```tsx
{/* Instrument type filter */}
<div className="flex gap-1 flex-wrap">
  {[
    { label: 'Acciones', value: 'accion' as const },
    { label: 'ETFs', value: 'etf' as const },
    { label: 'Crypto', value: 'crypto' as const },
    { label: 'Bonos', value: 'bono' as const },
    { label: 'Commodities', value: 'commodity' as const },
  ].map(({ label, value }) => (
    <Badge
      key={value}
      variant="outline"
      className={`text-[10px] cursor-pointer transition-all ${instrumentFilter === value ? 'bg-blue-500/40 text-blue-300 ring-1 ring-blue-500' : 'bg-blue-500/10 text-blue-400 hover:bg-blue-500/20'}`}
      onClick={() => setInstrumentFilter(instrumentFilter === value ? null : value)}
    >
      {label}
    </Badge>
  ))}
</div>
```

- [ ] **Step 4: Verify and commit**

Start frontend (`npm run dev` from root), navigate to the Oportunidades tab, verify filter chips appear and work.

```bash
git add apps/frontend/src/opportunities/OpportunityDashboard.tsx
git commit -m "feat(ui): add instrument type filter (Acciones/ETFs/Crypto/Bonos) to OpportunityDashboard"
```

---

## Task 6: Frontend — ETF Watchlist components

**Files:**
- Create: `apps/frontend/src/etf/ETFCard.tsx`
- Create: `apps/frontend/src/etf/AddETFModal.tsx`
- Create: `apps/frontend/src/etf/ETFWatchlistPage.tsx`

- [ ] **Step 1: Create ETFCard.tsx**

Create `apps/frontend/src/etf/ETFCard.tsx`:

```tsx
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { X } from 'lucide-react';

interface EtfEntry {
  id: number;
  symbol: string;
  name: string;
  category: string;
  description: string | null;
}

interface ETFCardProps {
  etf: EtfEntry;
  onRemove?: (symbol: string) => void;
}

const CATEGORY_LABELS: Record<string, string> = {
  indices: 'Índices',
  sectores: 'Sectores',
  bonos: 'Bonos',
  commodities: 'Commodities',
  latam: 'Latam',
  internacional: 'Internacional',
  crypto: 'Crypto',
  factor: 'Factor',
};

export function ETFCard({ etf, onRemove }: ETFCardProps) {
  return (
    <Card className="bg-card border-border hover:border-blue-500/40 transition-colors">
      <CardContent className="p-3 flex flex-col gap-1">
        <div className="flex items-start justify-between gap-2">
          <div className="flex items-center gap-2">
            <span className="font-mono font-bold text-sm text-white">{etf.symbol}</span>
            <Badge variant="outline" className="text-[10px] text-blue-400 border-blue-500/30">
              {CATEGORY_LABELS[etf.category] ?? etf.category}
            </Badge>
          </div>
          {onRemove && (
            <Button
              variant="ghost"
              size="icon"
              className="h-5 w-5 text-muted-foreground hover:text-destructive"
              onClick={() => onRemove(etf.symbol)}
            >
              <X className="h-3 w-3" />
            </Button>
          )}
        </div>
        <p className="text-xs text-muted-foreground leading-tight">{etf.name}</p>
        {etf.description && (
          <p className="text-[11px] text-muted-foreground/70 leading-tight">{etf.description}</p>
        )}
      </CardContent>
    </Card>
  );
}
```

- [ ] **Step 2: Create AddETFModal.tsx**

Create `apps/frontend/src/etf/AddETFModal.tsx`:

```tsx
import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { trpc } from '@/shared/trpc';

const CATEGORIES = [
  { value: 'indices', label: 'Índices' },
  { value: 'sectores', label: 'Sectores' },
  { value: 'bonos', label: 'Bonos' },
  { value: 'commodities', label: 'Commodities' },
  { value: 'latam', label: 'Latam' },
  { value: 'internacional', label: 'Internacional' },
  { value: 'crypto', label: 'Crypto' },
  { value: 'factor', label: 'Factor' },
] as const;

type Category = typeof CATEGORIES[number]['value'];

interface AddETFModalProps {
  open: boolean;
  onClose: () => void;
  onAdded: () => void;
}

export function AddETFModal({ open, onClose, onAdded }: AddETFModalProps) {
  const [symbol, setSymbol] = useState('');
  const [category, setCategory] = useState<Category>('indices');
  const [description, setDescription] = useState('');
  const [error, setError] = useState('');

  const addMutation = trpc.etf.addToWatchlist.useMutation({
    onSuccess: () => {
      setSymbol('');
      setDescription('');
      setError('');
      onAdded();
      onClose();
    },
    onError: (e) => setError(e.message),
  });

  return (
    <Dialog open={open} onOpenChange={onClose}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Agregar ETF al watchlist</DialogTitle>
        </DialogHeader>
        <div className="flex flex-col gap-3 pt-2">
          <Input
            placeholder="Símbolo (ej: VOO)"
            value={symbol}
            onChange={(e) => setSymbol(e.target.value.toUpperCase())}
          />
          <select
            className="flex h-9 w-full rounded-md border border-input bg-transparent px-3 py-1 text-sm shadow-sm"
            value={category}
            onChange={(e) => setCategory(e.target.value as Category)}
          >
            {CATEGORIES.map((c) => (
              <option key={c.value} value={c.value}>{c.label}</option>
            ))}
          </select>
          <Input
            placeholder="Descripción (opcional)"
            value={description}
            onChange={(e) => setDescription(e.target.value)}
          />
          {error && <p className="text-xs text-destructive">{error}</p>}
          <div className="flex gap-2 justify-end">
            <Button variant="outline" onClick={onClose}>Cancelar</Button>
            <Button
              disabled={!symbol || addMutation.isPending}
              onClick={() => addMutation.mutate({ symbol, category, description: description || undefined })}
            >
              {addMutation.isPending ? 'Verificando...' : 'Agregar'}
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
```

- [ ] **Step 3: Check if Dialog component is installed**

```bash
ls apps/frontend/src/components/ui/dialog.tsx 2>/dev/null && echo "EXISTS" || echo "MISSING"
```

If MISSING, install it:
```bash
cd apps/frontend && npx shadcn@latest add dialog
```

- [ ] **Step 4: Create ETFWatchlistPage.tsx**

Create `apps/frontend/src/etf/ETFWatchlistPage.tsx`:

```tsx
import { useState, useMemo } from 'react';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Plus } from 'lucide-react';
import { trpc } from '@/shared/trpc';
import { ETFCard } from './ETFCard';
import { AddETFModal } from './AddETFModal';

const CATEGORY_LABELS: Record<string, string> = {
  indices: 'Índices',
  sectores: 'Sectores',
  bonos: 'Bonos',
  commodities: 'Commodities',
  latam: 'Latam',
  internacional: 'Internacional',
  crypto: 'Crypto',
  factor: 'Factor',
};

export function ETFWatchlistPage() {
  const [search, setSearch] = useState('');
  const [categoryFilter, setCategoryFilter] = useState<string | null>(null);
  const [showAddModal, setShowAddModal] = useState(false);

  const { data: etfs = [], refetch } = trpc.etf.getWatchlist.useQuery();
  const removeMutation = trpc.etf.removeFromWatchlist.useMutation({ onSuccess: () => refetch() });

  const categories = useMemo(() => [...new Set(etfs.map((e) => e.category))].sort(), [etfs]);

  const filtered = useMemo(() => {
    const q = search.toLowerCase();
    return etfs.filter((e) => {
      const matchesSearch = !q || e.symbol.toLowerCase().includes(q) || e.name.toLowerCase().includes(q) || (e.description ?? '').toLowerCase().includes(q);
      const matchesCategory = !categoryFilter || e.category === categoryFilter;
      return matchesSearch && matchesCategory;
    });
  }, [etfs, search, categoryFilter]);

  return (
    <div className="flex flex-col gap-4 p-4">
      <div className="flex items-center justify-between gap-3">
        <Input
          placeholder="Buscar por símbolo o nombre..."
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          className="max-w-xs"
        />
        <Button size="sm" onClick={() => setShowAddModal(true)}>
          <Plus className="h-4 w-4 mr-1" />
          Agregar ETF
        </Button>
      </div>

      <div className="flex gap-2 flex-wrap">
        <Badge
          variant="outline"
          className={`cursor-pointer text-xs transition-all ${!categoryFilter ? 'bg-blue-500/30 text-blue-300' : 'hover:bg-blue-500/10'}`}
          onClick={() => setCategoryFilter(null)}
        >
          Todos ({etfs.length})
        </Badge>
        {categories.map((cat) => {
          const count = etfs.filter((e) => e.category === cat).length;
          return (
            <Badge
              key={cat}
              variant="outline"
              className={`cursor-pointer text-xs transition-all ${categoryFilter === cat ? 'bg-blue-500/30 text-blue-300' : 'hover:bg-blue-500/10'}`}
              onClick={() => setCategoryFilter(categoryFilter === cat ? null : cat)}
            >
              {CATEGORY_LABELS[cat] ?? cat} ({count})
            </Badge>
          );
        })}
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-3">
        {filtered.map((etf) => (
          <ETFCard
            key={etf.symbol}
            etf={etf}
            onRemove={(symbol) => removeMutation.mutate({ symbol })}
          />
        ))}
      </div>

      {filtered.length === 0 && (
        <p className="text-muted-foreground text-sm text-center py-8">
          No hay ETFs que coincidan con la búsqueda.
        </p>
      )}

      <AddETFModal
        open={showAddModal}
        onClose={() => setShowAddModal(false)}
        onAdded={() => refetch()}
      />
    </div>
  );
}
```

- [ ] **Step 5: Commit components**

```bash
git add apps/frontend/src/etf/
git commit -m "feat(ui): add ETFCard, AddETFModal, ETFWatchlistPage components"
```

---

## Task 7: Frontend — Wire up ETF tab in App.tsx

**Files:**
- Modify: `apps/frontend/src/App.tsx`

- [ ] **Step 1: Add import**

In `apps/frontend/src/App.tsx`, add the import:

```tsx
import { ETFWatchlistPage } from '@/etf/ETFWatchlistPage';
```

- [ ] **Step 2: Add tab trigger**

In the `<TabsList>` section (around line 103-117), add:

```tsx
<TabsTrigger value="etfs">ETFs</TabsTrigger>
```

Place it after `<TabsTrigger value="news">Noticias</TabsTrigger>`.

- [ ] **Step 3: Add tab content**

After the `news` TabsContent block, add:

```tsx
<TabsContent value="etfs" className="flex-1 overflow-y-auto">
  <ETFWatchlistPage />
</TabsContent>
```

- [ ] **Step 4: Verify in browser**

Start the dev server and verify:
1. "ETFs" tab appears in the navigation
2. Clicking it shows the ETF grid with ~54 ETFs
3. Search bar filters correctly
4. Category filter chips work
5. "Agregar ETF" button opens the modal
6. Adding a valid ETF (e.g., "VOO") works and shows it in the list
7. Removing an ETF (X button) works

- [ ] **Step 5: Commit**

```bash
git add apps/frontend/src/App.tsx
git commit -m "feat(ui): add ETFs tab to main navigation"
```

---

## Task 8: Frontend — Watchlist tabs + search in PortfolioTable

**Files:**
- Modify: `apps/frontend/src/portfolio/PortfolioTable.tsx`

- [ ] **Step 1: Add search state and tab state**

In `apps/frontend/src/portfolio/PortfolioTable.tsx`, after the existing state declarations, add:

```tsx
const [watchlistTab, setWatchlistTab] = useState<'portfolio' | 'etfs' | 'acciones' | 'crypto'>('portfolio');
const [watchlistSearch, setWatchlistSearch] = useState('');
```

- [ ] **Step 2: Add tab UI above the existing table**

Add the tabs and search bar before the existing `<TabInfo>` block:

```tsx
<div className="flex flex-col gap-2 px-4 pt-3 pb-0">
  <div className="flex items-center gap-3">
    <Input
      placeholder="Buscar por nombre o símbolo..."
      value={watchlistSearch}
      onChange={(e) => setWatchlistSearch(e.target.value)}
      className="max-w-xs h-7 text-xs"
    />
  </div>
  <div className="flex gap-1">
    {(['portfolio', 'etfs', 'acciones', 'crypto'] as const).map((tab) => (
      <button
        key={tab}
        onClick={() => setWatchlistTab(tab)}
        className={`text-xs px-3 py-1 rounded-sm transition-colors ${watchlistTab === tab ? 'bg-blue-500/20 text-blue-300' : 'text-muted-foreground hover:text-foreground'}`}
      >
        {tab === 'portfolio' ? 'Portfolio' : tab === 'etfs' ? 'ETFs' : tab === 'acciones' ? 'Acciones' : 'Crypto'}
      </button>
    ))}
  </div>
</div>
```

- [ ] **Step 3: Conditionally render content by tab**

The existing table shows portfolio positions. Wrap it so it only renders when `watchlistTab === 'portfolio'`. For other tabs, show a placeholder message (full implementation of those tabs is scope for a future feature — this establishes the structure):

```tsx
{watchlistTab === 'portfolio' && (
  // ... existing portfolio table JSX ...
)}
{watchlistTab === 'etfs' && (
  <p className="text-muted-foreground text-sm p-8 text-center">
    Ver watchlist completo en la tab "ETFs"
  </p>
)}
{watchlistTab === 'acciones' && (
  <p className="text-muted-foreground text-sm p-8 text-center">
    Acciones curadas — próximamente
  </p>
)}
{watchlistTab === 'crypto' && (
  <p className="text-muted-foreground text-sm p-8 text-center">
    Crypto — próximamente
  </p>
)}
```

- [ ] **Step 4: Apply search filter to portfolio view**

When `watchlistTab === 'portfolio'`, filter positions by `watchlistSearch` before rendering:

Find where `positions` is mapped in the table. Filter before mapping:

```tsx
const displayedPositions = watchlistTab === 'portfolio' && watchlistSearch
  ? positions.filter(
      (p) => p.symbol.toLowerCase().includes(watchlistSearch.toLowerCase()) ||
             (p.name ?? '').toLowerCase().includes(watchlistSearch.toLowerCase())
    )
  : positions;
```

Use `displayedPositions` instead of `positions` in the table body map.

- [ ] **Step 5: Verify in browser**

1. Portfolio tab shows existing table unchanged
2. Search filters portfolio positions by symbol/name
3. ETFs/Acciones/Crypto tabs show placeholder messages
4. Switching tabs works without breaking the portfolio table

- [ ] **Step 6: Commit**

```bash
git add apps/frontend/src/portfolio/PortfolioTable.tsx
git commit -m "feat(ui): add watchlist tabs (Portfolio/ETFs/Acciones/Crypto) and search bar to PortfolioTable"
```
