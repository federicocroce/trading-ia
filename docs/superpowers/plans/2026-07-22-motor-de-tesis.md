# Motor de Tesis — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** La app forma OPINIÓN como un trader: tesis semanales top-down (narrativa + catalizador + condición de entrada + precio de invalidación + horizonte), generadas por LLM desde los insumos del sistema (radar, macro, oportunidades), registradas y medidas como cualquier señal. Responde "¿por qué subirme y hasta dónde?", no "¿qué puntúa alto hoy?".

**Architecture:** Tabla `theses` nueva (migración drizzle — ⚠️ landmine). Generador semanal: insumos → prompt → `callAI` (router existente con fallbacks) → JSON validado por función pura fail-closed (tesis sin invalidación numérica = descartada) → persist. Evaluador diario (función pura + wiring en el pipeline): activa → gatillada (entry tocada) / invalidada (invalidación tocada) / expirada (horizonte vencido), con outcome medido vs SPY. Tab "Tesis" en el frontend. **Frontera dura**: las tesis JAMÁS tocan scoring/veredictos/scan — son capa advisory paralela, etiquetada como opinión LLM, con su propio track record.

**Tech Stack:** drizzle/better-sqlite3, `callAI` de `shared/ai-router.ts`, zod, vitest, React 19.

## Global Constraints

- **Migración drizzle = LANDMINE (regla dura #6)**: backup de `data/trading.db` ANTES de `npm run db:generate --workspace=apps/backend`; la migración nueva lleva `when` MAYOR a todas las existentes en el journal; aplicar con `npm run db:migrate --workspace=apps/backend` (incremental, jamás fresh); verificar columnas en la DB viva con `sqlite3` antes de asumir que un insert funciona.
- Fail-closed: tesis del LLM sin `invalidationPrice` numérico o sin `entryCondition` parseable → SE DESCARTA con log (jamás se persiste a medias). Evaluador sin precio vivo del símbolo → la tesis queda como está (sin transición silenciosa).
- El LLM CREA tesis (capa advisory nueva, medida) pero NADA de este módulo importa hacia `opportunities/scoring` ni toca verbos del scan. La regla "LLM solo degrada" del scan queda intacta — frontera documentada en código.
- envNumber lazy; comentarios español; ESM `.js`; TDD para toda lógica pura; payloads tRPC aditivos.
- Tests: `npm run test --workspace=apps/backend`. Branch: `feat/motor-tesis` desde main.

---

### Task 0: Branch + backup DB

- [ ] **Step 1:**
```bash
cd /Users/federicocroce/Docu/Fede/trading && git checkout main && git checkout -b feat/motor-tesis
cp data/trading.db "data/trading.db.backup-$(date +%Y%m%d-%H%M%S)" && ls -la data/*.backup* | tail -1
```

---

### Task 1: Schema + migración `theses`

**Files:**
- Modify: `apps/backend/src/db/schema.ts` (tabla nueva al final, siguiendo el patrón de las existentes)
- Generated: `apps/backend/drizzle/00XX_*.sql` (vía db:generate)

**Interfaces (Producer para Tasks 2-5):** tabla drizzle `theses`:

```typescript
export const theses = sqliteTable('theses', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  createdDate: text('created_date').notNull(),          // YYYY-MM-DD
  title: text('title').notNull(),                        // "Bancos US: giro de tasas"
  direction: text('direction').notNull(),                // 'alcista' | 'bajista'
  narrative: text('narrative').notNull(),                // el "por qué", citando insumos
  catalyst: text('catalyst'),                            // catalizador esperado (nullable)
  primarySymbol: text('primary_symbol').notNull(),       // el símbolo que mide la tesis
  symbols: text('symbols').notNull(),                    // JSON array: implementaciones posibles
  entryConditionText: text('entry_condition_text').notNull(),
  entryTriggerPrice: real('entry_trigger_price').notNull(),
  entryComparator: text('entry_comparator').notNull(),   // 'above' | 'below'
  invalidationPrice: real('invalidation_price').notNull(),
  invalidationReason: text('invalidation_reason').notNull(),
  horizonDays: integer('horizon_days').notNull(),
  status: text('status').notNull().default('activa'),    // activa|gatillada|cumplida|invalidada|expirada
  triggeredAt: text('triggered_at'),
  resolvedAt: text('resolved_at'),
  outcomeReturnPct: real('outcome_return_pct'),           // retorno del primarySymbol desde gatillo (o creación si nunca gatilló)
  outcomeVsSpyPct: real('outcome_vs_spy_pct'),
  sourceEvidence: text('source_evidence'),                // JSON: radar states, macro events, scores usados
  llmProvider: text('llm_provider'),
  createdAt: text('created_at').default(sql`(datetime('now'))`).notNull(),
});
```

- [ ] **Step 1:** Agregar la tabla a `schema.ts` (⚠️ mirar imports/patrón de tablas vecinas: `sqliteTable`, `sql` ya importados).
- [ ] **Step 2:** `npm run db:generate --workspace=apps/backend` → revisar el SQL generado (solo CREATE TABLE theses, nada más) y el journal: la entrada nueva DEBE tener `when` mayor que todas las anteriores (`tail apps/backend/drizzle/meta/_journal.json`). Si el generate tocó algo más: PARAR y reportar BLOCKED.
- [ ] **Step 3:** `npm run db:migrate --workspace=apps/backend` → verificar en la DB viva: `sqlite3 data/trading.db "PRAGMA table_info(theses);"` muestra todas las columnas.
- [ ] **Step 4:** `npm run typecheck` + suite completa verde.
- [ ] **Step 5:** Commit: `feat(tesis): tabla theses + migración` (+ trailer Co-Authored-By: Claude Fable 5 <noreply@anthropic.com> — igual en TODOS los commits del plan).

---

### Task 2: Validación pura de tesis del LLM (TDD)

**Files:**
- Create: `apps/backend/src/theses/thesis-validator.ts`
- Test: `apps/backend/src/theses/thesis-validator.test.ts`

**Interfaces (Producer):**
```typescript
export interface RawThesis { /* shape que se le pide al LLM, todos opcionales/unknown */ }
export interface ValidThesis {
  title: string; direction: 'alcista' | 'bajista'; narrative: string; catalyst: string | null;
  primarySymbol: string; symbols: string[];
  entryConditionText: string; entryTriggerPrice: number; entryComparator: 'above' | 'below';
  invalidationPrice: number; invalidationReason: string; horizonDays: number;
}
export function validateThesis(raw: unknown, livePrices: Map<string, number>): { ok: true; thesis: ValidThesis } | { ok: false; reason: string };
```

**Reglas fail-closed (cada una con test rojo primero):**
1. Campos obligatorios presentes y tipados (title/direction/narrative/primarySymbol/entry*/invalidation*/horizonDays); falta alguno → `{ok:false, reason}` nombrando el campo.
2. `direction` solo 'alcista'|'bajista'; `entryComparator` solo 'above'|'below'; `horizonDays` entero 5-120.
3. Coherencia de niveles vs precio vivo del `primarySymbol` (de `livePrices`; sin precio → rechazo):
   - alcista: `invalidationPrice < precioVivo` y `entryTriggerPrice` dentro de ±25% del precio vivo (el LLM alucina niveles — un trigger a 3x el precio es basura).
   - bajista: `invalidationPrice > precioVivo`, mismo límite de ±25% para el trigger.
4. `primarySymbol` debe estar en `symbols`; symbols ≤ 5; título ≤ 120 chars; narrative ≥ 100 chars (una tesis sin "por qué" sustancial no es tesis).
5. Números no finitos/negativos → rechazo.

- [ ] **Step 1:** Test file con ~8 casos (los 5 grupos de reglas + 1 happy path alcista + 1 bajista + 1 sin precio vivo). Escribir asserts contra mensajes de `reason` por regex laxa (`/invalidaci[oó]n/i` etc), no strings exactos.
- [ ] **Step 2:** RED → implementar → GREEN → suite completa → commit `feat(tesis): validador puro fail-closed de tesis LLM (TDD)`.

---

### Task 3: Transiciones del evaluador (puro, TDD)

**Files:**
- Create: `apps/backend/src/theses/thesis-evaluator.ts`
- Test: `apps/backend/src/theses/thesis-evaluator.test.ts`

**Interfaces (Producer):**
```typescript
export interface ThesisState {
  status: string; direction: string; entryTriggerPrice: number; entryComparator: string;
  invalidationPrice: number; horizonDays: number; createdDate: string; triggeredAt: string | null;
}
export interface ThesisTransition { newStatus: 'gatillada' | 'invalidada' | 'expirada' | 'cumplida' | null; reason: string | null; }
export function evaluateThesis(t: ThesisState, price: number | null, today: string): ThesisTransition;
```

**Reglas (test rojo primero cada grupo):**
1. `price` null/no-finito → `{newStatus: null}` (fail-closed: sin precio no hay transición).
2. Estados terminales (cumplida/invalidada/expirada) → nunca transicionan.
3. `activa`: invalidación tocada (alcista: price ≤ invalidationPrice; bajista: price ≥) → 'invalidada'. Entry tocada ('above': price ≥ trigger; 'below': price ≤) → 'gatillada'. **Invalidación gana si ambas** (fail-closed: en la duda, la tesis muere). Horizonte vencido sin gatillo (`today > createdDate + horizonDays`) → 'expirada'.
4. `gatillada`: invalidación tocada → 'invalidada'. Horizonte vencido (desde createdDate) → 'cumplida' (sobrevivió el horizonte sin invalidarse; el outcome numérico lo calcula el service, no esta función).

- [ ] **Step 1:** ~9 tests → RED → implementar → GREEN → suite → commit `feat(tesis): evaluador puro de transiciones (TDD)`.

---

### Task 4: Repository + generador semanal + evaluador diario (services)

**Files:**
- Modify: `apps/backend/src/db/repository.ts` (insert/list/update de theses — mirar patrones vecinos)
- Create: `apps/backend/src/theses/thesis-generator.service.ts`
- Create: `apps/backend/src/theses/thesis-runner.service.ts`
- Modify: `apps/backend/src/shared/cron.ts` (dos hooks)

**Generador (`generateWeeklyTheses()`):**
1. Insumos (todo ya existe — ⚠️ verificar nombres reales de getters): último snapshot del radar (`getLatestCycleRadarDate`+`getCycleRadarSnapshots`), macro events recientes (tabla `macro_events`, últimos 7 días), top-10 del último scan (`getLatestOpportunityScan`), régimen (`getMarketRegime`).
2. Prompt (en español, un solo mensaje): pasa los insumos resumidos + INSTRUCCIÓN estricta de devolver JSON array de 1-3 tesis con el shape exacto de `RawThesis`, con niveles numéricos coherentes con los precios provistos. Incluir en el prompt los precios vivos de los símbolos candidatos (getQuotes) para que el LLM no alucine niveles.
3. `callAI` (⚠️ leer firma real en `shared/ai-router.ts:103`; usar el patrón de parseo JSON de `unified-analysis.service.ts` — ya resuelve fences/reintentos).
4. Cada tesis del array → `validateThesis(raw, livePrices)`; las `ok:false` se loguean y descartan; las válidas → insert con `sourceEvidence` (JSON de qué insumos se usaron) y `llmProvider`.
5. Devuelve `{ generated, discarded, reasons }`. Idempotencia: si ya hay tesis con `createdDate` = hoy → skip con log (no duplicar por re-corrida).

**Runner (`evaluateActiveTheses()`):**
1. Lee tesis con status activa|gatillada; `getQuotes` de sus primarySymbols (+ SPY).
2. `evaluateThesis` por tesis → si hay transición: update status/fechas; al llegar a terminal, calcular `outcomeReturnPct` (precio actual vs precio al gatillo si gatilló — persistir precio de gatillo en `triggeredAt`... nota: guardar el precio del gatillo requiere columna; simplificación v1 aceptada y documentada: outcome = retorno del primarySymbol desde el CIERRE de `createdDate` hasta la resolución, y `outcomeVsSpyPct` = eso menos el retorno de SPY mismo período, usando `getHistoricalQuotes`) — fail-closed: sin datos históricos → outcome null con log.
3. Log por transición.

**Cron:** tesis semanales lunes 10:00 UTC (`'0 10 * * 1'`); evaluador diario a continuación del pipeline existente de pre-market (buscar el job diario 7:30 ET y agregar la llamada al final, fire-and-forget con try/catch propio).

- [ ] **Step 1:** Repository helpers + services (sin test unitario — I/O; la lógica de decisión ya quedó pura en Tasks 2-3, patrón del repo).
- [ ] **Step 2:** `npm run typecheck` + suite completa.
- [ ] **Step 3:** Commit `feat(tesis): generador semanal LLM + evaluador diario + crons`.

---

### Task 5: tRPC + tab "Tesis"

**Files:**
- Create: `apps/backend/src/theses/theses.router.ts` → merge en `src/router.ts` (patrón de los routers vecinos)
- Create: `apps/frontend/src/theses/ThesesPage.tsx`
- Modify: `apps/frontend/src/App.tsx` (tab 'tesis' en VALID_TABS + trigger + content — patrón exacto del commit `14ffc81` que agregó 'cartera')

**Router:** `theses.list` (todas, orden created desc), `theses.generate` (mutation manual — para probar sin esperar al lunes), `theses.evaluate` (mutation manual del runner).

**UI (mirar patrones de CarteraPage/TabInfo):**
- TabInfo explicando qué es una tesis y el caveat: "Opinión generada por LLM sobre los insumos del sistema. Medida como todo lo demás — track record visible. NO es una orden."
- Card por tesis: título + dirección (badge verde/rojo) + estado (badge) + narrativa + catalizador + tabla de niveles (entrada / invalidación / horizonte) + fechas + outcome si terminal.
- Botón "Generar tesis ahora" (mutation generate, disabled mientras corre) + "Re-evaluar" (mutation evaluate).
- Footer: track record agregado cuando haya terminales (n, % cumplidas, retorno medio vs SPY) — si n=0, texto honesto "Sin tesis resueltas todavía — el track record aparece acá".

- [ ] **Step 1:** Router + UI + typecheck + suite.
- [ ] **Step 2:** Commit `feat(tesis): endpoint + tab Tesis`.

---

### Task 6: Primera corrida real + docs

- [ ] **Step 1:** Con el backend vivo (3001): `curl -X POST http://localhost:3001/trpc/theses.generate` (⚠️ formato tRPC mutation: POST con body `{}` — mirar cómo el frontend llama mutations o usar la UI directamente vía Playwright). Verificar: 1-3 tesis en la DB con niveles coherentes (chequear a mano contra precios reales), descartes logueados si hubo.
- [ ] **Step 2:** Revisar la CALIDAD de las tesis generadas (juicio de dominio): ¿la narrativa cita insumos reales (radar/macro) o es genérica? ¿los niveles son sensatos? Si salen tesis-basura genéricas → iterar el prompt UNA vez (más contexto, exigir citas de insumos) y regenerar. Documentar en el reporte ambas corridas.
- [ ] **Step 3:** `.env.example`: no hay vars nuevas (horizontes vienen del LLM validados 5-120) — verificar; si el implementador agregó alguna, documentarla.
- [ ] **Step 4:** Prompt maestro: sección 5 (estado: motor de tesis v1, frontera con el scan, medición) + sección 7 (pregunta abierta: "¿las tesis LLM miden edge? n≥30 terminales; si a los 6 meses no superan a SPY, el motor se degrada a narrativa o se apaga").
- [ ] **Step 5:** Commit `docs(tesis): estado, frontera y pregunta abierta`.

---

## Self-Review

- La frontera "tesis jamás tocan el scan" está en constraints, en el architecture y pedida como comentario en código (Task 4 no importa nada hacia opportunities/scoring — solo LEE).
- Tipos: `ValidThesis` (T2) alimenta el insert (T4); `ThesisState`/`ThesisTransition` (T3) los consume el runner (T4); shape de la tabla (T1) consistente con ambos.
- Landmine de migración cubierta con protocolo explícito en Task 1 y backup en Task 0.
- Placeholder consciente: outcome v1 desde cierre de createdDate (documentado como simplificación; precio-de-gatillo exacto = v2 con columna extra).
- Riesgo conocido: calidad de tesis LLM con datos gratis — por eso Task 6 Step 2 la evalúa a mano y la pregunta abierta define el criterio de muerte (6 meses, n≥30, vs SPY).
