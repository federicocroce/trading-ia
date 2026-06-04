# Sector Impact Map (Mapa macro → sectores) — Design

**Date:** 2026-06-04
**Status:** Approved (user waived interactive review), ready for implementation
**Author:** Federico Croce (with Claude)

## Problem

The user wants, on each pipeline run, a clear per-sector view: **which macro "knob" drives each
sector, the sign (+/−) and confidence, and which tickers — including their own holdings — sit on
the winning vs losing side.** Today this is impossible to read: the data exists but is scattered
across `causal_chains`, `macro_events`, `sector_effects`, and the scan's `opportunities`, with no
synthesis. The user looked for it and couldn't find it.

There IS an existing sector panel — `SectorImpactsSection` rendering `SectorReport` — but it is a
**different lens**: it synthesizes *news sentiment* per sector (impact/conviction/catalysts/news).
It does NOT use the macro causal engine, does NOT classify scan winners/losers, and does NOT
connect to the portfolio. This feature is **complementary, not a replacement**, and must be named
and framed so the two are not confused.

## Goal

A **Sector Impact Map**: per sector, synthesize the existing macro-causal data + the latest scan
into one legible block — macro driver(s) with direction and confidence, winners vs losers from the
scan, and the user's holdings tagged on each side. Surfaced in the daily report.

## Non-Goals (YAGNI)

- ❌ New macro/causal modeling — this is a **synthesis layer over data already computed**.
- ❌ Replacing or merging the existing news-driven `SectorReport` panel.
- ❌ Price prediction or position sizing — context only, explicitly conditional/probabilistic.
- ❌ DB schema changes — computed on the fly via endpoint (same pattern as the portfolio
  correlation diagnostic), so it works immediately without a migration.

## Architecture

One aggregation unit + one endpoint + one frontend panel. No new persistence.

### Unit 1 — Aggregation service (`sector-impact-map.service.ts`)

Pure function, independently testable:

```ts
buildSectorImpactMap(
  opportunities: Opportunity[],        // latest scan (each has sector, action, opportunityScore)
  causalEvents: MacroEventRow[],       // from getCausalMapByDate (event → ticker chains)
  portfolioSymbols: string[],          // to tag holdings
): SectorImpactMapEntry[]
```

Logic, per `OpportunitySector`:
- **Macro drivers:** collect causal chains whose `ticker` belongs to this sector; group by
  `event` (with `category`, `direction`, `magnitude`). Each driver = `{ event, direction,
  magnitude }`. Sector net direction = sign of the magnitude-weighted sum of its drivers'
  directions (`positive`/`negative`/`mixed`/`neutral`).
- **Winners / losers from the scan:** within the sector, `winners` = tickers with `action === 'BUY'`
  (or positive causal direction), sorted by score desc; `losers` = `action === 'SELL'` or negative
  causal direction. Cap each list (e.g. top 6) and `log()` if truncated.
- **Your holdings:** for each winner/loser, flag `inPortfolio` when the symbol is in
  `portfolioSymbols`. Also expose `yourHoldings: string[]` = holdings in this sector and their side.
- **Confidence:** derived from the strongest driver's `magnitude` (`high`/`medium`/`low`); if there
  are no causal drivers for the sector, `confidence: 'low'` and `netImpact` falls back to the scan's
  BUY-vs-SELL balance (clearly a weaker signal).

Empty inputs → returns `[]` (no crash).

### Unit 2 — Types (`packages/shared/src/types/intelligence.ts`)

```ts
export type SectorImpactDirection = 'positive' | 'negative' | 'mixed' | 'neutral';

export interface SectorDriver {
  event: string;                          // "Volatilidad en activos argentinos"
  category: string;                       // causal category
  direction: 'positive' | 'negative';
  magnitude: 'high' | 'medium' | 'low';
}

export interface SectorImpactTicker {
  symbol: string;
  action: SignalAction;
  score: number;
  inPortfolio: boolean;
}

export interface SectorImpactMapEntry {
  sector: string;                         // OpportunitySector value
  label: string;                          // human label
  netImpact: SectorImpactDirection;
  confidence: 'high' | 'medium' | 'low';
  drivers: SectorDriver[];                // the macro "knobs" hitting this sector
  winners: SectorImpactTicker[];          // BUY / positive-causal tickers
  losers: SectorImpactTicker[];           // SELL / negative-causal tickers
  yourHoldings: Array<{ symbol: string; side: 'winner' | 'loser' | 'neutral' }>;
}
```

`SignalAction` is already exported from the shared barrel.

### Unit 3 — Endpoint

A tRPC query `intelligence.sectorImpactMap` (or `opportunities.sectorImpactMap`) that:
1. loads the latest scan's opportunities (`getLatestOpportunityScan`, parse `opportunities`),
2. loads today's causal map (`getCausalMapByDate(today)`), falling back to the most recent date
   present if today is empty,
3. loads portfolio symbols (`getPortfolioPositions`),
4. returns `buildSectorImpactMap(...)`.

Computed on the fly → works against the existing latest scan with no migration.

### Unit 4 — Frontend panel (`SectorImpactMapPanel.tsx`)

A panel in the daily view, clearly titled **"Mapa macro → sectores (impacto en tus posiciones)"**
to distinguish it from the news-driven "Sectores impactados por noticias". Per sector card:
- header: sector label + net impact badge (color by direction) + confidence.
- drivers: small chips "⛏ evento (↑/↓)".
- two columns: **Favor** (winners) / **En contra** (losers); portfolio holdings highlighted
  (e.g. a ★ or distinct color) and clickable to the symbol.
- a one-line honest caveat that this is conditional context, not a prediction.

Mounted in `DailySummary.tsx` near `SectorImpactsSection`, or in `MarketReportView.tsx`.

## Data Flow

```
latest scan (opportunities: sector, action, score)
        +
causal map (getCausalMapByDate → MacroEventRow[] → chains: ticker, direction, magnitude)
        +
portfolio symbols (getPortfolioPositions)
        →  buildSectorImpactMap()  →  SectorImpactMapEntry[]  →  tRPC  →  panel
```

## Error Handling

- No scan / empty opportunities → `[]`; panel renders nothing.
- No causal map for today → use most recent date with data; if none, sectors still render from the
  scan's BUY/SELL balance with `confidence: 'low'` and no drivers.
- Symbol with no resolvable sector → skipped from sector grouping (logged).
- Empty portfolio → `yourHoldings` empty; winners/losers still shown.

## Testing

- `buildSectorImpactMap` with a fixture: 2 sectors, causal events of both directions, a scan with
  BUY/SELL, a portfolio overlapping one sector → asserts net direction, winners/losers split,
  holdings tagged on the correct side, confidence from magnitude.
- Fallback test: no causal events → net impact derives from BUY/SELL balance, confidence `low`.
- Empty inputs → `[]`.
- Truncation: >6 winners → capped and flagged.

## Honesty Constraints

- Net impact and drivers are **conditional/probabilistic**, surfaced with confidence, never as
  "this sector will rise". The panel states this explicitly.
- This is **context, not a trading signal**, and is distinct from the news-sentiment panel.
- Lower priority than data-hygiene fixes (which corrupt the very inputs); noted, not bundled here.
