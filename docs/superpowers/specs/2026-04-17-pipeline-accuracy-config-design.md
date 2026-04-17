# Pipeline Intelligence — Accuracy, Config en DB & Persistencia Completa

**Fecha**: 2026-04-17  
**Scope**: Refactor del pipeline de análisis en 3 fases  
**Prioridad**: Crítica — base para mejora continua del sistema

---

## Contexto

El pipeline actual es un sistema de 5 stages (WebSearch → News → Fundamentals → Opportunities → Market Report) con análisis multi-dimensional (técnico + fundamental + sentimiento + LLM enrichment). Funciona bien pero tiene 3 problemas críticos:

1. **Símbolos y queries hardcodeados en código** — watchlist, discovery queries, thematic queries no son editables sin deploy
2. **Persistencia incompleta** — análisis intermedios se pierden entre runs, no hay audit trail completo
3. **Accuracy tracking existe en DB pero sin visibilidad ni feedback loop** — `signalTracking` + `resolveExpiredSignals()` existen pero no hay UI, no se trackean HOLD ni se mide entry/target/stop accuracy

---

## Fase 1: Config en DB + Persistencia Completa

### 1.1 Tablas de configuración de usuario

**`watchlistSymbols`**
```
id, symbol, name, sector, active (bool), addedAt, notes
```
Migrar los símbolos hardcodeados del portfolio/watchlist a esta tabla. La tabla ya existe como `symbols` — extender o crear nueva específica para watchlist con campo `active`.

**`discoveryQueries`**
```
id, query, lang (en|es), active (bool), priority (int), category (string), createdAt
```
Las 7 queries hardcodeadas en `web-search.service.ts` → DB. Pipeline las lee al inicio de stage 1. Si tabla vacía → seed con defaults.

**`thematicQueries`**
```
id, name, keywords (JSON array), active (bool), priority (int), createdAt
```
Los 10 THEMATIC_QUERIES hardcodeados en `market-report.service.ts` → DB. Pipeline los lee al inicio de stage 5. Si tabla vacía → seed con defaults.

### 1.2 Migración de hardcoded

- `web-search.service.ts`: eliminar `DISCOVERY_QUERIES` constante, leer desde DB al start del pipeline
- `market-report.service.ts`: eliminar `THEMATIC_QUERIES` constante, leer desde DB
- `pipeline.service.ts`: seed automático en primer run (insert if empty)
- Fallback: si DB falla al leer config → usar defaults en memoria (nunca crashear por config)

### 1.3 Audit trail completo del pipeline

**`pipelineStageArtifacts`** (nueva tabla)
```
id, pipelineRunId (FK), stage (enum: webSearch|news|fundamentals|opportunities|report|digest),
inputSnapshot (JSON), outputSnapshot (JSON),
tokensUsed (int), modelUsed (string), durationMs (int),
symbolsProcessed (JSON array), errorCount (int), createdAt
```

Cada stage del pipeline guarda su input principal y output completo. Permite:
- Replay de cualquier run histórico
- Debug de por qué un símbolo fue incluido/excluido
- Comparar outputs entre runs del mismo día

**`unifiedAnalysisBatches`** (nueva tabla)
```
id, pipelineRunId (FK), batchIndex (int), assetsInput (JSON), 
promptUsed (text), modelUsed (string), rawResponse (text),
tokensInput (int), tokensOutput (int), durationMs (int),
parsedOk (bool), errorMsg (string), createdAt
```

Cada llamada LLM del unified analysis queda registrada con su prompt exacto y respuesta raw.

**`newsArticles`**: agregar columna `pipelineRunId` (nullable FK) — linkear noticias al run que las procesó.

**`opportunitySnapshots`**: ya tiene `scanId` → agregar `pipelineRunId` directamente para joins directos.

### 1.4 API tRPC nuevos

```typescript
// Config management
userConfig.getDiscoveryQueries()
userConfig.updateDiscoveryQuery(id, data)
userConfig.toggleDiscoveryQuery(id, active)
userConfig.addDiscoveryQuery(data)

userConfig.getThematicQueries()
userConfig.updateThematicQuery(id, data)
userConfig.toggleThematicQuery(id, active)

userConfig.getWatchlist()
userConfig.toggleWatchlistSymbol(id, active)
userConfig.addWatchlistSymbol(data)
```

### 1.5 Frontend — Settings tab

Nueva sección en Settings (o tab separado "Configuración"):
- **Queries de discovery**: lista editable de web search queries con toggle on/off
- **Temas de análisis**: lista editable de thematic queries con keywords
- **Watchlist**: gestión de símbolos (hoy ya existe PositionDialog — esto es para símbolos monitoreados sin posición abierta)

---

## Fase 2: Accuracy Dashboard

### 2.1 Scope de tracking

**Qué se trackea** (señales registradas en `signalTracking`):

| Origen | Condición para trackear |
|--------|------------------------|
| Portfolio con BUY/SELL | Siempre |
| Portfolio con HOLD | Siempre (nuevo — hoy no se trackea) |
| Símbolo relevante del análisis diario con BUY/SELL | Si confidence > 0 y currentPrice > 0 |
| Símbolo relevante con WATCH (timing now/soon) | Si tiene ≥2 triggers |
| Watchlist general sin señal ese día | **NO** |

**Qué NO se trackea**: símbolos del watchlist que el análisis diario no mencionó.

### 2.2 Métricas de accuracy

**Win/Loss por señal**:
- BUY: win si `returnAfter7d > 0` o `returnAfter30d > target * 0.8`
- SELL: win si `returnAfter7d < 0` (precio bajó como se esperaba)
- HOLD portfolio: win si `returnAfter30d > -5%`, loss si `< -10%`, neutral en el medio
- Neutral: movimiento < 2% en 7d

**Entry accuracy** (nuevo campo en `signalTracking`):
```
entryHit (bool)         — si el precio llegó al nivel de entrada propuesto
entryDeviation (float)  — % diferencia entre entrada propuesta y precio real al día siguiente
entryHitAt (date)       — cuándo se alcanzó el nivel (null si nunca)
```

**Target accuracy** (nuevo campo en `signalTracking`):
```
targetHit (bool)        — si el precio alcanzó el target
targetDeviation (float) — % diferencia entre target propuesto y máximo en el período
targetHitAt (date)      — cuándo se alcanzó (null si nunca en el período)
```

**Stop accuracy** (nuevo campo en `signalTracking`):
```
stopTriggered (bool)     — si el stop loss fue tocado
stopDeviation (float)    — % diferencia entre stop propuesto y mínimo en el período
stopTriggeredAt (date)   — cuándo (null si nunca)
```

### 2.3 Resolución ampliada

`resolveExpiredSignals()` se extiende para calcular los campos nuevos:
- A los 7d: evaluar entry hit, calcular entryDeviation
- A los 30d: evaluar target hit, stop triggered, calcular deviations
- Para HOLD portfolio: calcular win/loss basado en retorno 30d con thresholds -5%/-10%

### 2.4 Endpoint tRPC

```typescript
intelligence.getAccuracyReport(params: {
  days: 30 | 60 | 90 | 180,
  symbolFilter?: 'portfolio' | 'all'
}): AccuracyReport
```

`AccuracyReport` incluye:
```typescript
{
  summary: {
    totalSignals: number,
    resolvedSignals: number,
    winRate: number,           // % global
    avgPredictedReturn: number,
    avgActualReturn: number,
    predictionBias: number,    // optimista (+) o pesimista (-)
    mae: number                // Mean Absolute Error predicción
  },
  byAction: Record<'BUY'|'SELL'|'HOLD'|'WATCH', ActionStats>,
  bySector: Record<string, SectorStats>,
  byModel: Record<string, ModelStats>,
  byConfidenceTier: {
    '40-55': TierStats,
    '55-70': TierStats,
    '70-85': TierStats,
    '85+': TierStats
  },
  entryAccuracy: {
    avgDeviation: number,
    hitRate: number,
    avgDaysToHit: number
  },
  targetAccuracy: {
    avgDeviation: number,
    hitRate: number,
    avgDaysToHit: number
  },
  stopAccuracy: {
    triggerRate: number,
    avgDeviation: number
  },
  trend: {
    rolling30d: number,
    rolling60d: number,
    rolling90d: number
  },
  missedOpportunities: {
    total: number,
    avgMissedReturn: number,
    topMissed: MissedOpp[]
  }
}
```

### 2.5 Frontend — Tab "Accuracy"

Nueva tab en la app con secciones:

**Resumen global**: win rate, MAE, sesgo de predicción (optimista/pesimista), señales resueltas

**Por acción**: tabla BUY/SELL/HOLD/WATCH — win rate, avg return, count

**Entry/Target/Stop**: 
- Entry hit rate + avg deviation
- Target hit rate + avg días para hit
- Stop trigger rate + avg deviation (¿cuán ajustado estaba el stop?)

**Por sector**: top 5 mejores + top 5 peores sectores por win rate

**Por modelo AI**: comparativa DeepSeek R1 vs otros

**Por confidence tier**: ¿las señales de 85%+ realmente ganan más?

**Tendencia**: win rate rolling 30/60/90d — ¿el sistema mejora?

**Missed opportunities**: listado de WATCH/HOLD que se escaparon con retorno real

---

## Fase 3: Ajuste Semi-automático de Pesos

### 3.1 Cuándo se genera propuesta

Post-pipeline, después de `resolveExpiredSignals()`:
- Si hay ≥20 señales resueltas desde la última propuesta aprobada
- Y al menos 10 BUY + 5 SELL (balance mínimo para correlaciones válidas)
- → auto-genera `scoringWeightProposal` con status `pending`
- → badge en UI "Nueva sugerencia disponible"

### 3.2 Lógica de correlación

```
Para SHORT_TERM (señales con horizon < 4 semanas):
  techCorr = pearson(techScore[], winOutcome[])
  fundCorr = pearson(fundScore[], winOutcome[])
  sentCorr = pearson(sentScore[], winOutcome[])
  
  // Normalizar a 100% respetando que cada peso ≥ 10%
  raw = [max(techCorr, 0), max(fundCorr, 0), max(sentCorr, 0)]
  total = sum(raw)
  proposed = raw.map(v => max(v/total, 0.10))  // min 10% cada dimensión
  // re-normalizar al 100%

Para MEDIUM_TERM: mismo proceso con señales de horizon ≥ 4 semanas
```

Si alguna correlación es negativa → esa dimensión queda en el mínimo (10%).

### 3.3 Tablas

**`scoringWeightProposals`**
```
id, proposedAt, signalCount, shortTermBasis (int), mediumTermBasis (int),
currentWeights (JSON: {shortTerm: {tech,fund,sent}, mediumTerm: {tech,fund,sent}}),
proposedWeights (JSON: same structure),
correlations (JSON: {shortTerm: {tech,fund,sent}, mediumTerm: {tech,fund,sent}}),
status (pending|approved|rejected),
approvedAt (nullable), appliedAt (nullable), rejectedReason (nullable)
```

**`scoringWeightHistory`**
```
id, appliedAt, weights (JSON), source (manual|auto-proposal), proposalId (FK nullable),
accuracyBefore (float), accuracyAfter (float, nullable — se calcula 30d después)
```

### 3.4 Pipeline integración

`scoring.ts` lee los pesos vigentes desde DB en lugar de constantes. Al iniciar el backend → cargar pesos activos en memoria (cache, refresh cada 24h o al aplicar propuesta).

Si no hay pesos en DB → usar defaults hardcodeados como fallback (nunca crashear).

### 3.5 API tRPC

```typescript
intelligence.getWeightProposal()           // última propuesta pending
intelligence.approveWeightProposal(id)     // aplica los pesos
intelligence.rejectWeightProposal(id, reason)
intelligence.getWeightHistory()            // historial de cambios
intelligence.getCurrentWeights()           // pesos activos ahora
```

### 3.6 Frontend — Sección "Optimización de Pesos"

En la tab "Accuracy", sección inferior:

- Pesos actuales vs propuestos — barras visuales side-by-side por dimensión
- Base estadística: "calculado sobre 47 señales (32 BUY, 15 SELL)"
- Correlaciones raw: "Technical 0.68 | Fundamental 0.41 | Sentiment 0.29"
- Impacto esperado si se aplican (proyección basada en historial)
- Botones: "Aplicar pesos" / "Rechazar"
- Historial de cambios anteriores con accuracy antes/después

---

## Dependencias entre fases

```
Fase 1 (Config en DB + Persistencia)
    ↓ desbloquea
Fase 2 (Accuracy Dashboard)
    ↓ desbloquea  
Fase 3 (Weight Adjustment)
```

Fase 2 puede empezar con datos existentes en `signalTracking` (parciales). Fase 3 requiere suficientes señales resueltas (≥20) — probablemente disponible 30+ días después de implementar Fase 1.

---

## Archivos clave a modificar

| Archivo | Cambio |
|---------|--------|
| `apps/backend/src/db/schema.ts` | Nuevas tablas: discoveryQueries, thematicQueries, pipelineStageArtifacts, unifiedAnalysisBatches, scoringWeightProposals, scoringWeightHistory. Nuevos campos en signalTracking |
| `apps/backend/src/intelligence/pipeline.service.ts` | Leer config desde DB, seed defaults, guardar artifacts por stage |
| `apps/backend/src/intelligence/market-report.service.ts` | Eliminar THEMATIC_QUERIES hardcoded, leer desde DB |
| `apps/backend/src/web-search/web-search.service.ts` | Eliminar DISCOVERY_QUERIES hardcoded, leer desde DB |
| `apps/backend/src/intelligence/unified-analysis.service.ts` | Guardar batches en unifiedAnalysisBatches |
| `apps/backend/src/opportunities/scoring.ts` | Leer pesos desde DB con fallback a defaults |
| `apps/backend/src/opportunities/signal-tracking.service.ts` | HOLD portfolio tracking, entry/target/stop accuracy fields, resolución ampliada |
| `apps/backend/src/intelligence/pipeline.repository.ts` | CRUD para nuevas tablas de config y artifacts |
| `packages/shared/src/types/` | Tipos para AccuracyReport, WeightProposal, ConfigQuery |
| `apps/frontend/src/` | Tab "Accuracy", sección settings queries, UI weight proposals |

---

## Consideraciones de performance

- `pipelineStageArtifacts.inputSnapshot/outputSnapshot`: comprimir con JSON.stringify, considerar truncar si > 100KB (guardar summary en lugar de full dump para stages con mucha data)
- `unifiedAnalysisBatches.rawResponse`: guardar siempre (útil para debug de parsing failures)
- Accuracy queries: índices en `signalTracking(signalDate, outcome, action, sector)`
- Weight loading: cache en memoria en `scoring.ts`, no query en cada cálculo

---

## Out of scope (esta iteración)

- Backtesting histórico completo (replay de decisiones pasadas con nuevos pesos)
- Alertas automáticas cuando accuracy cae bajo umbral
- Auto-aplicación de pesos sin aprobación
- Export CSV de señales para análisis externo
