# Pipeline de Análisis - Mapa Técnico Completo

**Fecha:** 2026-05-07
**Branch:** `feature/etf-watchlist`
**Alcance:** Flujo completo ejecutado al presionar el botón de análisis en el frontend.

---

## Trigger (Frontend → Backend)

**Botón:** Frontend [usePipeline.ts](../apps/frontend/src/intelligence/usePipeline.ts) llama `trpc.intelligence.generateMarketReport.mutate({ force, sectors, aiMode })`.

**Router:** [intelligence.router.ts:67-78](../apps/backend/src/intelligence/intelligence.router.ts#L67-L78) → invoca `checkOrRunPipeline()` en [pipeline.service.ts:583](../apps/backend/src/intelligence/pipeline.service.ts#L583).

**Modo IA:** `aiMode = 'cloud' | 'local'` se setea con `setRunAiMode()` ([shared/ai-router.ts](../apps/backend/src/shared/ai-router.ts)). Determina qué provider usa cada llamada LLM downstream (Anthropic / Gemini / Groq / OpenRouter / LMStudio).

**Estado run:** Crea fila en `pipelineRuns` con status `running`. Polling frontend cada 2s vía `intelligence.pipelineStatus`. Concurrencia bloqueada: si hay run activo retorna ese mismo.

**Recovery:** En startup `initPipeline()` marca como `failed` cualquier run colgado (crash recovery).

---

## STAGE 1 — Web Search

**Código:** [pipeline.service.ts:106-152](../apps/backend/src/intelligence/pipeline.service.ts#L106-L152)

| Campo | Detalle |
|---|---|
| **Input** | Símbolos de portfolio + queries de descubrimiento (tabla `discoveryQueries`) |
| **Proceso** | Llama Tavily + Exa en paralelo. Dos capas: `portfolio` (precisión alta sobre holdings) + `discovery` (queries amplias temáticas) |
| **IA** | No directamente. Solo APIs de búsqueda externa |
| **Output** | Artículos web con `title`, `url`, `content`, `publishedAt` |
| **BD** | `webSearchArticles` con `date`, `symbol`, `query`, `layer` |
| **TTL** | Por fecha. Día calendario. Reusa el mismo set en stages downstream del mismo día |
| **Error** | Si **ambos providers fallan** → status `failed`, pausa pipeline en `waiting_user`. Si **uno falla** → status `partial`, continúa |

---

## STAGE 2 — News Aggregation + Triangulation

**Código:** [pipeline.service.ts:154-208](../apps/backend/src/intelligence/pipeline.service.ts#L154-L208) → `refreshNewsProcess()` en opportunities.service.

| Campo | Detalle |
|---|---|
| **Input** | Símbolos activos + keywords (`newsSearchKeywords`) + `webSearchArticles` del Stage 1 |
| **Fuentes** | RSS (tabla `newsSources`) · Yahoo Finance v8 · Finnhub company-news · NewsAPI · web search |
| **Dedup** | [news-aggregator.service.ts](../apps/backend/src/news/news-aggregator.service.ts) - Jaccard sobre títulos tokenizados, threshold 0.7. Si duplica, mantiene el que tenga más símbolos relacionados |
| **Triangulación** | [triangulation.service.ts:68+](../apps/backend/src/news/triangulation.service.ts#L68) - Union-Find clusteriza por similitud título (0.65) + overlap símbolos + ventana 24h. Confianza: 3+ fuentes = `high` · 2 fuentes = `medium` · 1 fuente = `low` (`high` si es Reuters/Bloomberg/WSJ/CNBC/AP/FT/NYT) |
| **IA** | No. Algoritmos clásicos |
| **Output** | Artículos con `triangulationConfidence`, `storyClusterId` |
| **BD** | `newsArticles` (`externalId`, `source`, `title`, `body`, `publishedAt`, `relatedSymbols`, `sentiment`, `impact`, `storyClusterId`, `triangulationConfidence`) |
| **TTL** | 7 días retención. Se refresca diario; reusa si ya hay >5 artículos del día |
| **Error** | **0 artículos = critical** → status `failed`, skip resto. Parcial (alguna fuente caída) → continúa |

---

## STAGE 3 — Macro Intelligence + Causal Chains

**Código:** [pipeline.service.ts:210-263](../apps/backend/src/intelligence/pipeline.service.ts#L210-L263) · [macro-intelligence.service.ts](../apps/backend/src/intelligence/macro-intelligence.service.ts)

| Campo | Detalle |
|---|---|
| **Input** | Headlines del día (web search + news) |
| **Proceso** | **Dos llamadas LLM secuenciales:**<br>1. **Event extraction** — extrae 5-8 eventos macro con `category` (Política Monetaria, Semiconductores/IA, Energía/Oil, Argentina/CEDEARs, Cripto, Banca US, etc.) + `magnitude` (high/medium/low)<br>2. **Causal chains** — por cada evento infiere cadenas causales: ticker → dirección (positive/negative) + impact (direct/indirect) + razón. Max 6 tickers por evento |
| **IA** | `callAI('reasoning', ...)` → DeepSeek R1 o Gemini según routing |
| **Output** | Eventos macro + chains ticker-event |
| **BD** | `macroEvents` (`date`, `eventId`, `event`, `category`, `magnitude`) · `causalChains` (`date`, `eventId`, `ticker`, `direction`, `impact`, `reason`) |
| **TTL** | 1 día. Regenera diario |
| **Error** | Non-blocking. Falla → analysis usa portfolio sin enriquecimiento macro [pipeline.service.ts:517-521](../apps/backend/src/intelligence/pipeline.service.ts#L517) |

---

## STAGE 3.5 — Sector Intelligence (no bloqueante)

**Código:** [pipeline.service.ts:265-304](../apps/backend/src/intelligence/pipeline.service.ts#L265-L304) · [sector-report.service.ts](../apps/backend/src/intelligence/sector-report.service.ts)

| Campo | Detalle |
|---|---|
| **Input** | Artículos triangulados con confidence high/medium (max 60) |
| **IA** | Una sola llamada LLM. Prompt sintetiza 5-8 sectores impactados |
| **Output por sector** | `sector`, `impact` (positive/negative/mixed), `event`, `summary`, `catalysts[]`, `keyNews[]`, `suggestedTickers[]`, `riskFactors[]`, `conviccion` (alta/media/baja), `tension` (señales contradictorias), `confidence` |
| **BD** | `sectorImpacts` (borra día anterior antes de insertar) |
| **TTL** | 1 día |
| **Error** | Non-blocking. Si 0 artículos → `skipped` |

---

## STAGE 4 — Fundamentals Cache

**Código:** [pipeline.service.ts:306-348](../apps/backend/src/intelligence/pipeline.service.ts#L306-L348)

| Campo | Detalle |
|---|---|
| **Input** | Símbolos portfolio + descubiertos |
| **Proceso** | Check edad cache: si <3 días → `skipped`. Sino, llama FMP API |
| **Cálculos (FMP)** | P/E, Forward P/E, PEG, P/B, P/S, ROE, ROA, Net Margin, Debt/Equity, Current Ratio, Revenue Growth %, EPS Growth %, FCF Growth, 52w high/low, EPS últimos 4 trimestres + consensus |
| **IA** | No |
| **BD** | `fundamentalCache` (`symbol` PK, `data` JSON, `fetchedAt`, `expiresAt = fetchedAt + 7d`) |
| **TTL** | **7 días**. Refresh trigger en pipeline si edad ≥ 3 días |
| **Uso downstream** | Stage 5 (scoring), Stage 5b (LLM cards), Stage 7 (market report) |
| **Error** | Non-blocking. Analysis continúa con cache vieja |

---

## STAGE 5 — Analysis (CORE: Scoring + LLM)

**Código:** [pipeline.service.ts:350-383](../apps/backend/src/intelligence/pipeline.service.ts#L350-L383) · [scoring.ts](../apps/backend/src/opportunities/scoring.ts) · [unified-analysis.service.ts](../apps/backend/src/intelligence/unified-analysis.service.ts)

### 5a — Scoring algorítmico (sin IA)

**Input:** símbolos activos + technical summaries (RSI, MACD, SMA, Bollinger, OBV, divergencias) + fundamental summaries + sentiment map (de `newsIntelligenceSnapshots`).

**Fórmula composite** ([scoring.ts:59-103](../apps/backend/src/opportunities/scoring.ts#L59-L103)):
```
shortTerm  = 0.40·sentiment + 0.40·technical + 0.20·fundamental
mediumTerm = 0.20·sentiment + 0.35·technical + 0.45·fundamental
composite  = 0.40·shortTerm + 0.60·mediumTerm
```
Pesos configurables vía `getActiveWeights()` (tabla `scoringWeightHistory`, modificable por proposals).

**Confluencia (~19 votos):**
- Técnicos: RSI extremos, MACD histograma, vs SMA50/200, golden/death cross, stochastic, Bollinger position, OBV trend, divergencias, soporte/resistencia, volume ratio
- Fundamentales: P/E vs sector, growth, ROE, valoración vs 52w high, debt
- Sentimiento: count noticias, score, headline mayor

**Niveles trade:** entry = soporte 52w (o -5% precio actual) · stop = mínimo 52w -2% (u -8% entry) · target = máximo 52w (o +15%/+25%) · RR ratio.

**Filtros anti-hype:** rechazo si caída 1d >15% o spike >30% (strict). Logs en `antiHypeRejections`.

**Output:** opportunities array con score, recommendation (BUY/SELL/HOLD/WATCH), niveles, conflictos.

**BD:**
- `opportunityScans` (metadata scan)
- `opportunitySnapshots` (1 fila por símbolo: score, action, prices, shortTerm/mediumTerm scores, full data JSON)
- `signalTracking` (audit accuracy: priceAfter7d/30d, hitTarget/Stop, outcome — se completan diferido)

**TTL:** 7 días scans. Reusa si edad <7d (a menos que `force=true`).

### 5b — Unified Analysis (LLM enrichment)

**Código:** [unified-analysis.service.ts](../apps/backend/src/intelligence/unified-analysis.service.ts)

**Input:** Top ~20 opportunities con BUY/SELL.

**Proceso:** Batches de 4 símbolos por llamada (rate limit OpenRouter). Por símbolo arma "card" compacta:
```
SYMBOL $price | algoAction=BUY score=75 | portfolio context
tech_d: RSI_d=42 MACD=-0.005 vsSMA200=-2.1% BB_squeeze=8%
tech_w: RSI_w=55 MACD_w=0.012 trend_w=uptrend
divs: bullish_rsi_daily bullish_macd_weekly
fund: PE=18.5 fwdPE=16.2 vs52wH=-8% revGrow=12%
sent: +55 positive "headline1" "headline2"
conflicts: rsi_bullish vs macd_bearish
levels: entry=$45.30 stop=$41.20 target=$52.10 RR=1:2.3
CAUSAL CONTEXT: <chains macro relevantes>
```

**IA:** DeepSeek R1 o Gemini fallback. Prompt: `UNIFIED_ASSET_ANALYSIS_PROMPT`.

**Output JSON por activo:**
```json
{
  "action": "BUY|SELL|HOLD|WATCH",
  "thesis": "tesis 3-4 oraciones",
  "catalysts": ["..."],
  "risks": ["..."],
  "narrative": "historia completa",
  "wouldDo": ["..."],
  "wouldNotDo": ["..."],
  "macroTheme": "Semiconductores/IA"
}
```

**BD:**
- `unifiedAnalysisResults` (`pipelineRunId`, `symbol`, `action`, `thesis`, `catalysts`, `risks`, `wouldDo`, `wouldNotDo`, `narrative`, `macroTheme`, `generatedBy`, `dedupeKey` único)
- `unifiedAnalysisBatches` (audit: tokens in/out, modelo, errores, raw response)

**TTL:** Sin expiry duro. Dedupe por `pipelineRunId+symbol` (en run) o `manual-YYYY-MM-DD-symbol`.

**Error:** parsing falla → skip batch, log. Todas fallan → status `failed`, skip report.

---

## STAGE 6 — News Radar v2 (paralelo, fire-and-forget)

**Código:** [pipeline.service.ts:494-508](../apps/backend/src/intelligence/pipeline.service.ts#L494-L508) · [news-radar.service.ts](../apps/backend/src/news/news-radar.service.ts)

**Cuándo:** Disparado en paralelo después de news stage (no bloquea pipeline).

| Campo | Detalle |
|---|---|
| **Input** | Artículos high/medium confidence (filtra leveraged ETFs como TQQQ/TNA/SOXL) |
| **IA** | LLM con `NEWS_RADAR_PROMPT`. Por artículo extrae causa + impactos positivos/negativos en tickers/sectores |
| **Validación** | Solo NYSE/NASDAQ/ADR válidos |
| **Agregación** | Net score por target = (positive - negative) / total · weighted by confidence (high=1.0, medium=0.6, low=0.3). Sectores derivan de tickers con discount 0.5x |
| **BD** | `newsRadarSnapshots` (`pipelineRunId`, `perArticle` JSON, `aggregatedSignals` JSON, `emergingNarratives`, `llmModel`, `durationMs`) |
| **TTL** | 6 horas (sentiment boost reusa si <6h). 7 días retención |
| **Uso** | Boost/dampen sentiment map en Stage 5a. Señales \|netScore\| ≥ 1.5 → bonus +25 puntos sentiment |

---

## STAGE 7 — Quant Analysis (no bloqueante)

**Código:** [pipeline.service.ts:385-420](../apps/backend/src/intelligence/pipeline.service.ts#L385-L420)

| Campo | Detalle |
|---|---|
| **Input** | Technical summaries de todos los símbolos + SPY |
| **Proceso** | 3 sub-módulos:<br>1. **Regime detector** — analiza SPY → `trending_bull / trending_bear / mean_reverting / volatile` + confidence<br>2. **Momentum ranker** — ranking por price momentum + RSI rank + relative strength<br>3. **Weight calibrator** — ajusta pesos sentiment/technical/fundamental según accuracy histórica (signals últimos 30-90d) |
| **IA** | No. Algorítmico puro |
| **Output** | `_stageQuantContext` en memoria (consumido por Stage 8) |
| **BD** | `calibratedWeightsTable` (pesos shortTerm/mediumTerm calibrados) |
| **TTL** | Por run pipeline |
| **Error** | Non-blocking |

---

## STAGE 8 — Market Report + Digest (síntesis final)

**Código:** [pipeline.service.ts:422-479](../apps/backend/src/intelligence/pipeline.service.ts#L422-L479) · [market-report.service.ts](../apps/backend/src/intelligence/market-report.service.ts)

**Input:**
- Análisis unificados Stage 5b
- Opportunity scan Stage 5a
- Second-order effects (correlaciones sectoriales)
- Earnings calendar (próximos 10 eventos) [earnings-calendar.service.ts](../apps/backend/src/intelligence/earnings-calendar.service.ts)
- Macro events + causal chains Stage 3
- Quant context Stage 7 (regime, rankings)
- News intelligence (count, plazas, sentiment)

**IA:** **Una sola llamada LLM** con `COMBINED_SYNTHESIS_PROMPT`. Genera report + digest en mismo JSON. Modelo: reasoning class (DeepSeek R1 preferido, Gemini fallback).

**Normalización temas:** Mapea `macroTheme` de análisis a canónicos: Semiconductores/IA, Energía/Oil, Argentina/CEDEARs, Cripto, Defensa/Geopolítica, Banca US, Salud/Biotech, Commodities, Bonos/Tasas, Política Monetaria, Consumo/Retail.

**Output 1 — Market Report → `marketReports`:**
- `macroContext` (narrativa entorno mercado)
- `portfolioImpact` (implicaciones específicas portfolio)
- `topImpactNews[]` (con sectors, confidence, tickers)
- `themes[]` (relevance + summary + recommendations)
- `topRecommendations[]` (top 8 símbolos)
- `alternatives[]` (tier + thesis)
- `scenarios[]` (probabilidad + distribución)
- `avoidList[]`

**Output 2 — Market Digest → `marketDigests`:**
- `overnightSummary` (3-5 headlines sintetizados)
- `portfolioImpact`
- `topOpportunities[]`
- `watching[]`
- `warnings[]`
- `marketMood` (`risk-on / risk-off / mixed`)
- `wouldDo[]` (5 acciones recomendadas)
- `wouldNotDo[]` (5 acciones a evitar)

**Fallback (si LLM falla):** digest construido algorítmicamente — top 3 BUY + top 2 SELL + primeras 3 headlines. Mood = ratio buyCount vs sellCount.

**TTL:** Sin expiry. Cache en memoria (`cachedMarketReport`) + DB. 1-2 reports/día.

**Side-effect:** Tickers recomendados que no están en watchlist → registrados en `discoveredSymbols` para próximo run.

---

## STAGE 9 — Finalización + Tracking

**Código:** [pipeline.service.ts:568-581](../apps/backend/src/intelligence/pipeline.service.ts#L568-L581)

- Status final: `ok / partial / failed` según stages
- `finishedAt` timestamp
- Top 8 recommendations → `signalTracking` (accuracy diferida)
- Si suficientes signals resueltos → genera `scoringWeightProposals` pendiente (user aprueba/rechaza UI)

---

## Resumen Cálculos Técnicos

**Indicadores ([technical-analysis.service.ts](../apps/backend/src/technical/technical-analysis.service.ts) — getTechnicalSummary):**

| Indicador | Cálculo | Uso |
|---|---|---|
| RSI(14) | 100 - 100/(1+RS), RS=avg gain/avg loss | Sobrecompra/sobreventa, divergencias |
| MACD | EMA12-EMA26, signal line, histograma | Trend, divergencias |
| SMA 50, 200 | Media simple | Trend, golden/death cross |
| Bollinger | SMA20 ±2σ + squeeze % | Volatilidad, breakouts |
| Stochastic | K fast, D slow | Sobrecompra (>80) sobreventa (<20) |
| OBV | Volume cumulative | Trend volumen, divergencias precio |
| Crossovers | SMA50 vs SMA200 + ETA cruce | Cambios trend macro |
| Volume ratio | Actual / avg 20d | Confirmación movimientos |
| Soporte/Resistencia | Max-min recientes + % distancia | Niveles trade |
| Weekly trend | RSI/MACD sobre OHLC semanal | Filtrado direccional |

**Storage técnicos:** OHLC en `historicalCache` (TTL 1 día daily, 1 semana weekly). Indicadores se calculan on-demand desde OHLC (no cacheados como tales).

---

## Resumen Cálculos Fundamentales

**Origen:** FMP (Financial Modeling Prep) API.

| Categoría | Métricas |
|---|---|
| Valoración | P/E, Forward P/E, PEG, P/B, P/S |
| Crecimiento | Revenue Growth %, EPS Growth %, FCF Growth |
| Rentabilidad | ROE, ROA, Net Margin |
| Deuda | Debt/Equity, Current Ratio |
| Precio | 52w high/low, vs 52w high % |
| Earnings | EPS últimos 4Q + consensus |

**Storage:** `fundamentalCache` por símbolo, JSON blob, TTL 7 días, refresh threshold 3 días.

---

## Cómo se Construye el Resumen (Daily Report / Market Digest)

**Flujo:**
1. Stage 5b genera análisis por símbolo (LLM con cards completas)
2. Stage 8 toma top 8 análisis + macro + earnings + quant + scenarios
3. Una llamada LLM con `COMBINED_SYNTHESIS_PROMPT` produce ambos outputs (report + digest) en mismo JSON
4. Si LLM falla → fallback algorítmico (top 3 BUY, top 2 SELL, primeras headlines)
5. Persiste en `marketReports` + `marketDigests`
6. Cache en memoria para retrieval rápido del frontend

**Daily Summary frontend** consume `marketDigests` (resumen acción-orientado) y `marketReports` (vista profunda con themes y scenarios).

---

## Tabla Maestra Persistencia + TTL

| Tabla | Propósito | TTL/Vigencia |
|---|---|---|
| `pipelineRuns` | Estado run por día | Permanente |
| `pipelineStageArtifacts` | Audit input/output cada stage | 90 días |
| `webSearchArticles` | Resultados Tavily/Exa | 7 días |
| `newsArticles` | Noticias agregadas todas fuentes | 7 días |
| `newsIntelligenceSnapshots` | Resúmenes plazas | 1 día |
| `newsRadarSnapshots` | Causa+impacto por artículo | 6h sentiment, 7d retención |
| `macroEvents` + `causalChains` | Eventos macro + chains | 1 día |
| `sectorImpacts` | Implicaciones sectoriales | 1 día |
| `fundamentalCache` | Fundamentales FMP | 7 días (refresh @ 3d) |
| `historicalCache` | OHLC | 1d daily / 1w weekly |
| `opportunityScans` | Metadata scan | 7 días reuso |
| `opportunitySnapshots` | Por símbolo | 7 días reuso |
| `unifiedAnalysisResults` | Análisis LLM | Permanente, dedupe por run |
| `unifiedAnalysisBatches` | Audit batches LLM | 90 días |
| `marketReports` | Report final | Permanente |
| `marketDigests` | Digest final | Permanente, 1/día |
| `signalTracking` | Audit accuracy signals | Permanente |
| `antiHypeRejections` | Símbolos rechazados | 30 días |
| `scoringWeightHistory` | Pesos aplicados | Permanente |
| `scoringWeightProposals` | Pesos pendientes user-approve | Permanente |
| `discoveredSymbols` | Tickers nuevos detectados | Permanente |

---

## Lógica Reuso / Force

- `force=false` (default): reusa stages completados en `pipelineRuns` existente del día
- `force=true`: limpia causal map cache + rerun todos stages desde Stage 1
- News stage: skip si ya hay >5 artículos del día
- Fundamentals: skip si edad <3 días
- Opportunities: reusa si scan <7 días
- Market report: cache memoria reusado todo el día

---

## Errores Bloqueantes vs No-Bloqueantes

**Bloquean pipeline:**
- Web search ambos providers fallan → `waiting_user`
- News 0 artículos → `failed`, skip todo downstream
- Analysis falla → skip report

**No bloquean:**
- Macro intelligence — analysis usa fallback portfolio
- Sector intelligence — report sin sectores
- Fundamentals — usa cache vieja
- Quant — report sin regime/momentum
- News Radar — fire-and-forget
- Market report LLM — fallback algorítmico

---

## Notas Finales

- Pipeline total ~45-60s end-to-end
- Todo auditable vía `pipelineStageArtifacts`
- Frontend polling cada 2s mientras `status=running`
- `aiMode` determina provider LLM en cada llamada (cloud vs local)
- LLM se invoca en stages: 3 (macro), 3.5 (sectores), 5b (unified analysis), 6 (news radar), 8 (market report+digest)
- Stages sin IA: 1 (web search), 2 (news agg), 4 (fundamentals), 5a (scoring), 7 (quant)
