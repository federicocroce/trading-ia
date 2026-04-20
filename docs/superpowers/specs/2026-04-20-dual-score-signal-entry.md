# Dual Score: Signal Strength + Entry Quality

**Date:** 2026-04-20  
**Status:** Approved

## Problem

The current `opportunityScore` (0–100) measures signal strength but doesn't account for entry timing. A score of 87 with verdict ESPERAR is confusing because the score appears to contradict the recommendation. The conflict that causes the downgrade (e.g. RSI=96, overbought) is not visible.

## Solution

Split into two scores displayed as horizontal bars in the card header:

- **Señal** — existing `opportunityScore`, unchanged
- **Entrada** — new `entryScore`, measures how good the current entry conditions are

Both bars use the same color scale: red (<40) / orange (40–59) / yellow (60–74) / green (75+).

## Entry Score Formula

`entryScore = RSI×0.25 + RR×0.25 + Conflicts×0.25 + Timing×0.15 + Support×0.10`

All inputs normalized to 0–100:

| Factor | Weight | Scoring |
|--------|--------|---------|
| RSI position | 25% | ≤40→100, 40–65→70, 65–75→30, >75→0 |
| Risk/Reward ratio | 25% | ≥2.5x→100, 1.5–2.5x→60, <1.5x→0, missing→40 |
| Signal conflicts | 25% | 0→100, 1→60, 2→20, 3+→0 |
| Timing confidence | 15% | `timingView.confidence` directly (already 0–100) |
| Distance to support | 10% | ≤2%→100, 2–5%→70, 5–10%→40, >10%→10 |

**BB example (RSI=96):** RSI=0 + R/R=40 + 1 conflict=60 + timing≈50 + support≈40 → ~35/100 → explains ESPERAR despite Señal=87.

## Changes

### 1. `packages/shared/src/types/opportunity.ts`
Add `entryScore: number` to the `Opportunity` interface.

### 2. `apps/backend/src/opportunities/scoring.ts`
Add `computeEntryScore(opportunity: ScoredOpportunity): number` function. Called at the end of `scoreOpportunity()`, after conflicts and trade levels are computed. Result assigned to `opportunity.entryScore`.

Inputs sourced from already-computed fields:
- RSI: `opportunity.breakdown.technical.indicators.rsi` (or equivalent)
- R/R: `opportunity.tradeLevels?.riskRewardRatio`
- Conflicts: `opportunity.signalConflicts.length`
- Timing: `opportunity.timingView?.confidence ?? 50`
- Support distance: `opportunity.tradeLevels?.nearestSupport` distance % from current price

### 3. `apps/frontend/src/opportunities/OpportunityCard.tsx`
Replace the single score number in the header with two horizontal bars. Each bar: label + progress bar + numeric value. Color determined by value thresholds.

## Out of Scope
- No changes to scoring weights, verdict logic, or AI analysis
- No new API endpoints — `entryScore` travels in the existing `Opportunity` object
- No tooltip/explanation UI for entry score breakdown (future work)
