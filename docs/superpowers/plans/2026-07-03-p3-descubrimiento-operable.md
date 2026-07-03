# P3 — Descubrimiento Operable Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Que la app proponga candidatos operables del mercado ENTERO cada día (no solo de la burbuja de watchlist/noticias), reutilice los degradados como entradas futuras con timing, y diga explícitamente "hoy no se opera" cuando corresponde — en vez de estirar un pick flojo.

**Architecture:** Un stage de screener de mercado que alimenta el registro de discovery existente (reusa TTL/eviction/clasificación); funciones puras para el embudo y la detección de re-armado; señalización determinística en el digest (no LLM). Todo pasa por los filtros anti-humo ya construidos (quality bar, clamp de riesgo, gate LLM).

**Tech Stack:** TypeScript ESM, vitest, Yahoo predefined screeners (gratis, sin key nueva).

## Global Constraints

- Branch: `fix/p3-descubrimiento` desde `feat/outcome-resolver` (HEAD post-P2).
- Tests canónicos: `npm run test --workspace=apps/backend` (baseline: 346) — TODO reporte de verificación debe citar el output textual de ESE comando (lección del incidente Task 5 P2: verificación fabricada). Typecheck backend y frontend. `build:shared` si se toca shared.
- Comentarios en español, imports ESM `.js`, env lazy con `envNumber`, fail-closed.
- Campos nuevos en payloads tRPC: ADITIVOS (spread), nunca wrappers.
- Endpoint verificado en vivo (2026-07-03): `https://query1.finance.yahoo.com/v1/finance/screener/predefined/saved?scrIds=most_actives&count=100` devuelve quotes con `symbol`, `marketCap`, `regularMarketPrice`, `regularMarketVolume`, `regularMarketChangePercent` — la quality bar se aplica SIN fetches extra. scrIds a usar: `most_actives`, `day_gainers`, `day_losers`.
- Migraciones: el journal ya está sano (P2); `drizzle-kit generate` funciona normal. Verificar igual el SQL generado.

### Contexto de código (verificado en sesiones previas)

- `discovery/discovery-registry.ts`: `registerNovelTickers(symbols, source)` con `MAX_DISCOVERED=120`, TTL 14 días, clasificación vía asset-classifier, columna `discovered_from` en `discovered_symbols`. El scan arma su universo con portfolio ∪ causal ∪ discovered ∪ ETFs — registrar en discovered = entrar al scan.
- `opportunities/tradeability.ts`: `meetsQualityBar({marketCap, currentPrice, instrumentType})` fail-closed.
- `opportunities/scoring.ts`: `computeTradeLevels(tech, action, ...)` → `TradeLevels` con `setupQuality: 'valid'|'invalid'`, `setupWarning`; `ind.resistances` (array por toques) disponible en `TechnicalSummary.indicators`.
- `signal_tracking.setup_invalid` (P2 Task 8) se persiste por señal desde hoy; `opportunity_snapshots.data` JSON trae `tradeLevels.setupQuality` por símbolo/día.
- `anticipatory_alerts` tiene columna `kind` (default 'anticipatory') — apta para `kind='rearm'`; `reconcileAlerts` maneja expiración 7 días; frontend ya renderiza alertas.
- Digest: `market-report.service.ts` construye y persiste `MarketDigest` (tipo en packages/shared/src/types/intelligence.ts); `digest-recommendations.ts` proyecta recommendations determinísticas del scan. `DailySummary.tsx` lo renderiza.
- `technical-analysis.service.ts` → `getTechnicalSummary(symbol)` calcula todo con cache de históricos.

---

### Task 1: Cliente de screeners Yahoo + embudo puro

**Files:**
- Create: `apps/backend/src/shared/yahoo-screener.ts` (I/O: fetch de los 3 scrIds, dedup, shape mínimo)
- Create: `apps/backend/src/discovery/market-screener.ts` (embudo PURO: quotes → candidatos) + test
- Test: `apps/backend/src/discovery/market-screener.test.ts`

**Interfaces:**
- Produces: `fetchScreenerQuotes(): Promise<ScreenerQuote[]>` donde `ScreenerQuote = { symbol, name, marketCap, price, volume, changePct }`; y `filterScreenerCandidates(quotes: ScreenerQuote[], opts?): ScreenerQuote[]` (pura — Task 2 la consume).

- [ ] **Step 1: Tests del embudo puro (RED)**:

```typescript
import { describe, it, expect } from 'vitest';
import { filterScreenerCandidates } from './market-screener.js';

const q = (symbol: string, over: Partial<ReturnType<typeof base>> = {}) => ({ ...base(symbol), ...over });
const base = (symbol: string) => ({ symbol, name: symbol, marketCap: 5_000_000_000, price: 50, volume: 10_000_000, changePct: 2 });

describe('filterScreenerCandidates — embudo anti-humo', () => {
  it('rechaza micro-caps y penny (quality bar)', () => {
    const out = filterScreenerCandidates([q('OK'), q('MICRO', { marketCap: 30_000_000 }), q('PENNY', { price: 2.5 })]);
    expect(out.map(c => c.symbol)).toEqual(['OK']);
  });
  it('rechaza lo que ya voló >15% en el día (anti-chase, ambas direcciones)', () => {
    const out = filterScreenerCandidates([q('OK'), q('PUMP', { changePct: 22 }), q('DUMP', { changePct: -18 })]);
    expect(out.map(c => c.symbol)).toEqual(['OK']);
  });
  it('rechaza market cap null (fail-closed)', () => {
    const out = filterScreenerCandidates([q('NOCAP', { marketCap: null as unknown as number })]);
    expect(out).toEqual([]);
  });
  it('dedup por símbolo (aparece en gainers Y most_actives)', () => {
    const out = filterScreenerCandidates([q('DUP'), q('DUP')]);
    expect(out).toHaveLength(1);
  });
  it('cap de candidatos (default 40) ordenado por volumen', () => {
    const many = Array.from({ length: 60 }, (_, i) => q(`S${i}`, { volume: 1_000_000 * (i + 1) }));
    const out = filterScreenerCandidates(many);
    expect(out).toHaveLength(40);
    expect(out[0].symbol).toBe('S59'); // mayor volumen primero
  });
});
```

- [ ] **Step 2: Implementar el embudo** — `filterScreenerCandidates`: dedup por símbolo → `meetsQualityBar({marketCap, currentPrice: price, instrumentType: 'accion'})` (import de tradeability — los screeners de Yahoo devuelven equities; ETFs llegan igual: si aparece un ETF conocido no hay problema, la quality bar de acción es MÁS estricta) → `Math.abs(changePct) <= envNumber('SCREENER_MAX_DAY_MOVE_PCT', 15)` → sort por volumen desc → slice `envNumber('SCREENER_MAX_CANDIDATES', 40)`.
- [ ] **Step 3: Cliente I/O** — `yahoo-screener.ts`: `fetchScreenerQuotes()` pega a los 3 scrIds (`most_actives`, `day_gainers`, `day_losers`, count=100 c/u) con los mismos headers/patrón de `shared/yahoo.ts` (User-Agent, manejo de error por lista: una lista caída no tumba las otras — `Promise.allSettled`), mapea al shape `ScreenerQuote` (campos: `symbol`, `shortName→name`, `marketCap`, `regularMarketPrice→price`, `regularMarketVolume→volume`, `regularMarketChangePercent→changePct`), y concatena. Sin cache propio (se llama 1 vez por pipeline).
- [ ] **Step 4: GREEN + typecheck + commit** — `feat: screener de mercado — cliente Yahoo + embudo puro anti-humo`

---

### Task 2: Stage de screener en el pipeline — candidatos al universo del scan

**Files:**
- Create: `apps/backend/src/discovery/market-screener.service.ts` (orquestador: fetch → embudo → validación técnica → registro)
- Modify: `apps/backend/src/intelligence/pipeline.service.ts` (invocar antes del stage analysis; no-bloqueante)

**Interfaces:**
- Consumes: Task 1; `getTechnicalSummary` (technical-analysis.service); `computeTradeLevels` (scoring.ts — verificar que esté exportada; el P1 la exportó para tests); `registerNovelTickers(symbols, source)` (discovery-registry — verificar la firma real y los valores válidos de `source`/`discovered_from`; si 'screener' no es un valor aceptado por el tipo, ampliarlo).
- Produces: `runMarketScreener(): Promise<{ candidates: number; registered: string[] }>`.

- [ ] **Step 1: Orquestador** — `runMarketScreener()`:

```typescript
// Embudo completo: mercado entero → operables.
// 1. fetch + filtro barato (sin I/O extra)
// 2. técnicos SOLO para los ~40 sobrevivientes (cache de históricos existente, limiter Yahoo global)
// 3. solo setups VALID con RR >= SCREENER_MIN_RR (default 2) entran al universo
const quotes = await fetchScreenerQuotes();
const cheap = filterScreenerCandidates(quotes);
const operables: string[] = [];
for (const c of cheap) {
  try {
    const tech = await getTechnicalSummary(c.symbol);
    const levels = computeTradeLevels(tech, 'BUY');
    if (levels?.setupQuality === 'valid' && (levels.riskRewardRatio ?? 0) >= envNumber('SCREENER_MIN_RR', 2)) {
      operables.push(c.symbol);
    }
  } catch { /* símbolo sin datos: fuera, fail-closed */ }
}
if (operables.length) await registerNovelTickers(operables, 'screener');
console.log(`[Screener] mercado: ${quotes.length} → embudo ${cheap.length} → operables ${operables.length}: ${operables.slice(0, 10).join(', ')}`);
return { candidates: cheap.length, registered: operables };
```
(Adaptar a las firmas reales; el loop secuencial está bien — el limiter global de Yahoo ya acota, y son ≤40 símbolos con cache.)

- [ ] **Step 2: Wiring en el pipeline** — en `pipeline.service.ts`, invocar `runMarketScreener()` justo ANTES del stage analysis (después de fundamentals), envuelto en try/catch no-bloqueante (si falla, log y el scan corre con el universo de siempre). Registrarlo en el detail de algún stage existente o log propio — NO crear un stage nuevo en el shape de `pipelineRuns` (evitar migración de estados); un `console.log` + inclusión en `discovered` alcanza para v1.
- [ ] **Step 3: Verificación runtime** — con el backend corriendo: `curl -s -X POST localhost:3001/trpc/intelligence.generateMarketReport -H 'content-type: application/json' -d '{"json":{"force":true}}'` NO hace falta esperar el run entero: verificá por separado ejecutando `runMarketScreener()` vía un script one-shot (`npx tsx -e` o script en scripts/) y comprobá: log con el embudo, y `SELECT symbol, discovered_from FROM discovered_symbols WHERE discovered_from='screener'` con filas. Documentar output real en el report.
- [ ] **Step 4: Suite + typecheck + commit** — `feat: candidatos operables del mercado entero entran al scan (source screener)`

---

### Task 3: Watchlist de re-armado — los degradados avisan cuando se vuelven operables

**Files:**
- Create: `apps/backend/src/opportunities/rearm-detector.ts` (pura) + test
- Modify: `apps/backend/src/opportunities/opportunities.service.ts` (post-scan: detectar + persistir alertas)

**Interfaces:**
- Consumes: snapshots de ayer (`opportunity_snapshots` vía repository — buscar/crear un getter por fecha) y opportunities de hoy en memoria.
- Produces: `detectRearmedSetups(today: Opportunity[], yesterdayInvalid: Set<string>): RearmCandidate[]` con `RearmCandidate = { symbol, entryPrice, stopLoss, takeProfit, score }`.

- [ ] **Step 1: Tests (RED)**:

```typescript
describe('detectRearmedSetups — degradados que se vuelven operables', () => {
  it('detecta: ayer invalid, hoy valid con BUY/WATCH y score decente', () => {
    const today = [mkOpp('PAM', { action: 'WATCH', score: 63, setupQuality: 'valid' })];
    const out = detectRearmedSetups(today, new Set(['PAM']));
    expect(out.map(r => r.symbol)).toEqual(['PAM']);
  });
  it('NO detecta si hoy sigue invalid', () => {
    const today = [mkOpp('GGAL', { action: 'WATCH', score: 62, setupQuality: 'invalid' })];
    expect(detectRearmedSetups(today, new Set(['GGAL']))).toEqual([]);
  });
  it('NO detecta si ayer no era invalid (no hay transición)', () => {
    const today = [mkOpp('TSM', { action: 'BUY', score: 70, setupQuality: 'valid' })];
    expect(detectRearmedSetups(today, new Set())).toEqual([]);
  });
  it('exige score mínimo 55 y action BUY o WATCH', () => {
    const today = [
      mkOpp('LOW', { action: 'WATCH', score: 40, setupQuality: 'valid' }),
      mkOpp('HOLD1', { action: 'HOLD', score: 70, setupQuality: 'valid' }),
    ];
    expect(detectRearmedSetups(today, new Set(['LOW', 'HOLD1']))).toEqual([]);
  });
});
```
(`mkOpp` helper construye el objeto Opportunity mínimo con `tradeLevels.setupQuality` — mirar el shape real.)

- [ ] **Step 2: Implementar** — pura, transición `invalid→valid` + `action ∈ {BUY, WATCH}` + `score ≥ envNumber('REARM_MIN_SCORE', 55)`. Devuelve niveles del setup de HOY.
- [ ] **Step 3: Wiring** — en `runLiveScan` post-scan (donde ya se hacen recordSignals/alertas): construir `yesterdayInvalid` desde `opportunity_snapshots` del día anterior (`json_extract(data,'$.tradeLevels.setupQuality')='invalid'` — agregar getter en repository si no existe), correr el detector, y persistir cada candidato como `anticipatory_alerts` con `kind='rearm'` y los niveles (la tabla ya tiene entry/stop/takeProfit/score) — verificar la firma del insert de alertas y el flujo `reconcileAlerts` para no duplicar por día. Log: `[Rearm] N setups se volvieron operables: ...`.
- [ ] **Step 4: Frontend mínimo** — donde se renderizan las alertas anticipatorias (grep `anticipatory` en apps/frontend), distinguir `kind='rearm'` con label "SETUP OPERABLE" (badge verde/esmeralda) — el resto del render se reusa.
- [ ] **Step 5: Suite + typechecks + commit** — `feat: watchlist de re-armado — los degradados alertan cuando su setup se vuelve operable`

---

### Task 4: Modo "hoy no se opera" + convicción visible + R/R honesto

**Files:**
- Modify: `apps/backend/src/intelligence/market-report.service.ts` (digest: flag noTradeMode + suggestedWeight por convicción)
- Modify: `packages/shared/src/types/intelligence.ts` (campo aditivo `noTradeMode?: { active: boolean; reason: string }` en MarketDigest)
- Modify: `apps/backend/src/opportunities/scoring.ts` (`TradeLevels.rrToFirstResistance` — campo aditivo en shared)
- Modify: `apps/frontend/src/daily/DailySummary.tsx` (banner no-trade) y donde se muestren niveles (OpportunityCard: mostrar ambos R/R)
- Test: market-report.service.test.ts + scoring.test.ts

- [ ] **Step 1: noTradeMode (determinístico, no LLM)** — al construir el digest, computar desde el scan:

```typescript
// "La paciencia es la posición": pocos setups operables o régimen volatile ⇒ decirlo, no estirar un pick.
const validBuys = opportunities.filter(o => o.action === 'BUY' && o.tradeLevels?.setupQuality === 'valid');
const regime = /* régimen del quant context si está disponible en este punto — verificar */;
const noTradeMode = validBuys.length < envNumber('NO_TRADE_MIN_SETUPS', 3)
  ? { active: true, reason: `Solo ${validBuys.length} setup(s) operable(s)${regime === 'volatile' ? ' en régimen volátil' : ''} — los candidatos de calidad están en la watchlist de re-armado esperando que el riesgo se normalice.` }
  : { active: false, reason: '' };
```
Campo aditivo en el digest (spread). Test: scan con 1 BUY válido → active true; con 5 → false.

- [ ] **Step 2: suggestedWeight por convicción** — en `market-report.service.ts` (donde hoy es `action==='BUY'?10:...`): BUY con score ≥65 y setup valid → 10; BUY con score <65 → 6; BUY con setup invalid (no debería existir post-gate, defensivo) → 5; SELL → 0; resto → 5. Necesita el score: verificar qué llega a ese punto (si `UnifiedAssetAnalysis` no trae score, cruzar con el scan que ya está en `digestInputs.opportunities`). Test del mapeo.
- [ ] **Step 3: rrToFirstResistance** — en `computeTradeLevels` (rama BUY/WATCH): si hay `resistances[0] > entryPrice`, `rrToFirstResistance = (resistances[0].price - entryPrice) / (entryPrice - stopLoss)` (redondeado, null si no hay resistencia arriba). Campo aditivo en TradeLevels (shared). Test: fixture con resistencia cercana → RR menor al RR del target lejano. Frontend: donde se muestra `R/R`, mostrar `R/R 1:X (a 1ª resistencia 1:Y)` si difieren.
- [ ] **Step 4: Banner no-trade en DailySummary** — si `digest.noTradeMode?.active`, banner destacado arriba de topOpportunities (estilo consistente, ámbar/gris): el reason + link a alertas de re-armado.
- [ ] **Step 5: build:shared + typechecks + suite + commit** — `feat: modo hoy-no-se-opera, peso por convicción y R/R a primera resistencia`

---

### Task 5: Aviso de correlación en recomendaciones

**Files:**
- Create: `apps/backend/src/opportunities/correlation-warning.ts` (pura) + test
- Modify: `apps/backend/src/intelligence/market-report.service.ts` (agregar warning al digest)

- [ ] **Step 1: Test (RED)**:

```typescript
describe('detectConcentrationWarning', () => {
  it('avisa cuando 3+ recomendaciones BUY comparten sector', () => {
    const w = detectConcentrationWarning([
      mkRec('PAM', 'Energía', 'BUY'), mkRec('YPF', 'Energía', 'BUY'), mkRec('VIST', 'Energía', 'BUY'), mkRec('TSM', 'Tech', 'BUY'),
    ]);
    expect(w).toContain('Energía');
    expect(w).toContain('3');
  });
  it('null si no hay concentración', () => {
    expect(detectConcentrationWarning([mkRec('A', 'Tech', 'BUY'), mkRec('B', 'Salud', 'BUY')])).toBeNull();
  });
});
```

- [ ] **Step 2: Implementar** — agrupa BUYs por `sector` (campo ya presente en Opportunity/snapshots); ≥3 en el mismo → string `"⚠ Concentración: N de tus M recomendaciones BUY son el mismo trade (sector X) — diversificá o tomá una sola."`. Wiring: push al array `warnings` del digest (respetando el orden SALIDA: primero de P2).
- [ ] **Step 3: Suite + commit** — `feat: aviso de concentración — no proponer 4 veces el mismo trade`

---

### Task 6: Verificación end-to-end P3

- [ ] **Step 1:** `npm run build:shared && npm run typecheck && npm run test --workspace=apps/backend` — todo verde (citar conteo textual).
- [ ] **Step 2:** Runtime del screener: script one-shot de `runMarketScreener()` → log del embudo con números reales + `discovered_symbols` con `discovered_from='screener'`.
- [ ] **Step 3:** Pipeline completo (`force=true`) O esperar el pre-market del día siguiente: verificar que los símbolos del screener aparecen en el scan (opportunity_snapshots) y pasaron por el verdict normal.
- [ ] **Step 4:** Digest del run: si el día sigue volatile, `noTradeMode.active=true` con el reason; alertas `kind='rearm'` si algún degradado de ayer se re-armó.
- [ ] **Step 5:** Review final whole-branch (fable) + fixes + merge según el usuario.

---

## Fuera de alcance (dicho a consciencia)

Day-trading intradía (velas 1-5min, otra infraestructura y otro edge — no recomendado con este stack) · screeners pagos (Finviz/TradingView) · opciones sobre candidatos del screener · backtest del embudo del screener (cuando signal_tracking junte 1-2 meses de señales source='screener', medir su expectancy segmentada — el tracking ya lo captura gratis).
