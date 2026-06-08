# Digest Grounding Implementation Plan

> Implemented inline (user waived gates).
**Spec:** `docs/superpowers/specs/2026-06-08-digest-grounding-design.md`

## Task 1 — Grounding helper (TDD) ✅
- [x] `digest-grounding.ts` (`groundWouldBuyItems`, `stripNumbers`) + 5 tests.
- [x] Market mode (dropNonBuy=true): drops non-BUY tickers (XLE WATCH) + no-ticker lines.
- [x] Portfolio mode (dropNonBuy=false): keeps holds, still grounds numbers.
- [x] Numbers always re-rendered from scan tradeLevels; LLM-written figures stripped.

## Task 2 — Wire into market report ✅
- [x] `market-report.service.ts`: ground `finalMarketWouldDo` (drop non-BUY) and
      `finalPortfolioWouldDo` (keep holds) using scan BUY opportunities.

## Validation ✅
- [x] 122 backend tests (6 new). Typecheck clean.
- [x] Verified vs real scan #137: "Compraría XLE a $88.50" (WATCH, fabricated) → dropped;
      GGAL/SMCI kept with real scan numbers, fabricated $99/$200 removed.
