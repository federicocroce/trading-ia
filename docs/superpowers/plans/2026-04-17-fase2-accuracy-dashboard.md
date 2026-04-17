# Fase 2: Accuracy Dashboard — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Trackear accuracy de señales (incluyendo HOLD portfolio + entry/target/stop) y exponer un dashboard completo con win rate, desviaciones y tendencias.

**Architecture:** Extender `signalTracking` con nuevos campos para HOLD y accuracy de niveles de precio. Extender `resolveExpiredSignals()` para calcular entry hit, target hit, stop triggered. Nuevo endpoint `getAccuracyReport()` que agrega métricas. Nueva tab "Accuracy" en frontend.

**Prerequisite:** Fase 1 completada (schema migrations running, backend functional).

**Tech Stack:** Drizzle ORM + better-sqlite3, tRPC, TypeScript, React + Vite, shadcn/ui

---

## File Map

| Action | Path | Responsibility |
|--------|------|---------------|
| Modify | `apps/backend/src/db/schema.ts` | Add accuracy fields to signalTracking |
| Modify | `apps/backend/src/opportunities/signal-tracking.service.ts` | Track HOLD portfolio + entry/target/stop resolution |
| Modify | `apps/backend/src/opportunities/opportunities.service.ts` | Pass `isPortfolio` flag when recording signals |
| Create | `apps/backend/src/intelligence/accuracy.service.ts` | getAccuracyReport aggregation logic |
| Modify | `apps/backend/src/intelligence/intelligence.router.ts` | Add getAccuracyReport endpoint |
| Create | `apps/frontend/src/intelligence/AccuracyDashboard.tsx` | Accuracy tab UI |
| Modify | `apps/frontend/src/App.tsx` | Add Accuracy tab |

---

### Task 1: Extend signalTracking schema with accuracy fields

**Files:**
- Modify: `apps/backend/src/db/schema.ts`

- [ ] **Step 1: Add new fields to `signalTracking` table**

Find the `signalTracking` table definition. After the `createdAt` field, the current schema already has `outcome`, `resolvedAt`, `hitTarget`, `hitStop`. Add the following new fields before `createdAt`:

```typescript
  // Portfolio context
  isPortfolioHold: integer('is_portfolio_hold', { mode: 'boolean' }).default(false),

  // Entry accuracy (new — hitTarget/hitStop already exist)
  entryHit: integer('entry_hit', { mode: 'boolean' }),
  entryDeviation: real('entry_deviation'),     // % diff between proposed entry and next-day price
  entryHitAt: text('entry_hit_at'),            // ISO date when entry level was reached

  // Target deviation (hitTarget field already exists — only add deviation/date)
  targetDeviation: real('target_deviation'),   // % diff between target and max price in period
  targetHitAt: text('target_hit_at'),          // ISO date when target was reached

  // Stop deviation (hitStop field already exists — only add deviation/date)
  stopDeviation: real('stop_deviation'),        // % diff between stop and min price in period
  stopTriggeredAt: text('stop_triggered_at'),   // ISO date when stop was triggered
```

> Note: `hitTarget` and `hitStop` columns already exist in `signalTracking`. Do NOT add `targetHit` or `stopTriggered` — they would duplicate existing columns.

- [ ] **Step 2: Run migration** — restart backend:

```bash
npm run dev:backend
sqlite3 data/trading.db ".schema signal_tracking" | grep -E "is_portfolio_hold|entry_hit|target_deviation|stop_deviation"
```

Expected: new columns visible

- [ ] **Step 3: Commit**

```bash
git add apps/backend/src/db/schema.ts
git commit -m "feat(db): extend signalTracking with entry/target/stop accuracy fields and isPortfolioHold"
```

---

### Task 2: Track HOLD signals for portfolio positions

**Files:**
- Modify: `apps/backend/src/opportunities/signal-tracking.service.ts`
- Modify: `apps/backend/src/opportunities/opportunities.service.ts`

- [ ] **Step 1: Open `signal-tracking.service.ts`** and find `recordSignals()`

Current logic records only BUY, SELL, and qualifying WATCH. Add HOLD tracking for portfolio positions.

- [ ] **Step 2: Modify `recordSignals` to accept portfolio context**

Change function signature from:
```typescript
export function recordSignals(opportunities: Opportunity[]): void
```
To:
```typescript
export function recordSignals(opportunities: Opportunity[], portfolioSymbols?: Set<string>): void
```

- [ ] **Step 3: Add HOLD portfolio tracking logic inside `recordSignals`**

After the existing BUY/SELL/WATCH block, add:

```typescript
// Track HOLD for portfolio positions (accuracy: was holding correct?)
for (const opp of opportunities) {
  if (opp.action !== 'HOLD') continue;
  if (!portfolioSymbols?.has(opp.symbol)) continue;
  if (!opp.currentPrice || opp.currentPrice <= 0) continue;

  // Check if already tracked today
  const existing = db.select()
    .from(signalTracking)
    .where(
      and(
        eq(signalTracking.symbol, opp.symbol),
        eq(signalTracking.signalDate, new Date().toISOString().split('T')[0]),
        eq(signalTracking.action, 'HOLD')
      )
    )
    .get();
  if (existing) continue;

  db.insert(signalTracking).values({
    symbol: opp.symbol,
    signalDate: new Date().toISOString().split('T')[0],
    action: 'HOLD',
    entryPrice: opp.currentPrice,
    targetPrice: opp.tradeLevels?.target ?? null,
    stopLoss: opp.tradeLevels?.stopLoss ?? null,
    confidence: opp.confidence,
    opportunityScore: opp.score,
    sector: opp.sector ?? null,
    techScore: opp.dimensions?.technical ?? null,
    fundScore: opp.dimensions?.fundamental ?? null,
    sentScore: opp.dimensions?.sentiment ?? null,
    hadDivergences: (opp.signalConflicts?.length ?? 0) > 0,
    enrichedByLlm: opp.unifiedAnalysis != null,
    shortTermScore: opp.shortTermScore ?? null,
    mediumTermScore: opp.mediumTermScore ?? null,
    rsiAtSignal: opp.technicalData?.rsi ?? null,
    predictedReturnMid: opp.estimatedReturns?.medium?.mid ?? null,
    isPortfolioHold: true,
    outcome: 'pending',
  }).run();
}
```

- [ ] **Step 4: Find where `recordSignals` is called** in `opportunities.service.ts` and pass portfolio symbols**. `getPortfolioPositions()` is already imported/used at line 298 of `opportunities.service.ts`:

```typescript
import { getPortfolioPositions } from '../portfolio/portfolio.service.js'; // already imported
// ...
const positions = getPortfolioPositions();
const portfolioSymbols = new Set(positions.map(p => p.symbol));
recordSignals(opportunities, portfolioSymbols);
```

- [ ] **Step 5: Verify compilation**

```bash
npx tsc --noEmit -p apps/backend/tsconfig.json 2>&1 | head -20
```

- [ ] **Step 6: Commit**

```bash
git add apps/backend/src/opportunities/signal-tracking.service.ts apps/backend/src/opportunities/opportunities.service.ts
git commit -m "feat(signal-tracking): track HOLD portfolio signals for accuracy measurement"
```

---

### Task 3: Extend resolveExpiredSignals with entry/target/stop accuracy

**Files:**
- Modify: `apps/backend/src/opportunities/signal-tracking.service.ts`

- [ ] **Step 1: Open `resolveExpiredSignals()`** in signal-tracking.service.ts

Current logic fetches price history and records returnAfter7d/returnAfter30d + outcome. We need to also compute entry/target/stop accuracy.

- [ ] **Step 2: Add helper function `computeLevelAccuracy`** before `resolveExpiredSignals`:

```typescript
function computeLevelAccuracy(
  proposedLevel: number | null | undefined,
  priceHistory: number[],  // daily prices in order (oldest to newest)
  direction: 'above' | 'below'
): { hit: boolean; deviation: number; hitIndex: number | null } {
  if (!proposedLevel || priceHistory.length === 0) {
    return { hit: false, deviation: 0, hitIndex: null };
  }
  const hitIndex = direction === 'above'
    ? priceHistory.findIndex(p => p >= proposedLevel)
    : priceHistory.findIndex(p => p <= proposedLevel);

  if (hitIndex >= 0) {
    return { hit: true, deviation: ((priceHistory[hitIndex] - proposedLevel) / proposedLevel) * 100, hitIndex };
  }

  // Didn't hit — calculate deviation from closest extreme
  const extreme = direction === 'above'
    ? Math.max(...priceHistory)
    : Math.min(...priceHistory);
  const deviation = ((extreme - proposedLevel) / proposedLevel) * 100;
  return { hit: false, deviation, hitIndex: null };
}
```

- [ ] **Step 3: Extend the resolution logic inside `resolveExpiredSignals`**

After the existing outcome calculation (win/loss/neutral), add level accuracy computation.

Find the block where `priceAfter7d` / `priceAfter30d` are computed and add:

The existing `resolveExpiredSignals()` already computes `hitTarget`, `hitStop`, and `outcome`. We need to extend the existing `db.update()` call with the new fields. Find the existing update block (around line 117 in signal-tracking.service.ts) and extend it:

```typescript
// Existing variables already computed by resolveExpiredSignals:
// hitTarget (bool), hitStop (bool), outcome (string), returnForAction (number)
// priceAfter7d, priceAfter30d, returnAfter7d, returnAfter30d

// --- Level deviation calculations (new) ---
// Use available price points as proxy for price range in period
const pricesInPeriod = [signal.entryPrice, priceAfter7d, priceAfter30d]
  .filter((p): p is number => p != null && p > 0);

const targetResult = computeLevelAccuracy(signal.targetPrice, pricesInPeriod, 'above');
const stopResult = computeLevelAccuracy(signal.stopLoss, pricesInPeriod, 'below');

// HOLD portfolio outcome override
let finalOutcome = outcome; // outcome from existing logic
if (signal.isPortfolioHold) {
  const ret = returnAfter30d ?? returnAfter7d ?? 0;
  if (ret > -5) finalOutcome = 'win';
  else if (ret < -10) finalOutcome = 'loss';
  else finalOutcome = 'neutral';
}

// Extend the existing db.update() call — add new fields to the existing .set() object:
db.update(signalTracking).set({
  priceAfter7d,
  priceAfter30d,
  returnAfter7d,
  returnAfter30d,
  hitTarget,
  hitStop,
  outcome: is30d || hitTarget || hitStop ? finalOutcome : 'pending',
  resolvedAt: new Date().toISOString(),
  // NEW accuracy fields
  entryHit: true,       // entry price = signal date price, always "reached"
  entryDeviation: 0,    // no deviation on signal day
  targetDeviation: signal.targetPrice ? targetResult.deviation : null,
  targetHitAt: (hitTarget && signal.targetPrice) ? new Date().toISOString().split('T')[0] : null,
  stopDeviation: signal.stopLoss ? stopResult.deviation : null,
  stopTriggeredAt: (hitStop && signal.stopLoss) ? new Date().toISOString().split('T')[0] : null,
}).where(eq(signalTracking.id, signal.id)).run();
```

> Note: Replace the existing `db.update(signalTracking).set({...}).where(...).run()` call — don't add a second update call. The code above is a full replacement of that existing block with the new fields appended.

- [ ] **Step 4: Verify compilation**

```bash
npx tsc --noEmit -p apps/backend/tsconfig.json 2>&1 | head -20
```

- [ ] **Step 5: Commit**

```bash
git add apps/backend/src/opportunities/signal-tracking.service.ts
git commit -m "feat(signal-tracking): compute entry/target/stop accuracy and HOLD portfolio outcome on resolution"
```

---

### Task 4: Create accuracy.service.ts with getAccuracyReport

**Files:**
- Create: `apps/backend/src/intelligence/accuracy.service.ts`

- [ ] **Step 1: Create the file**

```typescript
import { db } from '../db/database.js';
import { signalTracking, missedOpportunities } from '../db/schema.js';
import { gte, sql, desc } from 'drizzle-orm';

export interface AccuracyReport {
  summary: {
    totalSignals: number;
    resolvedSignals: number;
    pendingSignals: number;
    winRate: number;
    avgPredictedReturn: number;
    avgActualReturn: number;
    predictionBias: number; // + = optimistic, - = pessimistic
    mae: number;
  };
  byAction: Record<string, {
    total: number;
    resolved: number;
    winRate: number;
    avgReturn: number;
  }>;
  bySector: Array<{
    sector: string;
    total: number;
    winRate: number;
    avgReturn: number;
  }>;
  byConfidenceTier: Record<string, {
    label: string;
    total: number;
    winRate: number;
    avgReturn: number;
  }>;
  entryAccuracy: {
    hitRate: number;
    avgDeviation: number;
  };
  targetAccuracy: {
    hitRate: number;
    avgDeviation: number;
  };
  stopAccuracy: {
    triggerRate: number;
    avgDeviation: number;
  };
  trend: {
    rolling30d: number | null;
    rolling60d: number | null;
    rolling90d: number | null;
  };
  missedOpps: {
    total: number;
    avgMissedReturn: number;
    topMissed: Array<{ symbol: string; date: string; return7d: number | null; return30d: number | null; wouldHaveBeen: string | null }>;
  };
}

function winRate(signals: Array<{ outcome: string | null }>): number {
  const resolved = signals.filter(s => s.outcome && s.outcome !== 'pending');
  if (resolved.length === 0) return 0;
  const wins = resolved.filter(s => s.outcome === 'win').length;
  return Math.round((wins / resolved.length) * 100);
}

function avg(values: (number | null | undefined)[]): number {
  const valid = values.filter((v): v is number => v != null);
  if (valid.length === 0) return 0;
  return Math.round((valid.reduce((a, b) => a + b, 0) / valid.length) * 100) / 100;
}

export function getAccuracyReport(days: 30 | 60 | 90 | 180 = 90): AccuracyReport {
  const since = new Date();
  since.setDate(since.getDate() - days);
  const sinceStr = since.toISOString().split('T')[0];

  const signals = db.select().from(signalTracking)
    .where(gte(signalTracking.signalDate, sinceStr))
    .all();

  const resolved = signals.filter(s => s.outcome && s.outcome !== 'pending');
  const wins = resolved.filter(s => s.outcome === 'win');

  // Summary
  const predicted = signals.map(s => s.predictedReturnMid);
  const actual = resolved.map(s => s.returnAfter30d ?? s.returnAfter7d);
  const predVsActual = resolved
    .filter(s => s.predictedReturnMid != null && (s.returnAfter30d ?? s.returnAfter7d) != null)
    .map(s => ({ pred: s.predictedReturnMid!, actual: s.returnAfter30d ?? s.returnAfter7d! }));

  const mae = predVsActual.length > 0
    ? avg(predVsActual.map(p => Math.abs(p.pred - p.actual)))
    : 0;
  const bias = predVsActual.length > 0
    ? avg(predVsActual.map(p => p.pred - p.actual))
    : 0;

  // By action
  const actions = ['BUY', 'SELL', 'HOLD', 'WATCH'];
  const byAction: AccuracyReport['byAction'] = {};
  for (const action of actions) {
    const group = signals.filter(s => s.action === action);
    byAction[action] = {
      total: group.length,
      resolved: group.filter(s => s.outcome && s.outcome !== 'pending').length,
      winRate: winRate(group),
      avgReturn: avg(group.map(s => s.returnAfter30d ?? s.returnAfter7d)),
    };
  }

  // By sector
  const sectorMap = new Map<string, typeof signals>();
  for (const s of signals) {
    const sector = s.sector ?? 'Unknown';
    if (!sectorMap.has(sector)) sectorMap.set(sector, []);
    sectorMap.get(sector)!.push(s);
  }
  const bySector = Array.from(sectorMap.entries())
    .map(([sector, group]) => ({
      sector,
      total: group.length,
      winRate: winRate(group),
      avgReturn: avg(group.map(s => s.returnAfter30d ?? s.returnAfter7d)),
    }))
    .sort((a, b) => b.total - a.total);

  // By confidence tier
  const tiers: AccuracyReport['byConfidenceTier'] = {
    low: { label: '40–55%', total: 0, winRate: 0, avgReturn: 0 },
    medium: { label: '55–70%', total: 0, winRate: 0, avgReturn: 0 },
    high: { label: '70–85%', total: 0, winRate: 0, avgReturn: 0 },
    vhigh: { label: '85%+', total: 0, winRate: 0, avgReturn: 0 },
  };
  const tierGroups: Record<string, typeof signals> = { low: [], medium: [], high: [], vhigh: [] };
  for (const s of signals) {
    const c = s.confidence;
    if (c >= 85) tierGroups.vhigh.push(s);
    else if (c >= 70) tierGroups.high.push(s);
    else if (c >= 55) tierGroups.medium.push(s);
    else tierGroups.low.push(s);
  }
  for (const key of ['low', 'medium', 'high', 'vhigh'] as const) {
    const group = tierGroups[key];
    tiers[key] = {
      ...tiers[key],
      total: group.length,
      winRate: winRate(group),
      avgReturn: avg(group.map(s => s.returnAfter30d ?? s.returnAfter7d)),
    };
  }

  // Entry/target/stop accuracy
  const withEntry = resolved.filter(s => s.entryHit != null);
  const withTarget = resolved.filter(s => s.targetHit != null && s.targetPrice != null);
  const withStop = resolved.filter(s => s.stopTriggered != null && s.stopLoss != null);

  // Rolling trend
  const rollingSince = (d: number) => {
    const dt = new Date();
    dt.setDate(dt.getDate() - d);
    const str = dt.toISOString().split('T')[0];
    const group = resolved.filter(s => s.signalDate >= str);
    return group.length >= 3 ? winRate(group) : null;
  };

  // Missed opportunities
  const missed = db.select().from(missedOpportunities)
    .where(gte(missedOpportunities.scanDate, sinceStr))
    .orderBy(sql`COALESCE(actual_return_30d, actual_return_7d) DESC`)
    .limit(10)
    .all();

  return {
    summary: {
      totalSignals: signals.length,
      resolvedSignals: resolved.length,
      pendingSignals: signals.filter(s => !s.outcome || s.outcome === 'pending').length,
      winRate: winRate(resolved),
      avgPredictedReturn: avg(predicted),
      avgActualReturn: avg(actual),
      predictionBias: bias,
      mae,
    },
    byAction,
    bySector,
    byConfidenceTier: tiers,
    entryAccuracy: {
      hitRate: withEntry.length > 0 ? Math.round((withEntry.filter(s => s.entryHit).length / withEntry.length) * 100) : 0,
      avgDeviation: avg(withEntry.map(s => s.entryDeviation)),
    },
    targetAccuracy: {
      hitRate: withTarget.length > 0 ? Math.round((withTarget.filter(s => s.targetHit).length / withTarget.length) * 100) : 0,
      avgDeviation: avg(withTarget.map(s => s.targetDeviation)),
    },
    stopAccuracy: {
      triggerRate: withStop.length > 0 ? Math.round((withStop.filter(s => s.stopTriggered).length / withStop.length) * 100) : 0,
      avgDeviation: avg(withStop.map(s => s.stopDeviation)),
    },
    trend: {
      rolling30d: rollingSince(30),
      rolling60d: rollingSince(60),
      rolling90d: rollingSince(90),
    },
    missedOpps: {
      total: missed.length,
      avgMissedReturn: avg(missed.map(m => m.actualReturn30d ?? m.actualReturn7d)),
      topMissed: missed.map(m => ({
        symbol: m.symbol,
        date: m.scanDate,
        return7d: m.actualReturn7d,
        return30d: m.actualReturn30d,
        wouldHaveBeen: m.wouldHaveBeen,
      })),
    },
  };
}
```

- [ ] **Step 2: Add missing imports** — verify `and`, `gte`, `eq`, `sql` are all available from `drizzle-orm`. The `not` and `isNull` imports may not be needed — remove unused ones.

- [ ] **Step 3: Verify compilation**

```bash
npx tsc --noEmit -p apps/backend/tsconfig.json 2>&1 | head -20
```

- [ ] **Step 4: Commit**

```bash
git add apps/backend/src/intelligence/accuracy.service.ts
git commit -m "feat(intelligence): accuracy.service — getAccuracyReport with win rate, bias, MAE, level accuracy, trends"
```

---

### Task 5: Add getAccuracyReport tRPC endpoint

**Files:**
- Modify: `apps/backend/src/intelligence/intelligence.router.ts`

- [ ] **Step 1: Add import**

```typescript
import { getAccuracyReport } from './accuracy.service.js';
```

- [ ] **Step 2: Add procedure to `intelligenceRouter`**

```typescript
accuracyReport: publicProcedure
  .input(z.object({ days: z.union([z.literal(30), z.literal(60), z.literal(90), z.literal(180)]).default(90) }).optional())
  .query(({ input }) => {
    return getAccuracyReport(input?.days ?? 90);
  }),
```

- [ ] **Step 3: Verify compilation and test endpoint**

```bash
npx tsc --noEmit -p apps/backend/tsconfig.json 2>&1 | head -20
```

- [ ] **Step 4: Commit**

```bash
git add apps/backend/src/intelligence/intelligence.router.ts
git commit -m "feat(intelligence): add accuracyReport tRPC endpoint"
```

---

### Task 6: Frontend — AccuracyDashboard component

**Files:**
- Create: `apps/frontend/src/intelligence/AccuracyDashboard.tsx`
- Modify: `apps/frontend/src/App.tsx`

- [ ] **Step 1: Create `AccuracyDashboard.tsx`**

```tsx
import { useState } from 'react';
import { trpc } from '../trpc.js';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';

const PERIOD_OPTIONS = [
  { value: 30 as const, label: '30d' },
  { value: 60 as const, label: '60d' },
  { value: 90 as const, label: '90d' },
  { value: 180 as const, label: '180d' },
];

function WinRateBadge({ rate }: { rate: number }) {
  const variant = rate >= 60 ? 'default' : rate >= 45 ? 'secondary' : 'destructive';
  return <Badge variant={variant}>{rate}%</Badge>;
}

function StatCard({ label, value, sub }: { label: string; value: string; sub?: string }) {
  return (
    <Card>
      <CardContent className="pt-4">
        <div className="text-2xl font-bold">{value}</div>
        <div className="text-sm text-muted-foreground">{label}</div>
        {sub && <div className="text-xs text-muted-foreground mt-1">{sub}</div>}
      </CardContent>
    </Card>
  );
}

export function AccuracyDashboard() {
  const [days, setDays] = useState<30 | 60 | 90 | 180>(90);
  const { data, isLoading } = trpc.intelligence.accuracyReport.useQuery({ days });

  if (isLoading) return <div className="p-4 text-muted-foreground">Cargando accuracy...</div>;
  if (!data) return <div className="p-4 text-muted-foreground">Sin datos de accuracy aún. Necesitas al menos algunas señales resueltas.</div>;

  const { summary, byAction, bySector, byConfidenceTier, entryAccuracy, targetAccuracy, stopAccuracy, trend, missedOpps } = data;

  return (
    <div className="space-y-6 p-4">
      {/* Period selector */}
      <div className="flex gap-2">
        {PERIOD_OPTIONS.map(opt => (
          <button
            key={opt.value}
            onClick={() => setDays(opt.value)}
            className={`px-3 py-1 rounded text-sm ${days === opt.value ? 'bg-primary text-primary-foreground' : 'bg-muted text-muted-foreground'}`}
          >
            {opt.label}
          </button>
        ))}
      </div>

      {/* Summary row */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <StatCard
          label="Win Rate Global"
          value={`${summary.winRate}%`}
          sub={`${summary.resolvedSignals} señales resueltas`}
        />
        <StatCard
          label="Sesgo de Predicción"
          value={`${summary.predictionBias > 0 ? '+' : ''}${summary.predictionBias.toFixed(1)}%`}
          sub={summary.predictionBias > 0 ? 'Optimista' : summary.predictionBias < 0 ? 'Pesimista' : 'Neutral'}
        />
        <StatCard
          label="MAE Predicción"
          value={`${summary.mae.toFixed(1)}%`}
          sub="Error absoluto medio"
        />
        <StatCard
          label="Pendientes"
          value={String(summary.pendingSignals)}
          sub="señales sin resolver"
        />
      </div>

      {/* Trend row */}
      <Card>
        <CardHeader><CardTitle className="text-sm">Tendencia Win Rate</CardTitle></CardHeader>
        <CardContent>
          <div className="flex gap-6">
            {trend.rolling30d != null && (
              <div className="text-center">
                <div className="text-lg font-bold">{trend.rolling30d}%</div>
                <div className="text-xs text-muted-foreground">últimos 30d</div>
              </div>
            )}
            {trend.rolling60d != null && (
              <div className="text-center">
                <div className="text-lg font-bold">{trend.rolling60d}%</div>
                <div className="text-xs text-muted-foreground">últimos 60d</div>
              </div>
            )}
            {trend.rolling90d != null && (
              <div className="text-center">
                <div className="text-lg font-bold">{trend.rolling90d}%</div>
                <div className="text-xs text-muted-foreground">últimos 90d</div>
              </div>
            )}
          </div>
        </CardContent>
      </Card>

      <Tabs defaultValue="action">
        <TabsList>
          <TabsTrigger value="action">Por Acción</TabsTrigger>
          <TabsTrigger value="levels">Entrada/Target/Stop</TabsTrigger>
          <TabsTrigger value="sector">Por Sector</TabsTrigger>
          <TabsTrigger value="confidence">Por Confianza</TabsTrigger>
          <TabsTrigger value="missed">Perdidas</TabsTrigger>
        </TabsList>

        {/* By Action */}
        <TabsContent value="action">
          <Card>
            <CardContent className="pt-4">
              <table className="w-full text-sm">
                <thead>
                  <tr className="text-muted-foreground border-b">
                    <th className="text-left py-2">Acción</th>
                    <th className="text-right py-2">Total</th>
                    <th className="text-right py-2">Resueltas</th>
                    <th className="text-right py-2">Win Rate</th>
                    <th className="text-right py-2">Ret. Prom.</th>
                  </tr>
                </thead>
                <tbody>
                  {Object.entries(byAction).map(([action, stats]) => (
                    <tr key={action} className="border-b border-border/40">
                      <td className="py-2 font-medium">{action}</td>
                      <td className="text-right">{stats.total}</td>
                      <td className="text-right">{stats.resolved}</td>
                      <td className="text-right"><WinRateBadge rate={stats.winRate} /></td>
                      <td className={`text-right ${stats.avgReturn >= 0 ? 'text-green-500' : 'text-red-500'}`}>
                        {stats.avgReturn > 0 ? '+' : ''}{stats.avgReturn.toFixed(1)}%
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </CardContent>
          </Card>
        </TabsContent>

        {/* Entry/Target/Stop */}
        <TabsContent value="levels">
          <div className="grid grid-cols-3 gap-3">
            <Card>
              <CardHeader><CardTitle className="text-sm">Entrada</CardTitle></CardHeader>
              <CardContent>
                <div className="text-2xl font-bold">{entryAccuracy.hitRate}%</div>
                <div className="text-xs text-muted-foreground">hit rate</div>
                <div className="mt-2 text-sm">{entryAccuracy.avgDeviation.toFixed(2)}% desviación promedio</div>
              </CardContent>
            </Card>
            <Card>
              <CardHeader><CardTitle className="text-sm">Target</CardTitle></CardHeader>
              <CardContent>
                <div className="text-2xl font-bold">{targetAccuracy.hitRate}%</div>
                <div className="text-xs text-muted-foreground">hit rate</div>
                <div className="mt-2 text-sm">{targetAccuracy.avgDeviation.toFixed(2)}% desviación promedio</div>
              </CardContent>
            </Card>
            <Card>
              <CardHeader><CardTitle className="text-sm">Stop Loss</CardTitle></CardHeader>
              <CardContent>
                <div className="text-2xl font-bold">{stopAccuracy.triggerRate}%</div>
                <div className="text-xs text-muted-foreground">tasa de activación</div>
                <div className="mt-2 text-sm">{stopAccuracy.avgDeviation.toFixed(2)}% desviación promedio</div>
              </CardContent>
            </Card>
          </div>
        </TabsContent>

        {/* By Sector */}
        <TabsContent value="sector">
          <Card>
            <CardContent className="pt-4">
              <table className="w-full text-sm">
                <thead>
                  <tr className="text-muted-foreground border-b">
                    <th className="text-left py-2">Sector</th>
                    <th className="text-right py-2">Total</th>
                    <th className="text-right py-2">Win Rate</th>
                    <th className="text-right py-2">Ret. Prom.</th>
                  </tr>
                </thead>
                <tbody>
                  {bySector.slice(0, 15).map(s => (
                    <tr key={s.sector} className="border-b border-border/40">
                      <td className="py-2">{s.sector}</td>
                      <td className="text-right">{s.total}</td>
                      <td className="text-right"><WinRateBadge rate={s.winRate} /></td>
                      <td className={`text-right ${s.avgReturn >= 0 ? 'text-green-500' : 'text-red-500'}`}>
                        {s.avgReturn > 0 ? '+' : ''}{s.avgReturn.toFixed(1)}%
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </CardContent>
          </Card>
        </TabsContent>

        {/* By Confidence */}
        <TabsContent value="confidence">
          <Card>
            <CardContent className="pt-4">
              <table className="w-full text-sm">
                <thead>
                  <tr className="text-muted-foreground border-b">
                    <th className="text-left py-2">Tier</th>
                    <th className="text-right py-2">Total</th>
                    <th className="text-right py-2">Win Rate</th>
                    <th className="text-right py-2">Ret. Prom.</th>
                  </tr>
                </thead>
                <tbody>
                  {Object.entries(byConfidenceTier).reverse().map(([key, tier]) => (
                    <tr key={key} className="border-b border-border/40">
                      <td className="py-2">{tier.label}</td>
                      <td className="text-right">{tier.total}</td>
                      <td className="text-right"><WinRateBadge rate={tier.winRate} /></td>
                      <td className={`text-right ${tier.avgReturn >= 0 ? 'text-green-500' : 'text-red-500'}`}>
                        {tier.avgReturn > 0 ? '+' : ''}{tier.avgReturn.toFixed(1)}%
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </CardContent>
          </Card>
        </TabsContent>

        {/* Missed Opportunities */}
        <TabsContent value="missed">
          <Card>
            <CardHeader>
              <div className="flex items-center justify-between">
                <CardTitle className="text-sm">Oportunidades Perdidas</CardTitle>
                <div className="text-sm text-muted-foreground">
                  Retorno prom: <span className="text-green-500">+{missedOpps.avgMissedReturn.toFixed(1)}%</span>
                </div>
              </div>
            </CardHeader>
            <CardContent>
              <table className="w-full text-sm">
                <thead>
                  <tr className="text-muted-foreground border-b">
                    <th className="text-left py-2">Símbolo</th>
                    <th className="text-right py-2">Fecha</th>
                    <th className="text-right py-2">Ret 7d</th>
                    <th className="text-right py-2">Ret 30d</th>
                    <th className="text-right py-2">Debió ser</th>
                  </tr>
                </thead>
                <tbody>
                  {missedOpps.topMissed.map((m, i) => (
                    <tr key={i} className="border-b border-border/40">
                      <td className="py-2 font-medium">{m.symbol}</td>
                      <td className="text-right text-muted-foreground">{m.date}</td>
                      <td className={`text-right ${(m.return7d ?? 0) >= 0 ? 'text-green-500' : 'text-red-500'}`}>
                        {m.return7d != null ? `+${m.return7d.toFixed(1)}%` : '—'}
                      </td>
                      <td className={`text-right ${(m.return30d ?? 0) >= 0 ? 'text-green-500' : 'text-red-500'}`}>
                        {m.return30d != null ? `+${m.return30d.toFixed(1)}%` : '—'}
                      </td>
                      <td className="text-right">
                        <Badge variant="outline" className="text-xs">{m.wouldHaveBeen ?? '—'}</Badge>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>
    </div>
  );
}
```

- [ ] **Step 2: Add Accuracy tab to App.tsx** — find the main `Tabs` component and add:

```tsx
import { AccuracyDashboard } from './intelligence/AccuracyDashboard.js';

// In TabsList add:
<TabsTrigger value="accuracy">Accuracy</TabsTrigger>

// In Tabs add:
<TabsContent value="accuracy">
  <AccuracyDashboard />
</TabsContent>
```

- [ ] **Step 3: Start frontend and verify**

```bash
npm run dev:frontend
# Navigate to Accuracy tab
# Should show "Sin datos de accuracy aún" if no resolved signals
# Or show dashboard if signals exist
```

- [ ] **Step 4: Commit**

```bash
git add apps/frontend/src/intelligence/AccuracyDashboard.tsx apps/frontend/src/App.tsx
git commit -m "feat(frontend): AccuracyDashboard — win rate, levels, sector/confidence breakdown, missed opps"
```
