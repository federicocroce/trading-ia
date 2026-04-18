# Evidence Deep Analysis Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** After each evidence signals scan, automatically run a Gemini-powered deep analysis on all HIGH/MEDIUM conviction signals and return a BUY_SETUP / WAIT / PASS verdict with entry zone, target, stop, and key risks.

**Architecture:** Post-scan trigger (fire-and-forget). `runScan()` calls `triggerDeepAnalysis()` when it finishes. The analysis runs independently with its own state counters, fetches news via Tavily, computes technicals locally, calls `callAI('reasoning')`, and persists results in a new `evidence_deep_analysis` SQLite table. The frontend polls existing `scanStatus` endpoint (extended with analysis fields) and renders analysis inline inside each SignalCard.

**Tech Stack:** TypeScript, Drizzle ORM + SQLite, `callAI` (Gemini 2.5 Pro/Flash with 4-key rotation → Groq fallback), Tavily search, tRPC, React.

---

## File Map

| Action | Path | Responsibility |
|--------|------|----------------|
| Modify | `packages/shared/src/types/evidence-signals.ts` | Add `DeepAnalysis` type + `DeepVerdict` |
| Modify | `packages/shared/src/types/index.ts` | Re-export new types (if not already wildcard) |
| Modify | `apps/backend/src/db/schema.ts` | Add `evidenceDeepAnalysis` table |
| Create | `apps/backend/drizzle/0022_evidence_deep_analysis.sql` | Migration SQL |
| Create | `apps/backend/src/evidence-signals/deep-analysis.service.ts` | Core analysis logic |
| Modify | `apps/backend/src/evidence-signals/evidence-signals.service.ts` | Call `triggerDeepAnalysis`, extend `getScanStatus` |
| Modify | `apps/backend/src/evidence-signals/evidence-signals.router.ts` | Add `getDeepAnalysis`, `getAllDeepAnalyses` procedures |
| Modify | `apps/frontend/src/evidence-signals/EvidenceSignals.tsx` | Analysis UI: verdict, reasoning, progress |

---

## Task 1: Add `DeepAnalysis` shared type

**Files:**
- Modify: `packages/shared/src/types/evidence-signals.ts`

- [ ] **Step 1: Add types to evidence-signals.ts**

Append to the bottom of `packages/shared/src/types/evidence-signals.ts`:

```typescript
export type DeepVerdict = 'BUY_SETUP' | 'WAIT' | 'PASS';

export interface DeepAnalysis {
  symbol: string;
  analysisDate: string;       // YYYY-MM-DD
  verdict: DeepVerdict;
  reasoning: string;          // Spanish narrative, 2-3 sentences
  entryZone: string;          // e.g. "$820–835"
  target: string;             // e.g. "$890"
  stopLoss: string;           // e.g. "$780"
  riskReward: string;         // e.g. "2.4:1"
  confidence: number;         // 0–100
  keyRisks: string[];         // max 3 items
  timeframe: string;          // e.g. "2–4 semanas"
  model: string;              // which AI ran this
  fetchedAt: string;          // ISO datetime
}
```

- [ ] **Step 2: Build shared package**

```bash
cd /Users/federicocroce/Documents/Fede/trading
npm run build --workspace=packages/shared
```

Expected: no errors.

- [ ] **Step 3: Commit**

```bash
git add packages/shared/src/types/evidence-signals.ts
git commit -m "feat(shared): add DeepAnalysis type and DeepVerdict"
```

---

## Task 2: Add DB table and migration

**Files:**
- Modify: `apps/backend/src/db/schema.ts`
- Create: `apps/backend/drizzle/0022_evidence_deep_analysis.sql`

- [ ] **Step 1: Add table to schema.ts**

Append after the `evidenceSignalsCache` table (after line 511) in `apps/backend/src/db/schema.ts`:

```typescript
// --- Evidence deep analysis (AI verdict per signal — 6h TTL) ---
export const evidenceDeepAnalysis = sqliteTable('evidence_deep_analysis', {
  symbol: text('symbol').primaryKey(),
  analysisDate: text('analysis_date').notNull(),
  verdict: text('verdict', { enum: ['BUY_SETUP', 'WAIT', 'PASS'] }).notNull(),
  reasoning: text('reasoning').notNull(),
  entryZone: text('entry_zone').notNull(),
  target: text('target').notNull(),
  stopLoss: text('stop_loss').notNull(),
  riskReward: text('risk_reward').notNull(),
  confidence: integer('confidence').notNull(),
  keyRisks: text('key_risks').notNull(),  // JSON array
  timeframe: text('timeframe').notNull(),
  model: text('model').notNull(),
  fetchedAt: text('fetched_at').notNull(),
  expiresAt: text('expires_at').notNull(),
});
```

- [ ] **Step 2: Create migration SQL manually**

Create `apps/backend/drizzle/0022_evidence_deep_analysis.sql`:

```sql
CREATE TABLE `evidence_deep_analysis` (
	`symbol` text PRIMARY KEY NOT NULL,
	`analysis_date` text NOT NULL,
	`verdict` text NOT NULL,
	`reasoning` text NOT NULL,
	`entry_zone` text NOT NULL,
	`target` text NOT NULL,
	`stop_loss` text NOT NULL,
	`risk_reward` text NOT NULL,
	`confidence` integer NOT NULL,
	`key_risks` text NOT NULL,
	`timeframe` text NOT NULL,
	`model` text NOT NULL,
	`fetched_at` text NOT NULL,
	`expires_at` text NOT NULL
);
--> statement-breakpoint
```

- [ ] **Step 3: Verify backend compiles**

```bash
cd /Users/federicocroce/Documents/Fede/trading
npm run build --workspace=apps/backend
```

Expected: no TypeScript errors.

- [ ] **Step 4: Commit**

```bash
git add apps/backend/src/db/schema.ts apps/backend/drizzle/0022_evidence_deep_analysis.sql
git commit -m "feat(db): add evidence_deep_analysis table"
```

---

## Task 3: Create `deep-analysis.service.ts`

**Files:**
- Create: `apps/backend/src/evidence-signals/deep-analysis.service.ts`

This service owns: technical indicator computation, news fetch, AI call, DB persistence, and state.

- [ ] **Step 1: Create the file**

Create `apps/backend/src/evidence-signals/deep-analysis.service.ts`:

```typescript
import { db, schema } from '../db/index.js';
import { eq } from 'drizzle-orm';
import { callAIWithModel } from '../shared/ai-router.js';
import { searchTavily } from '../web-search/tavily.js';
import { getHistoricalQuotes } from '../shared/yahoo.js';
import type { EvidenceSignal, DeepAnalysis } from '@trading/shared';

const ANALYSIS_TTL_MS = 6 * 60 * 60 * 1000; // 6h — matches signal cache TTL
const CONCURRENCY = 3; // conservative to avoid quota hammering

// ─── State (module-level, like scanState) ─────────────────────────────────────

let analysisState: 'idle' | 'analyzing' = 'idle';
let analyzedCount = 0;
let analysisTotal = 0;

export function getAnalysisStatus() {
  return { analysisState, analyzedCount, analysisTotal };
}

// ─── DB helpers ───────────────────────────────────────────────────────────────

function getCachedAnalysis(symbol: string): DeepAnalysis | null {
  const row = db.select()
    .from(schema.evidenceDeepAnalysis)
    .where(eq(schema.evidenceDeepAnalysis.symbol, symbol))
    .get();

  if (!row) return null;
  if (new Date(row.expiresAt) < new Date()) return null;

  return {
    symbol: row.symbol,
    analysisDate: row.analysisDate,
    verdict: row.verdict as DeepAnalysis['verdict'],
    reasoning: row.reasoning,
    entryZone: row.entryZone,
    target: row.target,
    stopLoss: row.stopLoss,
    riskReward: row.riskReward,
    confidence: row.confidence,
    keyRisks: JSON.parse(row.keyRisks) as string[],
    timeframe: row.timeframe,
    model: row.model,
    fetchedAt: row.fetchedAt,
  };
}

function setCachedAnalysis(analysis: DeepAnalysis): void {
  const now = new Date();
  const expires = new Date(now.getTime() + ANALYSIS_TTL_MS);
  db.insert(schema.evidenceDeepAnalysis)
    .values({
      symbol: analysis.symbol,
      analysisDate: analysis.analysisDate,
      verdict: analysis.verdict,
      reasoning: analysis.reasoning,
      entryZone: analysis.entryZone,
      target: analysis.target,
      stopLoss: analysis.stopLoss,
      riskReward: analysis.riskReward,
      confidence: analysis.confidence,
      keyRisks: JSON.stringify(analysis.keyRisks),
      timeframe: analysis.timeframe,
      model: analysis.model,
      fetchedAt: analysis.fetchedAt,
      expiresAt: expires.toISOString(),
    })
    .onConflictDoUpdate({
      target: schema.evidenceDeepAnalysis.symbol,
      set: {
        analysisDate: analysis.analysisDate,
        verdict: analysis.verdict,
        reasoning: analysis.reasoning,
        entryZone: analysis.entryZone,
        target: analysis.target,
        stopLoss: analysis.stopLoss,
        riskReward: analysis.riskReward,
        confidence: analysis.confidence,
        keyRisks: JSON.stringify(analysis.keyRisks),
        timeframe: analysis.timeframe,
        model: analysis.model,
        fetchedAt: analysis.fetchedAt,
        expiresAt: expires.toISOString(),
      },
    })
    .run();
}

export function getAllCachedAnalyses(): DeepAnalysis[] {
  const rows = db.select().from(schema.evidenceDeepAnalysis).all();
  return rows
    .filter((r) => new Date(r.expiresAt) > new Date())
    .map((r) => ({
      symbol: r.symbol,
      analysisDate: r.analysisDate,
      verdict: r.verdict as DeepAnalysis['verdict'],
      reasoning: r.reasoning,
      entryZone: r.entryZone,
      target: r.target,
      stopLoss: r.stopLoss,
      riskReward: r.riskReward,
      confidence: r.confidence,
      keyRisks: JSON.parse(r.keyRisks) as string[],
      timeframe: r.timeframe,
      model: r.model,
      fetchedAt: r.fetchedAt,
    }))
    .sort((a, b) => b.confidence - a.confidence);
}

// ─── Local technical indicator computation ────────────────────────────────────

interface TechSummary {
  rsi14: number | null;
  sma20: number | null;
  sma50: number | null;
  trend: 'bullish' | 'bearish' | 'mixed';
  momentum5d: number | null;  // % change last 5 sessions
  last20Candles: string;       // compact JSON for prompt
}

function computeTechSummary(ohlc: Array<{ date: string; open: number; high: number; low: number; close: number; volume: number }>): TechSummary {
  if (ohlc.length < 15) {
    return { rsi14: null, sma20: null, sma50: null, trend: 'mixed', momentum5d: null, last20Candles: '[]' };
  }

  const closes = ohlc.map((c) => c.close);
  const n = closes.length;

  // SMA
  const sma = (period: number): number | null => {
    if (n < period) return null;
    return closes.slice(n - period).reduce((a, b) => a + b, 0) / period;
  };
  const sma20 = sma(20);
  const sma50 = sma(50);

  // RSI 14
  let rsi14: number | null = null;
  if (n >= 15) {
    const changes = closes.slice(n - 15).map((c, i, arr) => i === 0 ? 0 : c - arr[i - 1]);
    const gains = changes.map((c) => Math.max(c, 0));
    const losses = changes.map((c) => Math.max(-c, 0));
    const avgGain = gains.slice(1).reduce((a, b) => a + b, 0) / 14;
    const avgLoss = losses.slice(1).reduce((a, b) => a + b, 0) / 14;
    rsi14 = avgLoss === 0 ? 100 : Math.round(100 - 100 / (1 + avgGain / avgLoss));
  }

  // Trend
  const current = closes[n - 1];
  const trend: TechSummary['trend'] =
    sma20 && sma50 && current > sma20 && sma20 > sma50 ? 'bullish'
    : sma20 && sma50 && current < sma20 && sma20 < sma50 ? 'bearish'
    : 'mixed';

  // Momentum 5d
  const momentum5d = n >= 6
    ? Math.round(((closes[n - 1] - closes[n - 6]) / closes[n - 6]) * 10000) / 100
    : null;

  // Last 20 candles compact
  const last20 = ohlc.slice(-20).map((c) => [c.date, c.open, c.high, c.low, c.close, c.volume]);
  const last20Candles = JSON.stringify(last20);

  return { rsi14, sma20: sma20 ? Math.round(sma20 * 100) / 100 : null, sma50: sma50 ? Math.round(sma50 * 100) / 100 : null, trend, momentum5d, last20Candles };
}

// ─── AI prompt builder ────────────────────────────────────────────────────────

function buildPrompt(
  signal: EvidenceSignal,
  tech: TechSummary,
  newsHeadlines: string,
): string {
  const fmt = new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 2 });
  const price = signal.currentPrice ? fmt.format(signal.currentPrice) : 'N/A';

  const signals: string[] = [];
  if (signal.pead.active) {
    signals.push(`PEAD: beat EPS ${signal.pead.beatPercent.toFixed(1)}% hace ${signal.pead.daysSinceEarnings}d, precio confirmó +${signal.pead.priceChangePct?.toFixed(1) ?? '?'}% post-earnings, ${signal.pead.daysInDriftWindow}d de ventana restantes`);
  }
  if (signal.insider.active) {
    const fmtCompact = new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', notation: 'compact', maximumFractionDigits: 1 });
    signals.push(`INSIDER: ${signal.insider.numberOfBuyers} insider(s) compraron ${fmtCompact.format(signal.insider.totalValue)}, última compra ${signal.insider.mostRecentBuyDate}`);
  }
  if (signal.optionsFlow.active) {
    signals.push(`OPTIONS FLOW: ${signal.optionsFlow.unusualStrikes} strikes OTM con actividad inusual, ratio C/P ${signal.optionsFlow.callPutRatio}x`);
  }

  return `Símbolo: ${signal.symbol}
Precio actual: ${price}
Convicción de señales: ${signal.conviction.toUpperCase()} (score: ${signal.compositeScore})

SEÑALES ACTIVAS:
${signals.join('\n')}

TÉCNICOS:
- RSI(14): ${tech.rsi14 ?? 'N/A'}
- SMA20: ${tech.sma20 ?? 'N/A'} | SMA50: ${tech.sma50 ?? 'N/A'}
- Tendencia: ${tech.trend}
- Momentum 5d: ${tech.momentum5d != null ? `${tech.momentum5d > 0 ? '+' : ''}${tech.momentum5d}%` : 'N/A'}

ÚLTIMAS 20 VELAS (OHLCV):
${tech.last20Candles}

NOTICIAS RECIENTES:
${newsHeadlines}

Analizá este candidato como swing trader con horizonte 2-4 semanas.
Devolvé SOLO el JSON, sin texto adicional.`;
}

const SYSTEM_PROMPT = `Eres un analista de swing trading. Tu trabajo es evaluar si un candidato identificado por señales técnicas (PEAD, insider buying, options flow) tiene un setup válido para entrada, basándote en contexto de precio, técnicos y noticias recientes.

Sé directo y honesto: si el setup no es bueno o hay riesgo elevado, devolvé PASS o WAIT. No infles la confianza.

Devolvé SOLO JSON válido con exactamente estos campos:
{
  "verdict": "BUY_SETUP" | "WAIT" | "PASS",
  "reasoning": "string en español, 2-3 oraciones, mencioná las señales concretas",
  "entryZone": "string como '$820-835' o 'N/A'",
  "target": "string como '$890' o 'N/A'",
  "stopLoss": "string como '$780' o 'N/A'",
  "riskReward": "string como '2.4:1' o 'N/A'",
  "confidence": número entre 0 y 100,
  "keyRisks": ["riesgo 1", "riesgo 2"],
  "timeframe": "string como '2-4 semanas'"
}`;

// ─── Parse + validate AI response ─────────────────────────────────────────────

interface RawAIOutput {
  verdict?: unknown;
  reasoning?: unknown;
  entryZone?: unknown;
  target?: unknown;
  stopLoss?: unknown;
  riskReward?: unknown;
  confidence?: unknown;
  keyRisks?: unknown;
  timeframe?: unknown;
}

function parseAIResponse(raw: string, symbol: string, model: string): DeepAnalysis | null {
  try {
    const parsed = JSON.parse(raw) as RawAIOutput;
    const verdict = parsed.verdict as string;
    if (!['BUY_SETUP', 'WAIT', 'PASS'].includes(verdict)) return null;

    return {
      symbol,
      analysisDate: new Date().toISOString().split('T')[0],
      verdict: verdict as DeepAnalysis['verdict'],
      reasoning: String(parsed.reasoning ?? ''),
      entryZone: String(parsed.entryZone ?? 'N/A'),
      target: String(parsed.target ?? 'N/A'),
      stopLoss: String(parsed.stopLoss ?? 'N/A'),
      riskReward: String(parsed.riskReward ?? 'N/A'),
      confidence: Math.min(100, Math.max(0, Number(parsed.confidence ?? 50))),
      keyRisks: Array.isArray(parsed.keyRisks) ? (parsed.keyRisks as unknown[]).map(String).slice(0, 3) : [],
      timeframe: String(parsed.timeframe ?? '2-4 semanas'),
      model,
      fetchedAt: new Date().toISOString(),
    };
  } catch {
    return null;
  }
}

// ─── Per-symbol analysis ──────────────────────────────────────────────────────

async function analyzeSignal(signal: EvidenceSignal): Promise<void> {
  const cached = getCachedAnalysis(signal.symbol);
  if (cached) return;

  // Fetch news and OHLC in parallel
  const [newsResult, ohlcResult] = await Promise.allSettled([
    searchTavily(`${signal.symbol} stock news`, 5, 'basic'),
    getHistoricalQuotes(signal.symbol, '3mo', '1d'),
  ]);

  const newsHeadlines = newsResult.status === 'fulfilled' && newsResult.value.length > 0
    ? newsResult.value
        .slice(0, 5)
        .map((a, i) => `${i + 1}. ${a.title}${a.publishedAt ? ` (${a.publishedAt.slice(0, 10)})` : ''}`)
        .join('\n')
    : 'Sin noticias disponibles.';

  const ohlc = ohlcResult.status === 'fulfilled' ? ohlcResult.value : [];
  const tech = computeTechSummary(ohlc);
  const prompt = buildPrompt(signal, tech, newsHeadlines);

  const { content, model } = await callAIWithModel('reasoning', prompt, SYSTEM_PROMPT, 1024);

  const analysis = parseAIResponse(content, signal.symbol, model);
  if (!analysis) {
    console.warn(`[DeepAnalysis] Invalid JSON from AI for ${signal.symbol}, skipping`);
    return;
  }

  setCachedAnalysis(analysis);
  console.log(`[DeepAnalysis] ✓ ${signal.symbol} — ${analysis.verdict} (confidence: ${analysis.confidence}, model: ${model})`);
}

// ─── Main trigger ─────────────────────────────────────────────────────────────

async function runDeepAnalysis(signals: EvidenceSignal[]): Promise<void> {
  if (analysisState === 'analyzing') return;

  const candidates = signals.filter(
    (s) => s.conviction === 'high' || s.conviction === 'medium',
  );

  if (!candidates.length) return;

  analysisState = 'analyzing';
  analysisTotal = candidates.length;
  analyzedCount = 0;

  console.log(`[DeepAnalysis] Iniciando análisis de ${candidates.length} señales HIGH/MEDIUM...`);

  try {
    for (let i = 0; i < candidates.length; i += CONCURRENCY) {
      const batch = candidates.slice(i, i + CONCURRENCY);
      await Promise.allSettled(
        batch.map(async (signal) => {
          try {
            await analyzeSignal(signal);
          } catch (err) {
            console.warn(`[DeepAnalysis] Error en ${signal.symbol}:`, (err as Error).message?.slice(0, 100));
          } finally {
            analyzedCount++;
          }
        }),
      );
    }
    console.log(`[DeepAnalysis] Completo — ${analyzedCount}/${analysisTotal} procesados`);
  } finally {
    analysisState = 'idle';
  }
}

export function triggerDeepAnalysis(signals: EvidenceSignal[]): void {
  runDeepAnalysis(signals).catch((err) =>
    console.error('[DeepAnalysis] Error fatal:', err),
  );
}

export function invalidateDeepAnalysisCache(): void {
  db.delete(schema.evidenceDeepAnalysis).run();
}
```

- [ ] **Step 2: Build backend**

```bash
cd /Users/federicocroce/Documents/Fede/trading
npm run build --workspace=apps/backend
```

Expected: no TypeScript errors.

- [ ] **Step 3: Commit**

```bash
git add apps/backend/src/evidence-signals/deep-analysis.service.ts
git commit -m "feat(evidence-signals): add deep-analysis service with AI verdict"
```

---

## Task 4: Wire `triggerDeepAnalysis` into the scan + extend `getScanStatus`

**Files:**
- Modify: `apps/backend/src/evidence-signals/evidence-signals.service.ts`

- [ ] **Step 1: Add import at the top of evidence-signals.service.ts**

Add to the imports block (after existing imports):

```typescript
import { triggerDeepAnalysis, getAnalysisStatus, invalidateDeepAnalysisCache } from './deep-analysis.service.js';
```

- [ ] **Step 2: Update `getScanStatus` to include analysis state**

Replace the existing `getScanStatus` function:

```typescript
export function getScanStatus() {
  const analysis = getAnalysisStatus();
  return {
    state: scanState,
    lastScanAt,
    scannedCount,
    totalCount,
    analysisState: analysis.analysisState,
    analyzedCount: analysis.analyzedCount,
    analysisTotal: analysis.analysisTotal,
  };
}
```

- [ ] **Step 3: Call `triggerDeepAnalysis` at end of `runScan`**

In `runScan`, replace the final log line and `finally` block:

```typescript
    lastScanAt = new Date().toISOString();
    const cached = readAllFromCache();
    const withSignals = cached.signals.filter(s => s.activeSignals > 0);
    console.log(`[EvidenceSignals] Scan completo — ${withSignals.length}/${cached.totalSymbols} con señales activas`);

    // Fire deep analysis for HIGH/MEDIUM conviction signals
    triggerDeepAnalysis(withSignals);
  } finally {
    scanState = 'idle';
  }
```

- [ ] **Step 4: Invalidate deep analysis cache on force refresh**

In `runScan`, in the `if (forceRefresh)` block, add:

```typescript
    if (forceRefresh) {
      db.delete(schema.evidenceSignalsCache).run();
      invalidateScreenerCache();
      invalidateDeepAnalysisCache();
    }
```

- [ ] **Step 5: Build**

```bash
cd /Users/federicocroce/Documents/Fede/trading
npm run build --workspace=apps/backend
```

Expected: no TypeScript errors.

- [ ] **Step 6: Commit**

```bash
git add apps/backend/src/evidence-signals/evidence-signals.service.ts
git commit -m "feat(evidence-signals): trigger deep analysis after scan completes"
```

---

## Task 5: Add router procedures for deep analysis

**Files:**
- Modify: `apps/backend/src/evidence-signals/evidence-signals.router.ts`

- [ ] **Step 1: Add imports**

Add to the import block at the top of `evidence-signals.router.ts`:

```typescript
import {
  getCachedScanResult,
  triggerScan,
  getScanStatus,
  getEvidenceSignalForSymbol,
} from './evidence-signals.service.js';
import { getSignalTrackingHistory } from '../db/repository.js';
import { getAllCachedAnalyses, getCachedAnalysis } from './deep-analysis.service.js';
```

Note: replace the existing imports with this block (adds `getCachedAnalysis` and `getAllCachedAnalyses`).

- [ ] **Step 2: Add two new procedures to the router**

Append inside `evidenceSignalsRouter` (before the closing `}`):

```typescript
  getDeepAnalysis: publicProcedure
    .input(z.object({ symbol: z.string() }))
    .query(({ input }) => getCachedAnalysis(input.symbol)),

  getAllDeepAnalyses: publicProcedure
    .query(() => getAllCachedAnalyses()),
```

Note: `getCachedAnalysis` is not exported yet — export it from `deep-analysis.service.ts` by adding `export` in front of the function declaration (it's currently an unexported helper). Change:

```typescript
function getCachedAnalysis(symbol: string): DeepAnalysis | null {
```
to:
```typescript
export function getCachedAnalysis(symbol: string): DeepAnalysis | null {
```

- [ ] **Step 3: Build**

```bash
cd /Users/federicocroce/Documents/Fede/trading
npm run build --workspace=apps/backend
```

Expected: no TypeScript errors.

- [ ] **Step 4: Commit**

```bash
git add apps/backend/src/evidence-signals/evidence-signals.router.ts \
        apps/backend/src/evidence-signals/deep-analysis.service.ts
git commit -m "feat(evidence-signals): expose deep analysis via tRPC router"
```

---

## Task 6: Frontend — Analysis UI in SignalCard

**Files:**
- Modify: `apps/frontend/src/evidence-signals/EvidenceSignals.tsx`

- [ ] **Step 1: Add trpc query hooks and new filter**

In `EvidenceSignals.tsx`, add `'buy'` to the `Filter` type and the `filters` array. Replace:

```typescript
type Filter = 'all' | 'high' | 'medium' | 'pead' | 'insider' | 'options';
```

with:

```typescript
type Filter = 'all' | 'high' | 'medium' | 'pead' | 'insider' | 'options' | 'buy';
```

Add to the `filters` array (append after the `options` entry):

```typescript
{ id: 'buy', label: '🟢 BUY Setup' },
```

- [ ] **Step 2: Fetch all deep analyses in `EvidenceSignals` component**

Inside the `EvidenceSignals` component function, add after the existing queries:

```typescript
const { data: analyses } = trpc.evidenceSignals.getAllDeepAnalyses.useQuery(undefined, {
  staleTime: 30_000,
  refetchInterval: 15_000,
});

const analysisMap = new Map(
  (analyses ?? []).map((a) => [a.symbol, a])
);
```

- [ ] **Step 3: Add `'buy'` to the filter logic**

In the `filtered` computation, add the buy case:

```typescript
const filtered = (data?.signals ?? []).filter((s) => {
  if (filter === 'high') return s.conviction === 'high';
  if (filter === 'medium') return s.conviction === 'medium' || s.conviction === 'high';
  if (filter === 'pead') return s.pead.active;
  if (filter === 'insider') return s.insider.active;
  if (filter === 'options') return s.optionsFlow.active;
  if (filter === 'buy') return analysisMap.get(s.symbol)?.verdict === 'BUY_SETUP';
  return s.activeSignals > 0;
});
```

- [ ] **Step 4: Pass analysis to `SignalCard`**

Replace the `SignalCard` render call to pass the analysis:

```typescript
{filtered.map((signal) => (
  <SignalCard
    key={signal.symbol}
    signal={signal}
    analysis={analysisMap.get(signal.symbol) ?? null}
    isAnalyzing={status?.analysisState === 'analyzing'}
  />
))}
```

- [ ] **Step 5: Update `SignalCard` component signature and add analysis UI**

Replace the `SignalCard` function signature and add the analysis section:

```typescript
import type { EvidenceSignal, EvidenceConviction, DeepAnalysis } from '@trading/shared';

function VerdictBadge({ verdict }: { verdict: DeepAnalysis['verdict'] }) {
  const styles = {
    BUY_SETUP: 'bg-green-500/20 text-green-400 border-green-500/30',
    WAIT:      'bg-yellow-500/20 text-yellow-400 border-yellow-500/30',
    PASS:      'bg-red-500/20 text-red-400 border-red-500/30',
  };
  const labels = { BUY_SETUP: '🟢 BUY SETUP', WAIT: '🟡 ESPERAR', PASS: '🔴 PASAR' };
  return (
    <span className={`text-[10px] font-bold px-2 py-0.5 rounded border ${styles[verdict]}`}>
      {labels[verdict]}
    </span>
  );
}

function SignalCard({
  signal,
  analysis,
  isAnalyzing,
}: {
  signal: EvidenceSignal;
  analysis: DeepAnalysis | null;
  isAnalyzing: boolean;
}) {
```

Inside the expanded section (after the `optionsFlow` details block, before the closing `</div>`), add:

```typescript
            {/* Deep AI Analysis */}
            <div className="mt-3 border-t border-border pt-3 space-y-2">
              <div className="text-xs font-semibold text-primary">Análisis AI</div>
              {analysis ? (
                <div className="space-y-2">
                  <div className="flex items-center gap-2">
                    <VerdictBadge verdict={analysis.verdict} />
                    <span className="text-[10px] text-muted-foreground">
                      confianza {analysis.confidence}% · {analysis.timeframe}
                    </span>
                  </div>
                  <p className="text-xs text-muted-foreground leading-relaxed">{analysis.reasoning}</p>
                  {analysis.verdict === 'BUY_SETUP' && analysis.entryZone !== 'N/A' && (
                    <div className="grid grid-cols-3 gap-2 text-[10px]">
                      <div className="bg-green-500/10 rounded p-1.5 text-center">
                        <div className="text-muted-foreground">Entrada</div>
                        <div className="font-medium text-green-400">{analysis.entryZone}</div>
                      </div>
                      <div className="bg-primary/10 rounded p-1.5 text-center">
                        <div className="text-muted-foreground">Target</div>
                        <div className="font-medium text-primary">{analysis.target}</div>
                      </div>
                      <div className="bg-red-500/10 rounded p-1.5 text-center">
                        <div className="text-muted-foreground">Stop</div>
                        <div className="font-medium text-red-400">{analysis.stopLoss}</div>
                      </div>
                    </div>
                  )}
                  {analysis.keyRisks.length > 0 && (
                    <div className="space-y-0.5">
                      <div className="text-[10px] text-muted-foreground font-medium">Riesgos:</div>
                      {analysis.keyRisks.map((r, i) => (
                        <div key={i} className="text-[10px] text-muted-foreground pl-2 border-l border-border">
                          {r}
                        </div>
                      ))}
                    </div>
                  )}
                  <div className="text-[10px] text-muted-foreground">
                    R/R: {analysis.riskReward} · {analysis.model}
                  </div>
                </div>
              ) : isAnalyzing ? (
                <div className="text-[10px] text-muted-foreground animate-pulse">
                  Analizando con AI...
                </div>
              ) : (
                <div className="text-[10px] text-muted-foreground">
                  Sin análisis — ejecutá un nuevo scan
                </div>
              )}
            </div>
```

- [ ] **Step 6: Add analysis progress bar to the header**

In the scan progress bar section, after the existing scan progress bar block, add:

```typescript
      {/* Analysis progress bar */}
      {status?.analysisState === 'analyzing' && (
        <div className="space-y-1">
          <div className="flex justify-between text-xs text-muted-foreground">
            <span>Analizando señales con AI...</span>
            <span>{status.analyzedCount}/{status.analysisTotal}</span>
          </div>
          <div className="h-1.5 bg-muted rounded-full overflow-hidden">
            <div
              className="h-full bg-green-500 transition-all duration-500 rounded-full"
              style={{
                width: status.analysisTotal > 0
                  ? `${(status.analyzedCount / status.analysisTotal) * 100}%`
                  : '0%'
              }}
            />
          </div>
        </div>
      )}
```

- [ ] **Step 7: Full build check**

```bash
cd /Users/federicocroce/Documents/Fede/trading
npm run build
```

Expected: all packages build, no TypeScript errors, Vite builds frontend.

- [ ] **Step 8: Commit**

```bash
git add apps/frontend/src/evidence-signals/EvidenceSignals.tsx
git commit -m "feat(frontend): show deep analysis verdict and progress in EvidenceSignals"
```

---

## Self-Review

**Spec coverage check:**
- ✅ Post-scan trigger (B approach): `triggerDeepAnalysis` called at end of `runScan`
- ✅ Gemini 2.5 Pro with 4-key rotation: via `callAI('reasoning')` in `ai-router.ts`
- ✅ Groq fallback: `ai-router.ts` handles this automatically
- ✅ Tavily news: `searchTavily` per symbol in `analyzeSignal`
- ✅ Technical indicators (local): RSI, SMA20/50, trend, momentum in `computeTechSummary`
- ✅ Verdict: BUY_SETUP / WAIT / PASS
- ✅ Entry zone, target, stop loss, R/R, confidence, key risks, timeframe
- ✅ DB persistence with 6h TTL matching signal cache
- ✅ Analysis state: `analysisState`, `analyzedCount`, `analysisTotal` in `getScanStatus`
- ✅ Frontend progress bar (green, separate from scan bar)
- ✅ BUY Setup filter
- ✅ VerdictBadge component
- ✅ Entry/Target/Stop grid in expanded card
- ✅ Key risks display
- ✅ `model` shown in card
- ✅ Cache invalidation on force refresh

**Type consistency:**
- `DeepAnalysis` defined in Task 1, used in Tasks 3, 5, 6 ✅
- `getCachedAnalysis` exported in Task 3, imported in Task 5 ✅
- `getAnalysisStatus` exported in Task 3, imported in Task 4 ✅
- `triggerDeepAnalysis` exported in Task 3, imported in Task 4 ✅
- `getAllCachedAnalyses` exported in Task 3, imported in Task 5 ✅
- `invalidateDeepAnalysisCache` exported in Task 3, imported in Task 4 ✅
- `schema.evidenceDeepAnalysis` added in Task 2, used in Task 3 ✅
- `status.analysisState`, `status.analyzedCount`, `status.analysisTotal` added in Task 4, used in Task 6 ✅
