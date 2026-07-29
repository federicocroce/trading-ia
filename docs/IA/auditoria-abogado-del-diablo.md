# Ledger — Abogado del diablo

> Registro durable de la auditoría adversarial. Se escribe desde `/abogado-del-diablo <sector>`.
> El prompt vive en `.claude/commands/abogado-del-diablo.md`; el criterio contra el que se juzga todo está en `docs/IA/prompt-maestro-mejora-continua.md` §1.
>
> **Regla del ledger**: un hallazgo sin evidencia verificable (código con línea citada, SQL con `n` y output, o comando con salida) no entra acá — va a "sospechas sin verificar" del informe y se queda ahí hasta que alguien lo pruebe.

## Estado por sector

Un sector queda `AUDITADO` cuando una corrida completa no produce hallazgos P0–P3 nuevos y los abiertos están `RESUELTO` o `ACEPTADO`. **La fecha caduca**: el código se mueve, y un sector auditado hace dos meses vuelve a estar sucio.

| sector | último pase | estado | abiertos |
|---|---|---|---|
| `pipeline` | 2026-07-29 | pase completo — 9 hallazgos | AD-004 … AD-012 |
| `descubrimiento` | — | nunca auditado | — |
| `motor` | — | nunca auditado | — |
| `guardian` | — | nunca auditado | — |
| `cartera` | — | nunca auditado | — |
| `medicion` | — | nunca auditado | — |
| `llm` | — | nunca auditado | — |
| `backend` | — | nunca auditado | — |
| `frontend` | — | nunca auditado | — |
| `operacion` | 2026-07-29 | pre-flight solamente | AD-001, AD-002, AD-003 |
| `negocio` | — | nunca auditado | — |
| `coherencia` | — | nunca auditado | — |

**Prioridad sugerida para la primera vuelta**: `guardian` y `medicion` primero. Son los dos sectores que sostienen todo lo que el §4 da por bueno y, justamente por eso, los menos atacados. Después `pipeline` y `descubrimiento` (donde el usuario ya sospecha que hay mejora), y `negocio` al final, cuando haya evidencia acumulada para contestarlo en serio.

---

## Hallazgos

Severidades: **P0** pierde plata · **P1** humo · **P2** incoherencia · **P3** medición falsa · **P4** peso muerto · **P5** cosmético.
Estados: `ABIERTO` · `REFUTADO` · `ACEPTADO` (el dueño convive con el riesgo) · `RESUELTO` (commit).

### AD-001 · P1 · operacion · 2026-07-29 · ABIERTO

**Claim atacado**: la app muestra el estado del mercado de hoy.

**Hallazgo**: el pipeline no corre desde el viernes 2026-07-24. Al miércoles 29 se perdieron tres ruedas (lun 27, mar 28, mié 29) y todas las superficies muestran datos del 24 — sin que se haya verificado que la UI declare esa antigüedad.

**Evidencia**:
```
$ sqlite3 data/trading.db "SELECT date, status FROM pipeline_runs WHERE date >= '2026-07-20' ORDER BY date;"
2026-07-20|ok
2026-07-21|partial
2026-07-22|ok
2026-07-23|failed
2026-07-23|ok
2026-07-24|ok        <- última

$ sqlite3 data/trading.db "SELECT 'opportunity_scans', MAX(scanned_at) FROM opportunity_scans
  UNION ALL SELECT 'today_proposals', MAX(scan_date) FROM today_proposals
  UNION ALL SELECT 'market_digests', MAX(report_date) FROM market_digests
  UNION ALL SELECT 'cycle_radar_snapshots', MAX(snapshot_date) FROM cycle_radar_snapshots
  UNION ALL SELECT 'signal_tracking', MAX(signal_date) FROM signal_tracking;"
opportunity_scans|2026-07-24T13:42:01.299Z
today_proposals|2026-07-24
market_digests|2026-07-24
cycle_radar_snapshots|2026-07-24
signal_tracking|2026-07-24

$ lsof -ti:3001
(vacío — nada escuchando)
```

**Causa inmediata**: el cron vive dentro del proceso del backend (`apps/backend/src/shared/cron.ts`). Sin proceso a las 7:30 ET no hay pipeline. No es un bug: es cron in-process en una laptop, y la disponibilidad del sistema es la disponibilidad de la máquina.

**Qué habría que creer para que esto esté bien**: que el dueño levanta el backend todos los días hábiles antes de la apertura, **y** que la UI declara visiblemente la antigüedad del dato cuando no corrió.

**Test que lo falsifica**: contar días hábiles con corrida sobre los últimos 60; abrir la app con datos viejos y ver si la fecha del scan es visible sin buscarla.

**Daño**: decidir con niveles, stops y precios de hace cinco ruedas creyéndolos de hoy. Toca el objetivo #1 (protección) y el #3 (cero humo). Sube a **P0** si se confirma que la UI no declara la antigüedad.

**Estado**: ABIERTO — falta verificar el lado del frontend.

---

### AD-002 · P3 · operacion · 2026-07-29 · ABIERTO

**Claim atacado**: §4 del prompt maestro, *"el pipeline fallaba el 35.8% de las corridas… **Fix**: timeout duro (`NEWS_STAGE_TIMEOUT_MS`, 300s) + solo `analysis` puede marcar la corrida como FALLIDA"*, presentado como saldado.

**Hallazgo**: el fix tiene **cero corridas reales**. El commit es del 2026-07-28 16:07; la última corrida del pipeline es del 2026-07-24. Ninguna línea de ese cambio se ejecutó nunca contra el mercado.

**Evidencia**:
```
$ git log -1 --format="%h %ad %s" --date=iso 48e0bd5
48e0bd5 2026-07-28 16:07:52 -0300 fix(fiabilidad): que noticias no tumbe el pipeline, gatear smart y medir tokens

$ sqlite3 data/trading.db "SELECT MAX(started_at) FROM pipeline_runs;"
2026-07-24T13:32:02.526Z
```

**Qué habría que creer para que esto esté bien**: que los tests unitarios cubren el comportamiento de `withStageTimeout` y del cálculo `ok`/`partial`/`failed` en condiciones de fallo real de red y de proveedor. Los tests cubren la lógica; no cubren que la etapa efectivamente se destrabe en producción.

**Test que lo falsifica**: una corrida real posterior al commit que registre `news_status='failed'` o vencido por timeout, con `status` de la corrida en `'partial'` y el scan del día producido igual.

**Daño**: el §4 registra como resuelto el modo de fallo más frecuente del sistema. Si el fix no funciona —o funciona a medias— la próxima lectura de la tasa de fallo va a atribuirle una mejora que no hizo. Es el quinto caso del mismo patrón en este repo: `EXIT_ON_CLOSE` inerte, el e2e apuntando a un puerto equivocado, la etiqueta `yahoo`/`finnhub`, el calibrador que escribe en una tabla que nadie lee.

**Estado**: ABIERTO — **AGRAVADO 2026-07-29** por el pase de `pipeline`. El fix no solo tiene cero corridas: tiene **cero tests**. `git show --stat 48e0bd5` muestra un solo archivo de test en el commit — `verdicts.smart-gate.test.ts` (51 líneas), que cubre el gate de `smart`, no el pipeline. Las 84 líneas cambiadas en `pipeline.service.ts` no tienen cobertura: `grep -rln "pipeline.service\|runRemainingStages\|checkOrRunPipeline\|finishPipelineRun" apps/backend/src --include="*.test.ts"` → **sin resultados**. O sea que el supuesto que sostenía este hallazgo como "solo falta la corrida" —*"los tests unitarios cubren el comportamiento de `withStageTimeout` y del cálculo ok/partial/failed"*— es **falso**: no existen. Y ver AD-005: el timeout, además, está mal dimensionado por un factor de 4.

---

### AD-003 · P4 · operacion · 2026-07-29 · ABIERTO

**Claim atacado**: implícito en el §4 — que la confiabilidad del pipeline es un problema conocido y en vías de mejora.

**Hallazgo**: la tasa de fallo es **plana en cuatro meses**, no descendente. Y hay más corridas que días hábiles, o sea disparos manuales mezclados con el cron: cualquier lectura de "el pipeline corre todos los días" está midiendo dos cosas a la vez.

**Evidencia**:
```
$ sqlite3 data/trading.db "SELECT substr(date,1,7) mes, COUNT(*) n, SUM(status='ok') ok,
    SUM(status='partial') partial, SUM(status='failed') failed FROM pipeline_runs GROUP BY 1 ORDER BY 1;"
2026-04|39|25|0|14   (36% failed)
2026-05|30|18|0|9    (30%)
2026-06|31|16|3|12   (39%)
2026-07|23|11|3|9    (39%)
```
Julio: 23 corridas hasta el día 24 (~17 días hábiles). El 2026-07-23 tiene dos corridas registradas — una `failed` y una `ok`.

**Qué habría que creer para que esto esté bien**: que las corridas manuales son re-intentos deliberados y que el `ok` posterior al `failed` del mismo día produjo trabajo real, no un no-op por el skip de "ya hay datos del día".

**Test que lo falsifica**: comparar `pipeline_stage_artifacts` de las dos corridas del 2026-07-23 y ver qué produjo cada una; separar corridas por origen (cron vs manual) antes de leer cualquier tasa.

**Daño**: la métrica de confiabilidad que se usa para priorizar trabajo mezcla poblaciones. Si las manuales son las que fallan menos —porque el dueño está mirando— la confiabilidad desatendida es peor que el 39% reportado.

**Estado**: ABIERTO — **parcialmente contestado 2026-07-29** (pase de `pipeline`). El test propuesto se corrió: la corrida 122 del 2026-07-23 tiene **dos juegos completos de artifacts** (webSearch+news+fundamentals+analysis+report ×2, analysis de 426s y 657s) — el re-run manual **no es un no-op, re-hace todo el trabajo**, porque `rerunPipelineStage` resetea las etapas a `pending` antes de correr y por eso los guards `isNewsStageValid`/`isAnalysisStageValid` nunca se consultan en ese path. Además: la tasa del 35.8% **sobreestima la pérdida real**. De las 44 corridas `failed`, 14 tenían `analysis` en ok/partial (puro rótulo), y de los 24 días con alguna corrida fallida, **22 tuvieron scan igual** — días realmente sin scan: **2**. Queda abierto separar cron de manual.

---

## Pase `pipeline` — 2026-07-29

**Contexto obligatorio**: los datos están congelados desde el 2026-07-24 (ver AD-001). Todo lo medido acá sobre `data/trading.db` mira 121 corridas históricas, ninguna posterior al 2026-07-24. Los hallazgos de código son sobre el código vivo de `fix/cierre-exposicion` @ `c450cf2`.

### Tabla de etapas (corridas ok/partial, `pipeline_runs`, n en cada fila)

| # | etapa | insumo → salida | filas (24/07) | tiempo medio | consumidor real | si falla | ¿stage propio? |
|---|---|---|---|---|---|---|---|
| 1 | `webSearch` | Tavily/Exa → `web_search_articles` | 150 | **7 s** (n=68) | headlines de macro (`pipeline.service.ts:254`) + contexto del agregador (`news-aggregator.service.ts:199`) | **PAUSA LA CORRIDA ENTERA** | sí |
| 2 | `news` | RSS/NewsAPI → `news_articles` | 278 | **1.059 s** (n=76) — **74% de la corrida** | sentiment (peso 0.05), headlines de macro, digest | degrada a partial (código sin correr) | sí |
| 3 | `macroIntelligence` | headlines → `macro_events`+`causal_chains` | 1 + 4 | 28 s (n=58) | `CausalMapView`, tab mercado | partial | sí |
| 4 | `sectorIntelligence` | artículos → `sector_impacts` | 12 | 31 s (n=53) | `DailySummary`, tab mercado | **no cuenta para el status** | sí |
| 5 | `fundamentals` | Yahoo → `fundamental_cache` | `skipped` en 94/121 | 9 s (n=76) | eje fundamental del score (Δalpha +7.16%) | partial | sí |
| 6 | **screener** | universo por liquidez → `discovered_symbols` | 22 activos | **no medible** | universo del scan | `console.warn` | **NO** |
| 7 | **radar de ciclos** | 23 ETFs → `cycle_radar_snapshots` | 23 | **no medible** | `RadarSummaryWidget`, tesis | invisible | **NO** |
| 8 | `analysis` | universo → `opportunity_scans`/`_snapshots`, `today_proposals` | 6 propuestas | **218 s** (n=76) | **toda la vista Hoy** | mata la corrida (correcto) | sí |
| 9 | `quant` | technical summaries → régimen + momentum + `calibrated_weights` | — | 9 s (n=67) | **solo `regime`**; momentum y pesos: nadie | **no cuenta para el status** | sí |
| 10 | `report` | análisis → `market_digests`/`market_reports` | 1 | 63 s (n=76) | `DailySummary`, tab mercado | partial | sí |
| 11 | **news-radar ×2** | artículos → `news_radar_snapshots` | 2 por corrida, a 5 s | 3,8 s c/u | `RadarSummaryWidget` | invisible | **NO** |

Total ≈ **1.424 s (23,7 min)**. La etapa que produce las decisiones son 218 s = **15%**. Espera medida antes de que arranque `analysis`: **902 s** (n=70 corridas ok).

---

### AD-004 · P0 · pipeline · 2026-07-29 · ABIERTO

**Claim atacado**: *"Solo `analysis` puede marcar la corrida como FALLIDA; el resto degrada a 'partial'"* (§4, y comentario verbatim en `pipeline.service.ts:677-681`).

**Hallazgo**: falso. **`webSearch` puede cancelar el día de trading entero** — y lo hizo. Es la PRIMERA etapa, corre antes que todo, y si falla no degrada nada: pausa la corrida en `waiting_user` y `analysis` nunca arranca. El fix del 2026-07-28 no tocó ese camino.

**Evidencia** — código vivo:
```ts
// apps/backend/src/intelligence/pipeline.service.ts:722-728
const webSearchResult = await runWebSearchStage(runId);
recordStageArtifact(runId, 'webSearch', webSearchResult);

if (webSearchResult.status === 'failed') {
  pauseRunWaitingUser(runId);
  return getPipelineRunByDate(today)!;
}
```
Y si el dueño no está mirando, la corrida pausada la barre el próximo arranque del backend:
```ts
// apps/backend/src/intelligence/pipeline.repository.ts:129-140
const orphans = db.select().from(schema.pipelineRuns)
  .where(or(
    eq(schema.pipelineRuns.status, 'running'),
    eq(schema.pipelineRuns.status, 'waiting_user'),   // ← la pausada muere acá
  ))
```
Evidencia de que ya pasó:
```
$ sqlite3 data/trading.db "SELECT id,date,status,web_search_status,analysis_status,started_at
                           FROM pipeline_runs WHERE web_search_status='failed';"
48|2026-05-13|cancelled|failed|pending|2026-05-13T14:55:52Z
49|2026-05-13|cancelled|failed|pending|2026-05-13T14:56:01Z
50|2026-05-13|cancelled|failed|pending|2026-05-13T15:04:51Z

$ sqlite3 data/trading.db "SELECT id, scanned_at FROM opportunity_scans
                           WHERE scanned_at>='2026-05-12' AND scanned_at<'2026-05-15';"
112|2026-05-12T13:35:16Z
113|2026-05-14T01:01:12Z    ← el siguiente scan: 22:01 ART del 13, con el mercado cerrado
```
Tres corridas muertas en `webSearch` entre las 11:55 y las 12:04 ART del 2026-05-13, y **cero scans durante la rueda**. El primer scan llegó nueve horas después del cierre.

**Qué habría que creer para que esto esté bien**: que la búsqueda web aporta algo a las decisiones del día. No aporta: con `DISCOVERY_ATTENTION_NOMINATION` apagada por default (`discovery-registry.ts:58`, exige `=== '1'` y no está en `.env`), sus 150 artículos diarios solo alimentan la lista de headlines de macro y el contexto del agregador. Ninguna decisión, ningún nivel, ningún stop.

**Test que lo falsifica**: matar las keys de Tavily/Exa a mitad de corrida y verificar que el scan del día se produce igual. Hoy no se produce: se produce un `waiting_user`.

**Daño**: un día operativo sin niveles, sin stops y sin veredictos, por el fallo de una etapa que no alimenta ninguna decisión. Con el dueño dormido a las 8:30 ART, el `waiting_user` se convierte en `failed` en el próximo boot y la app muestra lo viejo en silencio. Es el objetivo #1 directo.

**Estado**: ABIERTO

---

### AD-005 · P3 · pipeline · 2026-07-29 · ABIERTO

**Claim atacado**: *"Fix: timeout duro (`NEWS_STAGE_TIMEOUT_MS`, 300s)… No se apagó nada — macro_events, cadenas causales, radar y digest siguen produciéndose"* (§4 y mensaje del commit `48e0bd5`).

**Hallazgo**: el timeout está mal dimensionado por un factor de 4. **87 de 97 corridas históricas del stage de noticias superaron los 300 s.** No es un techo contra cuelgues: es un interruptor que va a apagar noticias en ~90% de las corridas. Y como el timeout no aborta el trabajo de fondo ni escribe el estado de la etapa, **borra su propia huella** en `pipeline_runs`.

**Evidencia** — el dato:
```
$ sqlite3 data/trading.db "SELECT COUNT(*) n, MIN(duration_ms)/1000 min_s, ROUND(AVG(duration_ms)/1000.0) avg_s,
    MAX(duration_ms)/1000 max_s, SUM(duration_ms<300000) bajo_300s, SUM(duration_ms>=300000) sobre_300s
    FROM pipeline_stage_artifacts WHERE stage='news' AND duration_ms IS NOT NULL;"
n=97 | min=0s | avg=1288s | max=4295s | bajo_300s=10 | sobre_300s=87
```
Mediana ≈ 1.208 s (fila 51 de 97 ordenadas). El default vigente es 300.000 ms y **no está sobreescrito en `.env`** (solo figura en `.env.example:38`), o sea 300 s es el valor real.

Tres consecuencias, todas en el código vivo:

1. **No aborta nada.** `withStageTimeout` (`pipeline.service.ts:527-551`) hace `Promise.race` y sigue: *"el trabajo interno puede seguir en background y terminar solo"*. O sea el fetch+análisis de noticias queda corriendo **en paralelo con el scan**, compitiendo por la misma cola de Yahoo. Ese es exactamente el mecanismo que el propio backlog documenta como **causa sistémica de etapas colgadas** (§6 A.1: *"los fan-outs de precios cada 10s se apilaban y saturaban la cola global de Yahoo"*). El fix contra los cuelgues recrea la condición que los producía.

2. **Borra la evidencia del timeout.** El objeto que devuelve el timeout nunca pasa por `updatePipelineStage`; la etapa queda `running` en la DB, y cuando el trabajo de fondo termina 15 minutos después escribe `updatePipelineStage(runId,'news',{status:'ok'})` — **después** de que `finishPipelineRun` ya cerró la corrida. La fila final dice `news='ok'` con la corrida en `partial` y ninguna etapa fallida: contradictorio y sin rastro del vencimiento. La huella sobrevive solo en `pipeline_stage_artifacts` (`criticalError: 'stage-timeout:news'`), que ninguna superficie lee. Además ese artifact va **sin duración** (el timeout devuelve `startedAt: null` → `durationMs` queda `undefined`), así que la propia métrica de "cuánto tarda news" pierde justo las corridas que vencen — sesgo de supervivencia autoinfligido.

3. **Sí apaga cosas.** `macroIntelligence` corre inmediatamente después y lee `getNewsArticlesForToday('medium')`. La columna `impact` es nullable y los artículos crudos se insertan **sin** impacto (`persistArticles`, `news.service.ts:62-79`); el impacto lo escribe la fase LLM, que es la lenta. Y el filtro descarta lo que no tiene impacto: `const level = order[(r.impact ?? 'low')] ?? 0; return level >= minLevel;` (`repository.ts:1460-1461`). Con news vencida a los 300 s, **macro corre sobre el subconjunto ya etiquetado, no sobre las noticias del día**. `runMacroIntelligence` con pocas headlines devuelve 0 eventos → stage `failed` → no se guarda el mapa causal.

**Qué habría que creer para que esto esté bien**: que los 300 s son suficientes para el caso típico. La distribución dice que alcanzan en 10 de 97 casos.

**Test que lo falsifica**: una corrida real con `NEWS_STAGE_TIMEOUT_MS=300000` que termine con `news_status='ok'` y `macro_intelligence_status='ok'` con ≥3 `macro_events` del día. Si en cambio termina con news vencida y macro en 0 eventos, el fix apagó el bloque narrativo entero.

**Daño**: el §4 registra como saldado el modo de fallo más frecuente del sistema con un parámetro que, según los datos del propio proyecto, dispara casi siempre. La próxima lectura de la tasa de fallo va a ver "menos fallidas" y atribuirlo a confiabilidad, cuando lo que pasó es que se dejó de esperar a la etapa. Y el costo no baja: el trabajo sigue corriendo, ahora encima del scan.

**Estado**: ABIERTO

---

### AD-006 · P3 · pipeline · 2026-07-29 · ABIERTO

**Claim atacado**: *"`pipeline_stage_artifacts.tokens_used` estaba en NULL en las 5 etapas… **Fix**: acumulador por etapa en `ai-router` (`takeStageTokens`). Es un PISO"* (§4).

**Hallazgo**: sigue en NULL en **las 550 filas**, y el diseño del acumulador no produce un piso sino una **atribución equivocada**: las dos etapas que sí gastan LLM y no registran artifact (`macroIntelligence`, `sectorIntelligence`) le cargan sus tokens a `fundamentals` — una etapa que no hace una sola llamada a LLM y está `skipped` en 94 de 121 corridas.

**Evidencia** — el dato:
```
$ sqlite3 data/trading.db "SELECT stage, COUNT(*) n, SUM(tokens_used IS NULL) tok_null,
    SUM(COALESCE(tokens_used,0)) tok_sum FROM pipeline_stage_artifacts GROUP BY 1;"
webSearch     143 | null=143 | suma=0
report        109 | null=109 | suma=0
fundamentals  108 | null=108 | suma=0
news           97 | null= 97 | suma=0
analysis       93 | null= 93 | suma=0
```
No hay ninguna otra tabla de costo: `sqlite3 data/trading.db ".tables" | grep -iE "token|usage|llm|cost|provider"` → vacío. **El costo del sistema hoy no es medible desde la DB.**

El código: `recordStageArtifact` acepta solo `'webSearch' | 'news' | 'fundamentals' | 'analysis' | 'report' | 'digest'` (`pipeline.service.ts:95`) y su primera línea útil es `const tokens = takeStageTokens();` (`:101`), que **drena** el acumulador global (`ai-router.ts:110-127`). El orden de ejecución en `runRemainingStages` es: news→`record` (drena) → macroIntelligence (**no drena**) → sectorIntelligence (**no drena**) → fundamentals→`record` (**drena macro+sector**). Se suman ahí también los dos pases fire-and-forget del news radar, que corren en paralelo.

**Qué habría que creer para que esto esté bien**: que ningún LLM se llama fuera de las cinco etapas instrumentadas. `runMacroIntelligence` y `runSectorIntelligence` son llamadas a LLM por definición.

**Test que lo falsifica**: una corrida real y después `SELECT stage, tokens_used FROM pipeline_stage_artifacts WHERE pipeline_run_id = <id>`. Si `fundamentals` aparece con tokens > 0 estando `skipped`, la atribución está rota.

**Daño**: la pregunta "¿qué etapa recorto por costo?" (§7) no se puede contestar, y cuando se pueda va a señalar la etapa equivocada. `fundamentals` alimenta el único eje con discriminación medida de alpha (+7,16%, t=10,08): es justo la que no hay que apagar, y es la que va a figurar como la más cara.

**Estado**: ABIERTO

---

### AD-007 · P1 · pipeline · 2026-07-29 · ABIERTO

**Claim atacado**: AD-001, *"Causa inmediata: el cron vive dentro del proceso del backend. Sin proceso a las 7:30 ET no hay pipeline. **No es un bug**: es cron in-process en una laptop, y la disponibilidad del sistema es la disponibilidad de la máquina."*

**Hallazgo**: **el diagnóstico está incompleto y la conclusión "no es un bug" no se sostiene.** El backend estuvo vivo **12 horas el lunes 27 y ~9 horas el martes 28**, y el pipeline no corrió ninguno de los dos días. Lo que falta no es uptime: falta **catch-up al arrancar**. `node-cron` no recupera disparos perdidos y nadie chequea al bootear si falta la corrida del día.

**Evidencia** — el cron horario del news radar deja huella de cuándo el proceso estaba vivo (`created_at` es `datetime('now')` = UTC, verificado contra `date -u`):
```
$ sqlite3 data/trading.db "SELECT date(created_at) d, COUNT(*) n, MIN(time(created_at)) primera,
    MAX(time(created_at)) ultima FROM news_radar_snapshots WHERE created_at>='2026-07-26' GROUP BY 1;"
2026-07-26 |  3 | 09:00:07 | 23:00:01
2026-07-27 | 12 | 00:00:01 | 23:00:10     ← lunes: backend vivo 13:00→23:00 UTC
2026-07-28 | 10 | 00:00:16 | 23:00:10     ← martes: backend vivo 14:00→20:00 y 23:00 UTC
2026-07-29 |  1 | 01:00:08 | 01:00:08
```
Contra `MAX(started_at) FROM pipeline_runs` = **2026-07-24T13:32Z**. Y el arranque:
```
$ grep -n "startCronJobs\|initPipeline\|checkOrRunPipeline" apps/backend/src/index.ts
16:initPipeline();        ← solo markOrphanedRunsFailed()
64:startCronJobs();       ← solo programa disparos futuros
```
`initPipeline()` marca huérfanas como fallidas y nada más. Nadie pregunta "¿hay corrida de hoy?".

**Qué habría que creer para que esto esté bien**: que la única forma de tener el pipeline del día es que la laptop esté despierta a las 7:30 ET exactas. Con catch-up al boot, el lunes 27 habría corrido a las 13:00 UTC — antes de la apertura de las 13:30.

**Test que lo falsifica**: arrancar el backend un día hábil después de las 7:30 ET sin corrida registrada y ver si dispara el pipeline. Hoy no dispara.

**Daño**: tres ruedas perdidas (27, 28, 29) que eran **recuperables**. El costo del fix es un chequeo al arranque, no un servidor 24/7 — y mientras AD-001 diga "no es un bug", ese fix no se hace.

**Estado**: ABIERTO — refina la causa de AD-001, no lo refuta (el dato de AD-001 sigue en pie: tres ruedas sin corrida).

---

### AD-008 · P3 · pipeline · 2026-07-29 · ABIERTO

**Claim atacado**: implícito — que "el día" significa lo mismo en todas las etapas del pipeline.

**Hallazgo**: el pipeline registra las corridas con fecha de **Buenos Aires** pero tres lecturas que alimentan etapas usan fecha **UTC**. Entre las 21:00 y las 24:00 ART las dos fechas difieren, y ahí caen **13 corridas (11% del total)** — que son justamente las de recuperación nocturna después de un día fallido.

**Evidencia** — las dos fuentes de verdad:
```ts
// apps/backend/src/shared/date-utils.ts:2-4  — lo que usa el pipeline para la fecha del run
export function getToday(): string {
  return new Date().toLocaleDateString('en-CA', { timeZone: 'America/Argentina/Buenos_Aires' });
}
```
```ts
// apps/backend/src/db/repository.ts:1451  — lo que lee macroIntelligence
const today = new Date().toISOString().split('T')[0];        // UTC
// apps/backend/src/db/repository.ts:1466  (getSectorImpactsForToday) — idem
// apps/backend/src/intelligence/sector-report.service.ts:226 (getStoredSectorReports) — idem
```
La población expuesta:
```
$ sqlite3 data/trading.db "SELECT COUNT(*) n, SUM(status='ok') ok, SUM(status='failed') fail
    FROM pipeline_runs WHERE CAST(strftime('%H',started_at) AS INT) < 3;"
n=13 | ok=8 | failed=5
```
La más reciente es la corrida 122: `date='2026-07-23'`, `started_at='2026-07-24T01:12:04Z'` (22:12 ART) — la recuperación del día que había fallado. Para ella `getToday()`='2026-07-23' y `getNewsArticlesForToday()` filtró por '2026-07-24'.

**Qué habría que creer para que esto esté bien**: que ninguna corrida arranca después de las 21:00 ART. Arrancaron 13.

**Test que lo falsifica**: correr el pipeline a las 22:00 ART y comparar `COUNT(*)` de `getNewsArticlesForToday()` contra los artículos con `published_at` del día ART. Si el primero es ~0 y el segundo ~300, está confirmado.

**Daño**: las corridas de recuperación —las que se hacen justamente porque el día falló— alimentan macro y sectores con la ventana de noticias equivocada. La corrida 51 (2026-05-13, arrancada 00:33 UTC) terminó con `macro_intelligence_status='failed'`, consistente con este mecanismo, aunque la causalidad de ese caso puntual no está probada.

**Estado**: ABIERTO

---

### AD-009 · P4 · pipeline · 2026-07-29 · ABIERTO

**Claim atacado**: implícito en el orden del orquestador — que el bloque narrativo tiene que correr antes que el scan.

**Hallazgo**: **902 de los 1.361 segundos de una corrida exitosa (66%) son espera antes de que arranque la etapa que produce las decisiones**, y esa etapa no depende de nada de lo que la precede.

**Evidencia**:
```
$ sqlite3 data/trading.db "SELECT COUNT(*) n,
    ROUND(AVG((julianday(analysis_started_at)-julianday(started_at))*86400)) espera_avg_s,
    ROUND(AVG((julianday(finished_at)-julianday(started_at))*86400)) total_avg_s,
    ROUND(AVG((julianday(analysis_finished_at)-julianday(analysis_started_at))*86400)) analysis_avg_s
  FROM pipeline_runs WHERE status='ok' AND analysis_started_at IS NOT NULL AND finished_at IS NOT NULL;"
n=70 | espera=902s | total=1361s | analysis=208s
```
Por etapa (n entre paréntesis): webSearch 7 s (68) · **news 1.059 s (76)** · macro 28 s (58) · sector 31 s (53) · fundamentals 9 s (76) · **analysis 218 s (76)** · quant 9 s (67) · report 63 s (76).

Que `analysis` no depende del bloque narrativo ya está establecido en el §4: *"su universo sale de `discovered_symbols` + `symbols`"*.

**Qué habría que creer para que esto esté bien**: que el orden importa. No importa — `runAnalysisStage` consume `_stageSectors` (que viene del parámetro de entrada, no de `sectorIntelligence`) y el universo de la DB.

**Test que lo falsifica**: mover `analysis` + screener al principio y `webSearch`/`news`/`macro`/`sector` después, y verificar que el scan sale idéntico. Si sale idéntico, el orden actual son 15 minutos regalados.

**Daño**: el pipeline pre-market arranca 7:30 ET y hoy entrega las decisiones ~15:00 min más tarde de lo necesario. Con AD-004 encima, esos 15 minutos son además la ventana en la que una etapa narrativa puede cancelar el día antes de que el scan exista.

**Estado**: ABIERTO

---

### AD-010 · P4 · pipeline · 2026-07-29 · ABIERTO

**Claim atacado**: *"Nada se apagó, todo sigue produciéndose"* — leído como "todo lo que se produce sirve".

**Hallazgo**: tres salidas que se computan en cada corrida y no las lee nadie, más una que se computa dos veces.

**Evidencia**:
- **`momentumRankings`**: se calcula en `pipeline.service.ts:432` y se guarda en `_stageQuantContext`. Los únicos lectores de `quantContext` en todo el backend son `market-report.service.ts:488`, `:628` y `:637`, y **los tres leen `.regime`**. `grep -rn "momentumRankings" apps/backend/src --include="*.ts" | grep -v test` devuelve solo la escritura. Salida muerta.
- **`calibrateWeights()`**: `pipeline.service.ts:433`, escribe 66 filas en `calibrated_weights`. Único lector: `getLatestCalibratedWeights`, re-exportado por el propio calibrador (`weight-calibrator.service.ts:101`). El que manda en el scoring es `getActiveWeights` desde `scoring_weight_history` (`scoring.ts:109`), tabla con **0 filas**. Confirma el "INERTE" del §4 — y sigue corriendo.
- **News radar duplicado**: `refreshNewsProcess` ya dispara un pase fire-and-forget (`opportunities.service.ts:1330-1344`) y `runRemainingStages` dispara otro (`pipeline.service.ts:583-594`). El dato:
```
$ sqlite3 data/trading.db "SELECT id, created_at, pipeline_run_id FROM news_radar_snapshots
                           WHERE date(created_at)='2026-07-24';"
629 | 2026-07-24 13:36:57 | 123
630 | 2026-07-24 13:37:02 |          ← 5 segundos después, mismos artículos
```
66 pares a menos de 120 s en el histórico. Costo real, medido y **chico**: 661 snapshots a 3,8 s de media con Groq Llama-70B, 18 minutos de LLM en los últimos 30 días. No inflar esto: es peso muerto barato.

**Qué habría que creer para que esto esté bien**: que `momentumRankings` y `calibrated_weights` son observación deliberada. `calibrated_weights` lo es y está documentado; `momentumRankings` no se persiste en ningún lado, así que ni siquiera se puede observar.

**Test que lo falsifica**: borrar `rankMomentum` del stage quant y ver si algo cambia. Nada debería cambiar.

**Daño**: bajo — el stage quant entero son 9 s. Lo que cuesta no es CPU, es que cada lectura futura de "qué produce el pipeline" incluya tres salidas que nadie consume.

**Estado**: ABIERTO

---

### AD-011 · P2 · pipeline · 2026-07-29 · ABIERTO

**Claim atacado**: §6 C del prompt maestro: *"webSearch (EXA/Tavily) caído en 104/121 runs — skip honesto ya implementado, decidir si se arregla o se elimina."*

**Hallazgo**: el número no corresponde a los datos. La búsqueda web salió **ok en 111 de 123 corridas, con cero errores registrados**. La decisión pendiente ("arreglar o eliminar") está apoyada en una premisa falsa — y la razón real para tocar `webSearch` es otra (AD-004).

**Evidencia**:
```
$ sqlite3 data/trading.db "SELECT web_search_status,
    SUM(web_search_errors IS NOT NULL AND web_search_errors NOT IN ('','[]')) con_errores,
    COUNT(*) n FROM pipeline_runs GROUP BY 1;"
failed  | con_errores=3 | n=3
ok      | con_errores=0 | n=111
pending | con_errores=0 | n=9
```
Cero filas en `skipped`, o sea las keys están configuradas (`TAVILY_API_KEY` y `EXA_API_KEY` presentes en `.env`) y el camino de skip honesto nunca se ejercitó. El detalle persistido es consistente: `"40 artículos portfolio, 35 discovery."` en 81 corridas y `"35 artículos portfolio, 35 discovery."` en 30.

**Qué habría que creer para que esto esté bien**: que "caído" se refería a otra cosa que no queda registrada en `pipeline_runs` — por ejemplo fallos parciales tragados dentro de `runWebSearch`. No pude verificar esa hipótesis; lo verificable dice ok en 111.

**Test que lo falsifica**: encontrar la medición original de la que salió el 104/121. Si existe y mide otra población, hay que decir cuál.

**Daño**: un ítem de backlog (¿se paga Tavily/Exa o no?) apoyado en un número que la DB contradice. Y la conclusión correcta es la opuesta a la que sugiere el ítem: `webSearch` no hay que arreglarlo porque esté caído — hay que sacarle el poder de pausar la corrida.

**Estado**: ABIERTO

---

### AD-012 · P5 · pipeline · 2026-07-29 · ABIERTO

**Claim atacado**: los comentarios de `shared/cron.ts` sobre en qué horario corre cada job.

**Hallazgo**: cuatro de los cinco crons declaran UTC en el comentario y corren en hora **local (ART, UTC−3)**, porque no pasan `timezone`. El único con timezone explícita es el del pipeline (`America/New_York`), que sí corre cuando dice.

**Evidencia** — el código declara una ventana y el dato muestra otra:
```ts
// apps/backend/src/shared/cron.ts:24-26
// News Radar: every 60 minutes (only during market-relevant hours, 6am-22pm UTC)
// = 3am-19pm ART. Skip overnight to save tokens.
cron.schedule('0 6-22 * * *', async () => {
```
```
$ sqlite3 data/trading.db "SELECT MIN(time(created_at)), MAX(time(created_at)) FROM news_radar_snapshots;"
→ hay filas a las 23:00, 00:00 y 01:00 UTC — fuera de la ventana declarada.
   El rango observado es 09:00–01:00 UTC = exactamente 06:00–22:00 ART.
```
Confirmación independiente con el generador de tesis (`'0 10 * * 1'`, comentado *"lunes 10:00 UTC"*):
```
$ sqlite3 data/trading.db "SELECT MAX(created_at) FROM theses;"
2026-07-27 13:01:17   ← lunes 13:01 UTC = 10:01 ART
```
`datetime('now')` de SQLite es UTC (verificado: `date -u` y `SELECT datetime('now')` coinciden al segundo).

**Qué habría que creer para que esto esté bien**: que la TZ del proceso siempre va a ser ART. Es cierto hoy y deja de serlo el día que esto corra en cualquier otro lado.

**Test que lo falsifica**: `TZ=UTC npm run dev` y ver si los horarios de los jobs se mueven 3 horas. Deberían moverse.

**Daño**: cosmético hoy. El news radar gasta llamadas después del cierre US pese a que el comentario dice que las evita, y el resolver de outcomes corre a las 02:00 UTC en vez de las 23:00 — igual después del cierre, así que no rompe nada. Se registra para que nadie lea esos comentarios como especificación.

**Estado**: ABIERTO
