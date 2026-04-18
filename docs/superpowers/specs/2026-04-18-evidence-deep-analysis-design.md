# Evidence Deep Analysis — Design Spec
**Date:** 2026-04-18  
**Branch:** feature/v2-evidence-based-signals

## Problem

The Evidence Signals scan (V2) produces a watchlist of HIGH/MEDIUM conviction candidates but stops there. The user still has to manually: check the chart, read recent news, assess macro context, and decide if the setup is worth entering. This spec describes an automatic post-scan AI analysis layer that does that second step and produces a structured BUY_SETUP / WAIT / PASS verdict per signal.

## Approach

**Post-scan trigger (Option B):** when `runScan()` completes, it calls `triggerDeepAnalysis()` (fire-and-forget) which processes all HIGH/MEDIUM signals in the background. The scan and the analysis have separate state, separate progress counters, and the frontend shows both.

The existing AI infra (`callAI('reasoning', ...)` → Gemini 2.5 Pro with 4-key rotation → Groq fallback) is used directly. No new AI provider wiring needed.

## Architecture

### New files
- `apps/backend/src/evidence-signals/deep-analysis.service.ts` — core logic
- (No new router file — extends existing `evidenceSignalsRouter`)

### DB table: `evidenceDeepAnalysis`
```
symbol        TEXT PRIMARY KEY
analysisDate  TEXT  (YYYY-MM-DD)
verdict       TEXT  ('BUY_SETUP' | 'WAIT' | 'PASS')
reasoning     TEXT  (Spanish narrative, 2-3 sentences)
entryZone     TEXT  (e.g. "$820–835")
target        TEXT  (e.g. "$890")
stopLoss      TEXT  (e.g. "$780")
riskReward    TEXT  (e.g. "2.4:1")
confidence    INT   (0–100)
keyRisks      TEXT  (JSON array of strings, max 3)
timeframe     TEXT  (e.g. "2–4 semanas")
model         TEXT  (which AI model ran this)
fetchedAt     TEXT
expiresAt     TEXT  (same 6h TTL as signal cache)
```

### Data flow

```
runScan() completes
  └─ triggerDeepAnalysis()   [fire-and-forget, non-blocking]
       └─ reads all cached HIGH/MEDIUM signals
       └─ for each (CONCURRENCY=3 to respect quota):
            a. searchTavily(symbol + " stock news recent", 5, 'basic')
            b. getHistoricalQuotes(symbol, '3mo', '1d')  [already cached from scan]
            c. computeTechnicalSummary(ohlc)  [local, no API call]
            d. callAI('reasoning', prompt, systemPrompt)
            e. parse JSON → upsert evidenceDeepAnalysis row
       └─ sets analysisState = 'idle'
```

OHLC is already fetched in `computeEvidenceSignal` — the deep analysis function re-uses it or fetches from Yahoo cache (TTL ensures no double-billing).

### AI prompt structure

**System prompt:**
> Eres un analista de swing trading. Tu trabajo es evaluar si un candidato identificado por señales técnicas (PEAD, insider buying, options flow) tiene un setup válido para entrada, basándote en contexto de precio, técnicos y noticias recientes. Sé directo y honesto: si el setup no es bueno, decí PASS. Respondé SOLO con JSON válido.

**User message includes:**
- Symbol + current price + 52w range
- Evidence signals summary (conviction, beat%, insider buys, options activity)
- Last 30 OHLC candles (compact: `[[date,open,high,low,close,vol], ...]`)
- Technical summary: RSI, SMA20/50, trend direction, distance from key levels
- Recent news headlines + 1-sentence summaries (last 5 articles from Tavily)

**Output JSON schema:**
```json
{
  "verdict": "BUY_SETUP",
  "reasoning": "NVDA confirmó drift post-earnings con +8.2% en 3 días. RSI en 58 con tendencia alcista, cotiza 4% bajo resistencia en $875. Noticias de Blackwell demand positivas sin catalizadores adversos.",
  "entryZone": "$820–835",
  "target": "$890",
  "stopLoss": "$780",
  "riskReward": "2.4:1",
  "confidence": 74,
  "keyRisks": ["Earnings próximos en 6 semanas", "Debilidad sectorial si VIX sube"],
  "timeframe": "2–4 semanas"
}
```

### Technical summary computation (local, no AI call)
From the OHLC array:
- RSI (14)
- SMA20, SMA50
- Trend: `bullish` if price > SMA20 > SMA50, `bearish` if inverse, `mixed` otherwise
- Distance from 52w high/low (%)
- Recent momentum: close[last] vs close[last-5] (%)

This is computed locally in `deep-analysis.service.ts` — no dependency on `technical-analysis.service.ts` (avoids a heavy import chain).

### State management

`getScanStatus()` response gains two new fields:
```ts
analysisState: 'idle' | 'analyzing'
analyzedCount: number
analysisTotal: number
```

Frontend already polls `scanStatus` every 3s — no new polling needed.

### Router additions (evidenceSignalsRouter)

```ts
getDeepAnalysis: publicProcedure
  .input(z.object({ symbol: z.string() }))
  .query(...)  // returns DeepAnalysis | null

getAllDeepAnalyses: publicProcedure
  .query(...)  // returns DeepAnalysis[] sorted by confidence desc
```

### Shared type: `DeepAnalysis`
Added to `packages/shared/src/types/evidence-signals.ts`:
```ts
export type DeepVerdict = 'BUY_SETUP' | 'WAIT' | 'PASS';

export interface DeepAnalysis {
  symbol: string;
  analysisDate: string;
  verdict: DeepVerdict;
  reasoning: string;
  entryZone: string;
  target: string;
  stopLoss: string;
  riskReward: string;
  confidence: number;
  keyRisks: string[];
  timeframe: string;
  model: string;
  fetchedAt: string;
}
```

## Frontend changes

### EvidenceSignals.tsx
- `SignalCard` expanded view: new "Análisis AI" section below the signal pills
- Shows: verdict badge (green/yellow/red) + reasoning + entry/target/stop + key risks
- Loading skeleton while `analysisState === 'analyzing'` for that symbol
- New filter button: `buy` — shows only signals with `verdict === 'BUY_SETUP'`
- Second progress bar in header: "Analizando con AI... X/Y" (only visible while analyzing)

## Error handling
- Tavily failure → analysis runs without news (AI prompt says "sin noticias disponibles")
- AI failure → signal stays without analysis, no crash, logged
- JSON parse failure → retry once, then skip symbol
- Per-symbol errors don't block other symbols

## Quota math
- Typical scan: 15–25 HIGH/MEDIUM signals
- Each analysis: ~4000 tokens input + ~500 tokens output
- Gemini 2.5 Flash free tier: 1500 req/day × 4 keys = 6000 req/day
- At 25 signals/scan × 3 scans/day = 75 calls → well within limits

## What this does NOT do
- Does not place orders or auto-track (auto-tracking already happens in `autoTrackSignal`)
- Does not backtest or validate the AI's accuracy
- Does not guarantee profitable trades — it's a second opinion, not a signal generator
