# Sistema "Anticipar el Mercado" Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add Weekly Picks (Evidence V2 + conviction filter) + Macro Regime widget + Sector Rotation dashboard to reduce signal noise from 309 to ≤5 high-conviction picks/week.

**Architecture:** Two independent backend services (SectorRotationService + WeeklyPicksService) compose existing services (market-regime, evidence-signals, scoring) into a curated output. A new `macro` tRPC router exposes the data. Frontend gets 3 new components: MacroRegimeWidget (header badge), WeeklyPicksPage (main view), SectorHeatMap.

**Tech Stack:** Hono + tRPC + Drizzle ORM + SQLite (backend), React + Vite + shadcn/ui (frontend), Vitest (tests), node-cron (cron).

**Pre-existing services to reuse (do not duplicate):**
- `apps/backend/src/evidence-signals/market-regime.service.ts` — `getMarketRegime()` → `EvidenceMarketRegime` ('bull'/'bear'/'neutral')
- `apps/backend/src/evidence-signals/sector-momentum.service.ts` — `getSectorMomentum(symbol)` — per-symbol SMA50 trend
- `apps/backend/src/evidence-signals/deep-analysis.service.ts` — `getCachedAnalysis(symbol)` → `EvidenceDeepAnalysis`
- `apps/backend/src/evidence-signals/evidence-signals.service.ts` — `getCachedSignal(symbol)`
- Main router at `apps/backend/src/router.ts` — add `macro: macroRouter`

---

## File Map

**Create:**
- `apps/backend/src/macro/sector-rotation.service.ts` — RS vs SPY for 11 ETFs
- `apps/backend/src/macro/argentina-macro.service.ts` — ADR performance vs SPY
- `apps/backend/src/macro/macro.router.ts` — tRPC endpoints
- `apps/backend/src/opportunities/weekly-picks.service.ts` — conviction filter → top 5
- `apps/backend/src/shared/cron.ts` — Sunday 20:00 ART automation
- `apps/backend/src/macro/sector-rotation.service.test.ts`
- `apps/backend/src/opportunities/weekly-picks.service.test.ts`
- `apps/frontend/src/macro/MacroRegimeWidget.tsx`
- `apps/frontend/src/macro/SectorHeatMap.tsx`
- `apps/frontend/src/weekly-picks/PickCard.tsx`
- `apps/frontend/src/weekly-picks/WeeklyPicksPage.tsx`

**Modify:**
- `apps/backend/src/db/schema.ts` — add `weeklyPicks` + `sectorRotationCache`
- `apps/backend/src/evidence-signals/market-regime.service.ts` — add VIX gate
- `apps/backend/src/router.ts` — register `macroRouter`
- `apps/backend/src/index.ts` — start cron on startup
- `packages/shared/src/types/opportunity.ts` — add `WeeklyPick`, `SectorRotationData`, `SectorCategory`
- `packages/shared/src/types/index.ts` — re-export new types
- `apps/frontend/src/App.tsx` — add `/picks` route
- `apps/frontend/src/layout/Header.tsx` — add MacroRegimeWidget

---

## Task 1: DB Schema

**Files:**
- Modify: `apps/backend/src/db/schema.ts`

- [ ] **Step 1: Add two new tables at the end of schema.ts**

```typescript
// Add after evidenceScanRuns table (end of file)

export const sectorRotationCache = sqliteTable('sector_rotation_cache', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  etf: text('etf').notNull(),
  sectorName: text('sector_name').notNull(),
  return1m: real('return_1m').notNull(),
  return3m: real('return_3m').notNull(),
  relativeStrength1m: real('relative_strength_1m').notNull(),
  relativeStrength3m: real('relative_strength_3m').notNull(),
  category: text('category', { enum: ['LEADING', 'NEUTRAL', 'LAGGING'] }).notNull(),
  updatedAt: text('updated_at').notNull().default(sql`(datetime('now'))`),
});

export const weeklyPicks = sqliteTable('weekly_picks', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  scanDate: text('scan_date').notNull(),       // YYYY-MM-DD
  symbol: text('symbol').notNull(),
  tier: text('tier', { enum: ['HIGH', 'MEDIUM'] }).notNull(),
  evidenceType: text('evidence_type').notNull(), // 'PEAD' | 'INSIDER' | 'OPTIONS' | 'PEAD_INSIDER' | 'FUNDAMENTAL'
  evidenceDetail: text('evidence_detail').notNull(),
  entryLow: real('entry_low').notNull(),
  entryHigh: real('entry_high').notNull(),
  stop: real('stop').notNull(),
  target: real('target').notNull(),
  rrRatio: real('rr_ratio').notNull(),
  regime: text('regime', { enum: ['bull', 'bear', 'neutral'] }).notNull(),
  sectorCategory: text('sector_category', { enum: ['LEADING', 'NEUTRAL', 'LAGGING'] }).notNull(),
  aiVerdict: text('ai_verdict', { enum: ['BUY_SETUP', 'WAIT', 'PASS'] }),
  fundamentalScore: integer('fundamental_score').notNull(),
  technicalScore: integer('technical_score').notNull(),
  outcome30d: real('outcome_30d'),
  outcome90d: real('outcome_90d'),
  createdAt: text('created_at').notNull().default(sql`(datetime('now'))`),
});
```

- [ ] **Step 2: Run migration**

```bash
cd apps/backend && npm run db:migrate
```

Expected: No errors. Run `npm run db:studio` to verify tables exist if needed.

- [ ] **Step 3: Commit**

```bash
git add apps/backend/src/db/schema.ts
git commit -m "feat(db): add sector_rotation_cache and weekly_picks tables"
```

---

## Task 2: Shared Types

**Files:**
- Modify: `packages/shared/src/types/opportunity.ts`
- Modify: `packages/shared/src/types/index.ts`

- [ ] **Step 1: Add new types to opportunity.ts (after the last export)**

```typescript
// Add at end of packages/shared/src/types/opportunity.ts

export type WeeklyPickTier = 'HIGH' | 'MEDIUM';
export type SectorCategory = 'LEADING' | 'NEUTRAL' | 'LAGGING';

export interface WeeklyPick {
  symbol: string;
  tier: WeeklyPickTier;
  evidence: {
    type: 'PEAD' | 'INSIDER' | 'OPTIONS' | 'PEAD_INSIDER' | 'FUNDAMENTAL';
    detail: string;
  };
  entryLow: number;
  entryHigh: number;
  stop: number;
  target: number;
  rrRatio: number;
  regime: import('./evidence-signals.js').EvidenceMarketRegime;
  sectorCategory: SectorCategory;
  aiVerdict?: import('./evidence-signals.js').DeepVerdict;
  fundamentalScore: number;
  technicalScore: number;
  scanDate: string;
  historicalWinRate: number | null;
}

export interface SectorRotationData {
  etf: string;
  sectorName: string;
  return1m: number;
  return3m: number;
  relativeStrength1m: number;
  relativeStrength3m: number;
  category: SectorCategory;
  updatedAt: string;
}

export interface MacroDashboard {
  regime: import('./evidence-signals.js').MarketRegimeData;
  sectors: SectorRotationData[];
  argentinaSignal: 'STABLE' | 'VOLATILE';
  picks: WeeklyPick[];
}
```

- [ ] **Step 2: Re-export from index.ts**

Open `packages/shared/src/types/index.ts` and add to the existing opportunity export line or add a new line:

```typescript
export type { WeeklyPick, SectorRotationData, MacroDashboard, WeeklyPickTier, SectorCategory } from './opportunity.js';
```

- [ ] **Step 3: Verify types compile**

```bash
cd packages/shared && npx tsc --noEmit
```

Expected: 0 errors.

- [ ] **Step 4: Commit**

```bash
git add packages/shared/src/types/opportunity.ts packages/shared/src/types/index.ts
git commit -m "feat(shared): add WeeklyPick, SectorRotationData, MacroDashboard types"
```

---

## Task 3: SectorRotationService

**Files:**
- Create: `apps/backend/src/macro/sector-rotation.service.ts`
- Create: `apps/backend/src/macro/sector-rotation.service.test.ts`

The existing `sector-momentum.service.ts` computes SMA50 trend per symbol. This new service computes **relative strength vs SPY** for all 11 sector ETFs — a different calculation for portfolio-wide sector rotation view.

- [ ] **Step 1: Write the failing test**

Create `apps/backend/src/macro/sector-rotation.service.test.ts`:

```typescript
import { describe, it, expect } from 'vitest';
import { computeReturn, classifySector } from './sector-rotation.service.js';

describe('computeReturn', () => {
  it('returns correct percent return for 21 days', () => {
    const closes = Array(30).fill(100).map((v, i) => v + i); // 100..129
    // closes[8] = 108 (21 days ago), closes[29] = 129 (last)
    const result = computeReturn(closes, 21);
    // (129 - 108) / 108 * 100 = 19.44%
    expect(result).toBeCloseTo(19.44, 1);
  });

  it('returns 0 when not enough data', () => {
    expect(computeReturn([100, 110], 21)).toBe(0);
  });
});

describe('classifySector', () => {
  it('returns LEADING when rs1m > 2 and rs3m > 3', () => {
    expect(classifySector(3, 4)).toBe('LEADING');
  });

  it('returns LAGGING when rs1m < -2', () => {
    expect(classifySector(-3, 0)).toBe('LAGGING');
  });

  it('returns LAGGING when rs3m < -3', () => {
    expect(classifySector(0, -4)).toBe('LAGGING');
  });

  it('returns NEUTRAL in the middle', () => {
    expect(classifySector(1, 2)).toBe('NEUTRAL');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

```bash
cd apps/backend && npm test -- sector-rotation
```

Expected: FAIL — `computeReturn` and `classifySector` not found.

- [ ] **Step 3: Create the service**

Create `apps/backend/src/macro/sector-rotation.service.ts`:

```typescript
import { getHistoricalQuotes } from '../shared/yahoo.js';
import type { SectorRotationData, SectorCategory } from '@trading/shared';

const SECTOR_ETFS: Record<string, string> = {
  XLK: 'Technology',
  XLF: 'Financials',
  XLE: 'Energy',
  XLV: 'Healthcare',
  XLY: 'Consumer Discretionary',
  XLP: 'Consumer Staples',
  XLI: 'Industrials',
  XLB: 'Materials',
  XLU: 'Utilities',
  XLRE: 'Real Estate',
  XLC: 'Communication Services',
};

/** Exported for testing. Computes % return over last `days` closes. */
export function computeReturn(closes: number[], days: number): number {
  if (closes.length < days + 1) return 0;
  const recent = closes[closes.length - 1];
  const past = closes[closes.length - 1 - days];
  return Math.round(((recent - past) / past) * 10000) / 100;
}

/** Exported for testing. Maps RS values to category. */
export function classifySector(rs1m: number, rs3m: number): SectorCategory {
  if (rs1m > 2 && rs3m > 3) return 'LEADING';
  if (rs1m < -2 || rs3m < -3) return 'LAGGING';
  return 'NEUTRAL';
}

let cache: SectorRotationData[] | null = null;
let cacheExpiresAt = 0;
const CACHE_TTL_MS = 7 * 24 * 60 * 60 * 1000; // 7 days

export async function getSectorRotation(): Promise<SectorRotationData[]> {
  if (cache && Date.now() < cacheExpiresAt) return cache;

  const spyOhlc = await getHistoricalQuotes('SPY', '6mo', '1d');
  const spyCloses = spyOhlc.map((c) => c.close);
  const spyReturn1m = computeReturn(spyCloses, 21);
  const spyReturn3m = computeReturn(spyCloses, 63);

  const results: SectorRotationData[] = [];

  for (const [etf, sectorName] of Object.entries(SECTOR_ETFS)) {
    try {
      const ohlc = await getHistoricalQuotes(etf, '6mo', '1d');
      const closes = ohlc.map((c) => c.close);

      const return1m = computeReturn(closes, 21);
      const return3m = computeReturn(closes, 63);
      const rs1m = Math.round((return1m - spyReturn1m) * 100) / 100;
      const rs3m = Math.round((return3m - spyReturn3m) * 100) / 100;

      results.push({
        etf,
        sectorName,
        return1m,
        return3m,
        relativeStrength1m: rs1m,
        relativeStrength3m: rs3m,
        category: classifySector(rs1m, rs3m),
        updatedAt: new Date().toISOString(),
      });
    } catch {
      // Skip failed ETF — partial results are fine
    }
  }

  cache = results;
  cacheExpiresAt = Date.now() + CACHE_TTL_MS;
  return results;
}

export function invalidateSectorRotationCache(): void {
  cache = null;
  cacheExpiresAt = 0;
}
```

- [ ] **Step 4: Run test to verify it passes**

```bash
cd apps/backend && npm test -- sector-rotation
```

Expected: PASS (4 tests).

- [ ] **Step 5: Commit**

```bash
git add apps/backend/src/macro/sector-rotation.service.ts apps/backend/src/macro/sector-rotation.service.test.ts
git commit -m "feat(macro): add SectorRotationService with RS vs SPY classification"
```

---

## Task 4: Enhance MarketRegimeService with VIX

**Files:**
- Modify: `apps/backend/src/evidence-signals/market-regime.service.ts`

The existing service uses SPY vs SMA200/SMA50. Add VIX: if VIX > 30, force regime to 'bear' regardless of SPY position.

- [ ] **Step 1: Write the failing test**

Add to a new file `apps/backend/src/evidence-signals/market-regime.service.test.ts`:

```typescript
import { describe, it, expect } from 'vitest';
import { applyVixGate } from './market-regime.service.js';

describe('applyVixGate', () => {
  it('returns bear when VIX > 30 regardless of SPY regime', () => {
    expect(applyVixGate('bull', 35)).toBe('bear');
    expect(applyVixGate('neutral', 31)).toBe('bear');
  });

  it('returns neutral when VIX 20-30 and regime is bull', () => {
    expect(applyVixGate('bull', 25)).toBe('neutral');
  });

  it('returns original regime when VIX < 20', () => {
    expect(applyVixGate('bull', 15)).toBe('bull');
    expect(applyVixGate('neutral', 18)).toBe('neutral');
    expect(applyVixGate('bear', 10)).toBe('bear');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

```bash
cd apps/backend && npm test -- market-regime
```

Expected: FAIL — `applyVixGate` not exported.

- [ ] **Step 3: Add VIX fetch + applyVixGate to market-regime.service.ts**

Add `applyVixGate` export and modify `getMarketRegime` to fetch VIX:

```typescript
// Add this export near the top of market-regime.service.ts (after computeSMA):

/** Exported for testing. Applies VIX override to SPY-based regime. */
export function applyVixGate(spyRegime: EvidenceMarketRegime, vix: number): EvidenceMarketRegime {
  if (vix > 30) return 'bear';
  if (vix > 20 && spyRegime === 'bull') return 'neutral';
  return spyRegime;
}
```

Then inside `getMarketRegime()`, after computing `regime` from SPY data, add:

```typescript
// After the regime computation block (before building result):
let vix = 0;
try {
  const vixOhlc = await getHistoricalQuotes('^VIX', '5d', '1d');
  if (vixOhlc.length > 0) {
    vix = vixOhlc[vixOhlc.length - 1].close;
    regime = applyVixGate(regime, vix);
  }
} catch {
  // VIX fetch failure: keep SPY-based regime
}

const result: MarketRegimeData = {
  regime,
  spyPrice: Math.round(spyPrice * 100) / 100,
  sma200: Math.round(sma200 * 100) / 100,
  priceVsSma200Pct,
  checkedAt: new Date().toISOString(),
};
```

- [ ] **Step 4: Run test to verify it passes**

```bash
cd apps/backend && npm test -- market-regime
```

Expected: PASS (4 tests).

- [ ] **Step 5: Commit**

```bash
git add apps/backend/src/evidence-signals/market-regime.service.ts apps/backend/src/evidence-signals/market-regime.service.test.ts
git commit -m "feat(market-regime): add VIX gate — VIX>30 forces bear, VIX 20-30 downgrades bull→neutral"
```

---

## Task 5: WeeklyPicksService

**Files:**
- Create: `apps/backend/src/opportunities/weekly-picks.service.ts`
- Create: `apps/backend/src/opportunities/weekly-picks.service.test.ts`

- [ ] **Step 1: Write the failing tests**

Create `apps/backend/src/opportunities/weekly-picks.service.test.ts`:

```typescript
import { describe, it, expect } from 'vitest';
import { assignTier, buildEvidenceDetail, getEvidenceType } from './weekly-picks.service.js';
import type { EvidenceSignal } from '@trading/shared';

// Minimal signal factory
function makeSignal(overrides: Partial<EvidenceSignal>): EvidenceSignal {
  return {
    symbol: 'TEST',
    scannedAt: new Date().toISOString(),
    conviction: 'high',
    regimeAdjustedConviction: 'high',
    activeSignals: 1,
    pead: { active: false, beatPercent: 0, daysSinceEarnings: 0, daysInDriftWindow: 0, score: 0, epsActual: null, epsEstimate: null, earningsDate: null, priceConfirmed: false, priceChangePct: null, consecutiveBeats: 0 },
    insider: { active: false, recentBuys: [], totalValue: 0, numberOfBuyers: 0, mostRecentBuyDate: null, score: 0 },
    optionsFlow: { active: false, callVolume: 0, putVolume: 0, callPutRatio: 0, nearestExpiry: null, dominantSentiment: 'neutral', score: 0, unusualStrikes: 0 },
    compositeScore: 0,
    recommendation: 'WATCH_CLOSELY',
    reasoning: '',
    ...overrides,
  } as EvidenceSignal;
}

describe('assignTier', () => {
  it('returns HIGH when conviction=high, score>=70, weeklyBullish, sector!=LAGGING, regime!=bear', () => {
    const signal = makeSignal({ regimeAdjustedConviction: 'high' });
    expect(assignTier(signal, 75, true, 'NEUTRAL', 'bull')).toBe('HIGH');
  });

  it('returns MEDIUM when conviction=high but weekly not bullish', () => {
    const signal = makeSignal({ regimeAdjustedConviction: 'high' });
    expect(assignTier(signal, 75, false, 'NEUTRAL', 'bull')).toBe('MEDIUM');
  });

  it('returns MEDIUM when conviction=medium and sector is not LAGGING', () => {
    const signal = makeSignal({ regimeAdjustedConviction: 'medium' });
    expect(assignTier(signal, 75, true, 'NEUTRAL', 'bull')).toBe('MEDIUM');
  });

  it('returns null when conviction=medium and sector is LAGGING', () => {
    const signal = makeSignal({ regimeAdjustedConviction: 'medium' });
    expect(assignTier(signal, 75, true, 'LAGGING', 'bull')).toBeNull();
  });

  it('returns null when score < 70', () => {
    const signal = makeSignal({ regimeAdjustedConviction: 'high' });
    expect(assignTier(signal, 65, true, 'NEUTRAL', 'bull')).toBeNull();
  });

  it('returns null when regime is bear', () => {
    const signal = makeSignal({ regimeAdjustedConviction: 'high' });
    expect(assignTier(signal, 80, true, 'NEUTRAL', 'bear')).toBeNull();
  });
});

describe('getEvidenceType', () => {
  it('returns PEAD_INSIDER when both active', () => {
    const signal = makeSignal({
      pead: { ...makeSignal({}).pead, active: true },
      insider: { ...makeSignal({}).insider, active: true },
    });
    expect(getEvidenceType(signal)).toBe('PEAD_INSIDER');
  });

  it('returns PEAD when only pead active', () => {
    const signal = makeSignal({ pead: { ...makeSignal({}).pead, active: true } });
    expect(getEvidenceType(signal)).toBe('PEAD');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

```bash
cd apps/backend && npm test -- weekly-picks
```

Expected: FAIL — exports not found.

- [ ] **Step 3: Create the service**

Create `apps/backend/src/opportunities/weekly-picks.service.ts`:

```typescript
import { db, schema } from '../db/index.js';
import { gte, eq, desc } from 'drizzle-orm';
import { getMarketRegime } from '../evidence-signals/market-regime.service.js';
import { getSectorRotation } from '../macro/sector-rotation.service.js';
import { getCachedAnalysis } from '../evidence-signals/deep-analysis.service.js';
import type {
  WeeklyPick, SectorRotationData, SectorCategory, WeeklyPickTier,
  EvidenceSignal, Opportunity,
} from '@trading/shared';
import type { EvidenceMarketRegime } from '@trading/shared';

const MIN_SCORE = 70;

// ─── Pure functions (exported for testing) ────────────────────────────────────

export function assignTier(
  signal: EvidenceSignal,
  opportunityScore: number,
  weeklyBullish: boolean,
  sectorCategory: SectorCategory,
  regime: EvidenceMarketRegime,
): WeeklyPickTier | null {
  if (regime === 'bear') return null;
  if (opportunityScore < MIN_SCORE) return null;

  if (signal.regimeAdjustedConviction === 'high') {
    if (weeklyBullish && sectorCategory !== 'LAGGING') return 'HIGH';
    return 'MEDIUM';
  }

  if (signal.regimeAdjustedConviction === 'medium') {
    if (sectorCategory === 'LAGGING') return null;
    return 'MEDIUM';
  }

  return null;
}

export function getEvidenceType(signal: EvidenceSignal): WeeklyPick['evidence']['type'] {
  if (signal.pead.active && signal.insider.active) return 'PEAD_INSIDER';
  if (signal.pead.active) return 'PEAD';
  if (signal.insider.active) return 'INSIDER';
  if (signal.optionsFlow.active) return 'OPTIONS';
  return 'FUNDAMENTAL';
}

export function buildEvidenceDetail(signal: EvidenceSignal): string {
  const parts: string[] = [];
  if (signal.pead.active) {
    parts.push(`Earnings beat ${signal.pead.beatPercent.toFixed(0)}%`);
    if (signal.pead.consecutiveBeats > 1) parts.push(`${signal.pead.consecutiveBeats}Q consecutive`);
  }
  if (signal.insider.active) {
    const val = (signal.insider.totalValue / 1_000_000).toFixed(1);
    parts.push(`${signal.insider.numberOfBuyers} insider${signal.insider.numberOfBuyers > 1 ? 's' : ''} $${val}M`);
  }
  if (signal.optionsFlow.active && signal.optionsFlow.unusualStrikes > 0) {
    parts.push(`${signal.optionsFlow.unusualStrikes} unusual call strikes`);
  }
  return parts.join(' + ') || 'Multiple signals aligned';
}

// ─── DB helpers ───────────────────────────────────────────────────────────────

function getActiveCachedSignals(): EvidenceSignal[] {
  const now = new Date().toISOString();
  const rows = db.select()
    .from(schema.evidenceSignalsCache)
    .where(gte(schema.evidenceSignalsCache.expiresAt, now))
    .all();
  return rows
    .map((row) => {
      try { return JSON.parse(row.data) as EvidenceSignal; } catch { return null; }
    })
    .filter(Boolean) as EvidenceSignal[];
}

function getLatestOpportunity(symbol: string): Opportunity | null {
  const row = db.select({ data: schema.opportunitySnapshots.data })
    .from(schema.opportunitySnapshots)
    .where(eq(schema.opportunitySnapshots.symbol, symbol))
    .orderBy(desc(schema.opportunitySnapshots.scannedAt))
    .limit(1)
    .get();
  if (!row) return null;
  try { return JSON.parse(row.data) as Opportunity; } catch { return null; }
}

function getSectorCategoryForOpp(
  sectorData: SectorRotationData[],
  opp: Opportunity,
): SectorCategory {
  const sectorEtfMap: Record<string, string> = {
    'us-tech': 'XLK',
    'us-energy': 'XLE',
    'argentina-energy': 'XLE',
    'argentina-finance': 'XLF',
    'argentina-cedears': 'XLY',
    'commodities': 'XLB',
    // crypto, bonds, etfs-sectors, emerging-markets: no direct ETF mapping → NEUTRAL
  };
  const etf = sectorEtfMap[opp.sector];
  if (!etf) return 'NEUTRAL';
  return sectorData.find((s) => s.etf === etf)?.category ?? 'NEUTRAL';
}

// ─── Main function ────────────────────────────────────────────────────────────

export async function generateWeeklyPicks(): Promise<WeeklyPick[]> {
  const [regime, sectorRotation] = await Promise.all([
    getMarketRegime(),
    getSectorRotation(),
  ]);

  const signals = getActiveCachedSignals().filter(
    (s) => s.regimeAdjustedConviction === 'high' || s.regimeAdjustedConviction === 'medium',
  );

  const picks: WeeklyPick[] = [];

  for (const signal of signals) {
    const opp = getLatestOpportunity(signal.symbol);
    if (!opp?.breakdown || !opp.tradeLevels) continue;

    const fundamentalScore = opp.breakdown.fundamental?.score ?? 0;
    const technicalScore = opp.breakdown.technical?.score ?? 0;
    const weeklyBullish = opp.weekly?.trend === 'bullish';
    const sectorCategory = getSectorCategoryForOpp(sectorRotation, opp);
    const deepAnalysis = getCachedAnalysis(signal.symbol);

    if (deepAnalysis?.verdict === 'PASS') continue;

    const tier = assignTier(signal, fundamentalScore, weeklyBullish, sectorCategory, regime.regime);
    if (!tier) continue;

    const levels = opp.tradeLevels;
    if (!levels.stopLoss || !levels.takeProfit) continue;

    picks.push({
      symbol: signal.symbol,
      tier,
      evidence: {
        type: getEvidenceType(signal),
        detail: buildEvidenceDetail(signal),
      },
      entryLow: Math.round(levels.entryPrice * 0.99 * 100) / 100,
      entryHigh: Math.round(levels.entryPrice * 1.01 * 100) / 100,
      stop: levels.stopLoss,
      target: levels.takeProfit,
      rrRatio: levels.riskRewardRatio,
      regime: regime.regime,
      sectorCategory,
      aiVerdict: deepAnalysis?.verdict,
      fundamentalScore,
      technicalScore,
      scanDate: new Date().toISOString().split('T')[0],
      historicalWinRate: null,
    });
  }

  picks.sort((a, b) => {
    if (a.tier === 'HIGH' && b.tier !== 'HIGH') return -1;
    if (a.tier !== 'HIGH' && b.tier === 'HIGH') return 1;
    return b.fundamentalScore - a.fundamentalScore;
  });

  return picks.slice(0, 5);
}

export async function saveWeeklyPicks(picks: WeeklyPick[]): Promise<void> {
  for (const pick of picks) {
    db.insert(schema.weeklyPicks).values({
      scanDate: pick.scanDate,
      symbol: pick.symbol,
      tier: pick.tier,
      evidenceType: pick.evidence.type,
      evidenceDetail: pick.evidence.detail,
      entryLow: pick.entryLow,
      entryHigh: pick.entryHigh,
      stop: pick.stop,
      target: pick.target,
      rrRatio: pick.rrRatio,
      regime: pick.regime,
      sectorCategory: pick.sectorCategory,
      aiVerdict: pick.aiVerdict,
      fundamentalScore: pick.fundamentalScore,
      technicalScore: pick.technicalScore,
    }).run();
  }
}

export function getLatestWeeklyPicks(): WeeklyPick[] {
  const latestDate = db.select({ scanDate: schema.weeklyPicks.scanDate })
    .from(schema.weeklyPicks)
    .orderBy(desc(schema.weeklyPicks.scanDate))
    .limit(1)
    .get()?.scanDate;
  if (!latestDate) return [];

  return db.select()
    .from(schema.weeklyPicks)
    .where(eq(schema.weeklyPicks.scanDate, latestDate))
    .all()
    .map((row) => ({
      symbol: row.symbol,
      tier: row.tier,
      evidence: { type: row.evidenceType as WeeklyPick['evidence']['type'], detail: row.evidenceDetail },
      entryLow: row.entryLow,
      entryHigh: row.entryHigh,
      stop: row.stop,
      target: row.target,
      rrRatio: row.rrRatio,
      regime: row.regime as EvidenceMarketRegime,
      sectorCategory: row.sectorCategory as SectorCategory,
      aiVerdict: row.aiVerdict as WeeklyPick['aiVerdict'],
      fundamentalScore: row.fundamentalScore,
      technicalScore: row.technicalScore,
      scanDate: row.scanDate,
      historicalWinRate: null,
    }));
}
```

- [ ] **Step 4: Run test to verify it passes**

```bash
cd apps/backend && npm test -- weekly-picks
```

Expected: PASS (7 tests).

- [ ] **Step 5: Commit**

```bash
git add apps/backend/src/opportunities/weekly-picks.service.ts apps/backend/src/opportunities/weekly-picks.service.test.ts
git commit -m "feat(opportunities): add WeeklyPicksService — conviction filter + top 5 picks"
```

---

## Task 6: Argentina Macro Service

**Files:**
- Create: `apps/backend/src/macro/argentina-macro.service.ts`

- [ ] **Step 1: Create the service (no separate test — logic is trivial)**

```typescript
import { getHistoricalQuotes } from '../shared/yahoo.js';

const ADR_SYMBOLS = ['YPF', 'GGAL', 'LOMA', 'BMA', 'CAAP'] as const;
const UNDERPERFORM_THRESHOLD = -5; // % vs SPY
const VOLATILE_MIN_COUNT = 3;
const CACHE_TTL_MS = 24 * 60 * 60 * 1000;

let cache: 'STABLE' | 'VOLATILE' | null = null;
let cacheExpiresAt = 0;

export async function getArgentinaMacro(): Promise<'STABLE' | 'VOLATILE'> {
  if (cache && Date.now() < cacheExpiresAt) return cache;

  try {
    const spyOhlc = await getHistoricalQuotes('SPY', '5d', '1d');
    if (spyOhlc.length < 2) return 'STABLE';
    const spyReturn = ((spyOhlc[spyOhlc.length - 1].close - spyOhlc[0].close) / spyOhlc[0].close) * 100;

    let underperformCount = 0;
    for (const symbol of ADR_SYMBOLS) {
      try {
        const ohlc = await getHistoricalQuotes(symbol, '5d', '1d');
        if (ohlc.length < 2) continue;
        const ret = ((ohlc[ohlc.length - 1].close - ohlc[0].close) / ohlc[0].close) * 100;
        if (ret - spyReturn < UNDERPERFORM_THRESHOLD) underperformCount++;
      } catch {
        // Skip failed symbol
      }
    }

    const result: 'STABLE' | 'VOLATILE' = underperformCount >= VOLATILE_MIN_COUNT ? 'VOLATILE' : 'STABLE';
    cache = result;
    cacheExpiresAt = Date.now() + CACHE_TTL_MS;
    return result;
  } catch {
    return 'STABLE';
  }
}

export function invalidateArgentinaMacroCache(): void {
  cache = null;
  cacheExpiresAt = 0;
}
```

- [ ] **Step 2: Verify it compiles**

```bash
cd apps/backend && npx tsc --noEmit
```

Expected: 0 errors.

- [ ] **Step 3: Commit**

```bash
git add apps/backend/src/macro/argentina-macro.service.ts
git commit -m "feat(macro): add ArgentinaMacroService — ADR performance vs SPY sentinel"
```

---

## Task 7: Macro tRPC Router + Wire into Main Router

**Files:**
- Create: `apps/backend/src/macro/macro.router.ts`
- Modify: `apps/backend/src/router.ts`

- [ ] **Step 1: Create the macro router**

```typescript
// apps/backend/src/macro/macro.router.ts
import { router, publicProcedure } from '../trpc.js';
import { getMarketRegime } from '../evidence-signals/market-regime.service.js';
import { getSectorRotation } from './sector-rotation.service.js';
import { getArgentinaMacro } from './argentina-macro.service.js';
import { getLatestWeeklyPicks, generateWeeklyPicks, saveWeeklyPicks } from '../opportunities/weekly-picks.service.js';
import type { MacroDashboard } from '@trading/shared';

export const macroRouter = router({
  dashboard: publicProcedure.query(async (): Promise<MacroDashboard> => {
    const [regime, sectors, argentinaSignal, picks] = await Promise.all([
      getMarketRegime(),
      getSectorRotation(),
      getArgentinaMacro(),
      Promise.resolve(getLatestWeeklyPicks()),
    ]);
    return { regime, sectors, argentinaSignal, picks };
  }),

  regime: publicProcedure.query(() => getMarketRegime()),

  sectorRotation: publicProcedure.query(() => getSectorRotation()),

  argentinaSignal: publicProcedure.query(() => getArgentinaMacro()),

  weeklyPicks: publicProcedure.query(() => getLatestWeeklyPicks()),

  generatePicks: publicProcedure.mutation(async () => {
    const picks = await generateWeeklyPicks();
    await saveWeeklyPicks(picks);
    return picks;
  }),
});
```

- [ ] **Step 2: Register in main router**

Edit `apps/backend/src/router.ts`:

```typescript
// Add import:
import { macroRouter } from './macro/macro.router.js';

// Add to appRouter:
export const appRouter = router({
  prices: pricesRouter,
  portfolio: portfolioRouter,
  analysis: analysisRouter,
  chat: chatRouter,
  news: newsRouter,
  opportunities: opportunitiesRouter,
  signals: signalsRouter,
  intelligence: intelligenceRouter,
  quant: quantRouter,
  evidenceSignals: evidenceSignalsRouter,
  macro: macroRouter,                     // <-- add this line
  health: publicProcedure.query(() => getHealthReport()),
});
```

- [ ] **Step 3: Verify compilation**

```bash
cd apps/backend && npx tsc --noEmit
```

Expected: 0 errors.

- [ ] **Step 4: Commit**

```bash
git add apps/backend/src/macro/macro.router.ts apps/backend/src/router.ts
git commit -m "feat(macro): add macro tRPC router — dashboard, regime, sectorRotation, weeklyPicks"
```

---

## Task 8: Cron Job (Sunday 20:00 ART)

**Files:**
- Create: `apps/backend/src/shared/cron.ts`
- Modify: `apps/backend/src/index.ts`

ART = UTC-3, so Sunday 20:00 ART = Sunday 23:00 UTC = cron `0 23 * * 0`.

- [ ] **Step 1: Install node-cron**

```bash
cd apps/backend && npm install node-cron && npm install --save-dev @types/node-cron
```

- [ ] **Step 2: Create the cron module**

```typescript
// apps/backend/src/shared/cron.ts
import cron from 'node-cron';
import { refreshEvidenceSignals } from '../evidence-signals/evidence-signals.service.js';
import { generateWeeklyPicks, saveWeeklyPicks } from '../opportunities/weekly-picks.service.js';
import { invalidateSectorRotationCache } from '../macro/sector-rotation.service.js';
import { invalidateMarketRegimeCache } from '../evidence-signals/market-regime.service.js';

export function startCronJobs(): void {
  // Sunday 23:00 UTC = Sunday 20:00 ART
  cron.schedule('0 23 * * 0', async () => {
    console.log('[Cron] Starting Sunday weekly picks generation...');
    try {
      // Invalidate caches to force fresh data
      invalidateMarketRegimeCache();
      invalidateSectorRotationCache();

      // Run full evidence scan (this is the existing function from evidence-signals service)
      await refreshEvidenceSignals({ forceRefresh: true });
      console.log('[Cron] Evidence scan complete');

      // Generate and save weekly picks
      const picks = await generateWeeklyPicks();
      await saveWeeklyPicks(picks);
      console.log(`[Cron] Weekly picks generated: ${picks.length} picks (${picks.filter((p) => p.tier === 'HIGH').length} HIGH)`);
    } catch (err) {
      console.error('[Cron] Weekly picks generation failed:', (err as Error).message);
    }
  });

  console.log('[Cron] Scheduled: weekly picks every Sunday 23:00 UTC (20:00 ART)');
}
```

**Note:** Check the exact export name from `evidence-signals.service.ts` — it may be `refreshEvidenceSignals` or `runEvidenceScan`. Use grep: `grep -n "^export" apps/backend/src/evidence-signals/evidence-signals.service.ts`

- [ ] **Step 3: Find the correct export name for evidence scan**

```bash
grep -n "^export async function" /Users/federicocroce/Documents/Fede/trading/apps/backend/src/evidence-signals/evidence-signals.service.ts
```

Update the import in `cron.ts` to use the correct function name from the output.

- [ ] **Step 4: Wire cron in index.ts**

Find the server startup in `apps/backend/src/index.ts` and add after the server starts:

```typescript
import { startCronJobs } from './shared/cron.js';

// After serve() call or after DB migration:
startCronJobs();
```

- [ ] **Step 5: Verify compilation and test startup**

```bash
cd apps/backend && npx tsc --noEmit
npm run dev
```

Expected: logs `[Cron] Scheduled: weekly picks every Sunday 23:00 UTC (20:00 ART)` in startup.

- [ ] **Step 6: Commit**

```bash
git add apps/backend/src/shared/cron.ts apps/backend/src/index.ts apps/backend/package.json apps/backend/package-lock.json
git commit -m "feat(cron): add Sunday 20:00 ART automated weekly picks generation"
```

---

## Task 9: Frontend — MacroRegimeWidget

**Files:**
- Create: `apps/frontend/src/macro/MacroRegimeWidget.tsx`
- Modify: `apps/frontend/src/layout/Header.tsx`

The widget shows a colored badge: 🟢 RISK ON / 🟡 CAUTELA / 🔴 RIESGO

- [ ] **Step 1: Create MacroRegimeWidget.tsx**

```tsx
// apps/frontend/src/macro/MacroRegimeWidget.tsx
import { trpc } from '@/lib/trpc';
import { Badge } from '@/components/ui/badge';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';

const REGIME_CONFIG = {
  bull: {
    label: 'RISK ON',
    className: 'bg-trading-green/20 text-trading-green border-trading-green/30',
    tooltip: 'SPY sobre SMA200, VIX < 20. Condiciones favorables para longs.',
  },
  neutral: {
    label: 'CAUTELA',
    className: 'bg-yellow-500/20 text-yellow-400 border-yellow-500/30',
    tooltip: 'Régimen mixto. Solo picks de alta convicción.',
  },
  bear: {
    label: 'RIESGO',
    className: 'bg-trading-red/20 text-trading-red border-trading-red/30',
    tooltip: 'SPY bajo SMA200 o VIX > 30. No se generan nuevos picks BUY.',
  },
} as const;

export function MacroRegimeWidget() {
  const { data, isLoading } = trpc.macro.regime.useQuery(undefined, {
    refetchInterval: 60 * 60 * 1000, // 1 hour
  });

  if (isLoading || !data) return null;

  const config = REGIME_CONFIG[data.regime];

  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <Badge variant="outline" className={`text-xs font-mono cursor-default ${config.className}`}>
          {config.label}
        </Badge>
      </TooltipTrigger>
      <TooltipContent>
        <p className="text-xs max-w-[200px]">{config.tooltip}</p>
        <p className="text-xs text-muted-foreground mt-1">
          SPY ${data.spyPrice} · SMA200 ${data.sma200} · {data.priceVsSma200Pct > 0 ? '+' : ''}{data.priceVsSma200Pct}%
        </p>
      </TooltipContent>
    </Tooltip>
  );
}
```

- [ ] **Step 2: Add MacroRegimeWidget to Header.tsx**

Open `apps/frontend/src/layout/Header.tsx`. Find where the existing badges/buttons are and add:

```tsx
import { MacroRegimeWidget } from '@/macro/MacroRegimeWidget';

// Inside the Header JSX, near the existing controls:
<MacroRegimeWidget />
```

- [ ] **Step 3: Start dev server and verify**

```bash
npm run dev --workspace=apps/frontend
```

Open browser at http://localhost:5173. Verify the regime badge appears in the header and shows RISK ON / CAUTELA / RIESGO.

- [ ] **Step 4: Commit**

```bash
git add apps/frontend/src/macro/MacroRegimeWidget.tsx apps/frontend/src/layout/Header.tsx
git commit -m "feat(frontend): add MacroRegimeWidget — regime badge in header"
```

---

## Task 10: Frontend — PickCard

**Files:**
- Create: `apps/frontend/src/weekly-picks/PickCard.tsx`

- [ ] **Step 1: Create PickCard.tsx**

```tsx
// apps/frontend/src/weekly-picks/PickCard.tsx
import { Badge } from '@/components/ui/badge';
import { Card, CardContent, CardHeader } from '@/components/ui/card';
import type { WeeklyPick } from '@trading/shared';

const TIER_CONFIG = {
  HIGH: { label: 'ALTA CONVICCIÓN', className: 'bg-trading-green/20 text-trading-green border-trading-green/30' },
  MEDIUM: { label: 'MEDIA', className: 'bg-yellow-500/20 text-yellow-400 border-yellow-500/30' },
};

const EVIDENCE_LABELS: Record<WeeklyPick['evidence']['type'], string> = {
  PEAD: 'Post-Earnings Drift',
  INSIDER: 'Compra Insider',
  OPTIONS: 'Flujo de Opciones',
  PEAD_INSIDER: 'PEAD + Insider',
  FUNDAMENTAL: 'Fundamentals',
};

const SECTOR_CONFIG = {
  LEADING: { label: 'Sector líder', className: 'text-trading-green' },
  NEUTRAL: { label: 'Sector neutral', className: 'text-muted-foreground' },
  LAGGING: { label: 'Sector rezagado', className: 'text-trading-red' },
};

interface PickCardProps {
  pick: WeeklyPick;
}

export function PickCard({ pick }: PickCardProps) {
  const tier = TIER_CONFIG[pick.tier];
  const sector = SECTOR_CONFIG[pick.sectorCategory];

  return (
    <Card className="border-border/50 bg-card/50">
      <CardHeader className="pb-2 flex flex-row items-center justify-between">
        <div className="flex items-center gap-2">
          <span className="font-mono font-bold text-lg">{pick.symbol}</span>
          <Badge variant="outline" className={`text-xs ${tier.className}`}>
            {tier.label}
          </Badge>
        </div>
        <span className={`text-xs ${sector.className}`}>{sector.label}</span>
      </CardHeader>
      <CardContent className="space-y-3">
        {/* Evidence */}
        <div className="text-sm">
          <span className="text-muted-foreground text-xs uppercase tracking-wide">
            {EVIDENCE_LABELS[pick.evidence.type]}
          </span>
          <p className="text-foreground mt-0.5">{pick.evidence.detail}</p>
        </div>

        {/* Levels */}
        <div className="grid grid-cols-3 gap-2 text-center">
          <div className="bg-background/50 rounded p-2">
            <p className="text-xs text-muted-foreground">Entrada</p>
            <p className="text-sm font-mono">${pick.entryLow.toFixed(2)}–${pick.entryHigh.toFixed(2)}</p>
          </div>
          <div className="bg-trading-red/10 rounded p-2">
            <p className="text-xs text-muted-foreground">Stop</p>
            <p className="text-sm font-mono text-trading-red">${pick.stop.toFixed(2)}</p>
          </div>
          <div className="bg-trading-green/10 rounded p-2">
            <p className="text-xs text-muted-foreground">Target</p>
            <p className="text-sm font-mono text-trading-green">${pick.target.toFixed(2)}</p>
          </div>
        </div>

        {/* R/R + scores */}
        <div className="flex gap-4 text-xs text-muted-foreground">
          <span>R/R <span className="text-foreground font-mono">{pick.rrRatio.toFixed(1)}x</span></span>
          <span>Fund. <span className="text-foreground font-mono">{pick.fundamentalScore}</span></span>
          <span>Tec. <span className="text-foreground font-mono">{pick.technicalScore}</span></span>
          {pick.aiVerdict && (
            <span>IA <span className={`font-mono ${pick.aiVerdict === 'BUY_SETUP' ? 'text-trading-green' : 'text-yellow-400'}`}>{pick.aiVerdict}</span></span>
          )}
        </div>

        {pick.historicalWinRate !== null && (
          <p className="text-xs text-muted-foreground">
            Win rate histórico ({EVIDENCE_LABELS[pick.evidence.type]}): <span className="text-foreground">{(pick.historicalWinRate * 100).toFixed(0)}%</span>
          </p>
        )}
        {pick.historicalWinRate === null && (
          <p className="text-xs text-muted-foreground">Sin datos suficientes para win rate histórico</p>
        )}
      </CardContent>
    </Card>
  );
}
```

- [ ] **Step 2: Commit**

```bash
git add apps/frontend/src/weekly-picks/PickCard.tsx
git commit -m "feat(frontend): add PickCard component for weekly picks"
```

---

## Task 11: Frontend — WeeklyPicksPage

**Files:**
- Create: `apps/frontend/src/weekly-picks/WeeklyPicksPage.tsx`

- [ ] **Step 1: Create WeeklyPicksPage.tsx**

```tsx
// apps/frontend/src/weekly-picks/WeeklyPicksPage.tsx
import { trpc } from '@/lib/trpc';
import { Button } from '@/components/ui/button';
import { PickCard } from './PickCard';

export function WeeklyPicksPage() {
  const { data: picks, isLoading, refetch } = trpc.macro.weeklyPicks.useQuery();
  const generateMutation = trpc.macro.generatePicks.useMutation({
    onSuccess: () => refetch(),
  });

  const today = new Date().toLocaleDateString('es-AR', {
    weekday: 'long', day: 'numeric', month: 'long',
  });

  return (
    <div className="p-6 max-w-2xl mx-auto space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-bold">Picks de la Semana</h1>
          <p className="text-sm text-muted-foreground">{today} · Alta convicción solamente</p>
        </div>
        <Button
          variant="outline"
          size="sm"
          onClick={() => generateMutation.mutate()}
          disabled={generateMutation.isPending}
        >
          {generateMutation.isPending ? 'Generando...' : 'Generar ahora'}
        </Button>
      </div>

      {isLoading && (
        <div className="text-center text-muted-foreground py-12">Cargando picks...</div>
      )}

      {!isLoading && (!picks || picks.length === 0) && (
        <div className="text-center py-12 space-y-2">
          <p className="text-muted-foreground">Sin picks de alta convicción esta semana.</p>
          <p className="text-sm text-muted-foreground">
            Puede indicar régimen RIESGO o falta de señales con suficiente evidencia.
          </p>
          <Button
            variant="ghost"
            size="sm"
            onClick={() => generateMutation.mutate()}
            disabled={generateMutation.isPending}
          >
            Intentar generar
          </Button>
        </div>
      )}

      {picks && picks.length > 0 && (
        <div className="space-y-4">
          <p className="text-sm text-muted-foreground">
            {picks.length} setup{picks.length !== 1 ? 's' : ''} · {picks.filter((p) => p.tier === 'HIGH').length} alta convicción
          </p>
          {picks.map((pick) => (
            <PickCard key={pick.symbol} pick={pick} />
          ))}
        </div>
      )}
    </div>
  );
}
```

- [ ] **Step 2: Commit**

```bash
git add apps/frontend/src/weekly-picks/WeeklyPicksPage.tsx
git commit -m "feat(frontend): add WeeklyPicksPage with generate button and empty state"
```

---

## Task 12: Frontend — SectorHeatMap

**Files:**
- Create: `apps/frontend/src/macro/SectorHeatMap.tsx`

- [ ] **Step 1: Create SectorHeatMap.tsx**

```tsx
// apps/frontend/src/macro/SectorHeatMap.tsx
import { trpc } from '@/lib/trpc';

const CATEGORY_CONFIG = {
  LEADING: { label: 'Líder', className: 'text-trading-green bg-trading-green/10 border-trading-green/20' },
  NEUTRAL: { label: 'Neutral', className: 'text-muted-foreground bg-muted/20 border-muted/20' },
  LAGGING: { label: 'Rezagado', className: 'text-trading-red bg-trading-red/10 border-trading-red/20' },
};

export function SectorHeatMap() {
  const { data: sectors, isLoading } = trpc.macro.sectorRotation.useQuery(undefined, {
    refetchInterval: 7 * 24 * 60 * 60 * 1000, // 7 days (matches cache TTL)
  });

  if (isLoading) return <div className="text-sm text-muted-foreground">Cargando sectores...</div>;
  if (!sectors?.length) return null;

  const sorted = [...sectors].sort((a, b) => b.relativeStrength1m - a.relativeStrength1m);

  return (
    <div className="space-y-2">
      <h3 className="text-sm font-medium text-muted-foreground uppercase tracking-wide">
        Rotación de Sectores vs SPY
      </h3>
      <div className="grid grid-cols-1 gap-1">
        {sorted.map((sector) => {
          const config = CATEGORY_CONFIG[sector.category];
          return (
            <div
              key={sector.etf}
              className={`flex items-center justify-between px-3 py-2 rounded border text-sm ${config.className}`}
            >
              <div className="flex items-center gap-2">
                <span className="font-mono text-xs">{sector.etf}</span>
                <span className="text-xs opacity-70">{sector.sectorName}</span>
              </div>
              <div className="flex items-center gap-3 font-mono text-xs">
                <span title="RS 1 mes">{sector.relativeStrength1m > 0 ? '+' : ''}{sector.relativeStrength1m.toFixed(1)}%</span>
                <span title="RS 3 meses" className="opacity-70">{sector.relativeStrength3m > 0 ? '+' : ''}{sector.relativeStrength3m.toFixed(1)}%</span>
                <span className="uppercase font-bold text-xs">{config.label}</span>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
```

- [ ] **Step 2: Commit**

```bash
git add apps/frontend/src/macro/SectorHeatMap.tsx
git commit -m "feat(frontend): add SectorHeatMap — 11 SPDR ETFs ranked by RS vs SPY"
```

---

## Task 13: Wire Frontend Routes + Navigation

**Files:**
- Modify: `apps/frontend/src/App.tsx`

- [ ] **Step 1: Add WeeklyPicksPage route to App.tsx**

Open `apps/frontend/src/App.tsx`. Find where existing routes/tabs are defined. Add:

```tsx
import { WeeklyPicksPage } from '@/weekly-picks/WeeklyPicksPage';
import { SectorHeatMap } from '@/macro/SectorHeatMap';

// Add tab or route for "Picks":
// If using Tabs pattern (existing), add:
<TabsTrigger value="picks">Picks</TabsTrigger>

// In TabsContent:
<TabsContent value="picks">
  <div className="space-y-6 p-4">
    <WeeklyPicksPage />
    <SectorHeatMap />
  </div>
</TabsContent>
```

**Note:** Match the exact tab pattern used in existing `App.tsx`. Use grep to find the pattern:
```bash
grep -n "TabsTrigger\|TabsContent\|value=" apps/frontend/src/App.tsx | head -20
```

- [ ] **Step 2: Start dev server and test golden path**

```bash
npm run dev --workspace=apps/frontend
```

1. Open http://localhost:5173
2. Verify "Picks" tab appears in navigation
3. Click "Picks" → WeeklyPicksPage renders (empty state or picks)
4. Click "Generar ahora" → loading state → picks generated (may be empty if no evidence signals in cache)
5. Verify MacroRegimeWidget badge in header
6. Verify SectorHeatMap loads and shows 11 sectors with RS values

- [ ] **Step 3: Commit**

```bash
git add apps/frontend/src/App.tsx
git commit -m "feat(frontend): add Picks tab — WeeklyPicksPage + SectorHeatMap"
```

---

## Verification Checklist

**Backend:**
- [ ] `npm test` in `apps/backend` → all tests pass (including new sector-rotation + weekly-picks tests)
- [ ] `npx tsc --noEmit` in `apps/backend` → 0 errors
- [ ] `npm run db:migrate` → no errors, tables created
- [ ] `curl http://localhost:3001/trpc/macro.regime` → returns `{ regime: "bull" | "neutral" | "bear", ... }`
- [ ] `curl http://localhost:3001/trpc/macro.sectorRotation` → returns array of 11 sectors with category
- [ ] `curl http://localhost:3001/trpc/macro.weeklyPicks` → returns array (may be empty if no cached evidence signals)
- [ ] Manual trigger via tRPC playground or curl: `macro.generatePicks` mutation → runs without error

**Frontend:**
- [ ] MacroRegimeWidget shows in header with correct color
- [ ] Picks tab shows WeeklyPicksPage
- [ ] SectorHeatMap shows 11 sectors ranked by RS
- [ ] "Generar ahora" button triggers mutation and updates picks
- [ ] Empty state shows correctly when no picks qualify
- [ ] Console shows no errors

**Cron:**
- [ ] Server startup logs `[Cron] Scheduled: weekly picks every Sunday 23:00 UTC`

---

## Scope: NOT in this plan

- Backtesting engine
- Automated trade execution
- On-chain crypto metrics
- Real-time intraday alerts
- API de BCRA / datos macro externos
- Outcome tracking update (requires separate 30d/90d scheduler — future task)
- Push notifications (requires mobile/desktop push infrastructure — check if `PushNotification` tool exists in backend first; add as follow-up task if infrastructure present)
