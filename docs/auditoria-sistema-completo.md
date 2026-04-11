# Auditoria Completa del Sistema v2 - Trading IA Dashboard

**Fecha**: 2026-04-10
**Alcance**: Optimizacion de procesos de analisis, fiabilidad, tokens, TTLs, accuracy tracking
**Perfil**: Swing trader tactico (semanas a meses), 4 anos exp, Argentina + US + Crypto
**Version anterior**: v1 (2026-04-06) — bugs criticos y conexiones faltantes

---

## Resumen Ejecutivo

El sistema tiene una arquitectura solida: 4 fuentes de noticias, triangulacion multi-fuente, scoring tecnico/fundamental/sentimiento con confluencia, y persistencia en SQLite. Sin embargo, hay problemas criticos que afectan la calidad de las decisiones:

**Lo que funciona bien:**
- Pipeline de datos robusto (dedup, triangulacion, clustering)
- Scoring tecnico con 12+ indicadores y deteccion de divergencias
- Trade levels basados en ATR + S/R (buena gestion de riesgo)
- Signal conflict detection (6 patrones)
- Tracking de accuracy con resoluciones automaticas

**Lo que necesita mejora urgente:**
- Prompts con contexto hardcodeado obsoleto (guerra EEUU-Iran, Brent $92+)
- Pesos de scoring arbitrarios sin validacion historica
- Anti-hype filter que CONTRADICE la logica de swing trading
- TTLs no alineados al perfil inversor
- Tracking de accuracy sin breakdowns por dimension/sector
- Prompts redundantes y dead code que consumen tokens

---

## 1. Fiabilidad de Resultados de Analisis

### 1.1 Analisis de Sentimiento de Noticias

**Archivo**: [news-intelligence.service.ts](apps/backend/src/news/news-intelligence.service.ts)

**Problema A — Batch size limitado:**
```typescript
const MAX_NEWS_FOR_BATCH = 6; // linea 20
```
Con ~150-200 articulos unicos por ciclo, esto genera 25-33 llamadas LLM. El batch de 6 fue dimensionado para Qwen 3.5 9B local, pero cuando se usa Groq (70B) o OpenRouter (405B) se desperdicia capacidad.

**Propuesta:**
- Batch de 6 para LMStudio local (mantener)
- Batch de 15-20 para Groq/OpenRouter (mas capacidad de contexto)
- Detectar el provider en uso y ajustar automaticamente

**Problema B — Keywords de sentimiento demasiado simples:**
```typescript
// lineas 24-71: 31 positivos + 32 negativos
const POSITIVE_KEYWORDS = ['surge', 'rally', 'gain', 'beat', ...];
```

Faltan bigramas financieros criticos: "profit warning", "guidance cut", "buyback program", "short squeeze", "margin call", "debt restructuring". Los keywords en espanol son solo 7 de cada tipo — insuficiente para noticias de fuentes argentinas.

**Propuesta:**
- Expandir a 60+ keywords por categoria
- Agregar bigramas: `['profit warning', 'guidance cut', 'short squeeze', 'debt default', 'margin expansion']`
- Expandir espanol: `['toma de ganancias', 'presion vendedora', 'flujo de capitales', 'riesgo pais', 'dolar blue', 'brecha cambiaria', 'cepo', 'licitacion exitosa']`
- Agregar pesos por keyword (no todos tienen el mismo impacto): "bankruptcy" != "gain"

**Problema C — INTELLIGENCE_TTL demasiado corto:**
```typescript
const INTELLIGENCE_TTL = 15 * 60 * 1000; // 15 min, linea 21
```
La agregacion de intelligence (plazas, trends, alertas) se regenera cada 15 min. Para un swing trader que revisa 1-2 veces por dia, esto desperdicia recursos. Nota: el analisis LLM per-articulo ya esta persistido en DB (`news_articles.sentiment`), asi que solo la agregacion se recalcula.

**Propuesta:** Subir a 60 minutos. Ver seccion 5 para estrategia completa de TTL.

---

### 1.2 Scoring Tecnico — Pesos Arbitrarios

**Archivo**: [technical-analysis.service.ts](apps/backend/src/technical/technical-analysis.service.ts), funcion `scoreTechnical()`

Todos los pesos son magic numbers sin validacion contra resultados historicos:

| Componente | Peso actual | Problema | Propuesta |
|-----------|-------------|----------|-----------|
| RSI | ±15 base + delta*0.5 | Razonable pero no calibrado | Validar contra signal_tracking |
| MACD histogram | ±15 max | Normalizado por ATR (bien), cap arbitrario | Mantener, calibrar cap |
| Precio vs SMA200 | ±12 | Menor que SMA50 sin justificacion | Subir a ±15 (tendencia principal) |
| Precio vs SMA50 | ±15 | Igual que MACD — son redundantes? | Bajar a ±12 si MACD ya captura momentum |
| Stochastic | ±10 | Solo dispara en extremos K | Considerar K/D crossover, no solo nivel |
| OBV divergencia | ±12 | Senal leading subestimada | **Subir a ±18** (divergencia OBV es una de las senales mas fiables) |
| S/R proximidad | +8/-5 (asimetrico) | No hay razon para la asimetria | Simetrizar a ±8 |
| Golden/Death Cross | ±15 | Senal LAGGING, demasiado peso para swing | **Bajar a ±8** (para cuando cruza, el movimiento ya paso) |
| BB Squeeze | 15% amplificador | Multiplicativo, puede distorsionar | Cambiar a aditivo ±6 |
| Volumen | 15-30% amplificador | Se stackea con BB squeeze | Cap total de amplificacion: 20% max |

**Propuesta concreta:**
1. Crear `packages/shared/src/constants/scoring-weights.ts` que centralice TODOS los magic numbers
2. Implementar funcion `calibrateWeights()` que correlacione componentes con resultados del signal_tracking
3. A futuro: auto-ajuste de pesos basado en accuracy por componente

---

### 1.3 Scoring Fundamental — Dominancia del P/E

**Archivo**: [fundamental-analysis.service.ts](apps/backend/src/fundamental/fundamental-analysis.service.ts), funcion `scoreFundamental()`

Los 3 componentes de P/E pueden stackear hasta +60 puntos de un rango de -100 a +100:
- P/E < 15 con EPS > 0: **+25**
- Forward P/E < 10: **+20**
- Mejora Forward vs Current > 50%: **+15**
- **Total posible: +60** (domina todo el score)

Un stock puede tener P/E bajo por razon negativa (empresa en declive, mercado lo descuenta). El scoring no distingue.

**Propuesta:**
1. Capear contribucion total de P/E a **35 puntos max**
2. Agregar contexto sectorial: P/E de 15 en tech ≠ P/E de 15 en oil. Usar mediana del sector como referencia
3. Si `nextEarningsDate` esta a < 14 dias, reducir peso fundamental 30% (los datos estan por cambiar)
4. Penalizar P/E bajo + revenue growth negativo (value trap indicator)

---

### 1.4 Formula Composite — Desalineada con Swing Trading

**Archivo**: [scoring.ts](apps/backend/src/opportunities/scoring.ts), linea 81

```typescript
const composite = Math.round(shortTerm * 0.6 + mediumTerm * 0.4);
```

El horizonte del usuario es semanas a meses (medium-term), pero el composite pondera 60% short-term. Esto sesga hacia momentum de corto plazo en lugar de tesis de mediano plazo.

**Propuesta:**
```typescript
// Para perfil swing trader:
const composite = Math.round(shortTerm * 0.40 + mediumTerm * 0.60);
```

Opcionalmente: parametro de perfil que ajuste los pesos:
- `aggressive`: short 60% / medium 40% (actual)
- `swing` (default): short 40% / medium 60%
- `value`: short 25% / medium 75%

---

### 1.5 Anti-Hype Filter — Contradice la Logica de Swing

**Archivo**: [scoring.ts](apps/backend/src/opportunities/scoring.ts), funcion `applyAntiHypeFilters()`

```
Filter 1: Price > SMA200
Filter 2: RSI entre 30 y 75
Filter 3: Volume ratio >= 1.0 (opcional)
Regla: pasar 2 de 3
```

**Problema critico:** RSI < 30 es la MEJOR senal de compra para swing trading (mean reversion). El scoring le da +15 puntos a RSI < 30, pero el anti-hype lo filtra. Se contradicen.

**Problema secundario:** Price > SMA200 elimina oportunidades de value/deep-value en correccion. Stocks como YPF o GGAL pueden pasar semanas debajo de SMA200 durante correcciones del mercado argentino y ser excelentes oportunidades de compra.

**Propuesta:**
1. RSI filter: cambiar de "30-75" a "< 85" (solo filtrar extreme overbought)
2. SMA filter: cambiar de SMA200 a SMA50 (mas relevante para swing, o directamente eliminar para portfolio symbols)
3. Agregar flag `bypassAntiHype` para signals con divergencia bullish (la divergencia ya confirma que es oportunidad real, no hype)

---

## 2. Optimizacion de Tokens en Prompts

### 2.1 ANALYST_SYSTEM_PROMPT — Contexto Hardcodeado Obsoleto (P0)

**Archivo**: [prompts.ts](packages/shared/src/constants/prompts.ts), linea 1-6

```
Contexto actual: guerra EEUU-Iran en curso, Brent en $92+,
Estrecho de Hormuz semi-bloqueado, produccion record en Vaca Muerta.
```

Este contexto esta **hardcodeado y probablemente obsoleto**. Se inyecta en cada llamada al chat, contaminando las respuestas con informacion que puede ser falsa.

**Propuesta — Reescritura:**
```typescript
export const ANALYST_SYSTEM_PROMPT = `Sos un analista financiero experto en mercados argentinos y globales.
Responde en espanol, conciso y accionable. Max 150 palabras.
Emojis: 📈 suba 📉 baja ⚠️ riesgo ✅ comprar 🔴 vender ⏸️ mantener.`;
```

El contexto de mercado debe inyectarse **dinamicamente** desde `getIntelligence().plazas` al momento de cada llamada. Esto ahorra tokens cuando no hay contexto relevante y garantiza frescura.

**Ahorro estimado:** ~40 tokens por llamada + eliminacion de informacion potencialmente falsa.

---

### 2.2 Prompts Muertos — Dead Code

**Archivo**: [prompts.ts](packages/shared/src/constants/prompts.ts)

| Prompt | Linea | Status | Accion |
|--------|-------|--------|--------|
| `NEWS_ANALYSIS_PROMPT` | 8-10 | Reemplazado por `buildBatchNewsAnalysisPrompt()` | **ELIMINAR** |
| `SIGNAL_GENERATION_PROMPT` | 12-14 | Reemplazado por `INTEGRATED_SIGNAL_PROMPT` | **ELIMINAR** |
| `OPPORTUNITY_SCANNER_PROMPT` | (si existe) | Legacy, nunca usado | **ELIMINAR** |
| `BATCH_NEWS_ANALYSIS_PROMPT` | 40 | Backward compat innecesario | **ELIMINAR** (usar `buildBatchNewsAnalysisPrompt()` directo) |

**Ahorro:** Limpieza de codigo + eliminacion de confuison sobre que prompt se usa realmente.

---

### 2.3 INTEGRATED_SIGNAL_PROMPT — Portfolio Hardcodeado

**Archivo**: [prompts.ts](packages/shared/src/constants/prompts.ts), linea 42-46

```
El usuario tiene este portfolio:
- Argentina Energia: VIST (Vista Energy), YPF, PAM, TGS, CEPU
- Argentina Finanzas: GGAL, BMA
- US Energia: XOM, CVX
- Crypto: BTC-USD, ETH-USD
```

El portfolio esta hardcodeado. Si el usuario agrega/elimina posiciones, el prompt no se actualiza.

**Propuesta:** Generar la seccion de portfolio dinamicamente desde `getAllPositions()`:
```typescript
export function buildIntegratedSignalPrompt(positions: Position[]): string {
  const portfolioSection = positions.map(p =>
    `- ${p.symbol} (${p.quantity} @ $${p.avgCost})`
  ).join('\n');

  return `Sos un analista financiero cuantitativo senior.
Portfolio actual del usuario:
${portfolioSection}
...`;
}
```

**Ahorro:** ~30 tokens + precision (refleja portfolio real).

---

### 2.4 Payloads de Enrichment — Datos Excesivos

**Archivo**: [opportunities.service.ts](apps/backend/src/opportunities/opportunities.service.ts), funcion `buildEnrichmentMessage()`

Actualmente envia para cada simbolo: RSI, MACD, score tecnico, signal, P/E, Forward P/E, score fundamental, signal, sentiment score, headline count, top headlines completos.

Para el enrichment (agregar reasoning/catalysts/risks), el LLM solo necesita el resumen, no los datos crudos. Los datos crudos ya fueron procesados por el scoring algoritmico.

**Propuesta — Payload reducido:**
```
=== VIST (Energia) — Score: 72/100, Action: BUY ===
  Top signals: RSI oversold (28), OBV bullish divergence, near support $58
  Sentiment: positive (0.6), 5 headlines
  Key headline: "Record Vaca Muerta production in Q1"
  Conflicts: BB squeeze + OBV divergence (caution)
```

**Ahorro estimado:** 40-50% de tokens por simbolo en enrichment. Para 10 simbolos = ~2000 tokens menos por scan.

---

### 2.5 buildBatchNewsAnalysisPrompt — Bien Estructurado

**Archivo**: [prompts.ts](packages/shared/src/constants/prompts.ts), linea 16-36

Este prompt ya esta bien optimizado. Estructura clara, output JSON definido, reglas de confidence integradas. **No requiere cambios significativos.**

Optimizacion menor: mover la lista de marketPlaza values a un comentario inline en vez de enumerarlos todos (el LLM ya los conoce del contexto de entrenamiento).

---

### 2.6 Resumen de Ahorro de Tokens

| Cambio | Tokens ahorrados/llamada | Frecuencia | Impacto total |
|--------|--------------------------|------------|---------------|
| ANALYST_SYSTEM_PROMPT (quitar contexto hardcoded) | ~40 | Cada chat | Medio |
| Eliminar 3 prompts muertos | 0 (no se usan) | - | Limpieza |
| Portfolio dinamico en INTEGRATED_SIGNAL | ~30 | Per-scan | Bajo |
| Payload reducido de enrichment | ~200/simbolo | 10 simbolos/scan | **Alto (~2000/scan)** |
| Batch size adaptativo (menos llamadas) | N/A | 25→10 llamadas | **Alto (60% menos llamadas)** |

---

## 3. Calidad de Informacion para Toma de Decisiones

### 3.1 Return Estimates — Sin Calibracion Historica

**Archivo**: [scoring.ts](apps/backend/src/opportunities/scoring.ts), funciones `estimateShortTermReturn()` y `estimateMediumTermReturn()`

La formula actual:
```
shortTerm.base = techBase*0.5 + sentComponent*0.35 + fundComponent*0.15
```

Genera `midPercent` tipicamente entre -8% y +15%. Pero **nunca se comparo contra los retornos reales** del `signal_tracking` (`returnAfter7d`, `returnAfter30d`).

**Propuesta concreta:**
1. Agregar funcion `getEstimateCalibration()` que:
   - Tome todos los signals resueltos del signal_tracking
   - Compare `predicted midPercent` vs `actual returnAfter7d`
   - Calcule el bias (ej: "en promedio sobrestimamos 2.3%")
   - Calcule RMSE (error cuadratico medio)
2. Aplicar factor de correccion: `calibrated = predicted - avgBias`
3. Mostrar en el frontend: "Accuracy de estimaciones: ±X% promedio en ultimas N senales"

### 3.2 Datos Faltantes para Decision

Lo que el sistema calcula pero NO muestra de forma prominente:

| Dato | Existe | Se muestra | Propuesta |
|------|--------|-----------|-----------|
| Risk/Reward ratio | Si (tradeLevels.riskRewardRatio) | Enterrado en datos | **Mostrar prominente con color** (verde > 2:1, amarillo 1.5-2, rojo < 1.5) |
| Accuracy historica por sector | No | No | Implementar (ver seccion 6) |
| Concentracion de portfolio | No | No | Mostrar "Si compras X, seria el Y% de tu portfolio" |
| Accuracy por nivel de confidence | No | No | "Senales con confidence > 70% tuvieron Z% win rate" |
| Evolucion del score | Si (opportunity_snapshots) | No | Mostrar sparkline: como evoluciono el score en ultimos 7 dias |
| Divergencias activas | Si (calculadas) | **Bug: no llegan** | Arreglar bug v1 (P0-2) y mostrar prominente |

### 3.3 Signal Conflicts — Patrones Faltantes

**Archivo**: [signal-conflicts.ts](apps/backend/src/opportunities/signal-conflicts.ts)

Los 6 patrones actuales son solidos. Faltan 3 criticos para swing trading:

1. **Weekly divergence vs Daily signal:** Divergencia bajista semanal + MACD diario positivo → "El daily dice comprar pero el weekly dice que viene correccion. Para swing, el weekly manda. → WAIT"

2. **Earnings proximity conflict:** Signal BUY a < 14 dias de earnings → "Los fundamentales pueden cambiar radicalmente. Si compras, hazlo con position size reducido → CAUTION"

3. **Sector vs Individual conflict:** Sentimiento sectorial negativo pero stock con sentiment positivo → "El sector arrastra, aunque el stock tenga buenas noticias. Verificar si la noticia es suficiente para desacoplarse → CAUTION"

---

## 4. Calidad de Acciones y Senales

### 4.1 BUY Threshold — No Validado

**Archivo**: [scoring.ts](apps/backend/src/opportunities/scoring.ts), funcion `scoreToAction()`

```typescript
if (score >= 62) return 'BUY';
```

El 62 no tiene justificacion estadistica. Podria ser muy alto (perdemos oportunidades) o muy bajo (demasiados falsos positivos).

**Propuesta:**
1. **Analizar signal_tracking:** Cual es el win rate para score >= 62? Y para >= 55? Y >= 70?
2. **Implementar tiers de conviccion:**
   - `STRONG BUY`: score >= 72 AND confidence >= 70% AND sin signal conflicts
   - `BUY`: score >= 62
   - `SPECULATIVE BUY`: score >= 52 AND divergencia bullish confirmada
3. **Threshold adaptativo:** Si el win rate de los ultimos 30 signals BUY cae por debajo de 50%, subir el threshold automaticamente (+5). Si supera 70%, bajarlo (-3).

### 4.2 SELL Trigger — Prematuro para High-Beta

**Archivo**: [scoring.ts](apps/backend/src/opportunities/scoring.ts), funcion `smartAction()`

El SELL se dispara con:
```
1 divergencia bajista diaria + RSI > 60
```

Para stocks con beta > 1.5 (MELI, crypto, etc.), RSI oscila frecuentemente arriba de 60 sin que haya una reversal real. Esto genera SELL prematuros.

**Propuesta:**
- Si `beta > 1.5`, requerir `RSI > 70` en lugar de 60 para el trigger de SELL por divergencia unica
- El beta esta disponible en `fundamentalData.beta` pero no se usa en `smartAction()`
- Para crypto (sin beta), usar volatilidad historica (ATR% > 5% = high volatility, aplicar threshold RSI > 72)

### 4.3 HOLD y WATCH — Demasiado Vagos

Actualmente:
- `HOLD` = "no hagas nada" (pero no dice QUE observar)
- `WATCH` = "no es momento" (pero no dice CUANDO seria momento)

El `buildActionCondition()` ya genera condiciones concretas tipo:
```
"Si corrige a $65 (soporte), re-evaluar como BUY"
"Si rompe $53.78 → SELL inmediato"
```

Esto es excelente. **Pero falta:**
1. **Price alerts automaticos:** Cuando la accion es HOLD/WATCH con condicion de re-evaluacion, generar un alert trigger que notifique cuando el precio llegue al nivel
2. **Re-evaluacion temporal:** "Volver a analizar en 3 dias habiles" — persistir en DB con fecha
3. **Condiciones de upgrade:** "Se convierte en BUY si: RSI baja de 35 + volumen > 1.5x promedio" — condiciones concretas evaluables automaticamente

### 4.4 Horizonte Temporal — Demasiado Amplio

- Short-term: 1-4 semanas (rango de 3x)
- Medium-term: 1-6 meses (rango de 6x)

Para un swing trader, estos rangos son demasiado amplios para ser accionables.

**Propuesta:**
- Short-term: **1-2 semanas** (mas preciso para swing entry)
- Medium-term: **1-3 meses** (horizonte real de holding del usuario)
- Agregar timing concreto: "Estimamos que el movimiento se materializa en ~X dias" (ya existe en `timingView.estimatedDays`, pero no se usa para acotar el rango de retorno)

---

## 5. Estrategia de TTL / Expiracion

### 5.1 Mapa Actual vs Propuesto

| Componente | TTL actual | TTL propuesto | Justificacion |
|-----------|-----------|---------------|---------------|
| Precios (cotizaciones) | 5 seg | 5 seg | OK — necesita ser real-time |
| Historico diario | 1 dia (DB) | **4 horas** O invalidar si precio movio > 3% | Movimientos intraday importan para swing entry timing |
| Historico semanal | 7 dias (DB) | 7 dias | OK — velas semanales no cambian intradia |
| Fundamental data | 7 dias (DB) | **Adaptativo: 1 dia si earnings < 14 dias, 7 dias normal** | Antes de earnings los datos pueden cambiar drasticamente |
| News API fetch | 12 horas | 12 horas | OK — mas frecuente quemaria rate limits |
| News intelligence (agregacion) | **15 min** | **60 min** | Swing trader revisa 1-2x/dia. 15 min desperdicia LLM tokens en re-agregacion |
| News sentiment (per-articulo) | Permanente (DB) | Permanente | OK — una vez analizado, no cambia |
| Opportunity scan | Solo hoy (date-key) | **Persistir 7 dias** para comparacion | Swing trader necesita ver evolucion de scores |
| Signal tracking | 7-30 dias | **5 dias minimo** para resoluciones rapidas | Algunos swing trades se resuelven antes |
| Discovered tickers | 14 dias | **21 dias** | Alinear con horizonte de holding swing |
| Swing alerts | 5 min scan interval | 5 min | OK — son alertas de movimiento intraday |
| Market digest (in-memory) | 1 scan | **4 horas** | Evitar regenerar si no hubo nuevo scan |

### 5.2 Invalidacion Inteligente

Ademas de TTL fijo, implementar invalidacion por evento:

1. **Historico diario:** Invalidar si el precio actual difiere > 3% del ultimo close cacheado
2. **Fundamental:** Invalidar si hay noticia con `impact: high` y `affectedTickers` incluye el simbolo
3. **Opportunity scan:** Mantener cache pero marcar como "stale" si alguna noticia de impacto alto llego despues del scan
4. **Intelligence:** Invalidar si llegan > 10 noticias nuevas desde la ultima agregacion

### 5.3 TTL Adaptativo por Perfil Inversor

La estructura ya permite esto. Crear un `TradingProfile` que configure TTLs:

```typescript
interface TradingProfile {
  name: 'scalper' | 'swing' | 'position' | 'value';
  intelligenceTTL: number;    // scalper: 5min, swing: 60min, position: 4h, value: 24h
  historicalDailyTTL: number; // scalper: 15min, swing: 4h, position: 1d, value: 1d
  fundamentalTTL: number;     // scalper: 7d, swing: 7d, position: 14d, value: 30d
  scanPersistence: number;    // scalper: 1d, swing: 7d, position: 14d, value: 30d
  signalMinAge: number;       // scalper: 1d, swing: 5d, position: 14d, value: 30d
}
```

---

## 6. Almacenamiento y Tracking de Precision

### 6.1 Estado Actual del Signal Tracking

**Archivo**: [schema.ts](apps/backend/src/db/schema.ts), lineas 148-168

La tabla `signal_tracking` registra: symbol, date, action, entryPrice, targetPrice, stopLoss, confidence, opportunityScore. Despues de 7+ dias: priceAfter7d, priceAfter30d, returnAfter7d, returnAfter30d, hitTarget, hitStop, outcome (win/loss/neutral).

**Archivo**: [repository.ts](apps/backend/src/db/repository.ts), funcion `getSignalAccuracyStats()`

Solo devuelve: total, wins, losses, neutrals, winRate, avgReturn7d, avgReturn30d. **Sin breakdowns.**

### 6.2 Columnas Faltantes en signal_tracking

Para poder analizar QUE funciona y QUE no, necesitamos saber QUE datos tenia cada senal al momento de emitirse:

```sql
ALTER TABLE signal_tracking ADD COLUMN sector TEXT;
ALTER TABLE signal_tracking ADD COLUMN tech_score INTEGER;
ALTER TABLE signal_tracking ADD COLUMN fund_score INTEGER;
ALTER TABLE signal_tracking ADD COLUMN sent_score REAL;
ALTER TABLE signal_tracking ADD COLUMN had_divergences INTEGER; -- boolean
ALTER TABLE signal_tracking ADD COLUMN enriched_by_llm INTEGER; -- boolean
ALTER TABLE signal_tracking ADD COLUMN short_term_score INTEGER;
ALTER TABLE signal_tracking ADD COLUMN medium_term_score INTEGER;
ALTER TABLE signal_tracking ADD COLUMN rsi_at_signal REAL;
ALTER TABLE signal_tracking ADD COLUMN predicted_return_mid REAL;
```

**Modificar** `recordSignals()` en [signal-tracking.service.ts](apps/backend/src/opportunities/signal-tracking.service.ts) para poblar estas columnas.

### 6.3 Funciones de Accuracy por Dimension

Implementar en [repository.ts](apps/backend/src/db/repository.ts):

**`getAccuracyBySector()`:**
```sql
SELECT sector,
  COUNT(*) as total,
  SUM(CASE WHEN outcome = 'win' THEN 1 ELSE 0 END) as wins,
  ROUND(SUM(CASE WHEN outcome = 'win' THEN 1 ELSE 0 END) * 100.0 / COUNT(*), 1) as winRate,
  AVG(return_after_7d) as avgReturn7d
FROM signal_tracking
WHERE outcome IS NOT NULL AND outcome != 'pending'
GROUP BY sector;
```

**`getAccuracyByConfidenceTier()`:**
```sql
SELECT
  CASE
    WHEN confidence >= 70 THEN 'high'
    WHEN confidence >= 50 THEN 'medium'
    ELSE 'low'
  END as tier,
  COUNT(*) as total,
  winRate, avgReturn
FROM signal_tracking WHERE outcome != 'pending'
GROUP BY tier;
```

**`getAccuracyByScoreRange()`:**
```sql
SELECT
  CASE
    WHEN opportunity_score >= 72 THEN '72+'
    WHEN opportunity_score >= 62 THEN '62-71'
    WHEN opportunity_score >= 52 THEN '52-61'
    ELSE '<52'
  END as range,
  COUNT(*), winRate, avgReturn
FROM signal_tracking WHERE outcome != 'pending'
GROUP BY range;
```

**`getDimensionCorrelation()`:**
Para cada senal resuelta, determinar si cada dimension "acerto":
- Technical acerto si: (tech_score > 0 AND return > 0) OR (tech_score < 0 AND return < 0)
- Fundamental acerto si: (fund_score > 0 AND return > 0) OR (fund_score < 0 AND return < 0)
- Sentiment acerto si: (sent_score > 0 AND return > 0) OR (sent_score < 0 AND return < 0)

Esto permite responder: "El analisis tecnico acerto el 68% de las veces, el fundamental el 55%, y el sentimiento el 72%."

**`getEstimateAccuracy()`:**
Comparar `predicted_return_mid` vs `returnAfter7d`:
- Bias promedio (sobrestimamos o subestimamos?)
- Error absoluto promedio
- Correlacion (las predicciones altas corresponden a retornos altos?)

### 6.4 Tracking de Falsos Positivos y Oportunidades Perdidas

**Falsos positivos** (ya trackeados parcialmente):
- Senal BUY con outcome 'loss' = falso positivo
- Agregar: `returnAfter7d < -5%` como "falso positivo severo"

**Oportunidades perdidas** (NO trackeadas):
- Implementar tabla `missed_opportunities`:
```sql
CREATE TABLE missed_opportunities (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  symbol TEXT NOT NULL,
  scan_date TEXT NOT NULL,
  action_given TEXT NOT NULL, -- WATCH o HOLD
  opportunity_score INTEGER,
  actual_return_7d REAL,
  actual_return_30d REAL,
  would_have_been TEXT, -- 'BUY' si return > 5%, 'STRONG_BUY' si > 10%
  created_at TEXT DEFAULT (datetime('now'))
);
```

Periodicamente revisar simbolos que fueron WATCH/HOLD: si subieron > 10% en los siguientes 30 dias, registrar como oportunidad perdida. Esto permite calibrar si el threshold de BUY es demasiado alto.

### 6.5 Swing Alerts — Retroalimentacion al Scoring

**Archivo**: [swing-alerts.service.ts](apps/backend/src/swing-alerts/) (pipeline separado)

Los swing alerts tienen su propio tracking de win rate por patron (historicalWinRate, historicalAvgReturn). Esta informacion NO retroalimenta el scoring principal.

**Propuesta:**
Cuando un swing alert activo existe para un simbolo que tambien esta en el opportunity scan:
- Si el alert tiene `direction: 'BUY'` y `historicalWinRate > 60%`:
  - Boost al `shortTerm.midPercent` basado en `historicalAvgReturn`
  - Agregar a `catalysts[]`: "Swing alert activo con {winRate}% historico"
- Si el alert tiene `direction: 'SELL'`:
  - Agregar a `signalConflicts[]` si la oportunidad dice BUY

---

## 7. Preguntas para Optimizar el Sistema

Estas preguntas me ayudarian a afinar el sistema a tu perfil especifico:

### Gestion de Riesgo
1. **Drawdown maximo tolerable por posicion?** (-10%? -15%? -20%?) → Afecta agresividad del stop-loss en tradeLevels
2. **Concentracion maxima en un activo?** (25%? 30%? 40%?) → Para position sizing y alertas de concentracion
3. **Capital total invertido?** → Para calcular position size en pesos/dolares concretos

### Estilo de Trading
4. **Cuantas veces por dia miras el dashboard?** → Determina TTL optimo
5. **Preferis menos senales pero mas precisas, o mas senales aunque fallen mas?** (conservative vs aggressive) → Determina BUY threshold
6. **Operas antes de earnings o esperas?** → Determina si filtrar oportunidades pre-earnings
7. **Cual es tu horizonte real de holding?** (2-3 semanas? 1-2 meses? 3-6 meses?) → Ajusta pesos composite y TTLs

### Mercado Argentino
8. **Los CEDEARs los compras en pesos o dolares (cable/MEP)?** → Afecta calculo de retorno (brecha cambiaria)
9. **Operas en BYMA directamente o solo ADRs en NYSE?** → Determina si mostrar precios en ARS
10. **Contra que benchmark queres medir performance?** (SPY? ARGT? Merval?) → Para accuracy comparativo

### Modelo de IA
11. **Cuando LMStudio esta apagado, que preferis?** Solo algoritmico / no generar nada / esperar
12. **Tenes preferencia por velocidad vs calidad en el analisis?** Local rapido (Qwen 9B) vs cloud lento pero mejor (Groq 70B / DeepSeek 405B)

### Proceso
13. **Queres que el scan corra automaticamente (cron) o solo manual?** → Determina si implementar scheduling
14. **Te interesa backtesting formal?** (simular estrategia con datos historicos) → Requiere desarrollo adicional
15. **Queres alertas push (Telegram/email) cuando se detecta una oportunidad fuerte?** → Determina integracion de notificaciones

---

## 8. Tabla Priorizada de Mejoras

| ID | P | Area | Descripcion | Archivo(s) | Esfuerzo |
|----|---|------|-------------|------------|----------|
| A1 | **P0** | Prompts | Eliminar contexto geopolitico hardcodeado de ANALYST_SYSTEM_PROMPT | [prompts.ts:1-6](packages/shared/src/constants/prompts.ts) | 30min |
| A2 | **P0** | Filtros | Anti-hype RSI: cambiar 30-75 a < 85 (no filtrar oversold) | [scoring.ts](apps/backend/src/opportunities/scoring.ts) | 30min |
| A3 | **P0** | Tracking | Agregar columnas dimension scores a signal_tracking | [schema.ts:148](apps/backend/src/db/schema.ts), [signal-tracking.service.ts](apps/backend/src/opportunities/signal-tracking.service.ts) | 2h |
| A4 | **P0** | Tracking | Implementar accuracy por sector/confidence/score range | [repository.ts](apps/backend/src/db/repository.ts) | 3h |
| A5 | **P1** | Scoring | Composite weights: shortTerm 40% + mediumTerm 60% (swing) | [scoring.ts:81](apps/backend/src/opportunities/scoring.ts) | 15min |
| A6 | **P1** | Scoring | Centralizar magic numbers en scoring-weights.ts | Nuevo archivo | 2h |
| A7 | **P1** | TTL | News intelligence TTL: 15min → 60min | [news-intelligence.service.ts:21](apps/backend/src/news/news-intelligence.service.ts) | 5min |
| A8 | **P1** | TTL | Fundamental TTL adaptativo (1d pre-earnings, 7d normal) | [fundamental-analysis.service.ts](apps/backend/src/fundamental/fundamental-analysis.service.ts) | 1h |
| A9 | **P1** | Prompts | Eliminar 3 prompts muertos (NEWS_ANALYSIS, SIGNAL_GENERATION, BATCH compat) | [prompts.ts:8-14,40](packages/shared/src/constants/prompts.ts) | 15min |
| A10 | **P1** | Prompts | Portfolio dinamico en INTEGRATED_SIGNAL_PROMPT | [prompts.ts:42](packages/shared/src/constants/prompts.ts) | 1h |
| A11 | **P1** | Scoring | Usar beta para threshold SELL por divergencia (RSI 70 para high-beta) | [scoring.ts](apps/backend/src/opportunities/scoring.ts) | 1h |
| A12 | **P1** | Tokens | Reducir payload de enrichment (solo top signals + 1 headline) | [opportunities.service.ts](apps/backend/src/opportunities/opportunities.service.ts) | 1h |
| A13 | **P1** | Retornos | Calibrar return estimates vs signal_tracking historico | [scoring.ts](apps/backend/src/opportunities/scoring.ts) | 4h |
| A14 | **P1** | Acciones | Tiers de conviccion: STRONG BUY / BUY / SPECULATIVE | [scoring.ts](apps/backend/src/opportunities/scoring.ts) | 2h |
| A15 | **P1** | TTL | Persistir scans 7 dias para evolucion de scores | [opportunities.service.ts](apps/backend/src/opportunities/opportunities.service.ts) | 2h |
| A16 | **P1** | Scoring | Capear P/E total contribution a 35 puntos | [fundamental-analysis.service.ts](apps/backend/src/fundamental/fundamental-analysis.service.ts) | 30min |
| A17 | **P1** | Batch | Batch size adaptativo: 6 local / 15-20 cloud | [news-intelligence.service.ts:20](apps/backend/src/news/news-intelligence.service.ts) | 1h |
| A18 | **P2** | Conflictos | 3 patrones faltantes (weekly vs daily, earnings, sector vs individual) | [signal-conflicts.ts](apps/backend/src/opportunities/signal-conflicts.ts) | 2h |
| A19 | **P2** | Keywords | Expandir keywords sentimiento (60+ por cat, bigramas, espanol) | [news-intelligence.service.ts:24-71](apps/backend/src/news/news-intelligence.service.ts) | 1h |
| A20 | **P2** | Tracking | Tabla missed_opportunities (oportunidades perdidas) | [schema.ts](apps/backend/src/db/schema.ts) | 3h |
| A21 | **P2** | Scoring | Reducir Golden/Death Cross de ±15 a ±8, subir OBV a ±18 | [technical-analysis.service.ts](apps/backend/src/technical/technical-analysis.service.ts) | 30min |
| A22 | **P2** | Swing | Integrar swing alerts win rate al opportunity scoring | [swing-alerts](apps/backend/src/swing-alerts/), [scoring.ts](apps/backend/src/opportunities/scoring.ts) | 4h |
| A23 | **P2** | Acciones | Condiciones de upgrade automaticas para HOLD/WATCH | [scoring.ts](apps/backend/src/opportunities/scoring.ts) | 3h |

**Esfuerzo total estimado:**
- P0 (hacer ya): ~6 horas
- P1 (prioridad alta): ~16 horas
- P2 (mejoras): ~14 horas

---

## Apendice: Archivos Clave

| Archivo | Responsabilidad | Secciones que lo referencian |
|---------|----------------|------------------------------|
| [prompts.ts](packages/shared/src/constants/prompts.ts) | Todos los prompts LLM | 2.1, 2.2, 2.3, 2.5 |
| [scoring.ts](apps/backend/src/opportunities/scoring.ts) | Score compuesto, anti-hype, smartAction, return estimates, trade levels | 1.4, 1.5, 3.1, 4.1, 4.2, 4.3 |
| [news-intelligence.service.ts](apps/backend/src/news/news-intelligence.service.ts) | TTL, batch size, keywords, pipeline LLM noticias | 1.1, 5.1 |
| [technical-analysis.service.ts](apps/backend/src/technical/technical-analysis.service.ts) | Indicadores + divergencias + scoring tecnico | 1.2 |
| [fundamental-analysis.service.ts](apps/backend/src/fundamental/fundamental-analysis.service.ts) | Fundamentales + scoring fundamental | 1.3 |
| [signal-tracking.service.ts](apps/backend/src/opportunities/signal-tracking.service.ts) | Recording + resolving signals | 6.1, 6.2 |
| [repository.ts](apps/backend/src/db/repository.ts) | Queries DB, accuracy stats | 6.3 |
| [schema.ts](apps/backend/src/db/schema.ts) | Esquema SQLite completo | 6.2, 6.4 |
| [signal-conflicts.ts](apps/backend/src/opportunities/signal-conflicts.ts) | 6 patrones de conflicto | 3.3 |
| [opportunities.service.ts](apps/backend/src/opportunities/opportunities.service.ts) | Pipeline scan completo, enrichment | 2.4, 5.1 |
| [scoring-weights.ts](packages/shared/src/constants/scoring-weights.ts) | (NUEVO) Magic numbers centralizados | 1.2 |
