# Evidence-Based Signals — V2 Design

**Date:** 2026-04-18  
**Status:** Approved — In Development  
**Branch:** feature/v2-evidence-based-signals

---

## Context & Motivation

V1 (archived as `archive/v1-naive-scoring-model`) was a scorecard aggregating commodity
signals (Yahoo Finance technicals + public news sentiment) with arbitrary weights. It had
no validated edge, a broken backtest (0% costs), and competed on data all quant funds
already have with much better tooling.

V2 focuses on **3 documented, academically-validated edges** available to retail swing traders:

| Edge | Source | Why It Works |
|------|--------|--------------|
| Post-Earnings Announcement Drift (PEAD) | Yahoo Finance earnings history | Market systematically underreacts to large earnings beats; price drifts 30-60 days post-earnings |
| Insider Buying (Form 4) | Yahoo Finance insider transactions | Officers buying with personal money = highest-quality signal; legally disclosed, publicly accessible |
| Options Unusual Activity | Yahoo Finance options chain | Institutions position in options *before* equities; unusual call volume precedes institutional accumulation |

---

## Architecture

```
evidence-signals/
  pead.service.ts           — PEAD signal computation
  insider.service.ts        — Insider buying signal computation
  options-flow.service.ts   — Options flow signal computation
  evidence-signals.service.ts — Aggregator (fetches + combines all 3)
  evidence-signals.router.ts  — tRPC router

shared/yahoo.ts             — Extended with: getEarningsHistory, getInsiderTransactions, getOptionsChain

packages/shared/types/evidence-signals.ts — All V2 types

DB: evidence_signals_cache  — Per-symbol JSON cache, 6h TTL
```

---

## Signal Definitions

### 1. PEAD Signal

**Trigger conditions:**
- Most recent earnings quarter: actual EPS beat estimate by ≥ 10%
- Earnings date was within the last 60 days (still within drift window)

**Score (0–100):**
- Beat 10–15%: score 55
- Beat 15–25%: score 70
- Beat 25–40%: score 85
- Beat > 40%: score 95

**Output:**
```typescript
{
  active: boolean;
  beatPercent: number;       // actual surprise %
  daysSinceEarnings: number; // how many days ago
  daysInDriftWindow: number; // days remaining in 60-day window
  score: number;             // 0-100
  epsActual: number;
  epsEstimate: number;
}
```

---

### 2. Insider Buying Signal

**Trigger conditions:**
- At least 1 open-market purchase by C-suite or Director within last 90 days
- Total purchase value ≥ $50,000 USD
- Transaction type: "Purchase" (excludes option exercises, grants)

**Score (0–100):**
- Total value $50K–$200K: score 55
- $200K–$1M: score 70
- $1M–$5M: score 85
- > $5M: score 95
- Multiple insiders buying in same window: +10 bonus

**Output:**
```typescript
{
  active: boolean;
  recentBuys: InsiderTransaction[];  // filtered to last 90 days
  totalValue: number;                // USD
  numberOfBuyers: number;
  mostRecentBuyDate: string;         // ISO date
  score: number;
}
```

---

### 3. Options Flow Signal

**Trigger conditions:**
- Call/Put volume ratio > 2.0 for nearest expiry (within 45 days)
- Total call volume > 500 contracts
- Not earnings week (to avoid simple IV plays)

**Score (0–100):**
- C/P ratio 2.0–3.0 AND volume 500–1K: score 50
- C/P ratio 3.0–5.0 OR volume 1K–5K: score 65
- C/P ratio > 5.0 OR volume > 5K: score 80
- Both C/P > 5.0 AND volume > 5K: score 90

**Output:**
```typescript
{
  active: boolean;
  callVolume: number;
  putVolume: number;
  callPutRatio: number;
  nearestExpiry: string;    // ISO date
  dominantSentiment: 'bullish' | 'bearish' | 'neutral';
  score: number;
}
```

---

## Combined EvidenceSignal

```typescript
interface EvidenceSignal {
  symbol: string;
  scannedAt: string;
  conviction: 'high' | 'medium' | 'low' | 'none';
  activeSignals: number;          // count of 1, 2, or 3 active signals
  pead: PEADSignal;
  insider: InsiderSignal;
  optionsFlow: OptionsFlowSignal;
  compositeScore: number;         // weighted average of active signals
  recommendation: 'WATCH_CLOSELY' | 'INTERESTING' | 'NO_SIGNAL';
  reasoning: string;              // human-readable summary
}
```

**Conviction logic:**
- 3 signals active: HIGH
- 2 signals active: MEDIUM
- 1 signal active: LOW
- 0 signals active: NONE

**Composite score:** average of scores of active signals only.

---

## Data Flow

```
getAllEvidenceSignals()
  ├── For each active symbol (in parallel, max 5 concurrent):
  │     ├── getEarningsHistory(symbol)  → Yahoo quoteSummary?modules=earningsHistory
  │     ├── getInsiderTransactions(symbol) → Yahoo quoteSummary?modules=insiderTransactions
  │     └── getOptionsChain(symbol)    → Yahoo v7/finance/options/{symbol}
  │
  ├── computePEADSignal(earningsHistory)
  ├── computeInsiderSignal(insiderTransactions)
  ├── computeOptionsFlowSignal(optionsChain)
  │
  ├── aggregateEvidenceSignal(pead, insider, optionsFlow)
  └── Cache result in DB (6h TTL)
```

---

## Caching Strategy

- Per-symbol cache in `evidence_signals_cache` DB table
- TTL: 6 hours (evidence signals don't change intraday)
- Force refresh via `refresh` mutation
- On cache miss: fetch all 3 data sources concurrently per symbol

---

## Frontend

New tab **"Señales V2"** in the main tabs bar.

**Layout:**
- Summary bar: total symbols scanned, high-conviction count, medium-conviction count
- Filter: show all | high conviction only | by signal type
- Per-symbol card showing:
  - Symbol + current price
  - Conviction badge (HIGH/MEDIUM/LOW)
  - Active signals as pill badges (PEAD, Insider, Options)
  - Composite score
  - PEAD detail: "Beat Q1 by 18.5% — 23 days ago"
  - Insider detail: "CEO bought $2.1M — April 2"
  - Options detail: "C/P ratio 4.2x — 3,200 calls"

---

## What V2 Does NOT Do

- No news sentiment (still available in V1 opportunities tab — both coexist)
- No backtest (paper trading is the validation method — manual tracking)
- No automated trade execution
- No ML model training

---

## Validation Plan

1. Generate signals for 60 days (paper trading)
2. After 60+ signals: calculate win rate vs S&P500
3. If win rate > 55% on HIGH conviction: weight those setups more
4. If no edge detected after 90 days: revisit signal definitions

---

## Implementation Plan

### Step 1: Types + DB
- `packages/shared/src/types/evidence-signals.ts`
- `apps/backend/src/db/schema.ts` — add `evidenceSignalsCache` table
- `apps/backend/drizzle/0021_evidence_signals_cache.sql`

### Step 2: Yahoo Extensions
- `getEarningsHistory(symbol)` — earningsHistory module
- `getInsiderTransactions(symbol)` — insiderTransactions module  
- `getOptionsChain(symbol)` — v7/finance/options

### Step 3: Signal Services
- `evidence-signals/pead.service.ts`
- `evidence-signals/insider.service.ts`
- `evidence-signals/options-flow.service.ts`

### Step 4: Aggregator + Router
- `evidence-signals/evidence-signals.service.ts`
- `evidence-signals/evidence-signals.router.ts`
- Register in `router.ts`

### Step 5: Frontend
- `apps/frontend/src/evidence-signals/EvidenceSignals.tsx`
- Add "Señales V2" tab in `App.tsx`
