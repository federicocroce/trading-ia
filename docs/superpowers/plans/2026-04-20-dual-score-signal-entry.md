# Dual Score: Signal Strength + Entry Quality — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add an `entryScore` (0–100) alongside the existing `opportunityScore` and display both as horizontal bars in the signal card header.

**Architecture:** `computeEntryScore()` runs inside `buildAlgorithmicOpportunity()` after trade levels and conflicts are computed, reading already-available fields (RSI, R/R, conflicts, timing, stop distance). The result is stored as `entryScore` on the `Opportunity` object and rendered in the frontend as two stacked bars replacing the current single number.

**Tech Stack:** TypeScript, Vitest (new, for backend unit tests), React + Tailwind

---

## File Map

| Action | File | What changes |
|--------|------|-------------|
| Modify | `packages/shared/src/types/opportunity.ts:103` | Add `entryScore?: number` |
| Modify | `apps/backend/src/opportunities/scoring.ts:1425` | Add `computeEntryScore()` + call before `return result` |
| Create | `apps/backend/src/opportunities/entry-score.test.ts` | Unit tests for `computeEntryScore` |
| Modify | `apps/backend/package.json` | Add vitest devDependency |
| Create | `apps/backend/vitest.config.ts` | Vitest config |
| Modify | `apps/frontend/src/opportunities/OpportunityCard.tsx:260-298` | Replace single score with two bars |

---

## Task 1: Add `entryScore` to shared types

**Files:**
- Modify: `packages/shared/src/types/opportunity.ts`

- [ ] **Step 1: Add the field**

In `packages/shared/src/types/opportunity.ts`, after line 102 (`signalConflicts?: SignalConflict[];`), add:

```typescript
  entryScore?: number;
```

The full block around it should look like:
```typescript
  signalConflicts?: SignalConflict[];
  entryScore?: number;
  narrativeDigest?: string;
```

- [ ] **Step 2: Typecheck**

```bash
cd /Users/federicocroce/Documents/Fede/trading
npm run typecheck -w packages/shared
```

Expected: no errors.

- [ ] **Step 3: Commit**

```bash
git add packages/shared/src/types/opportunity.ts
git commit -m "feat(shared): add entryScore field to Opportunity interface"
```

---

## Task 2: Setup Vitest in backend

**Files:**
- Modify: `apps/backend/package.json`
- Create: `apps/backend/vitest.config.ts`

- [ ] **Step 1: Install vitest**

```bash
cd /Users/federicocroce/Documents/Fede/trading/apps/backend
npm install -D vitest
```

Expected: vitest added to devDependencies in `apps/backend/package.json`.

- [ ] **Step 2: Add test script to package.json**

In `apps/backend/package.json`, add to `scripts`:
```json
"test": "vitest run"
```

- [ ] **Step 3: Create vitest config**

Create `apps/backend/vitest.config.ts`:

```typescript
import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'node',
  },
});
```

- [ ] **Step 4: Verify vitest runs (no tests yet)**

```bash
cd /Users/federicocroce/Documents/Fede/trading/apps/backend
npm test
```

Expected: "No test files found" or exits cleanly (exit 0 or 1 depending on vitest version — both are fine).

- [ ] **Step 5: Commit**

```bash
git add apps/backend/package.json apps/backend/vitest.config.ts
git commit -m "chore(backend): add vitest for unit testing"
```

---

## Task 3: Implement `computeEntryScore`

**Files:**
- Create: `apps/backend/src/opportunities/entry-score.test.ts`
- Modify: `apps/backend/src/opportunities/scoring.ts`

- [ ] **Step 1: Write the failing tests**

Create `apps/backend/src/opportunities/entry-score.test.ts`:

```typescript
import { describe, it, expect } from 'vitest';
import { computeEntryScore } from './scoring.js';

describe('computeEntryScore', () => {
  it('returns low score for overbought RSI with conflicts', () => {
    const score = computeEntryScore({
      rsi: 96,
      riskReward: 1.2,
      conflictCount: 1,
      timingConfidence: 50,
      currentPrice: 4.86,
      stopLoss: 4.20,
    });
    expect(score).toBeLessThan(45);
  });

  it('returns high score for oversold RSI, good R/R, no conflicts', () => {
    const score = computeEntryScore({
      rsi: 32,
      riskReward: 2.8,
      conflictCount: 0,
      timingConfidence: 80,
      currentPrice: 187,
      stopLoss: 183,
    });
    expect(score).toBeGreaterThan(75);
  });

  it('uses neutral fallbacks when optional fields are missing', () => {
    const score = computeEntryScore({
      rsi: null,
      riskReward: null,
      conflictCount: 0,
      timingConfidence: null,
      currentPrice: 100,
      stopLoss: null,
    });
    // All neutrals: RSI=50, R/R=40, conflicts=100, timing=50, support=50
    // = 50*0.25 + 40*0.25 + 100*0.25 + 50*0.15 + 50*0.10 = 12.5+10+25+7.5+5 = 60
    expect(score).toBe(60);
  });

  it('returns 0 for RSI > 75', () => {
    const score = computeEntryScore({
      rsi: 80,
      riskReward: null,
      conflictCount: 3,
      timingConfidence: 0,
      currentPrice: 100,
      stopLoss: null,
    });
    // RSI=0, R/R=40, conflicts=0, timing=0, support=50
    // = 0*0.25 + 40*0.25 + 0*0.25 + 0*0.15 + 50*0.10 = 0+10+0+0+5 = 15
    expect(score).toBe(15);
  });
});
```

- [ ] **Step 2: Run tests — verify they fail**

```bash
cd /Users/federicocroce/Documents/Fede/trading/apps/backend
npm test
```

Expected: FAIL — `computeEntryScore` is not exported from `scoring.ts`.

- [ ] **Step 3: Implement `computeEntryScore` in scoring.ts**

Add the following before the `buildAlgorithmicOpportunity` function (around line 1182, i.e. just before `export function buildAlgorithmicOpportunity`):

```typescript
function scoreRsi(rsi: number | null | undefined): number {
  if (rsi == null) return 50;
  if (rsi <= 40) return 100;
  if (rsi <= 65) return 70;
  if (rsi <= 75) return 30;
  return 0;
}

function scoreRiskReward(rr: number | null | undefined): number {
  if (rr == null) return 40;
  if (rr >= 2.5) return 100;
  if (rr >= 1.5) return 60;
  return 0;
}

function scoreConflicts(count: number): number {
  if (count === 0) return 100;
  if (count === 1) return 60;
  if (count === 2) return 20;
  return 0;
}

function scoreSupportDistance(currentPrice: number, stopLoss: number | null | undefined): number {
  if (stopLoss == null || stopLoss >= currentPrice) return 50;
  const distPct = ((currentPrice - stopLoss) / currentPrice) * 100;
  if (distPct <= 2) return 100;
  if (distPct <= 5) return 70;
  if (distPct <= 10) return 40;
  return 10;
}

export function computeEntryScore(params: {
  rsi: number | null | undefined;
  riskReward: number | null | undefined;
  conflictCount: number;
  timingConfidence: number | null | undefined;
  currentPrice: number;
  stopLoss: number | null | undefined;
}): number {
  const rsiScore = scoreRsi(params.rsi);
  const rrScore = scoreRiskReward(params.riskReward);
  const conflictScore = scoreConflicts(params.conflictCount);
  const timingScore = params.timingConfidence ?? 50;
  const supportScore = scoreSupportDistance(params.currentPrice, params.stopLoss);

  return Math.round(
    rsiScore * 0.25 +
    rrScore * 0.25 +
    conflictScore * 0.25 +
    timingScore * 0.15 +
    supportScore * 0.10,
  );
}
```

- [ ] **Step 4: Call `computeEntryScore` in `buildAlgorithmicOpportunity`**

In `scoring.ts`, find this block (around line 1425–1427):
```typescript
  // === ACTION CONDITION: qué tiene que pasar para que cambie la acción ===
  result.actionCondition = buildActionCondition(result, tech);

  return result;
```

Replace with:
```typescript
  // === ACTION CONDITION: qué tiene que pasar para que cambie la acción ===
  result.actionCondition = buildActionCondition(result, tech);

  result.entryScore = computeEntryScore({
    rsi: tech?.indicators.rsi14,
    riskReward: result.tradeLevels?.riskRewardRatio,
    conflictCount: result.signalConflicts?.length ?? 0,
    timingConfidence: result.timingView?.confidence,
    currentPrice: result.currentPrice,
    stopLoss: result.tradeLevels?.stopLoss,
  });

  return result;
```

- [ ] **Step 5: Run tests — verify they pass**

```bash
cd /Users/federicocroce/Documents/Fede/trading/apps/backend
npm test
```

Expected: 4 tests pass.

- [ ] **Step 6: Typecheck backend**

```bash
cd /Users/federicocroce/Documents/Fede/trading
npm run typecheck -w apps/backend
```

Expected: no errors.

- [ ] **Step 7: Commit**

```bash
git add apps/backend/src/opportunities/scoring.ts apps/backend/src/opportunities/entry-score.test.ts
git commit -m "feat(backend): add computeEntryScore — entry quality scoring"
```

---

## Task 4: Update frontend card

**Files:**
- Modify: `apps/frontend/src/opportunities/OpportunityCard.tsx`

- [ ] **Step 1: Add `ScoreBar` helper component**

In `OpportunityCard.tsx`, before the `OpportunityCard` function (around line 254), add:

```tsx
function scoreBarColor(value: number): string {
  if (value >= 75) return 'bg-green-500';
  if (value >= 60) return 'bg-yellow-400';
  if (value >= 40) return 'bg-orange-500';
  return 'bg-red-500';
}

function scoreTextColor(value: number): string {
  if (value >= 75) return 'text-green-400';
  if (value >= 60) return 'text-yellow-400';
  if (value >= 40) return 'text-orange-400';
  return 'text-red-400';
}

function ScoreBar({ label, value }: { label: string; value: number }) {
  return (
    <div className="flex items-center gap-1.5">
      <span className="text-[9px] text-muted-foreground uppercase w-12 text-right shrink-0">{label}</span>
      <div className="w-16 h-1.5 bg-muted rounded-full overflow-hidden">
        <div
          className={`h-full rounded-full ${scoreBarColor(value)}`}
          style={{ width: `${value}%` }}
        />
      </div>
      <span className={`text-[11px] font-bold font-mono w-5 text-right ${scoreTextColor(value)}`}>
        {value}
      </span>
    </div>
  );
}
```

- [ ] **Step 2: Remove `scoreColor` variable and replace the score block**

Remove this (lines 260–263):
```typescript
  const scoreColor =
    opportunity.opportunityScore >= 65 ? 'text-green-400' :
    opportunity.opportunityScore >= 45 ? 'text-yellow-400' :
    'text-muted-foreground';
```

Replace the score `<Tooltip>` block (lines 287–298):
```tsx
{/* Score */}
<Tooltip>
  <TooltipTrigger asChild>
    <div className="flex items-center gap-1 cursor-help shrink-0">
      <span className="text-[9px] text-muted-foreground uppercase">Score</span>
      <span className={`text-sm font-bold font-mono ${scoreColor}`}>
        {opportunity.opportunityScore}
      </span>
    </div>
  </TooltipTrigger>
  <TooltipContent>Score 0-100: combina técnico, fundamental y sentimiento.</TooltipContent>
</Tooltip>
```

With:
```tsx
{/* Scores: Señal + Entrada */}
<Tooltip>
  <TooltipTrigger asChild>
    <div className="flex flex-col gap-1 cursor-help shrink-0">
      <ScoreBar label="Señal" value={opportunity.opportunityScore} />
      {opportunity.entryScore != null && (
        <ScoreBar label="Entrada" value={opportunity.entryScore} />
      )}
    </div>
  </TooltipTrigger>
  <TooltipContent>
    <p><strong>Señal:</strong> fuerza de las señales técnicas, fundamentales y de sentimiento.</p>
    <p><strong>Entrada:</strong> calidad del momento de entrada (RSI, R/R, conflictos, timing).</p>
  </TooltipContent>
</Tooltip>
```

- [ ] **Step 3: Typecheck frontend**

```bash
cd /Users/federicocroce/Documents/Fede/trading
npm run typecheck -w apps/frontend
```

Expected: no errors.

- [ ] **Step 4: Start dev server and verify visually**

```bash
cd /Users/federicocroce/Documents/Fede/trading
npm run dev
```

Open http://localhost:5173. Check that:
- Signal cards show two stacked bars (Señal + Entrada)
- BB shows Señal ~87 (blue/green) and Entrada ~31 (red)
- A good opportunity shows both bars green or Señal high + Entrada high
- Tooltip explains both scores on hover

- [ ] **Step 5: Commit**

```bash
git add apps/frontend/src/opportunities/OpportunityCard.tsx
git commit -m "feat(frontend): replace single score with Señal + Entrada dual bars"
```
