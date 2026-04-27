# News-Driven Pipeline — Design Spec
**Date:** 2026-04-27  
**Status:** Approved

## Problem

The current pipeline is symbol-driven, not news-driven. It starts from a hardcoded list of ~40 symbols in the `symbols` table, fetches news *about* those symbols, and analyzes them in isolation. This means:

- A stock surging 9% (e.g. AMD) may be missed if it's not in the watchlist with a position
- News is used as *context* for pre-selected symbols, not as the *source* for which symbols to analyze
- Per-symbol LLM analysis is isolated — it doesn't know why AMD is in the list or how macro events connect to it

## Goal

Make the pipeline truly news-driven:
1. News arrives → LLM extracts key macro events and reasons causal chains
2. Causal chains determine which symbols to analyze (any ticker, known or unknown)
3. Each symbol carries its causal context into the per-symbol analysis
4. Portfolio positions always appear regardless of news

---

## Architecture

### New Pipeline Stage: `macroIntelligence`

Inserted between `news` and `analysis`:

```
webSearch → news → macroIntelligence → analysis → report
```

#### Paso 1 — Event Extraction (LLM call)
Input: all today's headlines (web_search_articles + news_articles)  
Output: 5–8 key macro events, each with:
- `id`, `event` (description), `category` (e.g. "Política Monetaria", "Semiconductores/IA", "Energía"), `magnitude` ("high" | "medium" | "low")

#### Paso 2 — Causal Chain Reasoning (LLM call)
Input: the extracted events  
Output: for each event, a list of causal chains with related events linked

Each chain entry:
- `ticker` — any valid ticker (known or new)
- `category` — sector (e.g. "Banca US", "Energía", "Cripto")
- `direction` — "positive" | "negative"
- `impact` — "direct" | "indirect"
- `reason` — one sentence explaining the causal link

Events that share a macro theme or reinforce each other are linked via `relatedEventIds`.

#### Example Output

```json
{
  "date": "2026-04-27",
  "events": [
    {
      "id": "evt_1",
      "event": "AMD earnings beat 40% por demanda AI en data centers",
      "category": "Semiconductores/IA",
      "magnitude": "high",
      "chains": [
        { "ticker": "AMD",  "category": "Semiconductores/IA", "direction": "positive", "impact": "direct",   "reason": "earnings beat directo" },
        { "ticker": "NVDA", "category": "Semiconductores/IA", "direction": "positive", "impact": "indirect", "reason": "valida demanda AI del sector" },
        { "ticker": "INTC", "category": "Semiconductores/IA", "direction": "negative", "impact": "indirect", "reason": "AMD gana market share" },
        { "ticker": "TSM",  "category": "Semiconductores/IA", "direction": "positive", "impact": "indirect", "reason": "mayor volumen de producción para AMD" }
      ],
      "relatedEventIds": ["evt_2"]
    },
    {
      "id": "evt_2",
      "event": "Fed mantiene tasas, señala 2 recortes en 2026",
      "category": "Política Monetaria",
      "magnitude": "high",
      "chains": [
        { "ticker": "JPM", "category": "Banca US",       "direction": "positive", "impact": "direct",   "reason": "spread de tasas mejora márgenes" },
        { "ticker": "IYR", "category": "Real Estate",    "direction": "negative", "impact": "direct",   "reason": "tasas altas presionan REITs" },
        { "ticker": "GLD", "category": "Commodities",    "direction": "positive", "impact": "indirect", "reason": "dólar más débil con expectativa de recortes" }
      ],
      "relatedEventIds": ["evt_1"]
    }
  ]
}
```

---

## Data Model

### New Tables

**`macro_events`**
```
id          INTEGER PK
date        TEXT NOT NULL
event_id    TEXT NOT NULL        -- e.g. "evt_1"
event       TEXT NOT NULL
category    TEXT NOT NULL
magnitude   TEXT NOT NULL        -- 'high' | 'medium' | 'low'
created_at  TEXT
```

**`causal_chains`**
```
id          INTEGER PK
date        TEXT NOT NULL
event_id    TEXT NOT NULL        -- FK to macro_events.event_id
ticker      TEXT NOT NULL
category    TEXT NOT NULL
direction   TEXT NOT NULL        -- 'positive' | 'negative'
impact      TEXT NOT NULL        -- 'direct' | 'indirect'
reason      TEXT NOT NULL
created_at  TEXT
```

**`event_relations`**
```
id              INTEGER PK
date            TEXT NOT NULL
event_id        TEXT NOT NULL
related_event_id TEXT NOT NULL
```

All tables have `date` for historical queries.

---

## Integration with Analysis Stage

### Symbol Selection
Replaces `getActiveSymbolList()` as the source for what to analyze:

```
symbols to analyze = open portfolio positions (always)
                   + all tickers from today's CausalMap
```

If a ticker from the CausalMap has never been seen before (e.g. SMCI), the pipeline attempts to fetch its price + fundamentals + technicals. If Yahoo Finance has no data → skip with warning logged.

### Causal Context Injection
When building the compact card for each symbol, the LLM receives its causal context:

```
AMD $162.40 | algoAction=BUY score=78/100
RSI_d: 61 | MACD: cruce alcista | vs SMA200: +12%
P/E: 28 | Forward P/E: 22 | Revenue growth: +31%

CONTEXTO CAUSAL HOY:
- [DIRECTO] Earnings beat 40% → validación demanda AI (magnitud: alta)
- [INDIRECTO vía evt_1+evt_2] Fed + recortes esperados benefician sector tech
```

The per-symbol LLM no longer analyzes in isolation — it knows *why* the symbol is in the list and what macro forces are driving it.

---

## Pipeline Button Behavior

| Button | Location | Behavior |
|--------|----------|----------|
| **Noticias** | Header | Runs full pipeline from scratch. Ignores all today's DB cache. Force-refreshes every stage. |
| **Analizar** | MarketReportView | Uses DB cache. Skips stages already completed today (news, macroIntelligence, analysis). Only re-runs what's missing or failed. |

This replaces the current implicit `force` flag with explicit user intent.

---

## Watchlist

The `symbols` table watchlist entries remain for **price tracking only** (displaying current values in the UI). They do NOT influence which symbols get analyzed. If a watchlist symbol appears in the CausalMap, it gets analyzed — but because of the news, not because of the watchlist.

---

## Error Handling

- If Paso 1 (event extraction) fails → macroIntelligence stage marked `failed` → analysis falls back to portfolio-only symbols
- If Paso 2 (causal chains) fails for a specific event → that event is skipped, others proceed
- If an unknown ticker has no Yahoo Finance data → skip with warning, do not block the stage
- macroIntelligence result is cached in DB; pressing **Analizar** a second time reuses it

---

## Out of Scope

- Showing the CausalMap in the frontend UI (future work)
- User editing/overriding causal chains
- Real-time (intraday) pipeline runs
