# Sector Impact Map Implementation Plan

> **For agentic workers:** Use superpowers:executing-plans. Steps use checkbox syntax.

**Goal:** Synthesize existing causal_chains + latest scan + portfolio into a per-sector impact map (macro driver, sign/confidence, winners/losers, holdings tagged), exposed via a tRPC query and a frontend panel. No new modeling, no DB migration.

**Architecture:** Pure aggregation `buildSectorImpactMap()` → tRPC `intelligence.sectorImpactMap` computing on the fly from latest scan + `getCausalMapByDate` + portfolio → `SectorImpactMapPanel.tsx`.

**Reference spec:** `docs/superpowers/specs/2026-06-04-sector-impact-map-design.md`

---

## Task 1: Shared types

**Files:** Modify `packages/shared/src/types/intelligence.ts` (add types + export `SignalAction` already in barrel).

- [ ] Add `SectorImpactDirection`, `SectorDriver`, `SectorImpactTicker`, `SectorImpactMapEntry` (shapes in spec). Build `@trading/shared`.

## Task 2: Aggregation service (TDD)

**Files:** Create `apps/backend/src/intelligence/sector-impact-map.service.ts` + `.test.ts`.

Signature:
```ts
buildSectorImpactMap(
  opportunities: Pick<Opportunity,'symbol'|'sector'|'sectorLabel'|'action'|'opportunityScore'>[],
  causalEvents: MacroEventRow[],
  portfolioSymbols: string[],
  sectorOf: (symbol: string) => string | null,   // for causal tickers not in scan
): SectorImpactMapEntry[]
```

- [ ] Test: 2 sectors, causal events both directions, scan BUY/SELL, portfolio overlapping one sector → net direction correct, winners/losers split, holdings tagged on correct side, confidence from event magnitude.
- [ ] Test: no causal events → net impact from BUY/SELL balance, confidence 'low'.
- [ ] Test: empty inputs → [].
- [ ] Test: >6 winners → capped.
- [ ] Implement (logic in spec). Run tests green.

## Task 3: Endpoint

**Files:** Modify `apps/backend/src/intelligence/intelligence.router.ts` + a service fn (in market-report.service.ts or a small module) `getSectorImpactMap()` that loads latest scan opps + causal map (today, fallback latest) + portfolio symbols + `getSectorForSymbolDynamic`.

- [ ] Add `getSectorImpactMap()` reading `getLatestOpportunityScan`, `getCausalMapByDate`, `getPortfolioPositions`.
- [ ] Add tRPC `sectorImpactMap: publicProcedure.query(() => getSectorImpactMap())`.
- [ ] Typecheck backend.

## Task 4: Frontend panel

**Files:** Create `apps/frontend/src/daily/SectorImpactMapPanel.tsx`; mount in `DailySummary.tsx`.

- [ ] Panel titled "Mapa macro → sectores (impacto en tus posiciones)", per-sector card: net-impact badge + confidence, driver chips, Favor/En contra columns with holdings highlighted + clickable, honest caveat line.
- [ ] Mount near `SectorImpactsSection`. Build frontend.

## Task 5: Validation

- [ ] Backend tests green; backend + frontend build.
- [ ] Verify against real DB (throwaway tsx script): sectors with drivers from today's causal chains, Argentina holdings flagged as losers.
