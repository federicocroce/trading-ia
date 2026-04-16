# Web Search — Design Spec
**Date:** 2026-04-16  
**Status:** Approved

## Objetivo

Agregar web search como fuente primaria de noticias en el pipeline de análisis, dando al sistema datos frescos y reales antes de generar señales de trading. Dos capas: búsquedas profundas por símbolo del portfolio, y búsquedas de discovery para encontrar oportunidades nuevas.

---

## Arquitectura y flujo

**Nuevo orden del pipeline:**
```
web-search → news → fundamentals → analysis → report
```

La stage `web-search` corre primero. Guarda artículos en la tabla `web_search_articles`. La stage `news` existente los levanta junto con Yahoo/Finnhub/RSS/NewsAPI — sin cambios al flujo de análisis downstream.

**Si `web-search` falla: el pipeline se pausa** en estado `waiting_user`. El frontend muestra un modal bloqueante con 3 opciones: Reintentar, Continuar sin web search, Cancelar.

---

## Dos capas de búsqueda

### Capa 1 — Portfolio (crítica)
- Lee posiciones activas con `getPortfolioPositions()` — dinámico, nunca hardcodeado
- Una búsqueda por símbolo en paralelo (`Promise.all`)
- Query: `"{SYMBOL} {nombre} stock news analysis today"`
- Resultados guardados con `layer = 'portfolio'`, `symbol = {SYMBOL}`

### Capa 2 — Discovery
- 5 queries amplias en secuencia (respeta rate limits):
  1. `"best stock market opportunities today"`
  2. `"Argentina stocks breaking news today"`
  3. `"crypto bitcoin opportunities this week"`
  4. `"AI semiconductors stocks news today"`
  5. `"oil energy stocks opportunities today"`
- Resultados guardados con `layer = 'discovery'`, `symbol = null`
- Regex sobre el contenido extrae candidatos a ticker (1-5 letras mayúsculas) → `validateTickers()` → `registerNovelTickers()` → amplía el universo

**Total búsquedas por run:** ~13 (7 portfolio + 5-6 discovery)  
**Estimado mensual:** ~780/mes con 2 runs/día → dentro del free tier de Tavily (1000/mes)

---

## Proveedores

**Principal: Tavily**
```
POST https://api.tavily.com/search
{ query, search_depth: "advanced", max_results: 5, include_raw_content: false }
```

**Fallback: Brave Search**
```
GET https://api.search.brave.com/res/v1/news/search?q={query}&count=5
```

Ambos devuelven la misma interfaz normalizada `WebSearchResult[]`. El servicio no necesita saber cuál proveedor respondió.

**Variables de entorno nuevas:**
```
TAVILY_API_KEY=        # requerida
BRAVE_API_KEY=         # opcional, solo fallback
```

---

## Lógica de fallo

- Si **alguna búsqueda de portfolio** falla individualmente → `StageResult: partial` con errores listados. Pipeline continúa.
- Si **todas las búsquedas fallan** (Tavily + Brave down) → lanza error → pipeline pausa en `waiting_user`.
- Si **discovery falla** pero portfolio OK → `partial`. Discovery no es bloqueante por sí sola.

---

## Cambios en DB

### Tabla nueva: `web_search_articles`
```
id            INTEGER PK autoincrement
date          TEXT NOT NULL              -- 'YYYY-MM-DD', coincide con pipeline_runs.date
symbol        TEXT NULL                  -- poblado en portfolio, null en discovery
query         TEXT NOT NULL              -- query que generó este resultado
layer         TEXT ('portfolio'|'discovery') NOT NULL
title         TEXT NOT NULL
url           TEXT NOT NULL
content       TEXT NOT NULL
publishedAt   TEXT NULL
relatedSymbols TEXT NOT NULL DEFAULT '[]'  -- JSON array de tickers extraídos
createdAt     TEXT NOT NULL DEFAULT datetime('now')
```

### Tabla `pipeline_runs` — columnas nuevas
```
webSearchStatus      TEXT ('pending'|'running'|'ok'|'partial'|'failed'|'skipped'|'waiting_user')
webSearchDetail      TEXT
webSearchErrors      TEXT  -- JSON array
webSearchStartedAt   TEXT
webSearchFinishedAt  TEXT
```

### `pipeline_runs.status` — nuevos valores
```
'waiting_user'   -- pipeline pausado esperando decisión del usuario
'cancelled'      -- usuario canceló el pipeline
```

---

## Cambios en tipos compartidos (`@trading/shared`)

```ts
// PipelineRun.stages agrega:
stages: {
  webSearch: StageResult   // nueva, primera stage
  news: StageResult
  fundamentals: StageResult
  analysis: StageResult
  report: StageResult
}

// PipelineRun.status agrega:
status: 'running' | 'ok' | 'partial' | 'failed' | 'waiting_user' | 'cancelled'
```

---

## Archivos nuevos

```
apps/backend/src/web-search/
  tavily.ts                 — cliente Tavily API
  brave.ts                  — cliente Brave Search (fallback)
  web-search.service.ts     — lógica principal (portfolio + discovery)
```

---

## Archivos modificados

| Archivo | Cambio |
|---|---|
| `apps/backend/src/db/schema.ts` | Nueva tabla `webSearchArticles` + columnas en `pipelineRuns` |
| `apps/backend/src/db/repository.ts` | CRUD para `web_search_articles` |
| `apps/backend/src/intelligence/pipeline.service.ts` | `runWebSearchStage()` como primera stage + lógica `waiting_user` |
| `apps/backend/src/intelligence/pipeline.repository.ts` | Soporte para stage `webSearch` + nuevos status |
| `apps/backend/src/intelligence/intelligence.router.ts` | Nuevo endpoint `resolveWebSearch` + extender `rerunStage` para incluir `'webSearch'` |
| `apps/backend/src/news/news-aggregator.service.ts` | Lee `web_search_articles` donde `date = run.date` y los incluye antes del dedup |
| `packages/shared/src/types/` | `PipelineRun` con `webSearch` stage + nuevos status |
| `.env.example` | `TAVILY_API_KEY`, `BRAVE_API_KEY` |
| `apps/frontend/src/pipeline/usePipeline.ts` | Polling en `waiting_user` + mutation `resolveWebSearch` |
| `apps/frontend/src/pipeline/PipelineStatusButton.tsx` | Colores para `waiting_user` y `cancelled` |
| `apps/frontend/src/pipeline/PipelineStatusToast.tsx` | Muestra stage `web-search` en el progreso |
| `apps/frontend/src/pipeline/WebSearchBlockedModal.tsx` | **Nuevo** — modal bloqueante con 3 opciones |
| `apps/frontend/src/App.tsx` | Montar `WebSearchBlockedModal` al mismo nivel que `PipelineStatusToast` |

---

## Endpoint nuevo (tRPC mutation)

```
intelligence.resolveWebSearch
Input: { action: 'retry' | 'skip' | 'cancel' }

- 'retry'  → re-corre runWebSearchStage(), si OK continúa pipeline desde news
- 'skip'   → marca webSearch como skipped, continúa desde news
- 'cancel' → marca pipeline como cancelled, fin
```

---

## UI — `WebSearchBlockedModal`

Aparece automáticamente cuando `pipelineStatus?.status === 'waiting_user'`. No requiere interacción previa del usuario.

```
┌─────────────────────────────────────────────┐
│  ⚠️  Web Search falló                       │
│                                             │
│  No se pudo obtener datos frescos del       │
│  mercado. El análisis podría estar          │
│  desactualizado sin esta información.       │
│                                             │
│  [Reintentar]  [Continuar sin datos]  [Cancelar] │
└─────────────────────────────────────────────┘
```

`PipelineStatusButton` muestra `🟠` naranja pulsante cuando `status === 'waiting_user'`.  
`PipelineStatusToast` muestra la stage `web-search` como primera en el progreso visual.

---

## Fuera de scope

- Web search on-demand por símbolo individual (fuera del pipeline)
- Búsquedas por watchlist (si un símbolo del watchlist es relevante, aparece en discovery)
- Perplexity como proveedor (capa de AI encima innecesaria)
- Almacenamiento histórico de resultados de web search más allá del día actual
