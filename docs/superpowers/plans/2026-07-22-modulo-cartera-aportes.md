# Módulo Cartera (modo aportes) — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** El sistema responde "¿dónde va cada dólar nuevo?" — clasifica la cartera real en capas (núcleo/riesgo/cobertura), detecta violaciones de bandas, y asigna aportes nuevos a la capa más subponderada. Advisory total: jamás ejecuta, jamás elige picks individuales (eso es del scan).

**Architecture:** Función de decisión pura (`buildAllocationPlan`) alimentada por `getPortfolio()` (posiciones ya valorizadas a precio vivo), expuesta como procedure tRPC aditivo `portfolio.allocationPlan`, renderizada como panel en la tab Portfolio debajo del diagnóstico existente. Capas v1: `nucleo` (ETFs índice whitelisteados), `cobertura` (oro/bonos/metálico whitelisteados), `riesgo` (todo lo demás: tesis macro + satélite swing juntos — separarlos requiere declaración del usuario, v2). Instrumentos sugeridos SOLO de whitelist amplia (SPY, GLD) — nunca acciones individuales.

**Tech Stack:** TypeScript ESM (`.js` en imports), vitest, tRPC, React 19 + Tailwind 4.

## Global Constraints

- Regla #1 fail-closed: posición sin precio vivo (`currentPrice` ≤ 0 o no finito) ⇒ el plan NO se genera; se devuelve `{ ok: false, reason }` con el símbolo culpable. Jamás plan parcial silencioso.
- Regla #3 envNumber lazy DENTRO de funciones: bandas configurables `CARTERA_TARGET_NUCLEO` (default 55), `CARTERA_TARGET_COBERTURA` (12), `CARTERA_MAX_RIESGO` (35), `CARTERA_MAX_POSICION` (20).
- Regla #4 payloads tRPC aditivos: procedure NUEVO, sin tocar los existentes.
- Regla #5: comentarios en español, TDD, función de decisión pura sin I/O.
- El módulo NO toca scoring, verdictos, ni pesos. NO recomienda vender (modo aportes: preferencia del dueño 2026-07-22). Las violaciones se INFORMAN, la corrección propuesta es siempre vía aportes.
- Tests: `npm run test --workspace=apps/backend`. Branch: `feat/modulo-cartera` desde main.

---

### Task 0: Branch

- [ ] **Step 1:**
```bash
cd /Users/federicocroce/Docu/Fede/trading && git checkout main && git checkout -b feat/modulo-cartera
```

---

### Task 1: Clasificador de capas + plan de asignación (puro, TDD)

**Files:**
- Create: `apps/backend/src/portfolio/allocation-plan.ts`
- Test: `apps/backend/src/portfolio/allocation-plan.test.ts`

**Interfaces:**
- Consumes: nada del repo (puro).
- Produces (Task 2 consume EXACTAMENTE esto):
```typescript
export type CarteraLayer = 'nucleo' | 'cobertura' | 'riesgo';
export function layerForSymbol(symbol: string): CarteraLayer;
export interface AllocationInput { positions: Array<{ symbol: string; value: number; currentPrice: number }>; newCashUsd: number; }
export interface LayerBreakdown { layer: CarteraLayer; value: number; pct: number; targetPct: number; }
export interface AllocationPlanOk {
  ok: true;
  totalValue: number;
  layers: LayerBreakdown[];
  violations: string[];            // texto en español, una por regla violada
  contributions: Array<{ layer: CarteraLayer; usd: number; instruments: string[]; nota: string }>;
}
export interface AllocationPlanFail { ok: false; reason: string; }
export type AllocationPlan = AllocationPlanOk | AllocationPlanFail;
export function buildAllocationPlan(input: AllocationInput): AllocationPlan;
```

**Reglas exactas de `buildAllocationPlan`:**
1. Fail-closed: alguna posición con `value` o `currentPrice` no finito o ≤ 0 ⇒ `{ ok: false, reason: 'Sin precio vivo de <SYMBOL> — plan no generado' }`. Cartera vacía y `newCashUsd` 0 ⇒ `{ ok: false, reason: 'Cartera vacía y sin aporte' }`.
2. Capas por whitelist (case-insensitive):
   - `NUCLEO_ETFS = ['SPY','VOO','IVV','QQQ','VT','VTI','ACWI']`
   - `COBERTURA_ETFS = ['GLD','IAU','SGOL','GLDM','TLT','IEF','SHV','BIL']`
   - resto ⇒ `riesgo`.
3. Targets (envNumber lazy): núcleo `CARTERA_TARGET_NUCLEO`=55, cobertura `CARTERA_TARGET_COBERTURA`=12, riesgo = `100 − nucleo − cobertura` (33). `pct` de cada capa sobre `totalValue + newCashUsd` (el plan mira la cartera POST-aporte).
4. Violaciones (informativas, texto español): riesgo actual > `CARTERA_MAX_RIESGO` (35); alguna posición individual > `CARTERA_MAX_POSICION` (20) del total.
5. Aportes: greedy hacia targets — todo `newCashUsd` se reparte entre las capas SUBPONDERADAS (pct post-aporte < target) proporcionalmente a su déficit en USD; el `riesgo` JAMÁS recibe aporte sugerido aunque esté subponderado (`nota: 'El riesgo se llena con setups del scan, no con aportes'` y `usd: 0` — o directamente excluirlo del reparto; incluir la nota como entry con usd 0 solo si riesgo está subponderado). Redondeo a enteros de USD; el residuo de redondeo va a la capa con mayor déficit.
6. `instruments`: núcleo ⇒ `['SPY']`, cobertura ⇒ `['GLD']`. Jamás otra cosa en v1.
7. `newCashUsd` = 0 es válido: devuelve breakdown + violaciones con `contributions: []`.

- [ ] **Step 1: Test rojo** — crear `allocation-plan.test.ts`:

```typescript
import { describe, it, expect } from 'vitest';
import { layerForSymbol, buildAllocationPlan } from './allocation-plan.js';

const pos = (symbol: string, value: number) => ({ symbol, value, currentPrice: 100 });

describe('layerForSymbol', () => {
  it('ETFs índice → nucleo; oro/bonos → cobertura; acciones → riesgo', () => {
    expect(layerForSymbol('SPY')).toBe('nucleo');
    expect(layerForSymbol('gld')).toBe('cobertura');
    expect(layerForSymbol('GGAL')).toBe('riesgo');
  });
});

describe('buildAllocationPlan — fail-closed', () => {
  it('posición sin precio vivo: plan no generado, nombra al culpable', () => {
    const r = buildAllocationPlan({ positions: [{ symbol: 'GGAL', value: 100, currentPrice: 0 }], newCashUsd: 1000 });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toContain('GGAL');
  });

  it('cartera vacía sin aporte: no hay nada que planear', () => {
    expect(buildAllocationPlan({ positions: [], newCashUsd: 0 }).ok).toBe(false);
  });
});

describe('buildAllocationPlan — breakdown y violaciones', () => {
  it('cartera 100% riesgo: viola CARTERA_MAX_RIESGO y lo dice en español', () => {
    const r = buildAllocationPlan({ positions: [pos('GGAL', 76_000), pos('YPF', 24_000)], newCashUsd: 0 });
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.violations.some((v) => v.includes('riesgo'))).toBe(true);
      expect(r.contributions).toEqual([]);
    }
  });

  it('posición individual sobre el cap del 20% aparece como violación con el símbolo', () => {
    const r = buildAllocationPlan({ positions: [pos('GGAL', 30_000), pos('SPY', 70_000)], newCashUsd: 0 });
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.violations.some((v) => v.includes('GGAL'))).toBe(true);
  });
});

describe('buildAllocationPlan — aportes', () => {
  it('cartera toda en riesgo + aporte: todo el aporte va a nucleo y cobertura, nada a riesgo', () => {
    const r = buildAllocationPlan({ positions: [pos('GGAL', 100_000)], newCashUsd: 50_000 });
    expect(r.ok).toBe(true);
    if (r.ok) {
      const usd = Object.fromEntries(r.contributions.map((c) => [c.layer, c.usd]));
      expect((usd['nucleo'] ?? 0) + (usd['cobertura'] ?? 0)).toBe(50_000);
      expect(usd['riesgo'] ?? 0).toBe(0);
      // proporcional al déficit: nucleo (target 55) mucho más seco que cobertura (12)
      expect(usd['nucleo']).toBeGreaterThan(usd['cobertura']);
      expect(r.contributions.find((c) => c.layer === 'nucleo')!.instruments).toEqual(['SPY']);
    }
  });

  it('capa ya en target no recibe aporte', () => {
    // nucleo 55% exacto post-aporte de 0: SPY 55k de 100k total
    const r = buildAllocationPlan({ positions: [pos('SPY', 55_000), pos('GLD', 12_000), pos('GGAL', 33_000)], newCashUsd: 10_000 });
    expect(r.ok).toBe(true);
    if (r.ok) {
      // post-aporte el total es 110k: nucleo 50% (<55) y cobertura 10.9% (<12) → ambos reciben; suma = 10k
      expect(r.contributions.reduce((s, c) => s + c.usd, 0)).toBe(10_000);
    }
  });

  it('los pct del breakdown se calculan sobre el total POST-aporte', () => {
    const r = buildAllocationPlan({ positions: [pos('GGAL', 50_000)], newCashUsd: 50_000 });
    expect(r.ok).toBe(true);
    if (r.ok) {
      const riesgo = r.layers.find((l) => l.layer === 'riesgo')!;
      expect(riesgo.pct).toBeCloseTo(50, 1); // 50k de 100k post-aporte
    }
  });
});
```

- [ ] **Step 2: RED** — `npm run test --workspace=apps/backend -- src/portfolio/allocation-plan.test.ts` → FAIL módulo inexistente.

- [ ] **Step 3: Implementar** `allocation-plan.ts` cumpliendo las 7 reglas (código completo, comentarios español, envNumber import de `../shared/env-number.js`).

- [ ] **Step 4: GREEN** — mismo comando, todos pasan. Ajustar SERIES de test solo si la aritmética del caso lo exige, jamás las reglas.

- [ ] **Step 5: Commit** — `feat(cartera): plan de asignación por capas (puro, TDD)` + trailer Co-Authored-By.

---

### Task 2: Procedure tRPC `portfolio.allocationPlan`

**Files:**
- Modify: `apps/backend/src/portfolio/portfolio.router.ts` (procedure nuevo, aditivo)

**Interfaces:**
- Consumes: `buildAllocationPlan`/`layerForSymbol` (Task 1); `getPortfolio()` de `./portfolio.service.js` (devuelve `PortfolioSummary` con `positions[]` valorizadas — campos `symbol`, `currentPrice`, y el valor de mercado: VERIFICAR nombre real del campo en `packages/shared/src/types/portfolio.ts` — puede ser `marketValue`/`value`/`totalValue` por posición; usar el real).
- Produces: `portfolio.allocationPlan` query con input `{ newCashUsd?: number }` (zod, default 0, `.min(0).max(10_000_000)`) → `AllocationPlan`.

- [ ] **Step 1:** Agregar al router (mirar el patrón de los procedures existentes con zod input en el mismo archivo):

```typescript
  // Plan de asignación por capas (modo aportes): advisory, jamás ejecuta.
  allocationPlan: publicProcedure
    .input(z.object({ newCashUsd: z.number().min(0).max(10_000_000).default(0) }).optional())
    .query(async ({ input }) => {
      const summary = await getPortfolio();
      return buildAllocationPlan({
        positions: summary.positions.map((p) => ({
          symbol: p.symbol,
          value: /* campo real de valor de mercado */,
          currentPrice: p.currentPrice,
        })),
        newCashUsd: input?.newCashUsd ?? 0,
      });
    }),
```
(zod ya se importa en el router o agregarlo; completar `/* campo real */` tras verificar el tipo.)

- [ ] **Step 2:** `npm run typecheck` limpio + suite completa verde.
- [ ] **Step 3: Commit** — `feat(cartera): endpoint portfolio.allocationPlan`.

---

### Task 3: Panel en la tab Portfolio

**Files:**
- Create: `apps/frontend/src/portfolio/AllocationPlanPanel.tsx`
- Modify: `apps/frontend/src/portfolio/PortfolioPage.tsx` (montar el panel debajo del diagnóstico existente)

**Interfaces:**
- Consumes: `trpc.portfolio.allocationPlan.useQuery({ newCashUsd })` — mirar cómo `PortfolioDiagnosticPanel.tsx` consume su query y COPIAR sus patrones (trpc hooks, estilos de card, clases Tailwind del repo).

**Contenido del panel:**
1. Título "CARTERA POR CAPAS — PLAN DE APORTES" con el mismo estilo del panel de diagnóstico.
2. Tres barras (núcleo/cobertura/riesgo) con % actual vs target (target como marca), colores: verde si dentro de banda, ámbar/rojo si violación.
3. Lista de `violations` en rojo (si hay).
4. Input numérico "USD nuevos a invertir" (default 0, estado local) → al cambiar (debounce o botón "Calcular"), re-query con `newCashUsd` → tabla de `contributions`: capa, USD, instrumentos, nota.
5. `ok: false` ⇒ mostrar `reason` en rojo, sin plan (fail-closed visible, no pantalla vacía).
6. Pie fijo: "Advisory: el sistema no ejecuta órdenes. El riesgo se llena con setups del scan."

- [ ] **Step 1:** Implementar panel + montaje. `npm run typecheck` limpio.
- [ ] **Step 2:** Verificación runtime: levantar `npm run dev` (o backend solo) y `curl` al procedure:
```bash
curl -s "http://localhost:3001/trpc/portfolio.allocationPlan?input=$(node -e 'console.log(encodeURIComponent(JSON.stringify({newCashUsd:50000})))')" | head -c 600
```
Esperado: JSON con `ok:true`, layers con riesgo ~100% (violación presente), contributions repartiendo 50k entre nucleo/cobertura. Si el backend ya corre en 3001, usar el vivo; si no, levantarlo y matarlo al final.
- [ ] **Step 3: Commit** — `feat(cartera): panel de capas y aportes en Portfolio`.

---

### Task 4: Docs

**Files:**
- Modify: `.env.example` — bloque nuevo tras las vars de sweep:
```bash
# Módulo Cartera (modo aportes) — bandas por capa, advisory
CARTERA_TARGET_NUCLEO=55       # % objetivo de índice amplio
CARTERA_TARGET_COBERTURA=12    # % objetivo de cobertura (oro/bonos)
CARTERA_MAX_RIESGO=35          # % máximo tolerado en capa riesgo (tesis+satélite)
CARTERA_MAX_POSICION=20        # % máximo de una posición individual
```
- Modify: `docs/IA/prompt-maestro-mejora-continua.md` — sección 5, al final:
```markdown
**Branch `feat/modulo-cartera` (2026-07-22):** módulo Cartera v1 (modo aportes) — el sistema responde "¿dónde va cada dólar nuevo?": capas por whitelist (núcleo=ETFs índice, cobertura=oro/bonos, riesgo=resto), bandas configurables (`CARTERA_*`), violaciones informativas, aportes greedy hacia targets con instrumentos whitelisteados (SPY/GLD — jamás picks individuales; el riesgo se llena con setups del scan). `buildAllocationPlan` pura fail-closed + `portfolio.allocationPlan` + panel en tab Portfolio. Advisory total, no recomienda vender (preferencia del dueño). V2 anotado: separar tesis-macro de satélite (requiere declaración por símbolo) y estado de respaldo del motor por posición.
```
- [ ] **Step 1:** Aplicar ambos, `git diff` para confirmar solo inserciones.
- [ ] **Step 2: Commit** — `docs(cartera): env vars y estado del módulo`.

---

## Self-Review

- Cobertura: capas+violaciones (T1), endpoint (T2), UI con input de aportes (T3), docs (T4) — todo lo comprometido en la conversación para v1; "respaldo del motor por posición" declarado v2 explícito.
- Tipos consistentes: `AllocationPlan` producido T1 = consumido T2 = renderizado T3.
- Sin placeholders salvo el campo de valor de mercado en T2, marcado explícitamente para verificar contra el tipo real (el implementador lo resuelve leyendo `portfolio.ts` de shared).
- Riesgos: `getPortfolio()` llama a Yahoo (getQuotes) — el procedure hereda esa latencia (~1-2s), aceptable para una query manual de la tab.
