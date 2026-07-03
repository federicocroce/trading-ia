# P1 — Edge y Automatización Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Convertir el sistema honesto (post-P0) en uno operable con edge medible: setups con riesgo acotado, expectancy en R-múltiplos, pipeline automático pre-market, y cierre de los agujeros que dejó el review final del P0.

**Architecture:** Misma disciplina que P0 — lógica nueva como funciones puras testeables, I/O en orquestadores existentes, fail-closed. Una migración de schema (columna `r_multiple`).

**Tech Stack:** TypeScript ESM, vitest, drizzle + better-sqlite3, node-cron v4.

## Global Constraints

- Branch de trabajo: `fix/p1-edge` creado desde `feat/outcome-resolver` (HEAD actual, post-merge P0).
- Tests: `npm run test --workspace=apps/backend`. Typecheck: `npm run typecheck --workspace=apps/backend`. Si se toca `packages/shared`: `npm run build:shared` primero.
- Comentarios en español, imports ESM `.js`, funciones puras separadas del I/O.
- Env vars numéricas SIEMPRE con el patrón `envNumber` lazy (leído por invocación, nunca a nivel módulo — lección del P0: ESM hoisting corre antes de dotenv).
- No cambiar la forma de la API tRPC salvo campos ADITIVOS opcionales.
- El outcome `'invalid'` queda excluido de toda estadística nueva (patrón ya establecido en P0).

### Decisiones de diseño (mandato: rediseñar lo que esté mal)

1. **El bug real de niveles NO es "falta ATR"** (computeTradeLevels ya usa ATR y busca R/R ≥ 1.5). El bug es que el stop estructural no tiene clamp: en un chart destruido (SDOT post reverse-split) el "soporte" queda a -97% del entry. Fix: riesgo máximo del setup acotado; si la estructura pide más riesgo, el setup es INVÁLIDO y la acción se degrada a WATCH.
2. **Win/loss ya es path-aware (P0); lo que falta es EXPECTANCY.** No se redefine outcome otra vez: se agrega `r_multiple` persistido y expectancy = media(R) en las stats. Un sistema con 37% win rate y expectancy +0.3R gana plata; uno con 55% y -0.2R quiebra. Esa es la métrica de verdad.
3. **Recortado a P2** (costo/beneficio): JSON-schema forzado en providers (el parseo ya tiene json_object + jsonrepair + fallbacks), prompt caching, migrar reasoning a Claude pago (decisión de costo del usuario), timeout extra en askLMStudio (ya tiene 120s en el cliente SDK).

---

### Task 1: Clamp de riesgo en computeTradeLevels + setup inválido degrada la acción

**Files:**
- Modify: `packages/shared/src/types/opportunity.ts` (interface `TradeLevels` — localizarla con grep; agregar campos opcionales)
- Modify: `apps/backend/src/opportunities/scoring.ts:941-1099` (`computeTradeLevels`) y el caller principal (~L1523 y L1550/1568/1592)
- Test: `apps/backend/src/opportunities/scoring.test.ts` (agregar describe block)

**Interfaces:**
- Produces: `TradeLevels.setupQuality?: 'valid' | 'invalid'` y `TradeLevels.setupWarning?: string`. Task 2 asume que `stopLoss` de señales nuevas ya viene clampeado.

- [ ] **Step 1: Tests que fallan** — agregar a `scoring.test.ts` (ajustar la construcción de `TechnicalSummary` al patrón de tests existentes del archivo; si no existe helper, armar el objeto mínimo `{ indicators: { currentPrice, atr14, supports, resistances, ... } }` con los campos que `computeTradeLevels` lee — exportar `computeTradeLevels` si hoy no está exportada):

```typescript
describe('computeTradeLevels — clamp de riesgo (caso SDOT)', () => {
  it('stop estructural absurdo se clampea a 3x ATR', () => {
    // SDOT-like: precio 24.58, ATR 2.0, "soporte" del chart destruido en 0.77
    const tech = mkTech({ currentPrice: 24.58, atr14: 2.0, supports: [{ price: 0.77, touches: 3 }], resistances: [] });
    const levels = computeTradeLevels(tech, 'BUY')!;
    // stop clampeado: nunca más lejos que 3x ATR del entry
    expect(levels.entryPrice - levels.stopLoss).toBeLessThanOrEqual(3 * 2.0 + 0.01);
    expect(levels.setupQuality).toBe('valid');
  });

  it('riesgo > MAX_SETUP_RISK_PCT marca setup invalid', () => {
    // Precio 10, ATR gigante 2.5 → stop ATR queda a -37.5% > 10% máximo
    const tech = mkTech({ currentPrice: 10, atr14: 2.5, supports: [], resistances: [] });
    const levels = computeTradeLevels(tech, 'BUY')!;
    expect(levels.setupQuality).toBe('invalid');
    expect(levels.setupWarning).toContain('riesgo');
  });

  it('setup normal sigue valid sin cambios', () => {
    const tech = mkTech({ currentPrice: 100, atr14: 2, supports: [{ price: 96, touches: 4 }], resistances: [{ price: 110, touches: 3 }] });
    const levels = computeTradeLevels(tech, 'BUY')!;
    expect(levels.setupQuality).toBe('valid');
    expect(levels.stopLoss).toBeGreaterThan(90);
  });
});
```

- [ ] **Step 2: RED** — `npm run test --workspace=apps/backend -- scoring` debe fallar (campos inexistentes).

- [ ] **Step 3: Tipo** — en `TradeLevels` (packages/shared) agregar:

```typescript
  /** 'invalid' = el riesgo del setup excede el máximo tolerable; no operar, la acción se degrada. */
  setupQuality?: 'valid' | 'invalid';
  setupWarning?: string;
```

- [ ] **Step 4: Implementar el clamp en `computeTradeLevels`** — en la rama BUY/WATCH, después de calcular `stopLoss` estructural y antes del target:

```typescript
    // Clamp de riesgo: un "soporte" de un chart roto (reverse split, colapso) puede quedar
    // a -90% del entry. El stop NUNCA queda más lejos que MAX_STOP_ATR_MULT x ATR.
    const MAX_STOP_ATR_MULT = 3;
    const maxStopDistance = atr * MAX_STOP_ATR_MULT;
    if (entryPrice - stopLoss > maxStopDistance) {
      stopLoss = Math.round((entryPrice - maxStopDistance) * 100) / 100;
      stopReason = `Clamp: stop estructural demasiado lejano — ajustado a ${MAX_STOP_ATR_MULT}x ATR ($${atr.toFixed(2)})`;
    }
```

Espejo en la rama SELL (`stopLoss - entryPrice > maxStopDistance` → `entryPrice + maxStopDistance`). En la rama HOLD aplicar el mismo clamp al stop informativo.

Después del cálculo de `riskRewardRatio` (L1064-1066), evaluar la calidad del setup (para TODAS las ramas):

```typescript
  // Setup inválido: si aún clampeado el riesgo excede el % máximo del precio, no es operable.
  const MAX_SETUP_RISK_PCT = envNumber('MAX_SETUP_RISK_PCT', 10); // % del entry
  const riskPct = Math.abs(entryPrice - stopLoss) / entryPrice * 100;
  const setupQuality: 'valid' | 'invalid' = riskPct > MAX_SETUP_RISK_PCT ? 'invalid' : 'valid';
  const setupWarning = setupQuality === 'invalid'
    ? `riesgo del setup ${riskPct.toFixed(1)}% > máximo ${MAX_SETUP_RISK_PCT}% — no operar`
    : undefined;
```

Incluir ambos campos en el objeto de retorno. `envNumber`: reutilizar el helper (hoy vive en `tradeability.ts` y `ai-router.ts` — moverlo a `apps/backend/src/shared/env-number.ts` exportado y que los 3 archivos lo importen; eliminar los duplicados).

- [ ] **Step 5: Degradar la acción con setup inválido** — en `scoring.ts`, después del call site principal de `computeTradeLevels` (~L1523) y de los re-cálculos (L1550/1568/1592), agregar UNA verificación final antes de armar el verdict (buscar dónde se cierra el objeto resultado, cerca de `resolveFinalVerdict` ~L1632):

```typescript
  // Setup con riesgo inaceptable: BUY se degrada a WATCH — señal sin trade operable no es señal.
  if (result.tradeLevels?.setupQuality === 'invalid' && (result.action === 'BUY')) {
    result.action = 'WATCH';
    // registrar en el trace del verdict si existe: `veto:setup_invalido (${setupWarning})`
  }
```

Adaptar al flujo real del verdict (si los vetos van por `applyAxisVetos`/trace, integrarlo ahí con el mismo formato `veto:`). El implementador debe mirar cómo se construye `result.verdict.trace` y usar el mecanismo existente.

- [ ] **Step 6: GREEN + suite completa** — `npm run build:shared && npm run typecheck --workspace=apps/backend && npm run test --workspace=apps/backend`.

- [ ] **Step 7: Commit** — `fix: clamp de riesgo en trade levels — setup con riesgo >10% degrada BUY a WATCH`

---

### Task 2: R-múltiplos persistidos + expectancy en stats

**Files:**
- Modify: `apps/backend/src/db/schema.ts` (tabla `signalTracking`: agregar `rMultiple: real('r_multiple')`)
- Create: migración vía `npm run db:generate --workspace=apps/backend` (drizzle-kit) + `npm run db:migrate --workspace=apps/backend`
- Modify: `apps/backend/src/intelligence/outcome-resolver.ts` (agregar cálculo puro de R)
- Modify: `apps/backend/src/opportunities/signal-tracking.service.ts` (persistir r en la resolución) y `apps/backend/src/db/repository.ts` (`resolveSignal` acepta `rMultiple`; `getSignalAccuracyStats` devuelve `avgR` y `expectancyR`)
- Create: `apps/backend/src/scripts/backfill-r-multiple.ts` + npm script `db:backfill-r`
- Modify: `apps/frontend/src/daily/AccuracyPanel.tsx` (mostrar expectancy)
- Test: `apps/backend/src/intelligence/outcome-resolver.test.ts`

**Interfaces:**
- Produces: `computeRMultiple(action, entryPrice, stopLoss, resolutionPrice): number | null` exportada de outcome-resolver.

- [ ] **Step 1: Tests que fallan** (outcome-resolver.test.ts):

```typescript
describe('computeRMultiple', () => {
  it('long que sale en target 2R da +2', () => {
    expect(computeRMultiple('BUY', 100, 95, 110)).toBeCloseTo(2);
  });
  it('long que sale en el stop da -1', () => {
    expect(computeRMultiple('BUY', 100, 95, 95)).toBeCloseTo(-1);
  });
  it('short gana cuando baja', () => {
    expect(computeRMultiple('SELL', 100, 105, 90)).toBeCloseTo(2);
  });
  it('sin stop válido devuelve null (no se puede medir riesgo)', () => {
    expect(computeRMultiple('BUY', 100, null, 110)).toBeNull();
    expect(computeRMultiple('BUY', 100, 100, 110)).toBeNull(); // stop == entry
    expect(computeRMultiple('BUY', 100, 120, 110)).toBeNull(); // stop incoherente
  });
});
```

- [ ] **Step 2: RED**, luego implementar en `outcome-resolver.ts`:

```typescript
/**
 * R-múltiplo: retorno medido en unidades de riesgo asumido (distancia entry→stop).
 * +2R = ganaste el doble de lo que arriesgabas. Es la métrica de expectancy real:
 * un sistema con 37% de aciertos y salidas a +2R es rentable; % de aciertos solo, no dice nada.
 */
export function computeRMultiple(
  action: 'BUY' | 'SELL' | 'HOLD' | 'WATCH',
  entryPrice: number,
  stopLoss: number | null | undefined,
  resolutionPrice: number,
): number | null {
  if (stopLoss == null || entryPrice <= 0) return null;
  const isShort = action === 'SELL';
  const risk = isShort ? stopLoss - entryPrice : entryPrice - stopLoss;
  if (risk <= 0) return null; // stop incoherente con la dirección
  const move = isShort ? entryPrice - resolutionPrice : resolutionPrice - entryPrice;
  return Math.round((move / risk) * 100) / 100;
}
```

- [ ] **Step 3: Schema + migración** — agregar `rMultiple: real('r_multiple'),` a `signalTracking` en schema.ts (verificar que `real` ya esté importado); correr `npm run db:generate --workspace=apps/backend` (revisar el SQL generado: debe ser un simple ALTER TABLE ADD COLUMN) y `npm run db:migrate --workspace=apps/backend`.

- [ ] **Step 4: Persistir en resolución** — en `signal-tracking.service.ts`, dentro de `resolveExpiredSignals` donde se llama `resolveSignal(...)`, calcular y pasar:

```typescript
        rMultiple: res.resolutionPrice != null && res.outcome !== 'invalid'
          ? computeRMultiple(signal.action as any, signal.entryPrice, signal.stopLoss, res.resolutionPrice)
          : null,
```

y en `repository.ts` ampliar la firma de `resolveSignal` con `rMultiple?: number | null`.

- [ ] **Step 5: Stats** — en `getSignalAccuracyStats` (repository.ts ~L922, ya filtra a win/loss/neutral): agregar al resultado `avgR` (media de `rMultiple` no-null) y `expectancyR` (misma media — es la expectancy por trade) + `rSampleSize`. Calculable en JS sobre las filas ya traídas.

- [ ] **Step 6: Backfill barato** — `apps/backend/src/scripts/backfill-r-multiple.ts`: recorre `signal_tracking` con outcome win/loss/neutral y `r_multiple IS NULL`, calcula con `computeRMultiple(action, entry_price, stop_loss, price_after_30d)` (usar `priceAfter30d` como resolutionPrice; si es null, saltear) y actualiza. SIN fetches externos — todo desde columnas existentes. npm script `"db:backfill-r": "tsx src/scripts/backfill-r-multiple.ts"`. Ejecutarlo y reportar: filas actualizadas + `SELECT round(avg(r_multiple),2) FROM signal_tracking WHERE r_multiple IS NOT NULL`.

- [ ] **Step 7: UI** — en `AccuracyPanel.tsx`, junto al win rate, mostrar `Expectancy: {expectancyR > 0 ? '+' : ''}{expectancyR}R por señal` con color verde si > 0, rojo si < 0 (seguir el estilo de badges del archivo). El endpoint tRPC que sirve accuracy stats ya devuelve el objeto de `getSignalAccuracyStats` — campo aditivo, no rompe nada.

- [ ] **Step 8: GREEN + suite + typecheck monorepo. Commit** — `feat: r-múltiplos y expectancy en signal tracking (la métrica que importa)`

---

### Task 3: Cron pre-market — el pipeline corre solo

**Files:**
- Modify: `apps/backend/src/shared/cron.ts`

**Interfaces:** consume `checkOrRunPipeline(force, sectors?, aiMode?)` de pipeline.service (firma verificada: `pipeline.service.ts:596`).

- [ ] **Step 1: Agregar el cron** — en `startCronJobs()`, siguiendo el patrón de import dinámico del cron existente de las 23:00 (`cron.ts:45`):

```typescript
  // Pipeline pre-market: corre solo a las 7:30 ET (lun-vie) para que el digest
  // esté listo ANTES de la apertura. Sin esto el sistema solo "anticipa" cuando
  // el usuario aprieta el botón — o sea, nunca a tiempo.
  cron.schedule('30 7 * * 1-5', async () => {
    console.log('[Cron] Pipeline pre-market (7:30 ET)...');
    try {
      const { checkOrRunPipeline } = await import('../intelligence/pipeline.service.js');
      await checkOrRunPipeline(false);
      console.log('[Cron] Pipeline pre-market OK');
    } catch (err) {
      console.error('[Cron] Pipeline pre-market error:', (err as Error).message);
    }
  }, { timezone: 'America/New_York' });
```

Nota: node-cron v4 acepta `{ timezone }` como tercer argumento — verificar el tipo exacto que exporta la versión instalada (si `schedule` tipa las options distinto, adaptar). `force=false` reusa stages válidos del día si el usuario ya corrió algo — correcto.

- [ ] **Step 2: Verificación** — typecheck + suite. Verificación manual del wiring: arrancar el backend (`npm run dev:backend` en otro proceso o confiar en el tsx watch vivo) y confirmar en el log de arranque que el cron se registró sin throw (agregar `console.log('[Cron] pre-market pipeline registrado (7:30 ET)')` al final de `startCronJobs` si no hay log equivalente).

- [ ] **Step 3: Commit** — `feat: pipeline automático pre-market 7:30 ET (lun-vie)`

---

### Task 4: Quality bar en el evidence-screener

**Files:**
- Modify: `apps/backend/src/evidence-signals/symbol-screener.service.ts:216-232`
- Test: crear `apps/backend/src/evidence-signals/symbol-screener.service.test.ts` SOLO si se extrae helper puro (recomendado); si no, verificación por typecheck + log

**Interfaces:** consume `meetsQualityBar` de `../opportunities/tradeability.js` y `getFundamentals` (o el servicio de cache `fundamental-analysis.service.ts` — usar el camino CON cache DB, no fetch directo).

- [ ] **Step 1: Filtrar los símbolos dinámicos** — después del filtro regex existente (`:221-223`) y ANTES de `cachedUniverse = [...universe]`:

```typescript
  // Quality bar sobre los símbolos DINÁMICOS (NASDAQ beats + EDGAR): un micro-cap
  // con insider buy sigue siendo un micro-cap — mismo vector SDOT, otro emisor.
  // Los curados están exentos (son large caps por construcción, y el fetch masivo no aporta).
  const dynamicOnly = [...universe].filter((s) => !CURATED_US_SYMBOLS.has(s));
  const rejected: string[] = [];
  for (const symbol of dynamicOnly) {
    try {
      const summary = await getCachedFundamentals(symbol); // usar la función real con cache DB (verificar nombre en fundamental-analysis.service.ts)
      const ok = meetsQualityBar({
        marketCap: summary?.data.marketCap,
        currentPrice: summary?.data.currentPrice,
        instrumentType: 'accion', // beats/EDGAR son siempre acciones US
      });
      if (!ok) { universe.delete(symbol); rejected.push(symbol); }
    } catch {
      universe.delete(symbol); rejected.push(symbol); // fail-closed: sin datos no entra
    }
  }
  if (rejected.length) console.log(`[Screener] Quality bar rechazó ${rejected.length} dinámicos: ${rejected.slice(0, 10).join(', ')}`);
```

El implementador DEBE verificar: (a) el nombre/shape real del servicio de fundamentals con cache (`fundamental-analysis.service.ts` — buscá la función que usa `fundamentalCache` de DB; NO usar `getFundamentals` crudo de yahoo.ts que no cachea); (b) que `CURATED_US_SYMBOLS` sea un Set (si es array, usar `.includes`); (c) que el flujo sea async-compatible (la función contenedora ya es async).

- [ ] **Step 2: Typecheck + suite. Commit** — `fix: quality bar sobre símbolos dinámicos del evidence-screener (cierra vector SDOT en evidence)`

---

### Task 5: Market report consume la acción GATEADA

**Files:**
- Modify: `apps/backend/src/opportunities/opportunities.service.ts` (bloque del gate LLM, ~L904-925)
- Test: verificación por typecheck + test existente de gate (no hay test del report; anotarlo)

**Contexto:** `generateMarketReport` calcula `suggestedWeight = analysis.action === 'BUY' ? 10 : ...` (market-report.service.ts:238) desde `precomputedAnalyses` — el `UnifiedAssetAnalysis.action` CRUDO del LLM, pre-gate. Un upgrade bloqueado (WATCH→BUY) igual pesa 10 en el reporte.

- [ ] **Step 1: Sincronizar la acción del unified con el gate** — en el loop del gate en `opportunities.service.ts`, después de resolver `gated`:

```typescript
        // Sincronizar el unified con la acción GATEADA: el market report consume
        // unified.action para suggestedWeight — sin esto, un upgrade bloqueado
        // igual pesa como BUY en el reporte (bypass del gate detectado en review P0).
        unified.action = (opp.verdict ? opp.verdict.finalAction : opp.action) as typeof unified.action;
```

Colocarlo al FINAL del cuerpo del `if (unified)` (después de que ambas ramas — con y sin verdict — hayan resuelto la acción final). `verdict.layers.llmAction` ya preserva la sugerencia original del LLM para la UI, así que no se pierde información.

- [ ] **Step 2: Typecheck + suite completa. Commit** — `fix: market report pesa recomendaciones con la acción gateada, no la cruda del LLM`

---

### Task 6: Tracking de tokens + limpieza de modelos

**Files:**
- Modify: `apps/backend/src/shared/groq.ts`, `gemini.ts`, `openrouter.ts` (leer usage), `claude.ts` (modelo), `ai-router.ts` (propagar usage)
- Modify: `apps/backend/src/intelligence/unified-analysis.service.ts` (persistir tokens en el batch audit)
- Test: `apps/backend/src/shared/ai-router.test.ts` solo si existe; si no, typecheck + verificación por log

**Interfaces:**
- Produces: `callAIWithModel` devuelve `{ content, model, tokensInput?: number, tokensOutput?: number }` (campos aditivos).

- [ ] **Step 1: Providers devuelven usage.**
  - `groq.ts`: en `askGroqWithRotation` (~L123-137), leer `response.usage?.prompt_tokens` / `completion_tokens` y devolver `{ content, model, tokensInput, tokensOutput }` (ampliar `GroqResult`).
  - `gemini.ts`: `result.response.usageMetadata?.promptTokenCount` / `candidatesTokenCount`. OJO: hoy las funciones devuelven `string` — para no romper todos los callers, agregar función paralela o devolver vía objeto SOLO en el camino que consume ai-router (el implementador decide el corte más chico; documentarlo en el report).
  - `openrouter.ts`: `response.usage?.prompt_tokens` / `completion_tokens`, mismo criterio.
- [ ] **Step 2: ai-router propaga** — `tryProvider`/`callAIWithModel` capturan usage cuando el provider lo entrega y lo incluyen en el retorno. `callAI`/`callAIText` no cambian su firma (siguen devolviendo string).
- [ ] **Step 3: Persistir** — `unified-analysis.service.ts:207-222`: pasar `tokensInput`/`tokensOutput` del resultado de `callAIWithModel` a `saveUnifiedAnalysisBatch` (las columnas existen y hoy quedan null). Además, log por batch: `[Unified] batch N: X in / Y out tokens (modelo)`.
- [ ] **Step 4: Limpieza de modelos.**
  - `openrouter.ts:16-23`: eliminar `meta-llama/llama-4-scout:free` y `google/gemma-4-31b-it:free` (IDs inexistentes que 404ean y degradan la cadena); agregar `deepseek/deepseek-r1:free` como primer modelo (así la etiqueta "DeepSeek R1 (OpenRouter)" de ai-router.ts:155 deja de ser mentira — y el doblado de maxTokens para reasoning por fin se activa).
  - `claude.ts:19,37`: `claude-sonnet-4-20250514` → `claude-sonnet-5` (el chat pasa a Sonnet 5).
- [ ] **Step 5: Typecheck + suite. Verificación en vivo si el backend está corriendo: disparar UNA llamada al chat o esperar el próximo radar y confirmar en DB `SELECT tokens_input, tokens_output FROM unified_analysis_batches ORDER BY id DESC LIMIT 3` (puede requerir un pipeline run — si no es viable ahora, anotarlo y validar en el smoke final).**
- [ ] **Step 6: Commit** — `feat: tracking real de tokens por llamada + limpieza de model IDs muertos + Sonnet 5 en chat`

---

### Task 7: UI honesta + higiene de tests

**Files:**
- Modify: `apps/frontend/src/daily/DailySummary.tsx:238-255`
- Modify: `apps/frontend/src/opportunities/OpportunityCard.tsx:657-668`
- Modify: `apps/frontend/src/macro/MacroRegimeWidget.tsx`
- Modify: `apps/backend/vitest.config.ts` (o crear si la config vive en package.json)

- [ ] **Step 1: Badge INVÁLIDA** — en el ternario del outcome badge de `DailySummary.tsx`, antes del fallback NEUTRAL:

```tsx
  : s.outcome === 'invalid' ? 'bg-orange-500/20 text-orange-400'
```
y en el label: `s.outcome === 'invalid' ? 'INVÁLIDA' : 'NEUTRAL'`. (Datos corruptos ≠ resultado neutral.)

- [ ] **Step 2: Trace bloqueado en ámbar** — en `OpportunityCard.tsx:661-666`, ANTES del check genérico `llm:`:

```tsx
  step.startsWith('llm:sugirió') ? 'text-amber-300' :
```
(un upgrade bloqueado no puede verse igual de verde que un cambio aplicado).

- [ ] **Step 3: Regime degradado visible** — en `MacroRegimeWidget.tsx` (lee `trpc.macro.regime`): si `data.degraded`, renderizar un badge extra `SIN DATOS FRESCOS` (estilo amber/warning consistente con el archivo) junto al badge de régimen, con tooltip/texto corto: "No se pudo calcular el régimen — LONGs nuevos bloqueados por seguridad". El campo ya viaja por tRPC (verificado en vivo).

- [ ] **Step 4: vitest exclude dist** — en la config de vitest del backend agregar `exclude: ['**/dist/**', '**/node_modules/**']` (hoy los `dist/*.test.js` stale inflan los conteos). Verificar que el conteo de tests BAJA respecto de la corrida anterior y anotar el número real.

- [ ] **Step 5: Typecheck frontend (`npm run typecheck --workspace=apps/frontend`) + suite backend. Commit** — `fix: UI honesta (INVÁLIDA, trace bloqueado, regime degradado) + vitest sin dist stale`

---

### Task 8: Verificación end-to-end P1

- [ ] **Step 1:** `npm run build:shared && npm run typecheck && npm run test --workspace=apps/backend` — todo verde (anotar el conteo real post-exclude).
- [ ] **Step 2:** Expectancy: `sqlite3 data/trading.db "SELECT COUNT(*), round(avg(r_multiple),2) FROM signal_tracking WHERE r_multiple IS NOT NULL"` — debe haber filas y un avg plausible (entre -1.5 y +3).
- [ ] **Step 3:** Screener: forzar refresh del universo (o log del próximo scan) y confirmar el log `[Screener] Quality bar rechazó N dinámicos`.
- [ ] **Step 4:** Backend vivo: `curl localhost:3001/trpc/macro.regime` sigue OK; revisar log de arranque del cron pre-market.
- [ ] **Step 5:** Review final whole-branch (subagent-driven: fable) y merge según elija el usuario.

---

## P2 backlog (recortado de P1 a consciencia)

JSON-schema forzado por provider (Groq json_schema / Gemini responseSchema) · prompt caching · migrar reasoning a Claude Sonnet 5 pago (decisión de costo del usuario — el chat ya quedó en Sonnet 5) · entry-zone check en ejecución (orden límite vs mercado) · salida por tiempo y break-even a +1R automáticos en today-decisions · índices DB + retención + VACUUM · CEDEARs con datos ARS en quality bar · `envNumber` compartido ya se unifica en Task 1.
