# Fase 3: Ajuste Semi-automático de Pesos — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** El sistema genera propuestas de ajuste de scoring weights basadas en correlación con outcomes reales. El usuario las aprueba o rechaza desde la UI. Los pesos aprobados se aplican al pipeline automáticamente.

**Architecture:** Nuevas tablas `scoringWeightProposals` y `scoringWeightHistory`. `scoring.ts` lee pesos desde DB con fallback a defaults. Post-pipeline, si hay ≥20 señales resueltas nuevas, se genera propuesta. UI en tab Accuracy muestra propuesta con comparación visual.

**Prerequisite:** Fase 2 completada (señales con outcome resuelto disponibles, `getAccuracyReport` funcionando).

**Tech Stack:** Drizzle ORM + better-sqlite3, tRPC, TypeScript, React + Vite, shadcn/ui

---

## File Map

| Action | Path | Responsibility |
|--------|------|---------------|
| Modify | `apps/backend/src/db/schema.ts` | Add scoringWeightProposals + scoringWeightHistory |
| Create | `apps/backend/src/intelligence/weight-adjustment.service.ts` | Pearson correlation + proposal generation |
| Modify | `apps/backend/src/opportunities/scoring.ts` | Read weights from DB with in-memory cache |
| Modify | `apps/backend/src/intelligence/pipeline.service.ts` | Post-pipeline: check + generate weight proposal |
| Modify | `apps/backend/src/intelligence/intelligence.router.ts` | Weight proposal tRPC endpoints |
| Modify | `apps/frontend/src/intelligence/AccuracyDashboard.tsx` | Add weight proposal section |

---

### Task 1: Add weight tables to schema.ts

**Files:**
- Modify: `apps/backend/src/db/schema.ts`

- [ ] **Step 1: Add `scoringWeightProposals` table** at end of schema.ts

```typescript
// --- Scoring Weight Proposals (semi-automatic weight adjustment) ---
export const scoringWeightProposals = sqliteTable('scoring_weight_proposals', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  proposedAt: text('proposed_at').notNull().default(sql`(datetime('now'))`),
  signalCount: integer('signal_count').notNull(),
  shortTermBasis: integer('short_term_basis').notNull(),
  mediumTermBasis: integer('medium_term_basis').notNull(),
  currentWeights: text('current_weights').notNull(),  // JSON: {shortTerm:{tech,fund,sent}, mediumTerm:{tech,fund,sent}}
  proposedWeights: text('proposed_weights').notNull(), // JSON: same shape
  correlations: text('correlations').notNull(),         // JSON: same shape (raw Pearson values)
  status: text('status', { enum: ['pending', 'approved', 'rejected'] }).notNull().default('pending'),
  approvedAt: text('approved_at'),
  appliedAt: text('applied_at'),
  rejectedReason: text('rejected_reason'),
});

// --- Scoring Weight History (track all applied weight changes) ---
export const scoringWeightHistory = sqliteTable('scoring_weight_history', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  appliedAt: text('applied_at').notNull().default(sql`(datetime('now'))`),
  weights: text('weights').notNull(),                  // JSON: {shortTerm:{tech,fund,sent}, mediumTerm:{tech,fund,sent}}
  source: text('source', { enum: ['manual', 'proposal'] }).notNull(),
  proposalId: integer('proposal_id').references(() => scoringWeightProposals.id),
  accuracyBefore: real('accuracy_before'),
  accuracyAfter: real('accuracy_after'),              // filled 30d later
});
```

- [ ] **Step 2: Run migration** — restart backend:

```bash
npm run dev:backend
sqlite3 data/trading.db ".tables" | grep -E "scoring_weight"
```

Expected: `scoring_weight_proposals  scoring_weight_history`

- [ ] **Step 3: Commit**

```bash
git add apps/backend/src/db/schema.ts
git commit -m "feat(db): add scoringWeightProposals and scoringWeightHistory tables"
```

---

### Task 2: Create weight-adjustment.service.ts

**Files:**
- Create: `apps/backend/src/intelligence/weight-adjustment.service.ts`

- [ ] **Step 1: Create the file**

```typescript
import { db } from '../db/database.js';
import { signalTracking, scoringWeightProposals, scoringWeightHistory } from '../db/schema.js';
import { eq, gte, and, desc } from 'drizzle-orm';

export interface ScoringWeights {
  shortTerm: { tech: number; fund: number; sent: number };
  mediumTerm: { tech: number; fund: number; sent: number };
}

// ─── Defaults (original hardcoded values) ────────────────────────────────────

export const DEFAULT_WEIGHTS: ScoringWeights = {
  shortTerm: { tech: 0.40, fund: 0.20, sent: 0.40 },
  mediumTerm: { tech: 0.35, fund: 0.45, sent: 0.20 },
};

// ─── Active weights cache ─────────────────────────────────────────────────────

let _cachedWeights: ScoringWeights | null = null;
let _cacheExpiry = 0;
const CACHE_TTL_MS = 24 * 60 * 60 * 1000; // 24h

export function getActiveWeights(): ScoringWeights {
  if (_cachedWeights && Date.now() < _cacheExpiry) return _cachedWeights;

  const latest = db.select()
    .from(scoringWeightHistory)
    .orderBy(desc(scoringWeightHistory.appliedAt))
    .limit(1)
    .get();

  if (latest) {
    _cachedWeights = JSON.parse(latest.weights) as ScoringWeights;
    _cacheExpiry = Date.now() + CACHE_TTL_MS;
    return _cachedWeights;
  }

  return DEFAULT_WEIGHTS;
}

export function invalidateWeightsCache(): void {
  _cachedWeights = null;
  _cacheExpiry = 0;
}

// ─── Pearson correlation ──────────────────────────────────────────────────────

function pearson(xs: number[], ys: number[]): number {
  if (xs.length !== ys.length || xs.length < 3) return 0;
  const n = xs.length;
  const meanX = xs.reduce((a, b) => a + b, 0) / n;
  const meanY = ys.reduce((a, b) => a + b, 0) / n;
  const num = xs.reduce((sum, x, i) => sum + (x - meanX) * (ys[i] - meanY), 0);
  const denX = Math.sqrt(xs.reduce((sum, x) => sum + (x - meanX) ** 2, 0));
  const denY = Math.sqrt(ys.reduce((sum, y) => sum + (y - meanY) ** 2, 0));
  if (denX === 0 || denY === 0) return 0;
  return num / (denX * denY);
}

function normalizeWeights(raw: { tech: number; fund: number; sent: number }, minEach = 0.10) {
  // Clamp negatives to min, then normalize to 1.0
  const t = Math.max(raw.tech, minEach);
  const f = Math.max(raw.fund, minEach);
  const s = Math.max(raw.sent, minEach);
  const total = t + f + s;
  return {
    tech: Math.round((t / total) * 100) / 100,
    fund: Math.round((f / total) * 100) / 100,
    sent: Math.round((s / total) * 100) / 100,
  };
}

// ─── Proposal generation ──────────────────────────────────────────────────────

const MIN_SIGNALS_FOR_PROPOSAL = 20;

export function shouldGenerateProposal(): boolean {
  // Check if there's already a pending proposal
  const pending = db.select()
    .from(scoringWeightProposals)
    .where(eq(scoringWeightProposals.status, 'pending'))
    .get();
  if (pending) return false;

  // Count resolved signals since last approved proposal
  const lastApproved = db.select()
    .from(scoringWeightProposals)
    .where(eq(scoringWeightProposals.status, 'approved'))
    .orderBy(desc(scoringWeightProposals.approvedAt))
    .limit(1)
    .get();

  const since = lastApproved?.approvedAt ?? '2000-01-01';
  const resolved = db.select()
    .from(signalTracking)
    .where(
      and(
        gte(signalTracking.resolvedAt, since),
        eq(signalTracking.outcome, 'win')
      )
    )
    .all();

  // We need total resolved (wins + losses), not just wins
  const allResolved = db.select()
    .from(signalTracking)
    .where(
      and(
        gte(signalTracking.resolvedAt, since)
      )
    )
    .all()
    .filter(s => s.outcome && s.outcome !== 'pending');

  return allResolved.length >= MIN_SIGNALS_FOR_PROPOSAL;
}

export function generateWeightProposal(): { id: number } | null {
  if (!shouldGenerateProposal()) return null;

  // Fetch resolved signals with dimension scores
  const signals = db.select()
    .from(signalTracking)
    .all()
    .filter(s => s.outcome && s.outcome !== 'pending' && s.techScore != null && s.fundScore != null && s.sentScore != null);

  if (signals.length < MIN_SIGNALS_FOR_PROPOSAL) return null;

  // Build outcome vector: win=1, loss=0, neutral=0.5
  function outcomeVal(o: string | null): number {
    if (o === 'win') return 1;
    if (o === 'loss') return 0;
    return 0.5;
  }

  // Short-term: signals with shortTermScore available
  const stSignals = signals.filter(s => s.shortTermScore != null);
  // Medium-term: all signals
  const mtSignals = signals;

  const stOutcomes = stSignals.map(s => outcomeVal(s.outcome));
  const mtOutcomes = mtSignals.map(s => outcomeVal(s.outcome));

  const stCorr = {
    tech: pearson(stSignals.map(s => s.techScore!), stOutcomes),
    fund: pearson(stSignals.map(s => s.fundScore!), stOutcomes),
    sent: pearson(stSignals.map(s => s.sentScore!), stOutcomes),
  };

  const mtCorr = {
    tech: pearson(mtSignals.map(s => s.techScore!), mtOutcomes),
    fund: pearson(mtSignals.map(s => s.fundScore!), mtOutcomes),
    sent: pearson(mtSignals.map(s => s.sentScore!), mtOutcomes),
  };

  const proposedWeights: ScoringWeights = {
    shortTerm: normalizeWeights(stCorr),
    mediumTerm: normalizeWeights(mtCorr),
  };

  const currentWeights = getActiveWeights();

  const result = db.insert(scoringWeightProposals).values({
    signalCount: signals.length,
    shortTermBasis: stSignals.length,
    mediumTermBasis: mtSignals.length,
    currentWeights: JSON.stringify(currentWeights),
    proposedWeights: JSON.stringify(proposedWeights),
    correlations: JSON.stringify({ shortTerm: stCorr, mediumTerm: mtCorr }),
    status: 'pending',
  }).returning().get();

  console.log(`[weight-adjustment] Generated proposal #${result.id} based on ${signals.length} signals`);
  return { id: result.id };
}

// ─── Approve / Reject ─────────────────────────────────────────────────────────

export function approveWeightProposal(id: number): void {
  const proposal = db.select().from(scoringWeightProposals).where(eq(scoringWeightProposals.id, id)).get();
  if (!proposal || proposal.status !== 'pending') throw new Error('Propuesta no encontrada o ya procesada');

  const now = new Date().toISOString();
  const weights = JSON.parse(proposal.proposedWeights) as ScoringWeights;

  // Update proposal status
  db.update(scoringWeightProposals).set({
    status: 'approved',
    approvedAt: now,
    appliedAt: now,
  }).where(eq(scoringWeightProposals.id, id)).run();

  // Record in history
  db.insert(scoringWeightHistory).values({
    weights: proposal.proposedWeights,
    source: 'proposal',
    proposalId: id,
    accuracyBefore: null,
  }).run();

  // Invalidate cache so pipeline picks up new weights
  invalidateWeightsCache();
  console.log(`[weight-adjustment] Proposal #${id} approved and applied`);
}

export function rejectWeightProposal(id: number, reason?: string): void {
  const proposal = db.select().from(scoringWeightProposals).where(eq(scoringWeightProposals.id, id)).get();
  if (!proposal || proposal.status !== 'pending') throw new Error('Propuesta no encontrada o ya procesada');

  db.update(scoringWeightProposals).set({
    status: 'rejected',
    rejectedReason: reason ?? null,
  }).where(eq(scoringWeightProposals.id, id)).run();

  console.log(`[weight-adjustment] Proposal #${id} rejected`);
}

// ─── Queries ──────────────────────────────────────────────────────────────────

export function getPendingProposal() {
  const row = db.select()
    .from(scoringWeightProposals)
    .where(eq(scoringWeightProposals.status, 'pending'))
    .orderBy(desc(scoringWeightProposals.proposedAt))
    .limit(1)
    .get();
  if (!row) return null;
  return {
    ...row,
    currentWeights: JSON.parse(row.currentWeights) as ScoringWeights,
    proposedWeights: JSON.parse(row.proposedWeights) as ScoringWeights,
    correlations: JSON.parse(row.correlations) as { shortTerm: { tech: number; fund: number; sent: number }; mediumTerm: { tech: number; fund: number; sent: number } },
  };
}

export function getWeightHistory() {
  return db.select()
    .from(scoringWeightHistory)
    .orderBy(desc(scoringWeightHistory.appliedAt))
    .limit(20)
    .all()
    .map(row => ({ ...row, weights: JSON.parse(row.weights) as ScoringWeights }));
}
```

- [ ] **Step 2: Verify compilation**

```bash
npx tsc --noEmit -p apps/backend/tsconfig.json 2>&1 | head -20
```

- [ ] **Step 3: Commit**

```bash
git add apps/backend/src/intelligence/weight-adjustment.service.ts
git commit -m "feat(intelligence): weight-adjustment.service — Pearson correlation, proposal generation, approve/reject"
```

---

### Task 3: Make scoring.ts read weights from DB

**Files:**
- Modify: `apps/backend/src/opportunities/scoring.ts`

- [ ] **Step 1: Open `scoring.ts`** and find the scoring weight constants. They will look something like:

```typescript
const SHORT_TERM_WEIGHTS = { sentiment: 0.40, technical: 0.40, fundamental: 0.20 };
const MEDIUM_TERM_WEIGHTS = { sentiment: 0.20, technical: 0.35, fundamental: 0.45 };
```

- [ ] **Step 2: Add import at top of file**

```typescript
import { getActiveWeights, DEFAULT_WEIGHTS } from '../intelligence/weight-adjustment.service.js';
```

- [ ] **Step 3: Replace constant references with dynamic weight reads**

Find `computeCompositeScore` or whichever function applies the short/medium term weights and modify it to use `getActiveWeights()`:

```typescript
export function computeCompositeScore(techScore: number, fundScore: number, sentScore: number): {
  shortTerm: number;
  mediumTerm: number;
  composite: number;
} {
  const weights = getActiveWeights();

  const techN = normalizeTechnical(techScore);
  const fundN = normalizeFundamental(fundScore);
  const sentN = normalizeSentiment(sentScore);

  const shortTerm = techN * weights.shortTerm.tech + fundN * weights.shortTerm.fund + sentN * weights.shortTerm.sent;
  const mediumTerm = techN * weights.mediumTerm.tech + fundN * weights.mediumTerm.fund + sentN * weights.mediumTerm.sent;
  const composite = shortTerm * 0.4 + mediumTerm * 0.6;

  return { shortTerm, mediumTerm, composite };
}
```

> Note: The exact implementation depends on how `scoring.ts` currently applies weights. Find the weight application and replace the hardcoded constants with `getActiveWeights()`. The `getActiveWeights()` call is O(1) cached — safe to call per-symbol.

- [ ] **Step 4: Verify the circular dependency is avoided** — `scoring.ts` → `weight-adjustment.service.ts` → `scoring.ts` would be a circular import. Check that `weight-adjustment.service.ts` does NOT import from `scoring.ts`. If it does, move `DEFAULT_WEIGHTS` to a separate `scoring-defaults.ts` file.

- [ ] **Step 5: Verify compilation**

```bash
npx tsc --noEmit -p apps/backend/tsconfig.json 2>&1 | head -20
```

- [ ] **Step 6: Commit**

```bash
git add apps/backend/src/opportunities/scoring.ts
git commit -m "feat(scoring): read weights from DB via getActiveWeights() with fallback to defaults"
```

---

### Task 4: Post-pipeline hook — auto-generate proposal

**Files:**
- Modify: `apps/backend/src/intelligence/pipeline.service.ts`

- [ ] **Step 1: Add import**

```typescript
import { generateWeightProposal, shouldGenerateProposal } from './weight-adjustment.service.js';
```

- [ ] **Step 2: After `resolveExpiredSignals()` call**, add proposal generation:

Find the end of the pipeline (after `recordSignals`, `resolveExpiredSignals`, `recordMissedOpportunities`):

```typescript
// After resolveExpiredSignals():
if (shouldGenerateProposal()) {
  const proposal = generateWeightProposal();
  if (proposal) {
    console.log(`[pipeline] Weight adjustment proposal #${proposal.id} generated — pending user approval`);
  }
}
```

- [ ] **Step 3: Verify compilation**

```bash
npx tsc --noEmit -p apps/backend/tsconfig.json 2>&1 | head -20
```

- [ ] **Step 4: Commit**

```bash
git add apps/backend/src/intelligence/pipeline.service.ts
git commit -m "feat(pipeline): auto-generate weight proposal post-run when ≥20 resolved signals available"
```

---

### Task 5: tRPC endpoints for weight management

**Files:**
- Modify: `apps/backend/src/intelligence/intelligence.router.ts`

- [ ] **Step 1: Add imports**

```typescript
import {
  getPendingProposal,
  getWeightHistory,
  approveWeightProposal,
  rejectWeightProposal,
  getActiveWeights,
} from './weight-adjustment.service.js';
```

- [ ] **Step 2: Add procedures to `intelligenceRouter`**

```typescript
// Weight adjustment
weightPendingProposal: publicProcedure.query(() => {
  return getPendingProposal();
}),

weightHistory: publicProcedure.query(() => {
  return getWeightHistory();
}),

weightCurrentWeights: publicProcedure.query(() => {
  return getActiveWeights();
}),

weightApproveProposal: publicProcedure
  .input(z.object({ id: z.number() }))
  .mutation(({ input }) => {
    approveWeightProposal(input.id);
    return { ok: true };
  }),

weightRejectProposal: publicProcedure
  .input(z.object({ id: z.number(), reason: z.string().optional() }))
  .mutation(({ input }) => {
    rejectWeightProposal(input.id, input.reason);
    return { ok: true };
  }),
```

- [ ] **Step 3: Verify compilation**

```bash
npx tsc --noEmit -p apps/backend/tsconfig.json 2>&1 | head -20
```

- [ ] **Step 4: Commit**

```bash
git add apps/backend/src/intelligence/intelligence.router.ts
git commit -m "feat(intelligence): tRPC endpoints for weight proposal management"
```

---

### Task 6: Frontend — Weight Proposal UI in AccuracyDashboard

**Files:**
- Modify: `apps/frontend/src/intelligence/AccuracyDashboard.tsx`

- [ ] **Step 1: Add weight queries and mutations** to the component (after existing trpc calls). `AccuracyDashboard` already has `const utils = trpc.useUtils()` from Phase 2 — if not, add it:

```tsx
const utils = trpc.useUtils(); // add if not already present
const { data: pendingProposal, refetch: refetchProposal } = trpc.intelligence.weightPendingProposal.useQuery();
const { data: currentWeights } = trpc.intelligence.weightCurrentWeights.useQuery();
const { data: weightHistory } = trpc.intelligence.weightHistory.useQuery();

const approveProposal = trpc.intelligence.weightApproveProposal.useMutation({
  onSuccess: () => { refetchProposal(); utils.intelligence.weightHistory.invalidate(); },
});
const rejectProposal = trpc.intelligence.weightRejectProposal.useMutation({
  onSuccess: () => refetchProposal(),
});
```

- [ ] **Step 2: Add `WeightBar` helper component** inside the file (before `AccuracyDashboard`):

```tsx
function WeightBar({ label, current, proposed }: { label: string; current: number; proposed?: number }) {
  const pct = Math.round((proposed ?? current) * 100);
  const curPct = Math.round(current * 100);
  return (
    <div className="space-y-1">
      <div className="flex justify-between text-xs">
        <span>{label}</span>
        <span className="text-muted-foreground">
          {proposed !== undefined && proposed !== current
            ? <><span className="line-through text-muted-foreground">{curPct}%</span> → <span className="text-primary">{pct}%</span></>
            : `${curPct}%`}
        </span>
      </div>
      <div className="h-2 bg-muted rounded overflow-hidden">
        <div className="h-full bg-primary rounded" style={{ width: `${pct}%` }} />
      </div>
    </div>
  );
}
```

- [ ] **Step 3: Add weight section after the existing Tabs block** in the `AccuracyDashboard` return:

```tsx
{/* Weight Adjustment */}
{pendingProposal && (
  <Card className="border-primary/50">
    <CardHeader>
      <div className="flex items-center justify-between">
        <CardTitle className="text-sm">Nueva Sugerencia de Pesos</CardTitle>
        <Badge>Pendiente</Badge>
      </div>
      <p className="text-xs text-muted-foreground">
        Calculado sobre {pendingProposal.signalCount} señales resueltas.
        Short-term: {pendingProposal.shortTermBasis} | Medium-term: {pendingProposal.mediumTermBasis}
      </p>
    </CardHeader>
    <CardContent className="space-y-4">
      <div className="grid grid-cols-2 gap-6">
        <div>
          <div className="text-xs font-medium mb-2 text-muted-foreground">SHORT TERM</div>
          <div className="space-y-2">
            <WeightBar label="Technical" current={pendingProposal.currentWeights.shortTerm.tech} proposed={pendingProposal.proposedWeights.shortTerm.tech} />
            <WeightBar label="Fundamental" current={pendingProposal.currentWeights.shortTerm.fund} proposed={pendingProposal.proposedWeights.shortTerm.fund} />
            <WeightBar label="Sentiment" current={pendingProposal.currentWeights.shortTerm.sent} proposed={pendingProposal.proposedWeights.shortTerm.sent} />
          </div>
        </div>
        <div>
          <div className="text-xs font-medium mb-2 text-muted-foreground">MEDIUM TERM</div>
          <div className="space-y-2">
            <WeightBar label="Technical" current={pendingProposal.currentWeights.mediumTerm.tech} proposed={pendingProposal.proposedWeights.mediumTerm.tech} />
            <WeightBar label="Fundamental" current={pendingProposal.currentWeights.mediumTerm.fund} proposed={pendingProposal.proposedWeights.mediumTerm.fund} />
            <WeightBar label="Sentiment" current={pendingProposal.currentWeights.mediumTerm.sent} proposed={pendingProposal.proposedWeights.mediumTerm.sent} />
          </div>
        </div>
      </div>

      <div className="text-xs text-muted-foreground space-y-1">
        <div>Correlaciones — Short: Tech {(pendingProposal.correlations.shortTerm.tech * 100).toFixed(0)}% | Fund {(pendingProposal.correlations.shortTerm.fund * 100).toFixed(0)}% | Sent {(pendingProposal.correlations.shortTerm.sent * 100).toFixed(0)}%</div>
        <div>Correlaciones — Mid: Tech {(pendingProposal.correlations.mediumTerm.tech * 100).toFixed(0)}% | Fund {(pendingProposal.correlations.mediumTerm.fund * 100).toFixed(0)}% | Sent {(pendingProposal.correlations.mediumTerm.sent * 100).toFixed(0)}%</div>
      </div>

      <div className="flex gap-2">
        <Button
          size="sm"
          onClick={() => approveProposal.mutate({ id: pendingProposal.id })}
          disabled={approveProposal.isPending}
        >
          Aplicar pesos sugeridos
        </Button>
        <Button
          variant="outline"
          size="sm"
          onClick={() => rejectProposal.mutate({ id: pendingProposal.id, reason: 'Manual rejection' })}
          disabled={rejectProposal.isPending}
        >
          Rechazar
        </Button>
      </div>
    </CardContent>
  </Card>
)}

{/* Current weights (when no pending proposal) */}
{!pendingProposal && currentWeights && (
  <Card>
    <CardHeader><CardTitle className="text-sm">Pesos Activos</CardTitle></CardHeader>
    <CardContent>
      <div className="grid grid-cols-2 gap-6">
        <div>
          <div className="text-xs font-medium mb-2 text-muted-foreground">SHORT TERM</div>
          <div className="space-y-2">
            <WeightBar label="Technical" current={currentWeights.shortTerm.tech} />
            <WeightBar label="Fundamental" current={currentWeights.shortTerm.fund} />
            <WeightBar label="Sentiment" current={currentWeights.shortTerm.sent} />
          </div>
        </div>
        <div>
          <div className="text-xs font-medium mb-2 text-muted-foreground">MEDIUM TERM</div>
          <div className="space-y-2">
            <WeightBar label="Technical" current={currentWeights.mediumTerm.tech} />
            <WeightBar label="Fundamental" current={currentWeights.mediumTerm.fund} />
            <WeightBar label="Sentiment" current={currentWeights.mediumTerm.sent} />
          </div>
        </div>
      </div>
    </CardContent>
  </Card>
)}

{/* Weight History */}
{weightHistory && weightHistory.length > 0 && (
  <Card>
    <CardHeader><CardTitle className="text-sm">Historial de Pesos</CardTitle></CardHeader>
    <CardContent>
      <table className="w-full text-xs">
        <thead>
          <tr className="text-muted-foreground border-b">
            <th className="text-left py-2">Fecha</th>
            <th className="text-left py-2">Origen</th>
            <th className="text-right py-2">ST Tech/Fund/Sent</th>
            <th className="text-right py-2">MT Tech/Fund/Sent</th>
          </tr>
        </thead>
        <tbody>
          {weightHistory.map(h => (
            <tr key={h.id} className="border-b border-border/40">
              <td className="py-1">{h.appliedAt.split('T')[0]}</td>
              <td>{h.source}</td>
              <td className="text-right font-mono">
                {Math.round(h.weights.shortTerm.tech * 100)}/{Math.round(h.weights.shortTerm.fund * 100)}/{Math.round(h.weights.shortTerm.sent * 100)}
              </td>
              <td className="text-right font-mono">
                {Math.round(h.weights.mediumTerm.tech * 100)}/{Math.round(h.weights.mediumTerm.fund * 100)}/{Math.round(h.weights.mediumTerm.sent * 100)}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </CardContent>
  </Card>
)}
```

- [ ] **Step 4: Verify frontend compiles**

```bash
cd apps/frontend && npx tsc --noEmit 2>&1 | head -20
```

- [ ] **Step 5: Start frontend and verify UI**

```bash
npm run dev:frontend
# Navigate to Accuracy tab
# If no pending proposal: should show "Pesos Activos" with current weights
# After ≥20 resolved signals and a pipeline run: proposal card appears
```

- [ ] **Step 6: Commit**

```bash
git add apps/frontend/src/intelligence/AccuracyDashboard.tsx
git commit -m "feat(frontend): weight proposal UI in AccuracyDashboard — visual comparison, approve/reject, history"
```
