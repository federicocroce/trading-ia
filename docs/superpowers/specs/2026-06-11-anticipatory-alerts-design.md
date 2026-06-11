# Anticipatory Alerts — Design

**Date:** 2026-06-11
**Author:** Federico Croce (+ Claude)

## Goal

Surface, proactively and early, assets that show a **confluence of bullish anticipatory
signals** — so the user can get on a move *before* it plays out, instead of reading about
it after the fact. Born from a concrete miss: on 2026-06-10 the scan already computed
*"Divergencia alcista MACD semanal — cambio de tendencia probable (~5d)"* on GGAL, which
then ran +7.9%. The signal existed but was buried under a "MANTENER" verdict instead of
alerting. **This feature does not invent prediction** — it promotes signals the engine
already computes into first-class, proactive alerts.

Honesty constraint: these are probabilistic *setups* that historically precede moves, not
guarantees. Copy must frame them as setups/odds, never certainties.

Anticipation constraint: an alert must anticipate the market by **at least 1 trading day**.
Signals describing events that *already happened* (a golden cross already executed, a stoch
cross that just fired) are confirmatory, not anticipatory, and never count — see the
anticipation gate below.

Single-discourse constraint: the app must never say two things about the same asset. The
alert is not a parallel opinion — it feeds back into the engine verdict (see *Verdict
feedback*), and every surface that talks about assets (digest, prompts, avoidList,
opportunity cards) reads the same alert state.

## Confirmed decisions

- **Trigger:** *Confluencia fuerte* — fire only when **≥2 distinct bullish anticipatory
  signal categories** coincide on the same asset. Keeps volume low and quality high.
- **Universe:** the **entire scanned universe** (not just portfolio). The strict trigger
  controls noise even across hundreds of tickers.
- **Cadence:** evaluated **on the existing daily scan** (the run that builds the digest).
  Logic is decoupled from cadence so an intraday scheduler can be added later with no
  rewrite.
- **Delivery (all three):** (1) pinned section atop the Daily/digest, (2) browser/desktop
  notification, (3) badge + dedicated panel with history/status.
- **Engine feedback (no double discourse):** bullish confluence upgrades the engine verdict,
  symmetric to the existing bearish `smartAction()` override (`scoring.ts:402–480`, where 2+
  bearish divergences already force SELL). The alert and the verdict can never contradict
  because the confluence *is* a verdict input.

## Signal taxonomy (bullish anticipatory categories)

Read from data the scan already computes per `Opportunity`. A category counts at most once.

1. **Bullish divergence** — `o.divergences` where `type === 'bullish'`. Weekly weighted
   higher than daily. (RSI / MACD / OBV.)
2. **Imminent golden cross** — `o.timingView.triggers` `type==='sma_cross'`, bullish,
   `estimatedDays ≥ 1`.
3. **Bullish Bollinger squeeze breakout** — timing trigger `type==='bb_squeeze'`, bullish
   direction, breakout imminent (`estimatedDays ≥ 1` — the service emits 1 or 3).
4. **Imminent bullish MACD cross** — timing trigger `type==='macd_cross'`, bullish,
   `estimatedDays ≥ 1`.
5. **Oversold bounce** — timing trigger `type==='rsi_zone'`, oversold (bullish). RSI already
   in the oversold zone (`estimatedDays === 0`) counts: the *bounce* — the move we
   anticipate — is still ahead. "RSI approaching oversold" (`estimatedDays > 0`) also counts.

### Anticipation gate (≥1 day before the move)

In `timing-analysis.service.ts`, `estimatedDays === 0` means the event **already happened**
(golden cross executed, stoch cross just fired). Those are confirmatory and **never count**
toward confluence — except `rsi_zone` per rule 5, where the zone is the setup and the bounce
is the anticipated move. `stoch_cross` (always `estimatedDays: 0`) is excluded from the
taxonomy entirely.

### Category dedup (no fake confluence)

Divergences live in TWO places: `o.divergences` AND as timing triggers (`rsi_divergence`,
`macd_divergence`, `obv_divergence` in the `TimingTrigger` type union). The same underlying
divergence must never produce two categories. Rule: any `*_divergence` trigger maps to the
`divergence` category, which counts at most once regardless of how many divergence signals
exist. Confluence requires ≥2 *distinct* categories after this mapping.

### Direction field

Today bullishness is only encoded in the trigger *description* text (fragile). We add an
explicit `direction: 'bullish' | 'bearish' | 'neutral'` field to `TimingTrigger`, set at
the source in `timing-analysis.service.ts`, so the detector reads direction reliably
instead of string-matching. Divergences already carry an explicit `type`.

## Verdict feedback (single discourse)

The GGAL miss happened because `smartAction()` (`scoring.ts:402–480`) only overrides
*downward* (bearish divergences → SELL); there is no bullish counterpart, so the weekly
bullish MACD divergence left the verdict at MANTENER. We add the symmetric layer:

- **≥2 bullish anticipatory categories** (same confluence that fires the alert) →
  `HOLD → WATCH`, and `WATCH → BUY` only when the composite score also supports it
  (score ≥ BUY-adjacent threshold) and no axis veto is active. Never upgrades past what
  vetos allow — `applyAxisVetos` still runs last.
- Traced in `VerdictChain` as its own layer, e.g.
  `["algo:HOLD(54)", "anticipatory:WATCH(divergence+macd_cross)"]`, `source` extended
  accordingly. Full traceability, same convention as `verdicts.service.ts:155–217`.
- **Conflict rule:** if the bearish `smartAction` override fired for the asset (bearish
  divergences present), there is **no alert and no upgrade** — conflicting tape means no
  confluence. Bearish signals never count toward a bullish alert, and a bearish override
  always wins.

Result: the pinned alert, the opportunity card, the digest recommendation, and the LLM
narrative all derive from one verdict that already absorbed the confluence. No surface can
say MANTENER while another screams "entrada".

## Data model

```ts
// packages/shared/src/types
export interface TimingTrigger {            // EXTENDED
  type: string;
  description: string;
  estimatedDays: number | null;
  impact: 'high' | 'medium';
  direction: 'bullish' | 'bearish' | 'neutral';   // NEW
}

export interface BullishSignal {
  category: 'divergence' | 'golden_cross' | 'bb_squeeze' | 'macd_cross' | 'oversold_bounce';
  description: string;       // verbatim from the engine signal
  estimatedDays: number | null;
  timeframe?: 'daily' | 'weekly';
}

export interface AnticipatoryAlert {
  id: string;                // stable key: `${symbol}:${sortedCategories.join('+')}`
  symbol: string;
  signals: BullishSignal[];  // the ≥2 confluent signals
  currentPrice: number;
  entryPrice?: number;       // from tradeLevels when present, else currentPrice
  stopLoss?: number;
  takeProfit?: number;
  score: number;             // opportunityScore
  status: 'active' | 'triggered' | 'expired';
  firstSeenDate: string;     // YYYY-MM-DD — when confluence first appeared
  lastSeenDate: string;      // last scan that still saw it
  seen: boolean;             // user has acknowledged (drives unread badge)
}
```

DB table `anticipatory_alerts`: `id` (pk), `symbol`, `signals` (json), `current_price`,
`entry_price`, `stop_loss`, `take_profit`, `score`, `status`, `first_seen_date`,
`last_seen_date`, `seen` (int), `created_at`, `updated_at`.

### Lifecycle / dedup (avoid re-pushing the same setup daily)

On each scan, build the current confluence set, then reconcile against stored alerts keyed
by `id` (symbol + category-set):
- **New** id not seen before → insert `active`, `seen=0`. **This is what fires a push.**
- **Still present** → update `lastSeenDate`, prices, keep `seen` as-is. No re-push.
- **Gone** (no longer confluent): if the asset's action is now BUY/strong or price already
  broke out → mark `triggered`; else after it disappears mark `expired`. (v1 heuristic:
  gone → `expired`; `triggered` refinement is a noted follow-up.)
- Active alerts not re-seen for **5 scans** (≈1 trading week) → `expired` (configurable const).

## Backend

1. `apps/backend/src/opportunities/anticipatory-alerts.ts` — **pure functions**, TDD:
   - `extractBullishSignals(opp): BullishSignal[]` — from divergences + timingView.
   - `buildAlertsFromScan(opps): AnticipatoryAlert[]` — emit one alert per asset with
     `≥2` distinct categories; entry/stop/target from `tradeLevels` when present.
2. `reconcileAlerts(current, stored)` — pure: returns `{ toInsert, toUpdate, toExpire, newAlerts }`.
   Persistence wrapper in the repository applies it.
3. Repository (`db/repository.ts`) + schema: table + `getActiveAlerts`, `getRecentAlerts`,
   `upsertAlerts`, `markAlertsSeen`, `countUnseenAlerts`.
4. Verdict feedback: bullish counterpart in `smartAction()` / verdict layer (see *Verdict
   feedback* above) — runs **inside scoring**, before the digest projection, so
   `digest-recommendations.ts` (which copies `action` verbatim from the scan) inherits the
   upgraded verdict for free.
5. Scan hook: where the digest is built (`market-report.service.ts` / the scan orchestrator),
   after opportunities are computed, run build → reconcile → persist. Return `newAlerts`
   count for logging.
6. tRPC `alerts` router: `list` (active + recent, with status), `unseenCount`, `markSeen`.

## Coherence with the rest of the app (no double discourse)

Every surface that emits opinions about assets must see the active alerts:

- **Digest recommendations** (`digest-recommendations.ts`): inherit the upgraded verdict
  automatically (projection is verbatim from the scan). Rows whose symbol has an active
  alert get an `anticipatoryAlert: true` flag → frontend renders a `⚡` chip linking to the
  panel.
- **LLM prompts** (`COMBINED_SYNTHESIS_PROMPT`, `UNIFIED_ASSET_ANALYSIS_PROMPT` in
  `packages/shared/src/constants/prompts.ts`): the prompt context includes the active
  alerts list with an explicit instruction — narratives must acknowledge the setup and
  must never contradict it (no "sin catalizadores a la vista" on a symbol with active
  confluence).
- **avoidList**: a symbol with an active anticipatory alert can never appear in
  `avoidList`. Filter engine-side (not just in `MarketReportView.tsx`, which today only
  filters vs BUY tickers); log the collision if the LLM proposed it.
- **`timingView.action` consistency**: an asset whose `timingView.action === 'SELL'`
  cannot fire a bullish alert (same spirit as the bearish-override conflict rule).
- **Existing alert types**: `SwingAlert` (`packages/shared/src/types/swing-alert.ts`)
  already models `status: active/expired`, entry/target/stop. `AnticipatoryAlert` follows
  the same naming conventions (field names, status vocabulary) so a future unified alerts
  panel is mechanical. We do not merge them in v1 — different lifecycles — but we do not
  invent divergent conventions either.

## Frontend

- **Pinned section** in `DailySummary.tsx`, above "QUE PASO": `⚡ ALERTAS ANTICIPATORIAS`.
  Each row: `SYMBOL` + confluent signal chips + suggested `Entrada / Stop / Target`. Empty
  state hidden (section only renders when ≥1 active alert).
- **Badge** in `Sidebar`/`Header`: unseen count → routes to the panel; clears on view.
- **Panel** (new `alerts/AlertsPanel.tsx`): list with status (vigente / disparada /
  vencida), signals, levels, dates. `markSeen` on open.
- **Browser notification:** `alerts/useAlertNotifications.ts`. Request `Notification`
  permission (once, via a small opt-in control — never auto-prompt on load). Poll
  `alerts.unseenCount` (tRPC `refetchInterval`, reusing the existing pattern; alerts are
  daily-cadence so ~60s poll is ample) and, on a rise in unseen new-alert ids, fire
  `new Notification(...)` linking to the panel.
  - **Scope v1:** desktop notification fires while the app tab is open (incl. backgrounded
    — the OS shows it). **True closed-tab Web Push** (service worker + VAPID + backend push
    sender) is explicitly **out of scope v1** — noted follow-up. We will not silently imply
    closed-tab delivery.

## Testing

`anticipatory-alerts.test.ts` (TDD, first):
- `<2` categories → no alert.
- `≥2` distinct categories → alert with both signals, dedup of same-category.
- **Anticipation gate:** trigger with `estimatedDays === 0` (e.g. golden cross already
  executed) never counts; `estimatedDays ≥ 1` counts; `rsi_zone` oversold-now exception.
- **Divergence dedup:** same divergence present in `o.divergences` AND as a
  `*_divergence` timing trigger → 1 category, no alert from that alone.
- entry/stop/target taken from `tradeLevels`; fallback to currentPrice when absent.
- bearish signals never count toward a bullish alert.
- **Conflict rule:** bearish smartAction override present (or `timingView.action==='SELL'`)
  → no alert, no upgrade.
- **Verdict feedback:** HOLD + confluence → WATCH; WATCH + confluence + supporting score →
  BUY; axis veto still wins; trace shows the `anticipatory:` layer.
- `reconcileAlerts`: new vs still-present vs gone → correct buckets; `seen` preserved on
  still-present; same id never produces a second "new".

## Out of scope (noted follow-ups)

- True Web Push when the tab is closed (VAPID + service worker + backend sender).
- Intraday cadence (scheduler + intraday scans).
- `triggered` vs `expired` refinement (did the setup actually break out?).
- Bearish/exit anticipatory alerts (symmetry) — v1 is bullish-only. (Bearish *verdict*
  overrides already exist in `smartAction()`; only the alert/notification side is missing.)
- Unified alerts panel merging `SwingAlert` + `AnticipatoryAlert`.
- Accuracy tracking of alerts (did the anticipated move materialize?) to calibrate the
  verdict-upgrade thresholds over time.
- Grounding the digest narrative (`overnightSummary`/`portfolioImpact`/`marketMood`)
  against the day's price tape — related coherence issue, separate change.
