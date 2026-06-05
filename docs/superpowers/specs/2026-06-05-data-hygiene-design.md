# Data Hygiene — Design

**Date:** 2026-06-05
**Status:** Approved (user waived interactive review), ready for implementation
**Author:** Federico Croce (with Claude)

## Problem

Four data-quality bugs poison the scoring engine's inputs, producing misleading
recommendations regardless of how good the downstream logic is:

1. **Split-poisoned SMA200.** Yahoo historical closes are unadjusted, so reverse-split tickers
   carry pre-split prices: VCIG SMA200 $217 vs price $9, HUBC $573 vs $0.48. This corrupts every
   indicator and the anti-hype trend filter.
2. **Sub-penny BUYs.** No price floor: ELEK at $0.01 is recommended BUY. Sub-penny tickers are
   illiquid, manipulable, and unscoreable.
3. **News/ticker mismatch.** Headlines are attached to the wrong symbol (PAM news shown under
   HSBC) because Yahoo `relatedTickers` is trusted blindly and never reconciled with the headline.
4. **Inflated confidence.** `confluencePercent` reaches 95% on just 2 aligned votes — no penalty
   for thin/missing data (EVEN: "2 de 2 indicadores → conf 95").

## Goal

A focused hygiene pass that fixes each at its root with a small, tested unit, plus a defensive
guard where the root cause is an external feed we can't fully trust (Yahoo).

## Non-Goals (YAGNI)

- ❌ Rewriting the news pipeline or the technical engine.
- ❌ A separate data-quality dashboard. (Rejections already surface via anti-hype; penny/SMA
  rejections reuse that channel.)
- ❌ Perfect news NLP — only reject headlines that clearly belong to a different named company.

## Fixes

### Fix 1 — Adjusted close + SMA sanity guard

Two layers (root fix + defense-in-depth):

**(a) Use adjusted close.** In `getHistoricalQuotes` (`apps/backend/src/shared/yahoo.ts`), read
`result.indicators.adjclose[0].adjclose` when present and, per bar, scale `open/high/low/close` by
`adjclose/close` so candles stay internally consistent and splits are corrected at the source.
Add `adjclose?: Array<{ adjclose: (number|null)[] }>` to the `YahooChartResult.indicators` type.
Fall back to raw close when adjclose is absent or non-finite.

**(b) Sanity guard.** New pure helper `sanitizeIndicators(ind)` in
`apps/backend/src/technical/indicator-sanity.ts`: if an SMA (`sma20/50/200`) is outside
`[currentPrice / MAX_RATIO, currentPrice * MAX_RATIO]` (MAX_RATIO default 4), null it out and add a
`dataQualityFlags: string[]` note. Applied in `computeIndicators` before returning. A nulled SMA200
makes the anti-hype trend filter skip that symbol (it already treats `sma200 == null` as "no
filter") rather than acting on garbage.

### Fix 2 — Minimum price floor

In `buildAlgorithmicOpportunity` (`scoring.ts`), after resolving `currentPrice`: if
`currentPrice < MIN_PRICE_USD` (default `1.0`, env-overridable) and the symbol is not in the
portfolio, `return null` (drop from the scan). Also drop non-finite / `<= 0` prices. This is the
single highest-leverage guard against junk; sub-penny names never reach scoring.

### Fix 3 — Headline ↔ symbol validation

New pure helper `headlineMatchesSymbol(headline, symbol, aliases?)` in
`apps/backend/src/news/headline-match.ts`:
- returns `true` if the headline mentions the ticker symbol (word-boundary, case-insensitive) or
  any provided alias/company name;
- returns `true` (permissive) when no aliases are known AND the headline mentions no other
  competing ticker pattern — i.e. only DROP when we're confident it belongs elsewhere.

Apply in `news-intelligence.service.ts` when building each `SymbolTrend.topHeadlines`: filter out
headlines that fail the match for that symbol. Conservative by design — never strips a symbol's
real news, only removes clearly-foreign headlines. Aliases come from a lightweight
`symbol → [names]` map seeded from the known universe (extendable), falling back to symbol-only
matching.

### Fix 4 — Coverage-aware confidence

In `computeConfluence` (`scoring.ts`), replace the flat `dataBonus = min(10, votes.length)` + 95
cap with a **coverage factor**:
- `axesWithData` = count of {technical, fundamental, sentiment} that contributed ≥1 vote.
- `coverage = clamp( (votes.length / EXPECTED_VOTES) , 0..1 )` with `EXPECTED_VOTES = 8`.
- `confluencePercent = round( clamp( rawConfluence * (0.5 + 0.5*coverage), 20, cap ) )` where the
  `cap` scales with axes: 1 axis → 55, 2 axes → 75, 3 axes → 95.

So 2 aligned votes from 1 axis → capped ~55, not 95. Full multi-axis confluence still reaches 95.

## Data Flow Touch-Points

```
Yahoo getHistoricalQuotes (adjclose)  →  computeIndicators (sanitizeIndicators)  →  anti-hype / scoring
buildAlgorithmicOpportunity (price floor) → drop junk
news-intelligence (headlineMatchesSymbol) → clean topHeadlines → sentimentMap
computeConfluence (coverage-aware) → honest confidence
```

## Configuration

- `MIN_PRICE_USD` — default `1.0` — price floor for non-portfolio symbols.
- `SMA_SANITY_MAX_RATIO` — default `4` — SMA/price ratio bound before nulling.

## Error Handling

- adjclose absent/garbage → fall back to raw close (no crash, behavior unchanged for clean names).
- All-SMA nulled → indicators still returned; anti-hype simply skips the trend filter.
- Empty alias map → headline match is symbol-only and permissive (no over-filtering).

## Testing

- `indicator-sanity.test.ts`: SMA200 10× price → nulled + flagged; in-range SMA → untouched.
- `headline-match.test.ts`: "Pampa Energía soars" vs symbol HSBC (alias "HSBC Holdings") → false;
  vs PAM → true; unknown alias + neutral headline → true (permissive).
- `scoring.test` additions: 2-of-2 single-axis votes → confidence ≤ 60; full 3-axis confluence →
  ≥ 85; price < floor (non-portfolio) → `buildAlgorithmicOpportunity` returns null; portfolio
  symbol at $0.01 → still scored.
- `yahoo` adjclose: unit test the per-bar scaling helper with a synthetic split.

## Priority Note

This is the highest-leverage work outstanding: it cleans the inputs that every other feature
(scoring, correlation diagnostic, sector map) consumes. Garbage in → garbage out.
