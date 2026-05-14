# Flujo Completo: Botón "Analizar"

> Última actualización: 2026-04-28

---

## Visión General

El botón "Analizar" dispara un pipeline de dos fases:
1. **Scan** — computación determinística de señales (sin IA)
2. **Deep Analysis** — análisis razonado por LLM (con IA)

Ambas fases corren en background. El frontend hace polling y muestra progreso en tiempo real.

---

## PASO 1 — Trigger (Frontend)

**Archivo:** [EvidenceSignals.tsx](../apps/frontend/src/evidence-signals/EvidenceSignals.tsx)

| | |
|---|---|
| **Input** | Click en botón "Analizar" |
| **Acción** | `refreshMutation.mutate()` → tRPC `evidenceSignals.refresh` |
| **Output** | `{ ok: true, message: 'Scan iniciado en background' }` (inmediato) |
| **IA** | No |

El endpoint retorna inmediatamente. Todo el trabajo corre en background.

---

## PASO 2 — Detección de Régimen de Mercado

**Archivo:** [evidence-signals.service.ts](../apps/backend/src/evidence-signals/evidence-signals.service.ts)

| | |
|---|---|
| **Input** | SPY: precio actual + SMA200 (Yahoo Finance) |
| **Lógica** | `price > SMA200 * 1.02` → bull / `price < SMA200 * 0.98` → bear / else → neutral |
| **Output** | `{ regime: 'bull'\|'bear'\|'neutral', spyPrice, sma200, priceVsSma200Pct }` |
| **IA** | No |
| **Efecto** | En régimen `bear`: señales LONG degradadas en convicción. BUY_SETUP bloqueado. |

---

## PASO 3 — Screener de Símbolos

**Archivo:** [evidence-signals.service.ts](../apps/backend/src/evidence-signals/evidence-signals.service.ts)

| | |
|---|---|
| **Input** | Símbolos del portfolio + lista de símbolos configurados |
| **Lógica** | Filtra duplicados, aplica overrides PEAD manuales |
| **Output** | `{ symbols: string[], peadOverrides: Record<string, PeadOverride> }` |
| **IA** | No |

---

## PASO 4 — Cómputo de Señales por Símbolo

**Archivo:** [evidence-signals.service.ts](../apps/backend/src/evidence-signals/evidence-signals.service.ts)  
**Concurrencia:** 5 símbolos en paralelo

Para cada símbolo se ejecuta `computeEvidenceSignal(symbol, peadOverride)`.

### 4a. Fetch de Datos (en paralelo)

| Fuente | Datos |
|--------|-------|
| Yahoo Finance | Earnings history (últimos 8 quarters) |
| Yahoo Finance | Insider transactions (últimos 6 meses) |
| Yahoo Finance | Options chain (calls + puts) |
| Yahoo Finance | Quote (precio actual, volumen) |
| Yahoo Finance | OHLCV histórico 3 meses (1d) |
| Yahoo Finance | Fundamentales (P/E, márgenes, revenue growth, beta, deuda) |

### 4b. Cómputo de 3 Señales

#### Señal PEAD (Post-Earnings Announcement Drift)

| | |
|---|---|
| **Input** | Earnings history: EPS estimado vs. reportado |
| **Lógica** | Beat ≥ 5% → activa. Días desde earnings dentro de ventana de drift (60d). Beats consecutivos. |
| **Output** | `{ active: bool, beatPct, daysSince, driftWindowRemaining, consecutiveBeats }` |

#### Señal INSIDER

| | |
|---|---|
| **Input** | Transacciones de insiders (últimos 6m) |
| **Lógica** | Compras ≥ 2 compradores o valor > $500k en 30 días |
| **Output** | `{ active: bool, buyerCount, totalValue, recentTransactions[] }` |

#### Señal OPTIONS FLOW

| | |
|---|---|
| **Input** | Options chain: volumen, OI, strikes por expiración |
| **Lógica** | Calls OTM con volumen anormal (Vol/OI ratio ≥ 3x). Call/Put ratio total. |
| **Output** | `{ active: bool, unusualStrikes[], callPutRatio, nearExpiry }` |

### 4c. Score Compuesto

| | |
|---|---|
| **Input** | Scores individuales de PEAD, INSIDER, OPTIONS + régimen de mercado |
| **Lógica** | Promedio ponderado: PEAD×0.4 + INSIDER×0.35 + OPTIONS×0.25. Degradado en bear. |
| **Output** | `compositeScore: 0-100`, `conviction: 'high'\|'medium'\|'low'\|'none'` |
| **IA** | No |

### 4d. Cache + Auto-tracking

- Cache 6h en tabla `evidenceSignalsCache`
- Si `conviction >= medium`: insertar en `signalTracking` para medir accuracy futura

---

## PASO 5 — Snapshot Histórico

| | |
|---|---|
| **Input** | Todos los signals del scan |
| **Acción** | `insertEvidenceSignalsSnapshot()` |
| **Output** | Fila en `evidenceSignalsSnapshot` con fecha, totales, señales serializadas |
| **IA** | No |

---

## PASO 6 — Deep Analysis (IA) — Non-blocking

**Archivo:** [deep-analysis.service.ts](../apps/backend/src/evidence-signals/deep-analysis.service.ts)  
**Concurrencia:** 3 señales en paralelo  
**Elegibilidad:** Solo señales con `conviction = high | medium`

### 6a. Fetch de Contexto Adicional (en paralelo)

| Fuente | Datos |
|--------|-------|
| Tavily Search API | 5 noticias recientes del símbolo |
| Yahoo Finance | OHLCV 3 meses (para indicadores técnicos) |
| Yahoo Finance | Fundamentales actualizados |
| Sector Momentum | Tendencia sectorial vs. SPY |

### 6b. Cómputo de Indicadores Técnicos

| Indicador | Cálculo |
|-----------|---------|
| RSI(14) | Últimas 14 velas diarias |
| SMA20 | Media móvil 20 días |
| SMA50 | Media móvil 50 días |
| Tendencia | `bullish` / `bearish` / `mixed` según SMA cruce |
| Momentum 5d | `(close[0] - close[4]) / close[4] * 100` |
| Últimas 20 velas | OHLCV completo para el LLM |

### 6c. Construcción del Prompt

**System prompt incluye:**
- Reglas para verdicts: `BUY_SETUP`, `WAIT`, `PASS`
- Validación de precios: zonas de entrada/target/stop dentro de ±30% del precio actual
- R/R mínimo 2:1 para `BUY_SETUP`
- Formato de respuesta JSON estricto

**User message incluye (≈200-300 tokens):**
- Símbolo, precio actual, convicción
- Detalle de señales activas (PEAD beat%, días; INSIDER compradores/valor; OPTIONS strikes)
- Sector + tendencia sectorial
- Fundamentales (P/E, revenue growth, márgenes, beta, deuda/equity)
- Indicadores técnicos calculados
- Últimas 20 velas OHLCV
- Titulares de noticias recientes

### 6d. Selección de Modelo IA (AI Router)

**Task type:** `'reasoning'`

| Prioridad | Proveedor | Modelo | Límite |
|-----------|-----------|--------|--------|
| 1 | **Gemini** | `gemini-2.5-pro` | 100 req/día × 4 keys = 400/día |
| 2 | **OpenRouter** | `deepseek/deepseek-r1-distill-llama-70b:free` | Free tier |
| 3 | **Groq** | `llama-3.3-70b-versatile` | Rate limit variable |
| 4 | **LM Studio** (local) | `qwen-3.5-9b` (localhost:1234) | Sin límite |

**Parámetros comunes:**
- Temperature: `0.1`
- Max tokens: `1024` (razonamiento: hasta `2048`)
- Response format: `JSON`

### 6e. Parsing y Validación de Respuesta

**Output esperado del LLM:**
```json
{
  "verdict": "BUY_SETUP | WAIT | PASS",
  "reasoning": "2-3 oraciones con datos concretos",
  "entryZone": "$820-835 o N/A",
  "target": "$920 o N/A",
  "stopLoss": "$780 o N/A",
  "riskReward": "2.8:1 o N/A",
  "confidence": 75,
  "keyRisks": ["riesgo1", "riesgo2"],
  "timeframe": "3-6 meses"
}
```

**Validaciones post-LLM:**
- Parsea rangos `$X-Y` → usa midpoint
- Rechaza precios fuera de ±30% del precio actual (alucinaciones)
- Si falla validación → `verdict = PASS`

### 6f. Persistencia

| Tabla | Qué guarda |
|-------|-----------|
| `evidenceDeepAnalysis` | Análisis completo con TTL 6h |
| `evidenceSignalsCache` | Actualiza `aiVerdict`, `aiConfidence`, `targetPrice`, `stopLoss` en la señal |

---

## PASO 7 — Polling del Frontend

**Archivo:** [EvidenceSignals.tsx](../apps/frontend/src/evidence-signals/EvidenceSignals.tsx)

| Endpoint | Intervalo | Qué retorna |
|----------|-----------|-------------|
| `evidenceSignals.scanStatus` | 3s | `state`, `scannedCount/totalCount`, `analysisState`, `analyzedCount/analysisTotal` |
| `evidenceSignals.getAll` | 10s | Señales cacheadas ordenadas por score |
| `evidenceSignals.getAllDeepAnalyses` | 15s | Análisis IA ordenados por confidence |

---

## PASO 8 — Renderizado UI

### Signal Cards
- Badge de convicción (`HIGH`/`MEDIUM`/`LOW`)
- Pills de señales activas (PEAD / INSIDER / OPTIONS)
- Composite score 0-100
- **Actionable Score 0-10** = `régimen(0-3)` + `convicción ajustada(0-3)` + `BUY_SETUP(2)/WAIT(1)` + `beats consecutivos(1)` + `múltiples insiders(1)`

### AI Analysis Section (aparece al completarse)
- Verdict badge + confidence % + timeframe
- Reasoning del LLM
- Entry zone / Target / Stop Loss (solo si BUY_SETUP)
- Key risks
- R/R ratio
- Modelo usado

### Top Picks
- Filtro: `verdict = BUY_SETUP`, ordenados por actionable score
- Position sizing: 2% riesgo del portfolio
- Warning de concentración sectorial

---

## PASO 9 — Signal Resolver (Async Tardío)

**Archivo:** [signal-resolver.service.ts](../apps/backend/src/evidence-signals/signal-resolver.service.ts)

| | |
|---|---|
| **Input** | Señales tracked con más de 30 días de vida |
| **Lógica** | Compara precio actual vs. target/stop al momento del señal |
| **Output** | Actualiza `signalTracking` con resultado `WIN/LOSS/OPEN` |
| **IA** | No |

---

## Resumen de Tiempos

| Fase | Duración estimada |
|------|-------------------|
| Retorno inmediato al frontend | < 100ms |
| Scan completo (100+ símbolos, batch 5) | 1-2 min |
| Deep Analysis (20-30 señales, batch 3) | 5-10 min |
| Polling hasta ver primeros resultados | ~30s |

---

## Resumen de Modelos IA por Tarea

| Tarea | Modelo primario | Fallbacks |
|-------|----------------|-----------|
| Análisis razonado de señal | Gemini 2.5 Pro | DeepSeek R1 → Groq Llama 70B → Qwen 9B local |
| Clasificación rápida | Gemini 2.5 Flash | Groq 8b → DeepSeek R1 → Qwen 9B local |
| Narrativa / resumen | Gemini 2.5 Flash | Groq Light → Qwen 9B local |

---

## Diagrama de Flujo

```
Click "Analizar"
      │
      ▼
tRPC evidenceSignals.refresh ──► return { ok: true } (inmediato)
      │
      └─► [BACKGROUND]
            │
            ├─ 1. getMarketRegime() → regime: bull/bear/neutral
            │
            ├─ 2. getScreenedSymbols() → [SYM1, SYM2, ...]
            │
            ├─ 3. Por cada símbolo (5 en paralelo):
            │      computeEvidenceSignal()
            │       ├─ fetch: earnings, insiders, options, quote, OHLC, fundamentos
            │       ├─ compute: PEAD + INSIDER + OPTIONS
            │       ├─ compute: compositeScore + conviction (ajustado por régimen)
            │       └─ cache 6h + auto-track si conviction ≥ medium
            │
            ├─ 4. insertEvidenceSignalsSnapshot()
            │
            └─ 5. triggerDeepAnalysis() ──► [NON-BLOCKING]
                        │
                        └─ Por cada señal HIGH/MEDIUM (3 en paralelo):
                             ├─ fetch: noticias (Tavily), OHLC, fundamentos, sector
                             ├─ compute: RSI, SMA20, SMA50, tendencia
                             ├─ build prompt (~250 tokens contexto)
                             ├─ call AI router ('reasoning'):
                             │    Gemini 2.5 Pro
                             │      └─► fallback: DeepSeek R1
                             │              └─► fallback: Groq Llama 70B
                             │                      └─► fallback: Qwen 9B local
                             ├─ parse + validar respuesta JSON
                             └─ cache 6h + update signal targets

Frontend polling:
  scanStatus (3s) ──► barra de progreso scan
  getAll (10s)    ──► signal cards
  getAnalyses (15s)──► secciones AI analysis
```
