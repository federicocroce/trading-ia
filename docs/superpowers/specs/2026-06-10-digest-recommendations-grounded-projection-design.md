# Digest Recommendations: Grounded Projection of the Scan — Design

**Date:** 2026-06-10
**Author:** Federico Croce (+ Claude)

## Problem

The digest ("LO QUE SÍ HARÍA CON TU PORTFOLIO") and the scan view contradict each
other for the same ticker. Example observed: digest says *"Sumaría a GGAL / Sumaría
a VIST"* with entry/stop/target, while the scan shows GGAL=**MANTENER** (HOLD) and
VIST=**OBSERVAR** (WATCH, with a bearish Bollinger squeeze warning).

### Root cause

The digest's four recommendation arrays (`portfolioWouldDo`, `portfolioWouldNotDo`,
`marketWouldDo`, `marketWouldNotDo`) are free-form strings written by the LLM and only
*partially* grounded after the fact (`digest-grounding.ts`). The grounding reconciled
two things — that the ticker exists, and the numbers — but **never reconciled the
recommended action** against the scan's verdict. Worse, for the portfolio path
(`dropNonBuy: false`) it kept non-BUY symbols and stamped `Entrada/stop/target` on them
whenever `tradeLevels` existed, disguising a HOLD/WATCH as a buy setup (e.g. "Mantendría
YPF — Entrada $53.54, stop, target").

So an asset could be HOLD/WATCH in the scan yet appear in the digest as a buy with an
entry price. Two layers, two sources of truth, guaranteed divergence.

## Decision

**The digest recommendation sections become a deterministic projection of the scan.**
The LLM no longer writes them. The engine builds them from the scan opportunities.
Single source of truth → contradiction is impossible by construction.

Confirmed product decisions:
- **Structure by real action** — drop the SÍ/NO split. Two blocks (Tu Portfolio /
  Mercado); each item carries its real scan action badge (COMPRAR/VENDER/MANTENER/OBSERVAR)
  + motivo.
- **Motivo from the scan, verbatim** — reuse `Opportunity.simpleReasoning`. The LLM
  does not touch per-symbol motivos.

## Data model (`packages/shared/src/types/intelligence.ts`)

```ts
export interface DigestRecommendation {
  symbol: string;
  action: SignalAction;            // 'BUY' | 'SELL' | 'HOLD' | 'WATCH' — verbatim from scan
  reason: string;                  // Opportunity.simpleReasoning (fallback: reasoning / first catalyst|risk)
  currentPrice: number;
  score: number;                   // Opportunity.opportunityScore
  tradeLevels?: { entryPrice: number; stopLoss: number; takeProfit: number }; // ONLY when action === 'BUY'
}
```

`MarketDigest` replaces the four `*WouldDo/*WouldNotDo` string arrays with:

```ts
portfolioRecommendations: DigestRecommendation[];  // opportunities with inPortfolio === true
marketRecommendations: DigestRecommendation[];     // opportunities with inPortfolio === false
```

Narrative LLM fields are unchanged: `overnightSummary`, `portfolioImpact`,
`marketMood`, `warnings`, `topOpportunities`, `watching`.

## Projection (`apps/backend/src/intelligence/digest-recommendations.ts`)

Pure function `buildDigestRecommendations(opps: Opportunity[])` →
`{ portfolioRecommendations, marketRecommendations }`.

Per opportunity → `DigestRecommendation`:
- `action = o.action`
- `reason = o.simpleReasoning || o.reasoning || o.catalysts[0] || o.risks[0] || ''`
- `tradeLevels` attached **only if `action === 'BUY'` and `o.tradeLevels` present**
- `currentPrice`, `score` copied through

Partition / filter / order:
- **Portfolio** = `inPortfolio === true`. Include **all** holdings (any action) so the
  user sees the stance on everything they own. Order by attention priority
  `SELL(0) < BUY(1) < WATCH(2) < HOLD(3)`, tiebreak `score` desc. Cap 12.
- **Mercado** = `inPortfolio === false`. Exclude `HOLD` (meaningless for non-owned).
  Keep `BUY`, `WATCH`, `SELL`. Order `BUY(0) < WATCH(1) < SELL(2)`, tiebreak `score` desc.
  Cap 6.

Used by **both** the LLM-success path and the catch/fallback path — identical output.

## Backend wiring (`market-report.service.ts`)

Delete the now-dead machinery: `groundWouldBuyItems` import + usage, `classifyByPortfolio`,
the reclassification block, `synthesizeWouldArrays`/`synthesizeBuyLine`/`synthesizeSellLine`,
`sanitizeWouldDo`/`sanitizeWouldNotDo` and their `coerceToString` helper (if otherwise
unused). Delete `digest-grounding.ts` + `digest-grounding.test.ts`.

The digest object (both success and fallback paths) sets
`portfolioRecommendations`/`marketRecommendations` from
`buildDigestRecommendations(digestInputs.opportunities)`.

## Prompt (`packages/shared/src/constants/prompts.ts`)

Remove the four `*WouldDo/*WouldNotDo` fields, their REGLAS, and the JSON example tail
from `COMBINED_SYNTHESIS_PROMPT` — the LLM no longer produces these, so asking for them
wastes tokens and misleads future readers.

## Backward-compat (`opportunities.service.ts` `normalizeDigest`)

New blobs carry the structured arrays. Old persisted blobs (string arrays only) cannot
be reconstructed into actions, so `normalizeDigest` coerces
`portfolioRecommendations`/`marketRecommendations` to validated arrays, defaulting to `[]`
when absent, and drops the legacy `*WouldDo/*WouldNotDo` + `wouldDo/wouldNotDo` fields.
An old cached digest renders empty → "regenerá" CTA; the next scan repopulates it.

## Frontend (`apps/frontend/src/daily/DailySummary.tsx`)

Replace the four string-array sections with two list sections (Tu Portfolio / Mercado).
Each row: action badge (reuse existing `actionStyle` map — already has all four actions)
+ `SYMBOL` + `reason`; when `tradeLevels` present, a second line `Entrada $X · Stop $Y ·
Target $Z`. Keep the empty-state "regenerá" CTA for the portfolio block and the `watching`
radar sub-block under Mercado. Items already sorted by the backend.

## Testing

`digest-recommendations.test.ts` (TDD, written first):
- BUY in portfolio → tradeLevels attached, reason = simpleReasoning.
- HOLD/WATCH in portfolio → **no** tradeLevels even if `o.tradeLevels` exists.
- Partition by `inPortfolio`.
- Mercado excludes HOLD; portfolio keeps all actions.
- Ordering by action priority then score.
- reason fallback chain when `simpleReasoning` empty.

## Out of scope (possible follow-ups)

- Forward/predictive signal bullets ("MACD a punto de cruzar (~1d)") in the digest rows.
- Market SELL "EVITAR" relabeling nuance.
