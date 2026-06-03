# Portfolio Correlation Diagnostic — Design

**Date:** 2026-06-03
**Status:** Approved, ready for implementation
**Author:** Federico Croce (with Claude)

## Problem

The opportunity engine scores every symbol in **isolation**. It never asks "how does this
candidate relate to what the user already holds?" The result: it recommends `EOG`/`BP`/`COP`
(oil) on top of a portfolio already heavy in oil (`YPF`, `PAM`, `VIST`), piling the *same*
risk instead of diversifying — and it never surfaces that the portfolio lacks a hedge (gold,
rates, safe-haven) that would actually rise when the rest falls.

This design adds **portfolio-correlation awareness** to the engine so it reproduces, on its own,
the manual diagnostic: penalize/flag candidates that stack existing risk, reward genuine
diversifiers, and report the missing hedge.

A separate concern — **data hygiene** (split-broken SMA200 on `VCIG`/`CDT`/`HUBC`, sub-penny
stocks like `ELEK` flagged BUY, ticker/news mismatches, inflated confidence) — is explicitly
**out of scope** here and will get its own spec.

## Goals

1. Classify any symbol (holding or candidate) into shared **risk factors** (hybrid: curated map
   confirmed by real price correlation).
2. Add a **traceable portfolio modifier** to the existing verdict chain that adjusts the score
   (not a hard veto), gated by an intensity dial defaulting to OFF.
3. Produce a **portfolio diagnostic** (factor concentration + missing hedges + diversifiers vs
   stackers), attached to the daily market report and exposed via endpoint.

## Non-Goals (YAGNI)

- ❌ Portfolio optimization (Markowitz / efficient frontier).
- ❌ Automatic rebalancing or suggested position sizes — diagnose only, never execute.
- ❌ Data-hygiene fixes (separate spec).

## Architecture

Three units, each independently testable, following existing patterns
(`computeMacroAdjustment` → `MacroAdjustment` → verdict chain layer).

### Unit 1 — Risk-factor classification (`risk-factors.service.ts`)

The hybrid core. Classifies a symbol into a closed enum of ~12 factors and computes
portfolio-relative concentration/correlation.

**Factor enum (`RiskFactor`):**
`oil`, `gas`, `argentina`, `emerging-markets`, `crypto`, `semis`, `gold`, `safe-haven`,
`rates`, `us-equity`, `china`, `risk-on`.

**(a) Curated map** (`risk-factor-map.ts`): explicit `symbol → RiskFactor[]` table. Examples:
```
YPF  → [oil, argentina, emerging-markets]
PAM  → [oil, gas, argentina]
EOG  → [oil, us-equity]
GLD  → [gold, safe-haven]
IEF  → [rates, safe-haven]
MARA → [crypto, risk-on]
```
A symbol with no entry falls back to factors inferred from its existing `sector` field, and the
miss is logged so the map can be curated over time.

**(b) Empirical confirmation:** Pearson correlation on ~90 days of daily returns, reusing the
historical quotes already fetched for technicals (no new data source). Two uses:
- Confirm two same-factor symbols actually move together (corr > 0.6).
- Catch hidden correlation between symbols with no shared factor (corr > 0.7 → flag).

**Output (per candidate, given the portfolio):**
- Portfolio factor concentration, weighted by position `value` from `getPortfolio()`.
- For the candidate: which already-heavy factors it adds to, and its average correlation with the
  holdings in each of those factors.

### Unit 2 — Portfolio modifier (verdict chain layer)

New type in `packages/shared/src/types/opportunity.ts`, parallel to `MacroAdjustment`:

```ts
export interface PortfolioAdjustment {
  delta: number;              // points applied to composite (after intensity)
  rawDelta: number;           // points before intensity scaling (for tracing/AB)
  intensity: number;          // 0..1 dial; 0 = trace only, no score change
  concentration: Array<{
    factor: RiskFactor;
    portfolioWeight: number;  // e.g. 0.40
    avgCorrelation: number;   // candidate vs holdings in that factor
  }>;
  verdict: 'stacks' | 'diversifies' | 'neutral';
  reason: string;             // "Apila riesgo oil (ya 40% en YPF/PAM/VIST, corr 0.78)"
}
```

`computePortfolioAdjustment(symbol, candidateFactors, portfolio, correlations, intensity)`:
- **stacks**: candidate adds to a factor already above `PORTFOLIO_FACTOR_THRESHOLD` (default 0.30)
  AND has high correlation → negative `rawDelta`, scaled by concentration severity.
- **diversifies**: new factors, or low/negative average correlation with the book → small
  positive `rawDelta`.
- **neutral**: otherwise → `rawDelta` 0.
- `delta = rawDelta × intensity`. With `intensity = 0` (default via `PORTFOLIO_CORR_INTENSITY`),
  `delta` is 0 → appears in trace only, does not change ranking.

**Integration in `resolveFinalVerdict`:** the modifier adjusts the **composite score** (like the
macro adjustment), not the action. If the lowered score drops below the BUY threshold, the action
becomes WATCH **as a consequence**, never as a hard veto — portfolio overlap means the trade is
wrong *for this book*, not wrong in itself. Trace example:
```
["algo:BUY(64)", "portfolio:stacks (oil 40%, corr 0.78) Δ-8×0.0=0"]
```
With the dial at 0 the trace shows `Δ0` (informational); at 0.5, `Δ-4` and the action may fall to
WATCH via the score. Reuses the existing A/B logging so diversified-vs-stacked performance can be
measured before raising the dial.

### Unit 3 — Portfolio diagnostic (panel)

Portfolio-level view the per-symbol modifier cannot express. New type:

```ts
export interface PortfolioDiagnostic {
  factorExposure: Array<{ factor: RiskFactor; weight: number; symbols: string[] }>;
  concentrationFlags: string[];   // "40% en oil — alta concentración"
  missingHedges: Array<{
    hedge: RiskFactor;            // safe-haven / rates / gold
    reason: string;
    candidates: string[];         // diversifiers from the current scan
  }>;
  diversifiers: string[];         // scan candidates that lower book correlation
  stackers: string[];             // scan candidates that raise it
}
```

- **Factor exposure:** value-weighted, from `getPortfolio()`.
- **Missing hedge rule:** if high `risk-on`/`us-equity`/`emerging-markets` exposure and ~0% in
  `safe-haven`/`rates`/`gold`, flag it and propose diversifiers from today's scan.
- **Diversifiers vs stackers:** reuses each candidate's `PortfolioAdjustment.verdict`.

Attached to the existing `market_reports` row (reusing the `portfolio_impact` area) and exposed
via endpoint for a frontend view. No new daily job.

## Data Flow (in `runLiveScan`)

1. Scan start: load `getPortfolio()` + compute the correlation matrix for the symbols being
   scanned, once per scan (cached for the scan's lifetime).
2. Inside `buildAlgorithmicOpportunity` (where the macro adjustment already applies): call
   `computePortfolioAdjustment`, attach `PortfolioAdjustment`, add the verdict-chain layer.
3. Scan end: compute `PortfolioDiagnostic` once, attach to `market_reports`.

## Configuration (mirrors `ANTIHYPE_VOLUME`)

- `PORTFOLIO_CORR_INTENSITY` — default `0` — the dial (0..1).
- `PORTFOLIO_FACTOR_THRESHOLD` — default `0.30` — weight at which a factor counts as concentrated.

## Error Handling

- Empty portfolio → modifier is a no-op (`neutral`, delta 0); diagnostic reports "sin cartera".
- Insufficient price history for correlation (< ~30 points) → fall back to curated-map factors
  only; correlation treated as unknown (does not block, does not penalize).
- Symbol missing from the factor map → infer from `sector`, log the miss.
- Price fetch failure for a holding → exclude from correlation, keep its map factors.

## Testing

- Unit tests for `computePortfolioAdjustment` using the real portfolio as a fixture
  (oil 40% → `EOG` stacks; `GLD` diversifies; empty portfolio → neutral).
- Unit tests for the correlation calc with synthetic series of known correlation (perfectly
  correlated → ~1.0; anti-correlated → ~-1.0; independent → ~0).
- Unit tests for the missing-hedge rule (risk-on heavy + no safe-haven → flags gold/rates).
- Dial test: `intensity = 0` produces `delta = 0` and never changes action; `intensity = 1`
  applies full `rawDelta`.

## Rollout

Ships OFF (dial at 0): the modifier only traces, the diagnostic is informational. The dial is
raised manually after observing A/B logs that diversified picks perform at least as well.
