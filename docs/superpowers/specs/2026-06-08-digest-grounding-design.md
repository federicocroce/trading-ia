# Digest Grounding (Anti-Hallucination) — Design

**Date:** 2026-06-08
**Status:** Approved (user waived interactive review), ready for implementation
**Author:** Federico Croce (with Claude)

## Problem

The Market Digest's "LO QUE SÍ HARÍA" bullets are free-text LLM prose. The LLM can:
1. **Recommend a non-BUY symbol** — e.g. "Compraría XLE a $88.50" when the scan rates XLE WATCH.
2. **Fabricate numbers** — XLE's price was never passed to the LLM (only BUY/SELL get prices), so
   it invented $88.50 (real price $58.40), plus a made-up stop/target.

Existing sanitization filters word-count and reclassifies portfolio-vs-market, but never checks
that a "would-buy" item is an actual BUY in the scan, nor reconciles its numbers. Result:
hallucinated recommendations the user sees and could act on.

## Goal

"El motor propone, el LLM explica." Ground every digest would-buy bullet against the scan: drop
items whose ticker isn't a real BUY, and replace any prices/stops/targets with the scan's actual
numbers — so a fabricated price or a non-BUY pick can never reach the UI.

## Non-Goals (YAGNI)

- ❌ Re-architecting the digest LLM call. We keep the LLM narrative; we only validate its output.
- ❌ Touching the "would NOT do" arrays beyond what exists (those already filter BUY tickers).
- ❌ Inventing recommendations when the LLM under-produces (the existing fallback handles that).

## Fix

New pure helper `apps/backend/src/intelligence/digest-grounding.ts`:

```ts
groundWouldBuyItems(
  items: string[],
  buyOpps: Array<{ symbol; currentPrice; tradeLevels?: { entryPrice; stopLoss; takeProfit } }>,
): string[]
```

Per item:
1. **Resolve the primary ticker** — the first uppercase token that matches a known BUY symbol.
   - If the item names a known symbol that is NOT a BUY (WATCH/SELL/HOLD), or names no known
     BUY symbol at all → **drop the item** (this removes the XLE line entirely).
2. **Ground the numbers** — strip every `$NNN(.NN)` token and trailing "Stop … / target … / a $…"
   clause the LLM wrote, then append the real figures from the matched BUY opportunity's
   `tradeLevels` (`Entrada $X · Stop $Y · Target $Z`). If the opp has no `tradeLevels`, strip the
   numbers and append nothing (narrative only — never a fabricated number).

The LLM keeps the *reasoning* (the prose minus numbers); the engine owns *every* number.

### Wiring

In `market-report.service.ts`, after `sanitizeWouldDo` produces the reclassified
`finalPortfolioWouldDo` / `finalMarketWouldDo`, pass each through `groundWouldBuyItems` using the
scan's BUY opportunities (`digestInputs.opportunities.filter(action === 'BUY')`). The "would not
do" arrays are unchanged.

## Data Flow

```
LLM wouldDo prose → sanitize (existing) → reclassify (existing)
  → groundWouldBuyItems(items, BUY opps)  ← drops non-BUY, replaces numbers from scan
  → digest.{portfolio,market}WouldDo
```

## Error Handling

- Item with no resolvable BUY ticker → dropped (logged count).
- BUY opp without `tradeLevels` → narrative kept, numbers stripped (no fabricated figure).
- Empty result after grounding → existing fallback (`synthesizeWouldArrays`) still applies upstream.

## Testing (`digest-grounding.test.ts`)

- "Compraría XLE a $88.50 … Stop $85, target $92" with XLE NOT in BUY opps → **dropped**.
- "Compraría GGAL a $99 …" where GGAL is BUY with tradeLevels {entry 47.81, stop 39.11,
  target 60.86} → kept, numbers **replaced** with the real ones (no $99).
- BUY ticker with no tradeLevels → narrative kept, no `$` numbers remain.
- Item naming only a non-BUY known ticker → dropped.
- Item with no ticker token → dropped (can't ground).

## Honesty Note

This closes the most user-visible inconsistency (the digest is what users read). After it, a
number shown in a would-buy bullet is guaranteed to come from the scan, and the pick is
guaranteed to be a real BUY. It does not make the LLM's *thesis* correct — only its facts.
