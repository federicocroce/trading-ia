# Digest Portfolio vs Market Sections — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Split `MarketDigest.wouldDo/wouldNotDo` into 4 fields (`portfolioWouldDo`, `portfolioWouldNotDo`, `marketWouldDo`, `marketWouldNotDo`) and render 2 symmetric sections (Portfolio / Mercado) in DailySummary.

**Architecture:** JSON-blob persistence (no DB migration). Prompt-driven separation by `portfolioSymbolSet`. Fallback synthesizers partition opportunities by portfolio membership. Backward-compat at `normalizeDigest`.

**Tech Stack:** TS, React, Drizzle, Vitest (existing). No new deps.

---

### Task 1: Update shared `MarketDigest` type

**Files:**
- Modify: `packages/shared/src/types/intelligence.ts:43-60`

- [ ] **Step 1:** Replace `wouldDo`/`wouldNotDo` fields with 4 new fields:

```ts
export interface MarketDigest {
  generatedAt: number;
  overnightSummary: string;
  portfolioImpact: string;
  topOpportunities: Array<{ symbol: string; action: 'BUY' | 'SELL'; narrative: string }>;
  watching?: Array<{ symbol: string; narrative: string }>;
  warnings: string[];
  marketMood: 'risk-on' | 'risk-off' | 'mixed';
  portfolioWouldDo: string[];
  portfolioWouldNotDo: string[];
  marketWouldDo: string[];
  marketWouldNotDo: string[];
}
```

- [ ] **Step 2:** Run `pnpm -F @trading/shared build` from repo root. Expect: success.

---

### Task 2: Update `COMBINED_SYNTHESIS_PROMPT`

**Files:**
- Modify: `packages/shared/src/constants/prompts.ts:198-217`

- [ ] **Step 1:** In the SECCIÓN MERCADO part of the prompt, add two new fields right before `"watching"`:

Insert after `topOpportunities` block (around current line 186):

```
"marketWouldDo": 3-5 trades de mercado (NO en portfolio) que SÍ haría hoy. Cada uno: ticker, precio entrada, stop, target, razón concreta. Ej: "Compraría LMT a $480 — divergencia alcista diaria + sector defensa. Stop $455, target $520." PROHIBIDO incluir tickers del portfolio acá (esos van en portfolioWouldDo).

"marketWouldNotDo": 3-5 cosas de mercado a evitar (NO en portfolio). Frase completa con razón + número. Ej: "No perseguiría TSLA arriba de $290 — divergencia bajista RSI semanal en 72." PROHIBIDO incluir tickers del portfolio.
```

- [ ] **Step 2:** In the SECCIÓN PORTFOLIO part, rename and constrain:

Replace:
```
"wouldDo": 3-5 trades que SÍ haría hoy. ...
"wouldNotDo": 3-5 cosas que NO haría y por qué. ...
```

With:
```
"portfolioWouldDo": 3-5 acciones que SÍ haría sobre tu PORTFOLIO. SOLO símbolos que aparecen en la sección PORTFOLIO del input. Cada uno: ticker, precio actual/entrada, stop, razón. Ej: "Sumaría a VIST en $73.90 — momentum técnico fuerte. Stop $61, target $93."

"portfolioWouldNotDo": 3-5 cosas que NO haría sobre tu PORTFOLIO. SOLO símbolos que aparecen en la sección PORTFOLIO. Frase completa con razón + número. Ej: "No agregaría a PAM ahora — P&L 14.4% el más bajo del bloque AR, sin catalyst técnico."
```

- [ ] **Step 3:** In the REGLAS block, replace lines that mention `wouldDo`/`wouldNotDo` with versions that mention the 4 new names. Specifically:

Replace:
```
- wouldDo/wouldNotDo son las secciones MÁS IMPORTANTES.
- Si divergencia bajista → nunca en wouldDo.
- Si activo tiene action=SELL en análisis → en wouldNotDo, no en wouldDo.
- PROHIBIDO listar solo el ticker en wouldNotDo (ej: "VIST" o "- VIST"). ...
- COHERENCIA OBLIGATORIA con TOP OPORTUNIDADES ALGORÍTMICAS: si un ticker aparece ahí con action=BUY, NO lo metas en wouldNotDo. ...
- wouldDo y wouldNotDo son ARRAYS DE STRINGS ...
```

With:
```
- Los 4 arrays (portfolioWouldDo/portfolioWouldNotDo/marketWouldDo/marketWouldNotDo) son las secciones MÁS IMPORTANTES. Precio y stop concretos siempre.
- Si divergencia bajista en un activo → nunca en *WouldDo.
- Si activo tiene action=SELL en análisis → en *WouldNotDo (portfolio o market según pertenencia), no en *WouldDo.
- PROHIBIDO listar solo el ticker (ej: "VIST" o "- VIST"). CADA item debe ser una oración con verbo y razón. Si no podés justificar con dato concreto, NO incluyas.
- COHERENCIA con TOP OPORTUNIDADES ALGORÍTMICAS: si un ticker aparece ahí con action=BUY, NO lo metas en *WouldNotDo. Si está en portfolio → portfolioWouldDo. Si NO está en portfolio → marketWouldDo.
- SEPARACIÓN ESTRICTA: portfolioWouldDo/portfolioWouldNotDo SOLO con tickers del portfolio; marketWouldDo/marketWouldNotDo SOLO con tickers FUERA del portfolio. Ningún ticker puede aparecer en ambos lados.
- Los 4 arrays son ARRAYS DE STRINGS (oraciones completas), NUNCA arrays de objetos.
```

- [ ] **Step 4:** Update the JSON example at the end (around line 217):

Replace the tail:
```
"portfolioImpact":"...","wouldDo":["Compraría LMT a $480..."],"wouldNotDo":["No compraría VIST..."]}
```

With:
```
"portfolioImpact":"...","portfolioWouldDo":["Sumaría a VIST a $73.90 — momentum + crecimiento ingresos 50.1%. Stop $61, target $93."],"portfolioWouldNotDo":["No agregaría a PAM — P&L 14.4% sin catalyst técnico claro."],"marketWouldDo":["Compraría LMT a $480 — divergencia alcista + catalyst defensa. Stop $455, target $520."],"marketWouldNotDo":["No perseguiría TSLA arriba de $290 — RSI semanal 72."]}
```

- [ ] **Step 5:** Run `pnpm -F @trading/shared build`. Expect: success.

---

### Task 3: Refactor fallback synthesizers in `market-report.service.ts`

**Files:**
- Modify: `apps/backend/src/intelligence/market-report.service.ts:140-182`

- [ ] **Step 1:** Replace the two synthesize functions and `buildFallbackDigest` with portfolio-aware versions:

```ts
function synthesizeBuyLine(o: Opportunity): string {
  const parts: string[] = [`Compraría ${o.symbol}`];
  if (o.tradeLevels) parts.push(`a $${o.tradeLevels.entryPrice.toFixed(2)}`);
  const reason = o.simpleReasoning ?? o.catalysts[0] ?? 'señal técnica positiva';
  parts.push(`— ${reason}`);
  if (o.tradeLevels) parts.push(`Stop $${o.tradeLevels.stopLoss.toFixed(2)}, target $${o.tradeLevels.takeProfit.toFixed(2)}.`);
  return parts.join(' ');
}

function synthesizeSellLine(o: Opportunity): string {
  const reason = o.simpleReasoning ?? o.risks[0] ?? 'señales negativas';
  return `No mantendría ${o.symbol} — ${reason}`;
}

function synthesizeWouldArrays(
  opportunities: Opportunity[],
  portfolioSymbols: Set<string>,
  limit = 5,
): { portfolioWouldDo: string[]; portfolioWouldNotDo: string[]; marketWouldDo: string[]; marketWouldNotDo: string[] } {
  const buys = opportunities.filter(o => o.action === 'BUY');
  const sells = opportunities.filter(o => o.action === 'SELL');
  return {
    portfolioWouldDo: buys.filter(o => portfolioSymbols.has(o.symbol)).slice(0, limit).map(synthesizeBuyLine),
    portfolioWouldNotDo: sells.filter(o => portfolioSymbols.has(o.symbol)).slice(0, limit).map(synthesizeSellLine),
    marketWouldDo: buys.filter(o => !portfolioSymbols.has(o.symbol)).slice(0, limit).map(synthesizeBuyLine),
    marketWouldNotDo: sells.filter(o => !portfolioSymbols.has(o.symbol)).slice(0, limit).map(synthesizeSellLine),
  };
}

function buildFallbackDigest(
  opportunities: Opportunity[],
  effects: SecondOrderEffect[],
  headlines: string[],
  portfolioSymbols: Set<string>,
): MarketDigest {
  const topBuy = opportunities.filter(o => o.action === 'BUY').slice(0, 3);
  const buyCount = opportunities.filter(o => o.action === 'BUY').length;
  const sellCount = opportunities.filter(o => o.action === 'SELL').length;
  const would = synthesizeWouldArrays(opportunities, portfolioSymbols, 3);
  return {
    generatedAt: Date.now(),
    overnightSummary: headlines.length > 0 ? headlines.slice(0, 3).join('. ') + '.' : 'Sin noticias relevantes recientes.',
    portfolioImpact: effects.length > 0 ? effects.slice(0, 2).map(e => e.reasoning).join(' ') : 'Sin efectos de segundo orden identificados.',
    topOpportunities: topBuy.map(o => ({ symbol: o.symbol, action: 'BUY' as const, narrative: o.simpleReasoning ?? o.reasoning })),
    warnings: opportunities.filter(o => o.action === 'SELL').slice(0, 2).map(o => `${o.symbol}: ${o.risks[0] ?? 'señales negativas'}`),
    marketMood: buyCount > sellCount * 2 ? 'risk-on' : sellCount > buyCount ? 'risk-off' : 'mixed',
    ...would,
  };
}
```

- [ ] **Step 2:** Find every call site of `buildFallbackDigest` in the file and pass `portfolioSymbols` (a `Set<string>` from current portfolio positions). If `buildFallbackDigest` is invoked elsewhere with old signature, fix those sites too.

Run: `grep -n "buildFallbackDigest\|synthesizeWouldDoFromBuys\|synthesizeWouldNotDoFromSells" apps/backend/src` — should return only call sites already updated, no orphan references to the deleted functions.

---

### Task 4: Update LLM-result parsing in `market-report.service.ts`

**Files:**
- Modify: `apps/backend/src/intelligence/market-report.service.ts:404-452`

- [ ] **Step 1:** Replace the block reading `p.wouldDo` / `p.wouldNotDo` with the 4-array version. The `sanitizeWouldNotDo` helper is reused for both `*WouldNotDo` arrays:

```ts
const buyTickers = new Set(
  (digestInputs?.opportunities ?? [])
    .filter(o => o.action === 'BUY')
    .map(o => o.symbol.toUpperCase())
);
const portfolioSymbols = new Set(positions.map(p => p.symbol.toUpperCase()));

avoidList = filterAvoidListVsBuy(Array.isArray(p.avoidList) ? p.avoidList : [], buyTickers);

const sanitizeWouldDo = (raw: unknown): string[] => {
  if (!Array.isArray(raw)) return [];
  return raw.map(coerceToString).filter(Boolean).filter(item => {
    const wordCount = item.replace(/[-•*]/g, '').trim().split(/\s+/).filter(Boolean).length;
    return wordCount >= 4;
  }).slice(0, 5);
};

// Reuse the existing sanitizeWouldNotDo definition from earlier in this try block.

const llmPortfolioWouldDo = sanitizeWouldDo(p.portfolioWouldDo);
const llmPortfolioWouldNotDo = sanitizeWouldNotDo(p.portfolioWouldNotDo);
const llmMarketWouldDo = sanitizeWouldDo(p.marketWouldDo);
const llmMarketWouldNotDo = sanitizeWouldNotDo(p.marketWouldNotDo);

const opps = digestInputs?.opportunities ?? [];
const fallback = synthesizeWouldArrays(opps, portfolioSymbols, 5);

const finalPortfolioWouldDo = llmPortfolioWouldDo.length > 0 ? llmPortfolioWouldDo : fallback.portfolioWouldDo;
const finalPortfolioWouldNotDo = llmPortfolioWouldNotDo.length > 0 ? llmPortfolioWouldNotDo : fallback.portfolioWouldNotDo;
const finalMarketWouldDo = llmMarketWouldDo.length > 0 ? llmMarketWouldDo : fallback.marketWouldDo;
const finalMarketWouldNotDo = llmMarketWouldNotDo.length > 0 ? llmMarketWouldNotDo : fallback.marketWouldNotDo;

if (llmPortfolioWouldDo.length === 0 && finalPortfolioWouldDo.length > 0) {
  console.log(`[MarketReport] LLM portfolioWouldDo empty — sintetizado ${finalPortfolioWouldDo.length} desde portfolio BUY opps`);
}
if (llmMarketWouldDo.length === 0 && finalMarketWouldDo.length > 0) {
  console.log(`[MarketReport] LLM marketWouldDo empty — sintetizado ${finalMarketWouldDo.length} desde non-portfolio BUY opps`);
}
```

- [ ] **Step 2:** Update the `digest` object construction (around line 449) to use the 4 fields instead of `wouldDo`/`wouldNotDo`:

```ts
digest = {
  // ...existing fields...
  portfolioWouldDo: finalPortfolioWouldDo,
  portfolioWouldNotDo: finalPortfolioWouldNotDo,
  marketWouldDo: finalMarketWouldDo,
  marketWouldNotDo: finalMarketWouldNotDo,
  // ...
};
```

- [ ] **Step 3:** Run `pnpm -F backend build`. Expect: success, no TS errors.

---

### Task 5: Update `normalizeDigest` for backward-compat

**Files:**
- Modify: `apps/backend/src/opportunities/opportunities.service.ts:126-135`

- [ ] **Step 1:** Replace `normalizeDigest` to handle both old (`wouldDo`/`wouldNotDo`) and new (4-field) shapes:

```ts
function normalizeDigest(d: any): import('@trading/shared').MarketDigest {
  const buyTickers = getCurrentBuyTickers();
  const arr = (v: unknown): string[] =>
    Array.isArray(v) ? (v as unknown[]).map(coerceTextItem).filter(s => s.length > 0) : [];

  // Backward-compat: viejos digests con wouldDo/wouldNotDo → portfolio side
  const legacyWouldDo = arr(d.wouldDo);
  const legacyWouldNotDo = arr(d.wouldNotDo);

  const portfolioWouldDo = d.portfolioWouldDo !== undefined ? arr(d.portfolioWouldDo) : legacyWouldDo;
  const portfolioWouldNotDoRaw = d.portfolioWouldNotDo !== undefined ? arr(d.portfolioWouldNotDo) : legacyWouldNotDo;
  const marketWouldDo = arr(d.marketWouldDo);
  const marketWouldNotDoRaw = arr(d.marketWouldNotDo);

  return {
    ...d,
    portfolioWouldDo,
    portfolioWouldNotDo: filterItemsVsBuyTickers(portfolioWouldNotDoRaw, buyTickers),
    marketWouldDo,
    marketWouldNotDo: filterItemsVsBuyTickers(marketWouldNotDoRaw, buyTickers),
    warnings: arr(d.warnings),
    // Strip legacy fields to avoid confusion downstream
    wouldDo: undefined,
    wouldNotDo: undefined,
  };
}
```

- [ ] **Step 2:** Run `pnpm -F backend build`. Expect: success.

---

### Task 6: Update `DailySummary.tsx` render

**Files:**
- Modify: `apps/frontend/src/daily/DailySummary.tsx:610-689`

- [ ] **Step 1:** Replace the block from line 610 (portfolioImpact) through line 689 (warnings end) with two-section layout. Keep `portfolioImpact` inside the Portfolio section; remove the standalone `topOpportunities` card; render `watching` inside Mercado → SÍ as a sub-section:

```tsx
{/* ============================== */}
{/* SECCIÓN TU PORTFOLIO            */}
{/* ============================== */}
<div className="space-y-1 pt-1">
  <div className="flex items-center gap-2">
    <span className="text-[9px] font-semibold text-amber-400 uppercase tracking-widest">Tu Portfolio</span>
    <div className="flex-1 h-px bg-amber-500/20" />
  </div>
</div>

{digest.portfolioImpact && (
  <div>
    <span className="text-[9px] text-blue-400 uppercase tracking-wider font-medium">Impacto en tu portfolio</span>
    <p className="text-xs text-foreground leading-relaxed mt-0.5">{digest.portfolioImpact}</p>
  </div>
)}

{digest.portfolioWouldDo && digest.portfolioWouldDo.length > 0 ? (
  <div className="rounded-md bg-green-500/5 border border-green-500/20 p-2">
    <span className="text-[9px] text-green-400 uppercase tracking-wider font-medium">Lo que SI haria con tu portfolio</span>
    <div className="space-y-1 mt-1">
      {digest.portfolioWouldDo.map((item, i) => (
        <p key={i} className="text-[10px] text-foreground leading-relaxed">- {item}</p>
      ))}
    </div>
  </div>
) : (
  <div className="rounded-md bg-yellow-500/5 border border-yellow-500/20 p-2 flex items-center justify-between gap-2">
    <div>
      <span className="text-[9px] text-yellow-400 uppercase tracking-wider font-medium">Lo que SI haria con tu portfolio</span>
      <p className="text-[10px] text-muted-foreground mt-0.5">Sin recomendaciones para portfolio en este run. Regenerá el análisis.</p>
    </div>
    <Button
      size="sm"
      variant="outline"
      className="h-6 text-[9px] px-2 shrink-0 border-yellow-500/30 text-yellow-400 hover:bg-yellow-500/10"
      onClick={async () => {
        const mode = await selectMode();
        if (!mode) return;
        run(false, undefined, mode);
      }}
      disabled={isRunning}
    >
      {isRunning ? 'Ejecutando...' : 'Regenerar'}
    </Button>
  </div>
)}

{digest.portfolioWouldNotDo && digest.portfolioWouldNotDo.length > 0 && (
  <div className="rounded-md bg-red-500/5 border border-red-500/20 p-2">
    <span className="text-[9px] text-red-400 uppercase tracking-wider font-medium">Lo que NO haria con tu portfolio</span>
    <div className="space-y-1 mt-1">
      {digest.portfolioWouldNotDo.map((item, i) => (
        <p key={i} className="text-[10px] text-foreground leading-relaxed">- {item}</p>
      ))}
    </div>
  </div>
)}

{/* ============================== */}
{/* SECCIÓN MERCADO                 */}
{/* ============================== */}
<div className="space-y-1 pt-2">
  <div className="flex items-center gap-2">
    <span className="text-[9px] font-semibold text-cyan-400 uppercase tracking-widest">Mercado</span>
    <span className="text-[8px] text-muted-foreground">(fuera de tu portfolio)</span>
    <div className="flex-1 h-px bg-cyan-500/20" />
  </div>
</div>

{digest.marketWouldDo && digest.marketWouldDo.length > 0 ? (
  <div className="rounded-md bg-green-500/5 border border-green-500/20 p-2">
    <span className="text-[9px] text-green-400 uppercase tracking-wider font-medium">Lo que SI haria en el mercado</span>
    <div className="space-y-1 mt-1">
      {digest.marketWouldDo.map((item, i) => (
        <p key={i} className="text-[10px] text-foreground leading-relaxed">- {item}</p>
      ))}
    </div>
    {digest.watching && digest.watching.length > 0 && (
      <div className="mt-2 pt-2 border-t border-green-500/10">
        <span className="text-[9px] text-green-300/70 uppercase tracking-wider font-medium">En radar (triggers de entrada)</span>
        <div className="space-y-1 mt-0.5">
          {digest.watching.map((w, i) => (
            <p key={i} className="text-[10px] text-muted-foreground leading-relaxed">
              <span className="font-mono font-semibold text-foreground">{w.symbol}</span> — {w.narrative}
            </p>
          ))}
        </div>
      </div>
    )}
  </div>
) : (
  <div className="rounded-md bg-muted/30 p-2">
    <span className="text-[9px] text-muted-foreground uppercase tracking-wider font-medium">Lo que SI haria en el mercado</span>
    <p className="text-[10px] text-muted-foreground mt-0.5">Sin oportunidades nuevas hoy fuera de tu portfolio.</p>
  </div>
)}

{digest.marketWouldNotDo && digest.marketWouldNotDo.length > 0 && (
  <div className="rounded-md bg-red-500/5 border border-red-500/20 p-2">
    <span className="text-[9px] text-red-400 uppercase tracking-wider font-medium">Lo que NO haria en el mercado</span>
    <div className="space-y-1 mt-1">
      {digest.marketWouldNotDo.map((item, i) => (
        <p key={i} className="text-[10px] text-foreground leading-relaxed">- {item}</p>
      ))}
    </div>
  </div>
)}

{/* Warnings */}
{digest.warnings.length > 0 && (
  <div>
    <span className="text-[9px] text-amber-400 uppercase tracking-wider font-medium">Riesgos a vigilar</span>
    <div className="space-y-0.5 mt-0.5">
      {digest.warnings.map((w, i) => (
        <p key={i} className="text-[10px] text-amber-300/80">- {w}</p>
      ))}
    </div>
  </div>
)}
```

The `digest.topOpportunities` block (lines 617-633 of original) is removed entirely — its content now lives in `marketWouldDo`.

- [ ] **Step 2:** Update the help-text mentions of `wouldDo/wouldNotDo` in the same file (lines 718, 721, 793) to mention the new structure:

Line 718: replace `wouldDo/wouldNotDo` with `portfolio/mercado SÍ-NO`.
Line 721: replace `wouldDo/wouldNotDo concreto` with `qué haría SÍ/NO en portfolio y mercado`.
Line 793: replace `wouldDo/wouldNotDo` comment with `portfolio/market SÍ/NO`.

- [ ] **Step 3:** Run `pnpm -F frontend build`. Expect: success.

---

### Task 7: Full typecheck + manual verification

- [ ] **Step 1:** Run typecheck at root: `pnpm -r build` (or equivalent). Expect: no TS errors.

- [ ] **Step 2:** Grep for any leftover `digest.wouldDo` / `digest.wouldNotDo` references in `apps/frontend/src` and `apps/backend/src`:

```
grep -rn "digest\.wouldDo\|digest\.wouldNotDo" apps/
```

Expected: no matches.

- [ ] **Step 3:** Grep for any `MarketDigest` consumer that still expects old fields:

```
grep -rn "wouldDo\|wouldNotDo" packages/shared/src
```

Expected: only the per-symbol references (UnifiedAssetAnalysis, opportunity types, UNIFIED_ASSET_ANALYSIS_PROMPT), NOT the digest type/prompt.

---

### Task 8: Commit

- [ ] **Step 1:** Create a feature branch and commit:

```bash
git checkout -b feat/digest-portfolio-vs-market-sections
git add packages/shared/src/types/intelligence.ts packages/shared/src/constants/prompts.ts \
        apps/backend/src/intelligence/market-report.service.ts \
        apps/backend/src/opportunities/opportunities.service.ts \
        apps/frontend/src/daily/DailySummary.tsx \
        docs/superpowers/specs/2026-05-28-digest-portfolio-vs-market-sections-design.md \
        docs/superpowers/plans/2026-05-28-digest-portfolio-vs-market-sections.md
git commit -m "feat(digest): split wouldDo into portfolio + market sections

- MarketDigest: portfolioWouldDo/Not + marketWouldDo/Not (replaces wouldDo/Not)
- COMBINED_SYNTHESIS_PROMPT: strict portfolio vs market separation
- market-report fallback synthesizers partition by portfolioSymbolSet
- normalizeDigest: backward-compat con blobs viejos (wouldDo → portfolio)
- DailySummary: 2 secciones simetricas (Tu Portfolio / Mercado), absorbe topOpportunities card y watching como sub-bloque

Spec: docs/superpowers/specs/2026-05-28-digest-portfolio-vs-market-sections-design.md

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

(Do NOT commit until user explicitly approves push/merge — per session guidance.)
