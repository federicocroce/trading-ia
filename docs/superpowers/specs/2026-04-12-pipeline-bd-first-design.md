# Pipeline BD-First: Reporte de Mercado con Dependencia Explícita

**Fecha:** 2026-04-12  
**Estado:** Aprobado  
**Scope:** Backend pipeline orchestration + refactor market-report service + frontend Pipeline History Modal

---

## Problema

El botón "Generar Reporte" ignora todo el trabajo previo de "Actualizar" y "Analizar". Re-fetchea NewsAPI, Yahoo Finance y Groq desde cero cada vez (~3 min). Los 3 procesos son pipelines independientes sin estado compartido. Si algo falla, el usuario no sabe qué ni puede re-correrlo. 17 listas hardcodeadas (símbolos, sectores, temas, keywords) hacen que el reporte no refleje el portfolio real.

---

## Solución

Encadenar los 3 procesos en un pipeline orquestado con estado granular. El reporte lee de la BD en vez de APIs externas. Todo lo hardcodeado pasa a tablas de configuración. El usuario puede ver el historial completo de ejecuciones y re-correr cualquier stage fallido.

---

## Sección 1: Pipeline Encadenado con Estado Granular

### Flujo al presionar "Generar Reporte"

```
Usuario presiona "Generar Reporte"
         ↓
Backend: pipeline.service.ts → checkOrRunPipeline()
         ↓
┌─────────────────────────────────────────────────────┐
│ Stage 1: NEWS                                       │
│ ¿newsArticles de hoy con status='ok'|'partial'?    │
│   SÍ → skip   NO o 'failed' → ejecutar Actualizar  │
└─────────────────────────────────────────────────────┘
         ↓
┌─────────────────────────────────────────────────────┐
│ Stage 2: ANALYSIS                                   │
│ ¿opportunityScan de hoy con status='ok'|'partial'? │
│   SÍ → skip   NO o 'failed' → ejecutar Analizar    │
└─────────────────────────────────────────────────────┘
         ↓
┌─────────────────────────────────────────────────────┐
│ Stage 3: REPORT                                     │
│ ¿marketReport de hoy con status='ok'?              │
│   SÍ → devolver cached + botón forzar regeneración │
│   NO o 'failed'|'partial' → generar               │
└─────────────────────────────────────────────────────┘
         ↓
Persistir en marketReports + actualizar pipelineRuns
```

### Definición de "fresco y válido"

Un stage se considera válido para skipear si:
- Corrió **hoy** (mismo día calendario)
- `status === 'ok'` O `status === 'partial'` con errores no críticos
- Si `status === 'failed'` → se re-ejecuta aunque sea de hoy

### Estado del Pipeline

```typescript
type StageStatus = 'pending' | 'running' | 'ok' | 'partial' | 'failed' | 'skipped'

type StageResult = {
  status: StageStatus
  startedAt: number | null
  finishedAt: number | null
  detail: string           // "47 artículos. NewsAPI: OK. RSS: FALLÓ (timeout)."
  errors: string[]         // errores individuales no críticos
  criticalError?: string   // error que causó el fallo del stage
}

type PipelineRun = {
  id: number
  date: string             // 'YYYY-MM-DD'
  status: 'running' | 'ok' | 'partial' | 'failed'
  stages: {
    news: StageResult
    analysis: StageResult
    report: StageResult
  }
  startedAt: number
  finishedAt: number | null
}
```

### Polling de progreso

`trpc.intelligence.pipelineStatus` → query que devuelve el `PipelineRun` activo o el último del día. Frontend hace polling cada 2s mientras `status === 'running'`.

---

## Sección 2: Refactor del Servicio (BD-First)

### Flujo nuevo de generateMarketReport

**Antes:**
```
NewsAPI (10 queries hardcodeadas) → Groq temas → Yahoo Finance todos → Groq analiza → Groq consolida
```

**Después:**
```
BD: newsArticles de hoy (filtrados por sentimiento/impacto)
BD: sectorImpacts de hoy
BD: opportunitySnapshots de hoy (scores + reasoning ya calculados)
         ↓
Groq identifica temas activos (datos reales, sin NewsAPI)
         ↓
BD: fundamentalCache por ticker → fallback Yahoo Finance solo si expirado
         ↓
Groq analiza por tema (usa opportunitySnapshots como base, no desde cero)
         ↓
Groq consolida (portfolio real de BD, sin hardcoding)
         ↓
Persistir en marketReports
```

### Fuentes eliminadas como primarias

| Antes (primaria) | Después (fuente) |
|---|---|
| NewsAPI 10 queries hardcodeadas | `newsArticles` filtrados por fecha/sentimiento/impacto |
| CEDEAR list hardcodeada en prompt | `SELECT * FROM symbols WHERE type='cedear'` |
| Yahoo Finance quotes siempre | `fundamentalCache` (7-day TTL), Yahoo solo si expirado |
| Yahoo Finance fundamentals siempre | Mismo `fundamentalCache` |
| Groq recalcula scores desde cero | `opportunitySnapshots` ya tienen score + reasoning |
| Sectores hardcodeados en prompt | `sectorImpacts` + `market_themes` de BD |

### Hardcoding eliminado (17 ocurrencias)

| Archivo | Líneas | Hardcoding | Reemplazo |
|---|---|---|---|
| market-report.service.ts | 20-31 | 10 thematic queries | tabla `market_themes` |
| market-report.service.ts | 125 | Lista CEDEAR (25+ símbolos) | `symbols WHERE type='cedear'` |
| newsapi.adapter.ts | 28-33 | Financial keywords (11) | tabla `news_search_keywords` |
| newsapi.adapter.ts | 50-54 | Crypto aliases | columna `aliases` en `symbols` |
| rss.adapter.ts | 6-11 | 4 RSS feeds hardcodeados | tabla `news_sources` |
| rss.adapter.ts | 53-54 | Crypto aliases (dup) | columna `aliases` en `symbols` |
| news-aggregator.service.ts | 65-70 | Sector mapping dict | query `symbols.sector` |
| news-aggregator.service.ts | 71 | Argentina tickers (7) | `symbols WHERE market='argentina'` |
| news-intelligence.service.ts | 30-47 | 40+ positive keywords | tabla `sentiment_keywords` |
| news-intelligence.service.ts | 49-66 | 45+ negative keywords | tabla `sentiment_keywords` |
| news-intelligence.service.ts | 68-75 | 30+ high impact keywords | tabla `sentiment_keywords` |
| sector-report.service.ts | 67-75 | Sector→tickers (8 sectores) | tabla `sector_tickers` |
| discovery-registry.ts | 187-189 | Sector classifications (5) | tabla `sector_mappings` |
| asset-classifier.ts | 158-161 | Exchange code mappings (10) | tabla `exchange_mappings` |
| scoring.ts | 544-552 | Sector-plaza mapping | query `symbols.plaza` |
| seed.ts | 4-16 | Seed symbols hardcodeados | migración SQL |
| seed.ts | 18-28 | Seed positions hardcodeados | migración SQL |

### Nuevas tablas de BD

```sql
-- Temas de mercado (reemplaza THEMATIC_QUERIES hardcodeadas)
market_themes (
  id, name, queryKeywords, active, createdAt
)

-- Fuentes de noticias configurables (reemplaza RSS feeds hardcodeados)
news_sources (
  id, name, type -- 'rss'|'newsapi'|'finnhub', url, active, priority
)

-- Keywords para búsqueda en NewsAPI (reemplaza FINANCIAL_KEYWORDS)
news_search_keywords (
  id, keyword, category, priority, active
)

-- Keywords para análisis de sentimiento (reemplaza arrays de 100+ keywords)
sentiment_keywords (
  id, keyword, language -- 'en'|'es', sentiment -- 'positive'|'negative',
  impactLevel -- 'high'|'medium'|null, weight, active
)

-- Tickers sugeridos por sector (reemplaza sector→tickers hardcodeados)
sector_tickers (
  id, sector, ticker, weight, relevance, updatedAt
)

-- Persistencia de reportes de mercado generados
market_reports (
  id, generatedAt, status -- 'ok'|'partial'|'failed',
  macroContext, portfolioImpact, themes JSON,
  topRecommendations JSON, alternatives JSON,
  scenarios JSON, avoidList JSON,
  engine, errors JSON
)

-- Historial de ejecuciones del pipeline
pipeline_runs (
  id, date, status -- 'running'|'ok'|'partial'|'failed',
  newsStatus, newsDetail, newsErrors JSON, newsStartedAt, newsFinishedAt,
  analysisStatus, analysisDetail, analysisErrors JSON, analysisStartedAt, analysisFinishedAt,
  reportStatus, reportDetail, reportErrors JSON, reportStartedAt, reportFinishedAt,
  startedAt, finishedAt
)
```

### Nuevos archivos backend

```
apps/backend/src/intelligence/
  pipeline.service.ts        ← orquesta los 3 stages, escribe pipelineRuns
  pipeline.repository.ts     ← CRUD para pipeline_runs y market_reports
apps/backend/src/db/
  seed-config.ts             ← seed de market_themes, sentiment_keywords, news_sources, sector_tickers
```

---

## Sección 3: Frontend

### Nuevos componentes

```
apps/frontend/src/pipeline/
  PipelineStatusButton.tsx   ← botón en header con color según estado del día
  PipelineHistoryModal.tsx   ← modal con historial completo y re-run por stage
  PipelineStatusToast.tsx    ← toast flotante durante ejecución activa
  usePipeline.ts             ← hook central: polling + mutations + estado
```

### PipelineStatusButton (header)

```
🟢 Pipeline   ← todo OK hoy
🟡 Pipeline   ← partial o con warnings
🔴 Pipeline   ← algún stage falló
⚪ Pipeline   ← no corrió hoy
```

Click → abre `PipelineHistoryModal`.

### PipelineHistoryModal

```
┌─────────────────────────────────────────────────────┐
│  Historial del Pipeline                        [X]  │
├─────────────────────────────────────────────────────┤
│  Hoy 12/04 — ⚠️ Parcial          [Re-correr todo]  │
│  ├─ ✅ Noticias    09:14  47 arts  NewsAPI+Finnhub  │
│  │                              RSS falló (timeout) │
│  ├─ ✅ Análisis    09:16  143 símbolos              │
│  └─ ⚠️ Reporte    09:18  4/6 temas  Groq timeout   │
│                                    [Re-correr ▶]    │
├─────────────────────────────────────────────────────┤
│  Ayer 11/04 — ✅ Completo                           │
│  ├─ ✅ Noticias    08:52  61 arts                   │
│  ├─ ✅ Análisis    08:54  150 símbolos              │
│  └─ ✅ Reporte     08:57  6/6 temas                 │
├─────────────────────────────────────────────────────┤
│  10/04 — ❌ Fallido                                 │
│  ├─ ❌ Noticias    07:30  NewsAPI rate limit        │
│  │                        [Re-correr ▶]             │
│  ├─ ⏭️ Análisis   —      Saltado (noticias falló)  │
│  └─ ⏭️ Reporte    —      Saltado                   │
└─────────────────────────────────────────────────────┘
```

- Cada stage fallido/partial tiene botón "Re-correr ▶" individual
- Re-correr `news` invalida automáticamente `analysis` y `report` del mismo día
- Re-correr `analysis` invalida `report` del mismo día
- Re-correr `report` no toca los otros stages

### PipelineStatusToast (durante ejecución)

Flotante, no bloquea UI. Polling cada 2s:

```
┌─────────────────────────────────────┐
│ 🔄 Ejecutando pipeline...           │
│ ✅ Noticias completado (47 arts)    │
│ ⏳ Análisis en curso...             │
│ ○  Reporte pendiente                │
└─────────────────────────────────────┘
```

### usePipeline hook

```typescript
const {
  run,          // () => void — dispara pipeline completo
  rerunStage,   // (stage: 'news'|'analysis'|'report') => void
  status,       // PipelineStatus actual
  history,      // PipelineRun[] — todos los históricos
  isRunning,    // boolean
  todayRun,     // PipelineRun | null
} = usePipeline()
```

El botón "Generar Reporte" existente en `MarketReportView` llama a `run()`.

---

## Sección 4: Manejo de Errores y Casos Edge

### Clasificación de errores por criticidad

| Error | Criticidad | Comportamiento |
|---|---|---|
| NewsAPI rate limit (100/día) | No crítico | Continúa con noticias de BD solamente |
| RSS feed timeout | No crítico | Continúa con otras fuentes |
| 0 artículos obtenidos | Crítico | Stage `news` = `failed`, bloquea siguientes |
| Yahoo Finance falla 1-3 tickers | No crítico | Continúa, registra tickers fallidos |
| Yahoo Finance falla todo | Crítico | Usa fundamentalCache aunque esté expirado |
| Groq timeout en pasada intermedia | No crítico | Reintenta 1 vez, si falla marca `partial` |
| Groq timeout en pasada final | Crítico | Stage `report` = `failed` |
| BD no disponible | Crítico | Pipeline entero = `failed` |

### Run huérfano

Al iniciar el backend → buscar `pipeline_runs` con `status='running'` de más de 15 min → marcar `failed` con error `"Proceso interrumpido (reinicio del servidor)"`.

### Primer uso / BD vacía

Si no hay `newsArticles` de hoy ni historial suficiente:
- Pipeline fuerza ejecución completa desde APIs externas
- No saltea ningún paso aunque sea "hoy"
- Modal muestra: `"Primera ejecución del día — obteniendo datos desde fuentes externas"`

### Concurrencia

Si el usuario dispara el pipeline mientras ya hay uno corriendo:
- Backend devuelve el `pipelineRun` activo en lugar de crear uno nuevo
- Frontend muestra el toast del run existente

### Re-run parcial — invalidación en cadena

```
Re-run news     → invalida analysis + report del mismo día → re-ejecuta ambos
Re-run analysis → invalida report del mismo día → re-ejecuta report
Re-run report   → solo regenera report, nada más
```

---

## Archivos Afectados (resumen)

### Backend — modificar
- `apps/backend/src/intelligence/market-report.service.ts` — refactor BD-first
- `apps/backend/src/intelligence/intelligence.router.ts` — nuevos endpoints
- `apps/backend/src/news/sources/newsapi.adapter.ts` — leer keywords de BD
- `apps/backend/src/news/sources/rss.adapter.ts` — leer feeds de BD
- `apps/backend/src/news/news-aggregator.service.ts` — leer sectores/aliases de BD
- `apps/backend/src/news/news-intelligence.service.ts` — leer sentiment keywords de BD
- `apps/backend/src/intelligence/sector-report.service.ts` — leer sector_tickers de BD
- `apps/backend/src/discovery/discovery-registry.ts` — leer sector_mappings de BD
- `apps/backend/src/discovery/asset-classifier.ts` — leer exchange_mappings de BD
- `apps/backend/src/opportunities/scoring.ts` — leer plaza de BD
- `apps/backend/src/db/schema.ts` — 7 tablas nuevas
- `apps/backend/src/db/seed.ts` — mover a seed-config.ts

### Backend — crear
- `apps/backend/src/intelligence/pipeline.service.ts`
- `apps/backend/src/intelligence/pipeline.repository.ts`
- `apps/backend/src/db/seed-config.ts`
- `apps/backend/src/db/migrations/` — migraciones Drizzle para tablas nuevas

### Nota de migración
La tabla `opportunityScans` existente necesita columna `status` ('ok'|'partial'|'failed') para que el pipeline pueda evaluar si el análisis del día es válido. Agregar en la misma migración que las tablas nuevas.

### Frontend — crear
- `apps/frontend/src/pipeline/PipelineStatusButton.tsx`
- `apps/frontend/src/pipeline/PipelineHistoryModal.tsx`
- `apps/frontend/src/pipeline/PipelineStatusToast.tsx`
- `apps/frontend/src/pipeline/usePipeline.ts`

### Frontend — modificar
- `apps/frontend/src/daily/MarketReportView.tsx` — usar `usePipeline().run()`
- Header component — agregar `PipelineStatusButton`
