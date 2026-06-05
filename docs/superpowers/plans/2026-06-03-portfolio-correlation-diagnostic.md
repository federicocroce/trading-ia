# Portfolio Correlation Diagnostic Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the opportunity engine portfolio-aware — classify symbols into shared risk factors, add a traceable score modifier (dial-gated, OFF by default) that penalizes candidates stacking existing risk and rewards diversifiers, and emit a portfolio diagnostic (factor concentration + missing hedges) on the daily market report.

**Architecture:** Three units mirroring the existing `computeMacroAdjustment → MacroAdjustment → verdict chain` pattern. A hybrid classifier (curated factor map confirmed by Pearson price correlation) feeds (a) a per-symbol `PortfolioAdjustment` applied to the composite inside `buildAlgorithmicOpportunity`, and (b) a portfolio-level `PortfolioDiagnostic` attached to `market_reports`. Everything ships with the dial at 0 (trace only).

**Tech Stack:** TypeScript monorepo (pnpm workspaces), NestJS-style backend, Vitest, Drizzle/SQLite, React frontend. Shared types in `packages/shared`.

**Reference spec:** `docs/superpowers/specs/2026-06-03-portfolio-correlation-diagnostic-design.md`

---

## File Structure

- `packages/shared/src/types/portfolio-risk.ts` — **new**: `RiskFactor`, `PortfolioAdjustment`, `PortfolioDiagnostic`, `PortfolioContext`.
- `packages/shared/src/types/opportunity.ts` — **modify**: add `portfolioAdjustment?` to `Opportunity`; extend `VerdictChain` layer note. Re-export new types.
- `packages/shared/src/index.ts` (or types barrel) — **modify**: export new types.
- `apps/backend/src/opportunities/risk-factor-map.ts` — **new**: curated `symbol → RiskFactor[]` + sector inference.
- `apps/backend/src/opportunities/correlation.ts` — **new**: Pearson correlation over return series.
- `apps/backend/src/opportunities/portfolio-risk.service.ts` — **new**: `buildPortfolioContext`, `computePortfolioAdjustment`, `buildPortfolioDiagnostic`.
- `apps/backend/src/opportunities/verdicts.service.ts` — **modify**: `resolveFinalVerdict` accepts `portfolioAdjustment`, adds trace layer.
- `apps/backend/src/opportunities/scoring.ts` — **modify**: `buildAlgorithmicOpportunity` accepts `PortfolioContext`, applies delta to composite, passes adjustment to verdict.
- `apps/backend/src/opportunities/opportunities.service.ts` — **modify**: build `PortfolioContext` once per scan, pass to builder, compute diagnostic at scan end.
- `apps/backend/src/intelligence/market-report.service.ts` — **modify**: persist/read `portfolioDiagnostic`.
- `apps/backend/src/db/repository.ts` + `drizzle` — **modify**: add `portfolio_diagnostic` column to `market_reports`.
- `apps/backend/src/opportunities/opportunities.router.ts` (or market-report router) — **modify**: expose diagnostic endpoint.
- `apps/frontend/src/portfolio/PortfolioDiagnosticPanel.tsx` — **new**: minimal panel rendering the diagnostic.
- Tests co-located: `correlation.test.ts`, `portfolio-risk.service.test.ts`, `risk-factor-map.test.ts`.

---

## Task 1: Shared types

**Files:**
- Create: `packages/shared/src/types/portfolio-risk.ts`
- Modify: `packages/shared/src/types/opportunity.ts`, types barrel export

- [ ] **Step 1: Create the types file**

```ts
// packages/shared/src/types/portfolio-risk.ts
export type RiskFactor =
  | 'oil' | 'gas' | 'argentina' | 'emerging-markets' | 'crypto' | 'semis'
  | 'gold' | 'safe-haven' | 'rates' | 'us-equity' | 'china' | 'risk-on';

export const ALL_RISK_FACTORS: RiskFactor[] = [
  'oil', 'gas', 'argentina', 'emerging-markets', 'crypto', 'semis',
  'gold', 'safe-haven', 'rates', 'us-equity', 'china', 'risk-on',
];

/** Hedge factors — what protects when risk-on falls. */
export const HEDGE_FACTORS: RiskFactor[] = ['safe-haven', 'rates', 'gold'];

/** Per-scan portfolio snapshot, computed once and shared across candidates. */
export interface PortfolioContext {
  /** Value-weighted factor concentration of current holdings. factor → 0..1 */
  factorWeights: Partial<Record<RiskFactor, number>>;
  /** Holdings grouped by factor for explanations. factor → symbols */
  factorSymbols: Partial<Record<RiskFactor, string[]>>;
  /** symbol → daily return series (most recent last), for correlation. */
  returns: Record<string, number[]>;
  /** Total portfolio value; 0 means empty portfolio. */
  totalValue: number;
}

export interface PortfolioConcentration {
  factor: RiskFactor;
  portfolioWeight: number;  // 0..1
  avgCorrelation: number;   // candidate vs holdings in that factor; NaN if unknown
}

export interface PortfolioAdjustment {
  delta: number;        // applied to composite (rawDelta × intensity)
  rawDelta: number;     // before intensity scaling
  intensity: number;    // 0..1 dial
  concentration: PortfolioConcentration[];
  verdict: 'stacks' | 'diversifies' | 'neutral';
  reason: string;
}

export interface MissingHedge {
  hedge: RiskFactor;
  reason: string;
  candidates: string[];
}

export interface PortfolioDiagnostic {
  factorExposure: Array<{ factor: RiskFactor; weight: number; symbols: string[] }>;
  concentrationFlags: string[];
  missingHedges: MissingHedge[];
  diversifiers: string[];
  stackers: string[];
}
```

- [ ] **Step 2: Wire into `Opportunity` and barrel.** In `opportunity.ts`, add the import-less field (types are re-exported from the barrel, so reference by name after export):

Add to `Opportunity` interface (after `macroAdjustment?` near line 130):
```ts
  /** Cómo se relaciona el candidato con la cartera actual (correlación/concentración). */
  portfolioAdjustment?: import('./portfolio-risk.js').PortfolioAdjustment;
```

In the types barrel (`packages/shared/src/types/index.ts` if present, else `packages/shared/src/index.ts`), add:
```ts
export * from './portfolio-risk.js';
```

- [ ] **Step 3: Build shared to verify types compile**

Run: `pnpm --filter @trading/shared build`
Expected: PASS (no type errors).

- [ ] **Step 4: Commit**

```bash
git add packages/shared/src/types/portfolio-risk.ts packages/shared/src/types/opportunity.ts packages/shared/src/index.ts packages/shared/src/types/index.ts
git commit -m "feat(shared): tipos para diagnóstico de correlación de cartera"
```

---

## Task 2: Pearson correlation util (TDD)

**Files:**
- Create: `apps/backend/src/opportunities/correlation.ts`
- Test: `apps/backend/src/opportunities/correlation.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
// correlation.test.ts
import { describe, it, expect } from 'vitest';
import { pearson, toReturns } from './correlation.js';

describe('pearson', () => {
  it('returns ~1 for identical series', () => {
    expect(pearson([1, 2, 3, 4], [1, 2, 3, 4])).toBeCloseTo(1, 5);
  });
  it('returns ~-1 for inverted series', () => {
    expect(pearson([1, 2, 3, 4], [4, 3, 2, 1])).toBeCloseTo(-1, 5);
  });
  it('returns ~0 for independent series', () => {
    expect(Math.abs(pearson([1, -1, 1, -1], [1, 1, 1, 1]))).toBeLessThan(1e-9);
  });
  it('returns NaN when fewer than 2 overlapping points', () => {
    expect(Number.isNaN(pearson([1], [1]))).toBe(true);
  });
  it('handles unequal lengths by truncating to the shorter (aligned at the end)', () => {
    expect(pearson([9, 1, 2, 3], [1, 2, 3])).toBeCloseTo(1, 5);
  });
});

describe('toReturns', () => {
  it('converts close prices to simple returns', () => {
    expect(toReturns([100, 110, 99])).toEqual([0.1, -0.1]);
  });
  it('returns [] for a single price', () => {
    expect(toReturns([100])).toEqual([]);
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `pnpm --filter @trading/backend test -- correlation`
Expected: FAIL ("Cannot find module './correlation.js'").

- [ ] **Step 3: Implement**

```ts
// correlation.ts
/** Simple daily returns from a close-price series. */
export function toReturns(closes: number[]): number[] {
  const out: number[] = [];
  for (let i = 1; i < closes.length; i++) {
    const prev = closes[i - 1];
    if (prev === 0) { out.push(0); continue; }
    out.push((closes[i] - prev) / prev);
  }
  return out;
}

/** Pearson correlation. Aligns series at the END (most recent), truncating to the shorter.
 *  Returns NaN if fewer than 2 overlapping points or zero variance. */
export function pearson(a: number[], b: number[]): number {
  const n = Math.min(a.length, b.length);
  if (n < 2) return NaN;
  const aa = a.slice(a.length - n);
  const bb = b.slice(b.length - n);
  const meanA = aa.reduce((s, x) => s + x, 0) / n;
  const meanB = bb.reduce((s, x) => s + x, 0) / n;
  let num = 0, denA = 0, denB = 0;
  for (let i = 0; i < n; i++) {
    const da = aa[i] - meanA, db = bb[i] - meanB;
    num += da * db; denA += da * da; denB += db * db;
  }
  if (denA === 0 || denB === 0) return NaN;
  return num / Math.sqrt(denA * denB);
}
```

- [ ] **Step 4: Run to verify it passes**

Run: `pnpm --filter @trading/backend test -- correlation`
Expected: PASS (7 tests).

- [ ] **Step 5: Commit**

```bash
git add apps/backend/src/opportunities/correlation.ts apps/backend/src/opportunities/correlation.test.ts
git commit -m "feat(opportunities): util de correlación de Pearson sobre retornos"
```

---

## Task 3: Curated risk-factor map (TDD)

**Files:**
- Create: `apps/backend/src/opportunities/risk-factor-map.ts`
- Test: `apps/backend/src/opportunities/risk-factor-map.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
// risk-factor-map.test.ts
import { describe, it, expect } from 'vitest';
import { factorsForSymbol } from './risk-factor-map.js';

describe('factorsForSymbol', () => {
  it('returns curated factors for known symbols', () => {
    expect(factorsForSymbol('YPF', undefined).sort()).toEqual(['argentina', 'emerging-markets', 'oil']);
    expect(factorsForSymbol('GLD', undefined).sort()).toEqual(['gold', 'safe-haven']);
    expect(factorsForSymbol('EOG', undefined).sort()).toEqual(['oil', 'us-equity']);
  });
  it('is case-insensitive', () => {
    expect(factorsForSymbol('ypf', undefined)).toContain('oil');
  });
  it('infers from sector when symbol is unknown', () => {
    expect(factorsForSymbol('UNKNOWN1', 'us-energy')).toContain('oil');
    expect(factorsForSymbol('UNKNOWN2', 'bonds')).toContain('rates');
  });
  it('returns [] for unknown symbol and unknown sector', () => {
    expect(factorsForSymbol('ZZZZ', 'made-up-sector')).toEqual([]);
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `pnpm --filter @trading/backend test -- risk-factor-map`
Expected: FAIL (module not found).

- [ ] **Step 3: Implement**

```ts
// risk-factor-map.ts
import type { RiskFactor } from '@trading/shared';

/** Curated symbol → factors. Extend over time; misses fall back to sector inference. */
const SYMBOL_FACTORS: Record<string, RiskFactor[]> = {
  // Argentina / energy (current portfolio)
  YPF: ['oil', 'argentina', 'emerging-markets'],
  PAM: ['oil', 'gas', 'argentina'],
  VIST: ['oil', 'argentina'],
  GGAL: ['argentina', 'emerging-markets', 'risk-on'],
  // Crypto miners
  MARA: ['crypto', 'risk-on'],
  HUT: ['crypto', 'risk-on'],
  // Commodities / gold
  NEM: ['gold'],
  GLD: ['gold', 'safe-haven'],
  GDX: ['gold'],
  // Semis
  TSM: ['semis', 'china'],
  // US oil majors / E&P
  EOG: ['oil', 'us-equity'],
  COP: ['oil', 'us-equity'],
  BP: ['oil', 'us-equity'],
  XLE: ['oil', 'us-equity'],
  // China / EM
  KWEB: ['china', 'emerging-markets', 'risk-on'],
  PDD: ['china', 'emerging-markets'],
  // Rates / safe-haven
  IEF: ['rates', 'safe-haven'],
  TLT: ['rates', 'safe-haven'],
  AGG: ['rates'],
  SHY: ['rates', 'safe-haven'],
  // Broad US
  SPY: ['us-equity', 'risk-on'],
};

/** Sector → factors fallback (sector strings come from getSectorForSymbolDynamic). */
const SECTOR_FACTORS: Record<string, RiskFactor[]> = {
  'us-energy': ['oil', 'us-equity'],
  'energy': ['oil'],
  'bonds': ['rates'],
  'us-tech': ['us-equity', 'risk-on'],
  'crypto': ['crypto', 'risk-on'],
};

export function factorsForSymbol(symbol: string, sector: string | undefined): RiskFactor[] {
  const direct = SYMBOL_FACTORS[symbol.toUpperCase()];
  if (direct) return [...direct];
  if (sector && SECTOR_FACTORS[sector]) return [...SECTOR_FACTORS[sector]];
  return [];
}

export function hasCuratedEntry(symbol: string): boolean {
  return symbol.toUpperCase() in SYMBOL_FACTORS;
}
```

- [ ] **Step 4: Run to verify it passes**

Run: `pnpm --filter @trading/backend test -- risk-factor-map`
Expected: PASS (4 tests).

- [ ] **Step 5: Commit**

```bash
git add apps/backend/src/opportunities/risk-factor-map.ts apps/backend/src/opportunities/risk-factor-map.test.ts
git commit -m "feat(opportunities): mapa curado de factores de riesgo + inferencia por sector"
```

---

## Task 4: `buildPortfolioContext` + `computePortfolioAdjustment` (TDD)

**Files:**
- Create: `apps/backend/src/opportunities/portfolio-risk.service.ts`
- Test: `apps/backend/src/opportunities/portfolio-risk.service.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
// portfolio-risk.service.test.ts
import { describe, it, expect } from 'vitest';
import { buildPortfolioContext, computePortfolioAdjustment } from './portfolio-risk.service.js';
import type { PortfolioContext } from '@trading/shared';

const HOLDINGS = [
  { symbol: 'YPF', value: 8000, returns: [0.01, -0.02, 0.03, 0.01] },
  { symbol: 'PAM', value: 6000, returns: [0.011, -0.019, 0.031, 0.009] },
  { symbol: 'VIST', value: 6000, returns: [0.009, -0.021, 0.029, 0.012] },
];

describe('buildPortfolioContext', () => {
  it('computes value-weighted factor concentration', () => {
    const ctx = buildPortfolioContext(HOLDINGS);
    // all three are oil → weight should be 1.0 for oil
    expect(ctx.factorWeights.oil).toBeCloseTo(1.0, 5);
    expect(ctx.factorSymbols.oil?.sort()).toEqual(['PAM', 'VIST', 'YPF']);
    expect(ctx.totalValue).toBe(20000);
  });
  it('handles empty portfolio', () => {
    const ctx = buildPortfolioContext([]);
    expect(ctx.totalValue).toBe(0);
    expect(ctx.factorWeights).toEqual({});
  });
});

describe('computePortfolioAdjustment', () => {
  const ctx = buildPortfolioContext(HOLDINGS);

  it('flags an oil candidate as stacking (correlated with heavy factor)', () => {
    const adj = computePortfolioAdjustment('EOG', ['oil', 'us-equity'],
      [0.0105, -0.0205, 0.0305, 0.0102], ctx, 1);
    expect(adj.verdict).toBe('stacks');
    expect(adj.rawDelta).toBeLessThan(0);
    expect(adj.delta).toBe(adj.rawDelta); // intensity 1
    expect(adj.reason).toMatch(/oil/);
  });

  it('rewards a true diversifier (new factor, low correlation)', () => {
    const adj = computePortfolioAdjustment('GLD', ['gold', 'safe-haven'],
      [-0.01, 0.02, -0.03, 0.0], ctx, 1);
    expect(adj.verdict).toBe('diversifies');
    expect(adj.rawDelta).toBeGreaterThan(0);
  });

  it('dial at 0 produces delta 0 but keeps rawDelta (trace only)', () => {
    const adj = computePortfolioAdjustment('EOG', ['oil', 'us-equity'],
      [0.0105, -0.0205, 0.0305, 0.0102], ctx, 0);
    expect(adj.delta).toBe(0);
    expect(adj.rawDelta).toBeLessThan(0);
  });

  it('is neutral for empty portfolio', () => {
    const empty = buildPortfolioContext([]);
    const adj = computePortfolioAdjustment('EOG', ['oil'], [0.01], empty, 1);
    expect(adj.verdict).toBe('neutral');
    expect(adj.delta).toBe(0);
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `pnpm --filter @trading/backend test -- portfolio-risk.service`
Expected: FAIL (module not found).

- [ ] **Step 3: Implement**

```ts
// portfolio-risk.service.ts
import type {
  RiskFactor, PortfolioContext, PortfolioAdjustment, PortfolioConcentration,
} from '@trading/shared';
import { pearson } from './correlation.js';
import { factorsForSymbol } from './risk-factor-map.js';

export interface HoldingInput {
  symbol: string;
  value: number;       // position market value
  returns: number[];   // daily returns, recent last
  sector?: string;
}

const FACTOR_THRESHOLD = Number(process.env.PORTFOLIO_FACTOR_THRESHOLD ?? '0.30');
const STACK_CORR = 0.6;          // correlation that confirms "same risk"
const MAX_RAW_DELTA = 12;        // cap, in composite points

export function buildPortfolioContext(holdings: HoldingInput[]): PortfolioContext {
  const totalValue = holdings.reduce((s, h) => s + h.value, 0);
  const factorWeights: Partial<Record<RiskFactor, number>> = {};
  const factorSymbols: Partial<Record<RiskFactor, string[]>> = {};
  const returns: Record<string, number[]> = {};

  for (const h of holdings) {
    returns[h.symbol.toUpperCase()] = h.returns;
    const factors = factorsForSymbol(h.symbol, h.sector);
    const w = totalValue > 0 ? h.value / totalValue : 0;
    for (const f of factors) {
      factorWeights[f] = (factorWeights[f] ?? 0) + w;
      (factorSymbols[f] ??= []).push(h.symbol.toUpperCase());
    }
  }
  return { factorWeights, factorSymbols, returns, totalValue };
}

/** Average correlation of a candidate's returns vs the holdings in a given factor. */
function avgCorrelationToFactor(
  candidateReturns: number[], factor: RiskFactor, ctx: PortfolioContext,
): number {
  const syms = ctx.factorSymbols[factor] ?? [];
  const corrs: number[] = [];
  for (const s of syms) {
    const r = ctx.returns[s];
    if (!r || r.length < 2 || candidateReturns.length < 2) continue;
    const c = pearson(candidateReturns, r);
    if (!Number.isNaN(c)) corrs.push(c);
  }
  if (corrs.length === 0) return NaN;
  return corrs.reduce((a, b) => a + b, 0) / corrs.length;
}

export function computePortfolioAdjustment(
  symbol: string,
  candidateFactors: RiskFactor[],
  candidateReturns: number[],
  ctx: PortfolioContext,
  intensity: number,
): PortfolioAdjustment {
  if (ctx.totalValue === 0 || candidateFactors.length === 0) {
    return { delta: 0, rawDelta: 0, intensity, concentration: [], verdict: 'neutral',
      reason: ctx.totalValue === 0 ? 'Sin cartera de referencia.' : 'Sin factores clasificados.' };
  }

  const concentration: PortfolioConcentration[] = [];
  let stackScore = 0;       // accumulates how much it piles onto heavy factors
  let novelFactors = 0;     // factors the portfolio lacks

  for (const f of candidateFactors) {
    const weight = ctx.factorWeights[f] ?? 0;
    if (weight === 0) { novelFactors++; continue; }
    const corr = avgCorrelationToFactor(candidateReturns, f, ctx);
    concentration.push({ factor: f, portfolioWeight: weight, avgCorrelation: corr });
    if (weight >= FACTOR_THRESHOLD) {
      // severity grows with weight; correlation amplifies (default 1 if unknown).
      const corrMult = Number.isNaN(corr) ? 1 : Math.max(0, corr) / STACK_CORR;
      stackScore += weight * Math.min(corrMult, 1.5);
    }
  }

  let rawDelta = 0;
  let verdict: PortfolioAdjustment['verdict'] = 'neutral';
  let reason = 'Relación neutral con la cartera.';

  if (stackScore > 0) {
    rawDelta = -Math.min(MAX_RAW_DELTA, Math.round(stackScore * MAX_RAW_DELTA));
    verdict = 'stacks';
    const top = concentration
      .filter(c => c.portfolioWeight >= FACTOR_THRESHOLD)
      .sort((a, b) => b.portfolioWeight - a.portfolioWeight)[0];
    const corrTxt = top && !Number.isNaN(top.avgCorrelation) ? `, corr ${top.avgCorrelation.toFixed(2)}` : '';
    const syms = (top ? ctx.factorSymbols[top.factor] ?? [] : []).join('/');
    reason = `Apila riesgo ${top?.factor} (ya ${Math.round((top?.portfolioWeight ?? 0) * 100)}% en ${syms}${corrTxt}).`;
  } else if (novelFactors === candidateFactors.length) {
    // entirely new factors → diversifier
    rawDelta = Math.min(6, novelFactors * 3);
    verdict = 'diversifies';
    reason = `Diversifica: aporta factores que la cartera no tiene (${candidateFactors.join(', ')}).`;
  } else if (novelFactors > 0) {
    rawDelta = 3;
    verdict = 'diversifies';
    reason = `Parcialmente diversificador: suma ${novelFactors} factor(es) nuevo(s).`;
  }

  const clampedIntensity = Math.max(0, Math.min(1, intensity));
  const delta = Math.round(rawDelta * clampedIntensity);
  return { delta, rawDelta, intensity: clampedIntensity, concentration, verdict, reason };
}
```

- [ ] **Step 4: Run to verify it passes**

Run: `pnpm --filter @trading/backend test -- portfolio-risk.service`
Expected: PASS (6 tests).

- [ ] **Step 5: Commit**

```bash
git add apps/backend/src/opportunities/portfolio-risk.service.ts apps/backend/src/opportunities/portfolio-risk.service.test.ts
git commit -m "feat(opportunities): contexto de cartera + modificador de correlación con dial"
```

---

## Task 5: Verdict chain layer (TDD)

**Files:**
- Modify: `apps/backend/src/opportunities/verdicts.service.ts`
- Test: extend `apps/backend/src/opportunities/portfolio-risk.service.test.ts` (verdict integration) or new `verdicts.portfolio.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
// verdicts.portfolio.test.ts
import { describe, it, expect } from 'vitest';
import { resolveFinalVerdict } from './verdicts.service.js';

describe('resolveFinalVerdict with portfolioAdjustment', () => {
  it('adds a portfolio trace layer showing the delta', () => {
    const v = resolveFinalVerdict({
      algoAction: 'BUY', algoScore: 64, smartAction: 'BUY',
      portfolioAdjustment: { delta: -4, rawDelta: -8, intensity: 0.5, concentration: [],
        verdict: 'stacks', reason: 'Apila riesgo oil (ya 40% en YPF/PAM/VIST, corr 0.78).' },
    });
    expect(v.trace.some(t => t.startsWith('portfolio:'))).toBe(true);
    expect(v.trace.find(t => t.startsWith('portfolio:'))).toMatch(/oil/);
  });
  it('shows delta 0 when dial is off', () => {
    const v = resolveFinalVerdict({
      algoAction: 'BUY', algoScore: 64, smartAction: 'BUY',
      portfolioAdjustment: { delta: 0, rawDelta: -8, intensity: 0, concentration: [],
        verdict: 'stacks', reason: 'Apila riesgo oil.' },
    });
    const layer = v.trace.find(t => t.startsWith('portfolio:'));
    expect(layer).toMatch(/Δ0/);
  });
  it('omits the layer when there is no adjustment or it is neutral', () => {
    const v = resolveFinalVerdict({ algoAction: 'BUY', algoScore: 64, smartAction: 'BUY' });
    expect(v.trace.some(t => t.startsWith('portfolio:'))).toBe(false);
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `pnpm --filter @trading/backend test -- verdicts.portfolio`
Expected: FAIL (resolveFinalVerdict does not accept portfolioAdjustment).

- [ ] **Step 3: Implement** — modify `resolveFinalVerdict` in `verdicts.service.ts`.

Add import at top:
```ts
import type { PortfolioAdjustment } from '@trading/shared';
```

Extend the `opts` parameter type with:
```ts
  portfolioAdjustment?: PortfolioAdjustment;
```

Destructure it and, after the `veto` trace push (after line ~175, before the smart layer), insert:
```ts
  const { portfolioAdjustment } = opts; // add to existing destructure
  // ...
  if (portfolioAdjustment && portfolioAdjustment.verdict !== 'neutral') {
    const sign = portfolioAdjustment.rawDelta >= 0 ? '+' : '';
    trace.push(
      `portfolio:${portfolioAdjustment.verdict} ` +
      `(${portfolioAdjustment.reason.replace(/\.$/, '')}) ` +
      `Δ${sign}${portfolioAdjustment.rawDelta}×${portfolioAdjustment.intensity}=${portfolioAdjustment.delta}`,
    );
  }
```
Note: the layer is informational in the trace; the score change itself is applied to the composite in `buildAlgorithmicOpportunity` (Task 6), so `finalAction`/`source` are unchanged here.

- [ ] **Step 4: Run to verify it passes**

Run: `pnpm --filter @trading/backend test -- verdicts.portfolio`
Expected: PASS (3 tests).

- [ ] **Step 5: Commit**

```bash
git add apps/backend/src/opportunities/verdicts.service.ts apps/backend/src/opportunities/verdicts.portfolio.test.ts
git commit -m "feat(opportunities): capa portfolio trazable en verdict chain"
```

---

## Task 6: Wire adjustment into `buildAlgorithmicOpportunity`

**Files:**
- Modify: `apps/backend/src/opportunities/scoring.ts`

- [ ] **Step 1: Add the optional context param.** Extend the signature (after `causalChains?`):

```ts
  portfolioCtx?: import('@trading/shared').PortfolioContext,
  candidateReturns?: number[],
```

Add the import to the existing `@trading/shared` type import block, plus the function:
```ts
import { computePortfolioAdjustment } from './portfolio-risk.service.js';
import { factorsForSymbol } from './risk-factor-map.js';
```

- [ ] **Step 2: Apply after the macro adjustment** (replace lines ~1314-1317):

```ts
  // === MACRO ADJUSTMENT: causalChains agregan/restan al composite ===
  const macroAdjustment = causalChains ? computeMacroAdjustment(symbol, causalChains) : undefined;
  let composite = compositeBase + (macroAdjustment?.delta ?? 0);

  // === PORTFOLIO ADJUSTMENT: correlación/concentración con la cartera (dial-gated) ===
  const intensity = Number(process.env.PORTFOLIO_CORR_INTENSITY ?? '0');
  const portfolioAdjustment = portfolioCtx
    ? computePortfolioAdjustment(symbol, factorsForSymbol(symbol, sector),
        candidateReturns ?? [], portfolioCtx, intensity)
    : undefined;
  composite += portfolioAdjustment?.delta ?? 0;

  if (composite < 0) composite = 0;
  if (composite > 100) composite = 100;
```

- [ ] **Step 3: Attach to result and verdict.** Where the result object is built, add `portfolioAdjustment` to it (search for `macroAdjustment` assignment on the result; add a sibling). Then in the `resolveFinalVerdict` call (line ~1574) add:

```ts
    portfolioAdjustment,
```

And after building `result`, ensure:
```ts
  result.portfolioAdjustment = portfolioAdjustment;
```

- [ ] **Step 4: Build backend to verify it compiles**

Run: `pnpm --filter @trading/backend build`
Expected: PASS.

- [ ] **Step 5: Run the full opportunities test suite (no regressions)**

Run: `pnpm --filter @trading/backend test -- opportunities scoring portfolio-risk verdicts correlation risk-factor`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add apps/backend/src/opportunities/scoring.ts
git commit -m "feat(opportunities): aplicar modificador de cartera al composite + verdict"
```

---

## Task 7: `buildPortfolioDiagnostic` (TDD)

**Files:**
- Modify: `apps/backend/src/opportunities/portfolio-risk.service.ts`
- Test: extend `portfolio-risk.service.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
// append to portfolio-risk.service.test.ts
import { buildPortfolioDiagnostic } from './portfolio-risk.service.js';

describe('buildPortfolioDiagnostic', () => {
  const ctx = buildPortfolioContext(HOLDINGS); // 100% oil, no hedges
  it('flags concentration and missing hedge', () => {
    const diag = buildPortfolioDiagnostic(ctx, [
      { symbol: 'GLD', verdict: 'diversifies' },
      { symbol: 'EOG', verdict: 'stacks' },
    ]);
    expect(diag.factorExposure.find(f => f.factor === 'oil')?.weight).toBeCloseTo(1, 5);
    expect(diag.concentrationFlags.some(s => /oil/.test(s))).toBe(true);
    expect(diag.missingHedges.length).toBeGreaterThan(0);
    expect(diag.diversifiers).toContain('GLD');
    expect(diag.stackers).toContain('EOG');
  });
  it('reports empty portfolio cleanly', () => {
    const diag = buildPortfolioDiagnostic(buildPortfolioContext([]), []);
    expect(diag.factorExposure).toEqual([]);
    expect(diag.concentrationFlags).toEqual([]);
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `pnpm --filter @trading/backend test -- portfolio-risk.service`
Expected: FAIL (buildPortfolioDiagnostic not exported).

- [ ] **Step 3: Implement** — append to `portfolio-risk.service.ts`:

```ts
import type { PortfolioDiagnostic, MissingHedge } from '@trading/shared';
import { HEDGE_FACTORS } from '@trading/shared';

const RISK_ON_FACTORS = ['risk-on', 'us-equity', 'emerging-markets', 'crypto', 'china'] as const;

export function buildPortfolioDiagnostic(
  ctx: PortfolioContext,
  candidateVerdicts: Array<{ symbol: string; verdict: 'stacks' | 'diversifies' | 'neutral' }>,
): PortfolioDiagnostic {
  if (ctx.totalValue === 0) {
    return { factorExposure: [], concentrationFlags: [], missingHedges: [], diversifiers: [], stackers: [] };
  }
  const factorExposure = (Object.keys(ctx.factorWeights) as Array<keyof typeof ctx.factorWeights>)
    .map(f => ({ factor: f as any, weight: ctx.factorWeights[f] ?? 0, symbols: ctx.factorSymbols[f] ?? [] }))
    .sort((a, b) => b.weight - a.weight);

  const concentrationFlags = factorExposure
    .filter(f => f.weight >= FACTOR_THRESHOLD)
    .map(f => `${Math.round(f.weight * 100)}% en ${f.factor} (${f.symbols.join('/')}) — alta concentración.`);

  const riskOnWeight = RISK_ON_FACTORS.reduce((s, f) => s + (ctx.factorWeights[f] ?? 0), 0);
  const hedgeWeight = HEDGE_FACTORS.reduce((s, f) => s + (ctx.factorWeights[f] ?? 0), 0);
  const diversifiers = candidateVerdicts.filter(c => c.verdict === 'diversifies').map(c => c.symbol);
  const stackers = candidateVerdicts.filter(c => c.verdict === 'stacks').map(c => c.symbol);

  const missingHedges: MissingHedge[] = [];
  if (riskOnWeight >= 0.5 && hedgeWeight < 0.1) {
    for (const h of HEDGE_FACTORS) {
      if ((ctx.factorWeights[h] ?? 0) > 0) continue;
      missingHedges.push({
        hedge: h,
        reason: `Cartera ${Math.round(riskOnWeight * 100)}% risk-on sin cobertura ${h}: si cae el apetito de riesgo, nada sube.`,
        candidates: diversifiers,
      });
    }
  }
  return { factorExposure, concentrationFlags, missingHedges, diversifiers, stackers };
}
```

- [ ] **Step 4: Run to verify it passes**

Run: `pnpm --filter @trading/backend test -- portfolio-risk.service`
Expected: PASS (8 tests total).

- [ ] **Step 5: Commit**

```bash
git add apps/backend/src/opportunities/portfolio-risk.service.ts apps/backend/src/opportunities/portfolio-risk.service.test.ts
git commit -m "feat(opportunities): diagnóstico de cartera (concentración + hedge faltante)"
```

---

## Task 8: Persist diagnostic on market report + endpoint

**Files:**
- Modify: drizzle schema + `apps/backend/src/db/repository.ts` (add `portfolio_diagnostic` text column to `market_reports`)
- Modify: `apps/backend/src/intelligence/market-report.service.ts`
- Modify: market-report/opportunities router

- [ ] **Step 1: Add migration column.** Add to the `market_reports` table definition (drizzle schema) a nullable text column `portfolio_diagnostic`. Generate/apply migration following the repo convention (`pnpm --filter @trading/backend db:generate` then `db:migrate`, matching how migration 0034 was made — separate ALTERs with statement-breakpoint). Store JSON-stringified `PortfolioDiagnostic`.

- [ ] **Step 2: Read/write in market-report.service.ts.** In the row mapper (near line 31) add `portfolioDiagnostic: row.portfolioDiagnostic ? JSON.parse(row.portfolioDiagnostic) : null`. In the persist path (near line 532/569) add `portfolioDiagnostic: JSON.stringify(report.portfolioDiagnostic ?? null)`. Add `portfolioDiagnostic?: PortfolioDiagnostic | null` to the report type.

- [ ] **Step 3: Endpoint.** Add a route returning the latest diagnostic, e.g. `GET /market-report/portfolio-diagnostic`, reading the latest `market_reports` row's parsed `portfolioDiagnostic`.

- [ ] **Step 4: Build + smoke test the endpoint**

Run: `pnpm --filter @trading/backend build` then start the server and `curl localhost:PORT/market-report/portfolio-diagnostic`
Expected: 200 with diagnostic JSON (or `null` until a scan runs).

- [ ] **Step 5: Commit**

```bash
git add -A apps/backend/src apps/backend/drizzle
git commit -m "feat(backend): persistir y exponer diagnóstico de cartera en market report"
```

---

## Task 9: Wire into `runLiveScan` + frontend panel

**Files:**
- Modify: `apps/backend/src/opportunities/opportunities.service.ts`
- Create: `apps/frontend/src/portfolio/PortfolioDiagnosticPanel.tsx`

- [ ] **Step 1: Build the PortfolioContext once per scan.** In `opportunities.service.ts` near where `positions`/`portfolioValue` are computed (lines ~390-399), fetch historical quotes for each holding (reuse `getHistoricalQuotes`), convert to returns with `toReturns`, and call `buildPortfolioContext` with `{symbol, value, returns, sector}`. Cache in a scan-scoped variable.

```ts
import { buildPortfolioContext, buildPortfolioDiagnostic } from './portfolio-risk.service.js';
import { toReturns } from './correlation.js';
// ... after positions/portfolioValue:
const holdingInputs = await Promise.all(positions.map(async (pos) => {
  let returns: number[] = [];
  try {
    const hist = await getHistoricalQuotes(pos.symbol, '3mo', '1d');
    returns = toReturns(hist.map(b => b.close));
  } catch { /* leave empty; correlation falls back to map-only */ }
  return { symbol: pos.symbol, value: pos.quantity * (priceMap.get(pos.symbol) ?? pos.avgCost), returns };
}));
const portfolioCtx = buildPortfolioContext(holdingInputs);
```
(Adjust `getHistoricalQuotes` args/return shape to its real signature — it returns bars with `.close`.)

- [ ] **Step 2: Pass context + candidate returns to the builder.** At the `buildAlgorithmicOpportunity(...)` call (line ~675), thread `portfolioCtx` and the candidate's own returns (the scan already fetches historicals for technicals — reuse that series via `toReturns`). Append the two new args.

- [ ] **Step 3: Compute the diagnostic at scan end.** After all opportunities are built, map them to `{symbol, verdict: o.portfolioAdjustment?.verdict ?? 'neutral'}`, call `buildPortfolioDiagnostic(portfolioCtx, those)`, and pass it into the market-report generation so Task 8's persistence stores it.

- [ ] **Step 4: Frontend panel.** Create `PortfolioDiagnosticPanel.tsx` that fetches the endpoint and renders: factor exposure bars, concentration flags, missing hedges with candidate chips, and two lists (diversifican / apilan). Follow existing panel styling (e.g. `AntiHypeRejectionsPanel`). Mount it near the portfolio/opportunities view.

```tsx
// PortfolioDiagnosticPanel.tsx (sketch — match existing fetch/styling conventions)
import { useEffect, useState } from 'react';
import type { PortfolioDiagnostic } from '@trading/shared';

export function PortfolioDiagnosticPanel() {
  const [d, setD] = useState<PortfolioDiagnostic | null>(null);
  useEffect(() => {
    fetch('/api/market-report/portfolio-diagnostic').then(r => r.json()).then(setD).catch(() => {});
  }, []);
  if (!d || d.factorExposure.length === 0) return null;
  return (
    <section className="portfolio-diagnostic">
      <h3>Diagnóstico de cartera</h3>
      <ul>{d.factorExposure.map(f => (
        <li key={f.factor}>{f.factor}: {Math.round(f.weight * 100)}% ({f.symbols.join(', ')})</li>
      ))}</ul>
      {d.concentrationFlags.map((c, i) => <p key={i} className="flag">⚠️ {c}</p>)}
      {d.missingHedges.map((h, i) => (
        <p key={i} className="hedge">Falta {h.hedge}: {h.reason} {h.candidates.length ? `→ ${h.candidates.join(', ')}` : ''}</p>
      ))}
      <p>Diversifican: {d.diversifiers.join(', ') || '—'}</p>
      <p>Apilan: {d.stackers.join(', ') || '—'}</p>
    </section>
  );
}
```

- [ ] **Step 5: Build frontend + backend**

Run: `pnpm --filter @trading/frontend build && pnpm --filter @trading/backend build`
Expected: PASS.

- [ ] **Step 6: End-to-end verify.** Run a live scan (or the scan trigger the app uses), confirm: opportunities carry `portfolioAdjustment` with the right `verdict`, verdict `trace` includes a `portfolio:` layer with `Δ…×0=0` (dial off), and the diagnostic endpoint returns oil-concentration + a missing gold/rates hedge for the current portfolio.

- [ ] **Step 7: Commit**

```bash
git add -A
git commit -m "feat: integrar diagnóstico de correlación de cartera en scan + panel frontend"
```

---

## Validation checklist (after all tasks)

- [ ] `pnpm --filter @trading/backend test` — all green.
- [ ] Dial off (`PORTFOLIO_CORR_INTENSITY=0`): scores identical to before; only traces/diagnostic added.
- [ ] Dial on (`=0.5`): EOG/BP/COP show negative delta and may drop BUY→WATCH via score; GLD/IEF get a small positive delta.
- [ ] Diagnostic for current portfolio: `oil` ~40%+, flags concentration, lists a missing `gold`/`rates`/`safe-haven` hedge.
- [ ] Empty portfolio: modifier neutral, diagnostic empty — no crash.
