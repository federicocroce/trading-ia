# Data Hygiene Implementation Plan

> Implemented inline (user waived gates). Steps use checkbox syntax.

**Goal:** Fix four data-quality bugs that poison scoring inputs.
**Reference spec:** `docs/superpowers/specs/2026-06-05-data-hygiene-design.md`

## Task 1 — Adjusted close + SMA sanity guard ✅
- [x] `indicator-sanity.ts` (`sanitizeSMA`, `sanitizeMovingAverages`) + 6 tests.
- [x] Wire into `computeIndicators` (null implausible SMAs, warn).
- [x] `getHistoricalQuotes`: scale OHLC by `adjclose/close` (split correction at source).

## Task 2 — Minimum price floor ✅
- [x] `buildAlgorithmicOpportunity`: drop `currentPrice < MIN_PRICE_USD` (default 1) and non-finite/≤0 prices unless in portfolio.

## Task 3 — Headline ↔ symbol validation ✅
- [x] `headline-match.ts` (`headlineMatchesSymbol`, word-boundary, permissive) + 7 tests.
- [x] `symbol-aliases.ts` seed map (portfolio + majors).
- [x] Wire into `news-intelligence.service.ts` symbolTrends: drop clearly-foreign headlines (fallback to raw if all dropped).

## Task 4 — Coverage-aware confidence ✅
- [x] `confluence.ts` (`computeConfluencePercent`: axis cap + coverage factor) + 6 tests.
- [x] Wire into `computeConfluence` (replace flat dataBonus + 95 cap).

## Validation ✅
- [x] 116 backend tests green (19 new). Typecheck clean.
- [x] Verified vs real DB: VCIG/HUBC/CDT SMA200 nulled, EOG/BP intact; ELEK $0.01 + $0 tickers dropped by floor.

## Known limitation
Fix 3 uses a seed alias map (not exhaustive). Unknown symbols match permissively (no false drops);
extend `SYMBOL_ALIASES` over time, or back it with fundamentals' `longName` in a follow-up.
