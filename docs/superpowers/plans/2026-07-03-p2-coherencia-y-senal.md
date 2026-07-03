# P2 — Coherencia y Señal Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Eliminar el doble discurso entre superficies (caso MARA: Hoy MANTENER vs todo lo demás SELL), desintoxicar el score del sentiment sin señal, matar la clase ROAD de alucinaciones en origen (extractor de tickers), y reparar la deuda con fecha límite (journal de migraciones).

**Architecture:** Jerarquía de decisión explícita como contrato compartido (tipos en packages/shared), lógica pura testeable, fail-closed. Una reparación one-time de la DB de migraciones ANTES de cualquier migración nueva.

**Tech Stack:** TypeScript ESM, vitest, drizzle + better-sqlite3, React.

## Global Constraints

- Branch: `fix/p2-coherencia` desde `feat/outcome-resolver` (HEAD post-merge P1).
- Tests: `npm run test --workspace=apps/backend` (baseline: 277). Typecheck backend Y frontend. `npm run build:shared` si se toca shared.
- Comentarios en español, imports ESM `.js`, env lazy con `envNumber` de `shared/env-number.ts`.
- **ORDEN OBLIGATORIO: Task 1 (journal) va PRIMERO** — cualquier migración generada antes de repararlo se saltea silenciosamente (timestamps futuros desde 0036; el migrator solo aplica `when > último created_at` = 2026-08-09).
- Evidencia base del relevamiento 2026-07-03 (números citados en cada task): sentiment r=+0.03 vs win (n=565), tech r=+0.24; caso MARA 2-jul; alucinación ROAD en market_reports id=98; `unified_analysis_results` 0 filas; webSearch caído 104/121 runs.

### Jerarquía de decisión (contrato — Task 2 lo implementa, TODAS las superficies lo respetan)

1. **Stop = salida dura.** Precio cierra bajo el trailing stop ⇒ VENDER. Mecánico, no negociable.
2. **Motor = advisory.** `action=SELL` del scan sobre una posición ⇒ verbo `REVISAR` (no MANTENER ni VENDER): "el motor recomienda salir/reducir; tu regla dura es el stop en $X". Nunca más MANTENER a secas cuando el motor dice SELL.
3. **LLM = narrativa.** Nunca cambia un verbo; sus sugerencias bloqueadas se muestran marcadas como bloqueadas.

---

### Task 1: Reparar journal de migraciones + migración dedupe_key

**Files:**
- Modify: `apps/backend/drizzle/meta/_journal.json`
- Modify: DB `__drizzle_migrations` (script one-time)
- Create: `apps/backend/src/scripts/repair-migration-timestamps.ts` + npm script `db:repair-journal`
- Create: migración nueva (drizzle-kit) para `unified_analysis_results.dedupe_key`

**Contexto:** Los `when` del journal desde idx 36 son timestamps FUTUROS (ago-2026). `drizzle-kit generate` estampa `Date.now()` → toda migración nueva generada antes del 2026-08-09 queda con `when` menor al último aplicado y el migrator la saltea sin error. Además `unified_analysis_results` en la DB viva NO tiene la columna `dedupe_key` que el schema y el código asumen → cada insert lanza y se traga (tabla con 0 filas desde siempre).

- [ ] **Step 1: Backup** — `cp data/trading.db "data/trading.db.pre-p2-$(date +%Y%m%d)"`.
- [ ] **Step 2: Script de reparación** — `repair-migration-timestamps.ts`: (a) lee `_journal.json`, reescribe los `when` futuros (idx ≥ 36) por timestamps crecientes REALES pasados (p.ej. `1751000000000 + idx*1000` — julio 2025, orden preservado); (b) actualiza `__drizzle_migrations.created_at` con los mismos valores por hash correspondiente (verificar el mapeo hash↔idx leyendo la tabla primero); (c) imprime antes/después. Idempotente (si no hay futuros, no-op).
- [ ] **Step 3: Ejecutar y verificar** — `npm run db:repair-journal`. Verificación: `sqlite3 data/trading.db "SELECT id, created_at FROM __drizzle_migrations ORDER BY id DESC LIMIT 5"` — ningún created_at > hoy.
- [ ] **Step 4: Migración dedupe_key** — en `db/schema.ts` la columna ya está declarada (`schema.ts:598`); correr `npm run db:generate --workspace=apps/backend` → revisar SQL (debe ser SOLO `ALTER TABLE unified_analysis_results ADD dedupe_key ...`; SQLite no permite ADD COLUMN UNIQUE — si drizzle genera constraint UNIQUE inline fallará: en ese caso la migración manual es `ALTER TABLE ... ADD COLUMN dedupe_key text;` + `CREATE UNIQUE INDEX idx_unified_results_dedupe ON unified_analysis_results(dedupe_key);` — escribirla a mano en el archivo generado). `npm run db:migrate`.
- [ ] **Step 5: Probar el write** — script inline o test de integración mínimo: llamar `saveUnifiedAnalysisResults` con una fila dummy y verificar `SELECT COUNT(*) FROM unified_analysis_results` = 1; borrar la dummy. Además: cambiar el catch silencioso de `unified-analysis.service.ts:343-345` por `console.error('[Unified] persist failed:', (err as Error).message)` — los errores de persistencia no pueden ser invisibles.
- [ ] **Step 6: Suite + typecheck + commit** — `fix: journal de migraciones reparado + dedupe_key en unified_analysis_results (write roto hace meses)`.

---

### Task 2: Jerarquía de decisión — verbo REVISAR + etiquetas consistentes

**Files:**
- Modify: `apps/backend/src/opportunities/today-decisions.ts:81-127` (`decidePositionVerb`)
- Modify: `packages/shared/src/types/*` (union del verbo: agregar `'REVISAR'`)
- Modify: `apps/backend/src/intelligence/digest-recommendations.ts` (SELLs fuera de topOpportunities)
- Modify: frontend `TodayPage`/`DailySummary` (render del verbo nuevo)
- Test: `apps/backend/src/opportunities/today-decisions.test.ts` (existe)

- [ ] **Step 1: Tests que fallan** — en `today-decisions.test.ts`, siguiendo el patrón del archivo:

```typescript
describe('decidePositionVerb — jerarquía de decisión', () => {
  it('motor SELL sin stop tocado ⇒ REVISAR (nunca MANTENER a secas)', () => {
    // precio ARRIBA del trailing stop, engine action SELL (caso MARA 2026-07-02)
    const d = decidePositionVerb(mkInput({ engineAction: 'SELL', decisionPrice: 13.37, trailingStop: 12.53 }));
    expect(d.verb).toBe('REVISAR');
    expect(d.reason).toContain('motor');
    expect(d.reason).toContain('12.53'); // el stop duro sigue visible
  });
  it('stop tocado sigue siendo VENDER aunque el motor diga BUY', () => {
    const d = decidePositionVerb(mkInput({ engineAction: 'BUY', decisionPrice: 10, trailingStop: 10.5 }));
    expect(d.verb).toBe('VENDER');
  });
  it('motor HOLD/BUY sin stop tocado sigue MANTENER', () => {
    const d = decidePositionVerb(mkInput({ engineAction: 'HOLD', decisionPrice: 100, trailingStop: 90 }));
    expect(d.verb).toBe('MANTENER');
  });
});
```
(Adaptar `mkInput` a la firma real; mirar los tests existentes del archivo.)

- [ ] **Step 2: Implementar** — en `decidePositionVerb`: el branch actual que degrada `engineWarnsSell` a warning pasa a emitir verbo `REVISAR` con reason que nombra ambas fuentes: `"El motor recomienda salir (${motivo}). Tu regla dura es el stop en $X — decidí: vender ya o ajustar el stop."`. VENDER (stop) mantiene prioridad si ambos aplican. Agregar `'REVISAR'` al union type del verbo en shared.
- [ ] **Step 3: Digest sin SELLs entre oportunidades** — en `digest-recommendations.ts` (o donde se arma `topOpportunities` del digest — verificar: el agente encontró NEM SELL dentro de topOpportunities generado por el LLM en `market-report.service.ts:380-434`): post-procesar `topOpportunities` filtrando items cuyo símbolo tenga action SELL en el scan → moverlos a `warnings` con prefijo "SALIDA: ". Determinístico, después del parseo del LLM.
- [ ] **Step 4: Frontend** — render de `REVISAR` en TodayPage (badge ámbar, entre MANTENER y VENDER) y en cualquier switch de verbos (grep `MANTENER` en apps/frontend). Typecheck frontend.
- [ ] **Step 5: Suite + commits** — `feat: verbo REVISAR — el motor advisory y el stop duro dejan de contradecirse` (backend) / mismo commit si es chico.

---

### Task 3: Staleness — el reporte avisa cuando hay scan más nuevo

**Files:**
- Modify: router/servicio que sirve report+digest (agregar `generatedAt` del report y `scannedAt` del último scan al payload — campos aditivos)
- Modify: `apps/frontend/src/daily/DailySummary.tsx` (banner)

- [ ] **Step 1:** En el endpoint que devuelve el digest/report (buscar en `intelligence.router.ts` el procedure que lee `market_digests`/`market_reports`), incluir `latestScanAt` (de `getLatestOpportunityScan().scannedAt`) junto al `generatedAt` del report.
- [ ] **Step 2:** En `DailySummary.tsx`: si `latestScanAt > generatedAt` (+30 min de tolerancia), banner ámbar arriba: `"Este reporte es de las HH:MM — hay un scan más nuevo (HH:MM). Las acciones por símbolo pueden haber cambiado; mirá Oportunidades."` con las dos horas renderizadas.
- [ ] **Step 3:** Typechecks + commit — `feat: banner de staleness — el reporte declara cuando el scan lo dejó viejo`.

---

### Task 4: Gate narrativo + escenarios con pesos + digest sin hype

**Files:**
- Modify: `apps/backend/src/opportunities/opportunities.service.ts` (bloque del gate, ~L904-945)
- Modify: `apps/backend/src/intelligence/market-report.service.ts` (validación scenarios)
- Modify: `packages/shared/src/constants/prompts.ts` (COMBINED_SYNTHESIS_PROMPT)

- [ ] **Step 1: Gate narrativo** — en el bloque donde se registra `llm:sugirió X — bloqueado`, además prefijar la narrativa: `opp.reasoning = '[Sugerencia ${unified.action} bloqueada por gate de riesgo — se mantiene ${gated}] ' + unified.thesis;` (y NO copiar `unified.wouldDo` a `opp.deepAnalysis.wouldDo` en ese caso; reemplazar por `['Ver por qué se bloqueó en la cadena de decisión']`). La tesis cruda sigue en `unified.thesis` para el report (que ya pesa con la acción gateada).
- [ ] **Step 2: Scenarios con pesos obligatorios** — post-parseo del report en `market-report.service.ts`: si TODOS los `distribution[].weight === 0` (hoy pasa en 45% de reports), recalcular determinísticamente: weight proporcional a la probabilidad del escenario × acción de los símbolos (BUY=sobreponderar en escenario bull, etc.) O — más simple y honesto — descartar la sección `distribution` y setear `scenarios[].distributionNote = 'sin asignación — el modelo no la produjo'`. Elegir la opción simple; documentar.
- [ ] **Step 3: Prompt anti-hype** — en `COMBINED_SYNTHESIS_PROMPT` agregar regla dura: `"PROHIBIDO lenguaje promocional o de urgencia ('la oportunidad es ahora', 'momento clave para entrar', 'no te lo pierdas'). Tono: analista institucional que reporta a un gestor de riesgo. Cada afirmación de topImpactNews debe citar el titular EXACTO de una noticia provista (campo sourceHeadline)."` y agregar `sourceHeadline` al shape esperado de topImpactNews (validación post-parse: item sin sourceHeadline que matchee substring de alguna headline provista → descartar item).
- [ ] **Step 4:** Suite + commit — `fix: narrativa gateada, escenarios honestos y reporte sin lenguaje de venta`.

---

### Task 5: Desintoxicar el score — sentiment a 0.05

**Files:**
- Modify: `apps/backend/src/intelligence/weight-adjustment.service.ts:10-13` (DEFAULT_WEIGHTS)
- Modify: `apps/backend/src/opportunities/scoring.ts:57-69` (fallback 4 ejes)
- Delete: `COMPOSITE_WEIGHTS` de `packages/shared/src/constants/scoring-weights.ts:39-52` (dead code confirmado — 0 usos)
- Test: `apps/backend/src/opportunities/scoring.test.ts`

**Evidencia:** sentiment r=+0.03 vs win (n=565, p≈0.47) — ruido; tech r=+0.24 (p<1e-7) monótono; fund r=−0.07 (signo invertido, no significativo). El sentiment pesa hoy ~22% del composite con `scoring_weight_history` vacía (corren defaults).

- [ ] **Step 1: Nuevos defaults** — en `DEFAULT_WEIGHTS` (3 ejes, se reescala con evidence 0.20 vía `withEvidenceDefault`):
```typescript
// Pesos por evidencia empírica (relevamiento 2026-07-03, n=565 señales resueltas):
// tech r=+0.24 (única señal real), sentiment r=+0.03 (ruido), fund r=-0.07 (sin señal medible).
// El sentiment queda simbólico (0.05) hasta que las weight proposals con datos limpios demuestren edge.
const DEFAULT_WEIGHTS = {
  shortTerm: { technical: 0.70, sentiment: 0.05, fundamental: 0.25 },
  mediumTerm: { technical: 0.50, sentiment: 0.05, fundamental: 0.45 },
};
```
Espejar la misma filosofía en el fallback de 4 ejes de `scoring.ts:57-69` (sentiment 0.05, redistribuir a technical/evidence). Verificar que ambos objetos sumen 1.0 (hay tests de suma? agregar assertion).
- [ ] **Step 2: Test** — assert que los pesos activos suman 1 y que sentiment ≤ 0.05 en ambos horizontes; snapshot del composite para un fixture conocido (para detectar el cambio deliberado, actualizar los fixtures existentes que asumían pesos viejos).
- [ ] **Step 3: Borrar `COMPOSITE_WEIGHTS`** (dead) y su export.
- [ ] **Step 4:** build:shared + suite + commit — `fix: sentiment a 0.05 en el score — r=0.03 medido, no paga su peso (tech r=0.24)`.

---

### Task 6: Extractor de tickers — matar la clase ROAD en origen

**Files:**
- Create: `apps/backend/src/news/ticker-extraction.ts` (pura) + test
- Modify: `apps/backend/src/news/news-aggregator.service.ts:246-263` y `apps/backend/src/web-search/web-search.service.ts:42-45` (usar la nueva)
- Modify: `apps/backend/src/intelligence/unified-analysis.service.ts` (`buildCompactCard`: incluir nombre de empresa) + `packages/shared/src/constants/prompts.ts` (UNIFIED_ASSET_ANALYSIS_PROMPT: regla de identidad)

**Evidencia:** substring matching extrajo ROAD de "B**road**band" y CAST de "Com**cast**" → `related_symbols` envenenado → el LLM recomendó ROAD (Construction Partners) como "Liberty Broadband" con niveles, publicado en market_reports id=98. "EL"/"AS"/"ON" contaminan ~10% de los artículos cada uno.

- [ ] **Step 1: Tests que fallan** (los casos reales del relevamiento):
```typescript
describe('extractTickersFromText', () => {
  const universe = new Set(['ROAD', 'CMCSA', 'LBRDA', 'GIS', 'NVDA', 'TSM', 'EL', 'DK']);
  it('NO extrae ROAD de "Broadband" ni CAST de "Comcast" (substring)', () => {
    const t = extractTickersFromText('Liberty Broadband stock surges 15% on Comcast spinoff news', universe);
    expect(t).not.toContain('ROAD');
  });
  it('extrae tickers como palabra completa en mayúsculas', () => {
    expect(extractTickersFromText('TSM beats estimates; NVDA rallies', universe)).toEqual(expect.arrayContaining(['TSM', 'NVDA']));
  });
  it('tickers de 1-2 letras SOLO con prefijo $ o contexto explícito', () => {
    expect(extractTickersFromText('Estée Lauder (EL) cae tras guidance', universe)).toContain('EL');
    expect(extractTickersFromText('EL presidente habló del mercado', universe)).not.toContain('EL');
    expect(extractTickersFromText('$EL breaking out', universe)).toContain('EL');
  });
  it('valida contra el universo: palabra en mayúsculas fuera del universo no es ticker', () => {
    expect(extractTickersFromText('FT reports on AI companies', universe)).toEqual([]);
  });
});
```
- [ ] **Step 2: Implementar** — reglas: (a) candidatos SOLO por word-boundary (`\b[A-Z]{1,5}\b` con lookaround que excluya estar dentro de una palabra más larga — el regex actual ya usa \b pero los casos ROAD/CAST vienen de otro camino: VERIFICAR de dónde salió "CAST de Comcast"; si el matching actual es case-insensitive o por includes, corregirlo); (b) TODO candidato debe estar en el universo conocido (symbols + discovered + curated + portfolio — pasar el Set como parámetro); (c) tickers de 1-2 letras: exigir `$TICKER` o `(TICKER)` parentetizado; (d) blocklist ampliada (CEO, AI, FT, INC, ETF, USD, GDP, EPS, IPO, Q1-Q4...). Cablear en los 2 call sites (que hoy registran a discovery con `registerNovelTickers` — el universo para validación en ese caso es el universo Yahoo-validable existente + las reglas b/c/d).
- [ ] **Step 3: Identidad en la card del LLM** — `buildCompactCard`: primera línea pasa a `SYMBOL (Nombre Real de la Empresa) $price | ...` usando `classification?.name ?? fundamentals name` (verificar qué campo con nombre llega a ese contexto; si ninguno, obtenerlo del fundMap/classification del caller). En el prompt: `"La empresa de cada símbolo es la que se indica entre paréntesis. PROHIBIDO atribuir el símbolo a otra empresa o a eventos de otra empresa."`
- [ ] **Step 4:** Suite + commit — `fix: extractor de tickers con word-boundary y universo — mata la clase ROAD de alucinaciones`.

---

### Task 7: Web search honesto + chat con contexto del motor

**Files:**
- Modify: `apps/backend/src/shared/env.ts` (validar las keys REALES: TAVILY_API_KEY, EXA_API_KEY, GROQ_API_KEY_1.., GOOGLE_AI_API_KEY_1..)
- Modify: `apps/backend/src/intelligence/pipeline.service.ts` (stage webSearch: si no hay NINGUNA key → status `skipped` con detail claro, no `failed`+retry+error spam; hoy: 104 errores en 121 runs)
- Modify: `apps/backend/src/chat/chat.service.ts` (inyectar acciones del último scan al system prompt)

- [ ] **Step 1: env check al startup** — en `env.ts` o `index.ts`: log INFO una vez con el estado real de cada proveedor: `[Env] Tavily: NO configurada — stage webSearch se salteará`, etc. Sin throw (todo es opcional), pero visible.
- [ ] **Step 2: Stage skip explícito** — en `runWebSearchStage`: si ni TAVILY_API_KEY ni EXA_API_KEY existen → `status: 'skipped'`, detail `'sin API keys de búsqueda web — configurá TAVILY_API_KEY en .env'`, return temprano sin tocar los providers. El pipeline ya tolera webSearch parcial.
- [ ] **Step 3: Chat con motor** — en `chat.service.ts`, agregar al system prompt un bloque compacto con el último scan: `"ACCIONES ACTUALES DEL MOTOR (no las contradigas sin decir explícitamente que estás contradiciendo al motor y por qué): TSM=BUY, MARA=SELL, ..."` (leer de `getLatestOpportunityScan`, solo símbolos con action BUY/SELL + posiciones; cap ~20 símbolos).
- [ ] **Step 4:** Suite + commit — `fix: webSearch honesto sin keys + chat consciente del motor`.

**Nota para el usuario (no bloquea):** cargar `TAVILY_API_KEY` real en `.env` si se quiere el stage 1 vivo — hoy está caído desde hace semanas.

---

### Task 8: Medir el filtro de setups — flag persistido + expectancy segmentada

**Files:**
- Modify: `apps/backend/src/db/schema.ts` (signal_tracking: `setupInvalid: integer('setup_invalid')` boolean) + migración (post-Task 1 el journal ya está sano)
- Modify: `apps/backend/src/opportunities/signal-tracking.service.ts` (`recordSignals`: persistir el flag; y trackear TAMBIÉN los BUY degradados a WATCH por setup — hoy quedan fuera y el filtro no es medible)
- Modify: `apps/backend/src/db/repository.ts` (`getSignalAccuracyStats`: expectancy segmentada)
- Modify: `apps/frontend/src/daily/AccuracyPanel.tsx`

- [ ] **Step 1: Schema + migración** (ALTER ADD COLUMN; journal ya reparado). 
- [ ] **Step 2: recordSignals** — persistir `setupInvalid: opp.tradeLevels?.setupQuality === 'invalid'`; y agregar tracking de degradados: si `opp.action === 'WATCH'` y `setupQuality === 'invalid'` → registrar con `action='WATCH'` + flag (para medir después si el filtro salvó plata o costó upside).
- [ ] **Step 3: Stats segmentadas** — `getSignalAccuracyStats` devuelve además: `expectancyRClean` (solo filas con riesgo del stop ≤ `MAX_SETUP_RISK_PCT`: `abs(entry-stop)/entry <= 0.10`) y `expectancyRLegacy` (el resto) — con Ns. Evidencia que lo motiva: 50.3% de filas históricas tienen stop >10% y comprimen el avg hacia 0 (+0.032 clean vs −0.018 legacy medidos en el review del P1).
- [ ] **Step 4: UI** — AccuracyPanel muestra "Expectancy (setups válidos): +X.XXR (n=...)" como métrica principal y la legacy en tooltip/secundaria.
- [ ] **Step 5:** Suite + typechecks + commit — `feat: el filtro de setups se mide — flag persistido y expectancy segmentada`.

---

### Task 9: Verificación end-to-end P2

- [ ] **Step 1:** `npm run build:shared && npm run typecheck && npm run test --workspace=apps/backend` — verde (anotar conteo nuevo).
- [ ] **Step 2:** Journal: `SELECT MAX(created_at) FROM __drizzle_migrations` < hoy; `SELECT COUNT(*) FROM unified_analysis_results` > 0 tras el próximo pipeline run (o el test de write de Task 1).
- [ ] **Step 3:** Caso MARA sintético: fixture con engine SELL + precio sobre el stop → verbo REVISAR en el test de today-decisions (ya cubierto por Task 2; confirmar en verde).
- [ ] **Step 4:** Extractor: correr los tests con los casos ROAD/Comcast (Task 6).
- [ ] **Step 5:** Review final whole-branch (fable) + fixes + merge según decida el usuario.

---

## Recortado a P3 (a consciencia)

Regenerar report/digest en cada refresh (por ahora: banner de staleness alcanza; regenerar = 1 llamada LLM cara por refresh) · reconciliar evidence BUY_SETUP con la acción del scan · limpieza retroactiva de `related_symbols` históricos (21k filas — el fix de Task 6 corta el flujo nuevo; lo viejo expira solo por TTL 7d) · prompt caching · JSON schema forzado por provider · widen DeepAnalysis.generatedBy · delay entre batches del screener · exhausted en 400 de contexto · CEDEARs con datos ARS en quality bar.
