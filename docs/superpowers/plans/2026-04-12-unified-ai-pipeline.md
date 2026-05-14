# Unified AI Pipeline — Análisis sin contradicciones

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Reemplazar las 6+ llamadas IA solapadas por un pipeline unificado: un análisis por activo con contexto completo, mismo modelo (DeepSeek R1), batches paralelos, sin contradicciones posibles entre etapas.

**Architecture:** STAGE 3 (ANALYSIS) hace UNA llamada IA por batch de activos con todo el contexto (técnico + fundamental + sentiment + second-order + portfolio). STAGE 4 (REPORT) solo agrupa esos outputs por tema más UNA llamada para macroContext/scenarios — sin re-analizar activos. Se eliminan `enrichWithLLM`, `generateDeepAnalyses`, `generateSymbolNarratives`, `generateDailyDigest` como pasos independientes. El reporte temático no genera nuevas recomendaciones — clasifica las ya generadas en STAGE 3.

**Tech Stack:** TypeScript, DeepSeek R1 vía OpenRouter (primario), Groq Llama 70B (fallback), `callAI('reasoning', ...)` existente, Drizzle + SQLite, tRPC.

**Prompt design principle:** Fichas compactas por símbolo (una línea por dimensión), sin texto redundante, sin instrucciones repetidas. Los prompts son system prompts cortos + fichas densas como user message. Objetivo: máxima información por token, no máximas palabras por instrucción.

---

## Mapa de archivos

| Archivo | Acción | Responsabilidad |
|---|---|---|
| `packages/shared/src/constants/prompts.ts` | Modificar | Agregar `UNIFIED_ASSET_ANALYSIS_PROMPT`, `REPORT_SYNTHESIS_PROMPT`. NO eliminar los existentes aún. |
| `packages/shared/src/types/opportunity.ts` | Modificar | `UnifiedAssetAnalysis` type, `Opportunity.unifiedAnalysis` field |
| `apps/backend/src/intelligence/unified-analysis.service.ts` | Crear | Lógica de análisis unificado por batch |
| `apps/backend/src/intelligence/market-report.service.ts` | Modificar | STAGE 4 lee `unifiedAnalysis` de STAGE 3, no re-analiza |
| `apps/backend/src/opportunities/opportunities.service.ts` | Modificar | Reemplaza `enrichWithLLM` + `generateDeepAnalyses` + `generateSymbolNarratives` + `generateDailyDigest` por `runUnifiedAnalysis` |

---

## Task 1: Nuevo tipo `UnifiedAssetAnalysis` + prompt compacto

**Files:**
- Modify: `packages/shared/src/types/opportunity.ts`
- Modify: `packages/shared/src/constants/prompts.ts`

- [ ] **Step 1: Agregar `UnifiedAssetAnalysis` al tipo `Opportunity`**

En `packages/shared/src/types/opportunity.ts`, agregar después de la interfaz `DeepAnalysis` (línea 121):

```typescript
export interface UnifiedAssetAnalysis {
  action: 'BUY' | 'SELL' | 'HOLD' | 'WATCH';
  thesis: string;                // 2-3 oraciones con datos concretos
  catalysts: string[];           // 2-3 items
  risks: string[];               // 1-2 items
  wouldDo: string[];             // 1-2 acciones con precio
  wouldNotDo: string[];          // 1 acción a evitar
  narrative: string;             // 2-3 oraciones para UI (reemplaza narrativeDigest)
  macroTheme: string | null;     // tema macro asignado (ej: "Semiconductores / IA")
  generatedBy: 'deepseek' | 'groq' | 'qwen';
}
```

En `Opportunity` (línea 75+), agregar campo:
```typescript
unifiedAnalysis?: UnifiedAssetAnalysis;
```

- [ ] **Step 2: Agregar prompts compactos en `packages/shared/src/constants/prompts.ts`**

Agregar al final del archivo:

```typescript
// ============================================================
// UNIFIED ASSET ANALYSIS — un análisis por activo, contexto completo
// ============================================================

/**
 * System prompt para análisis unificado de activos.
 * Fichas compactas → max información por token.
 * Reemplaza: enrichWithLLM + generateDeepAnalyses + generateSymbolNarratives
 */
export const UNIFIED_ASSET_ANALYSIS_PROMPT = `Analista swing trading argentino. Activos: CEDEARs, acciones US, ETFs, crypto. Horizonte: semanas-meses.

INPUT: fichas compactas por activo. Cada ficha = una línea por dimensión.
OUTPUT: análisis JSON por símbolo.

REGLAS:
- Usa datos concretos (precios, %, RSI, P/E). No frases genéricas.
- Si divergencia bajista → action=SELL o HOLD, nunca BUY.
- Si en portfolio con P&L negativo → mencionar nivel de stop concreto.
- wouldDo/wouldNotDo: precio específico, razón específica. Ej: "Stop en $41.50 si rompe soporte" no "gestionar riesgo".
- macroTheme: asignar a uno de estos si aplica, null si no: "Energía/Oil", "Semiconductores/IA", "Defensa/Geopolítica", "Cripto", "Argentina/CEDEARs", "Banca US", "Consumo/Retail", "Salud/Biotech", "Commodities", "Política Monetaria"
- narrative: lenguaje coloquial de trader experimentado, 2-3 oraciones. Interpreta señales, no repite números.

Responde SOLO con JSON:
{"analyses":[{"symbol":"VIST","action":"BUY","thesis":"...","catalysts":["..."],"risks":["..."],"wouldDo":["Entrada $65, stop $61..."],"wouldNotDo":["No escalar..."],"narrative":"...","macroTheme":"Energía/Oil","generatedBy":"deepseek"}]}`;

/**
 * Prompt para síntesis del reporte de mercado.
 * Input: análisis ya generados por UNIFIED_ASSET_ANALYSIS (no re-analiza activos).
 * Solo genera: macroContext, portfolioImpact, scenarios, avoidList.
 * Reemplaza: identifyActiveThemes + analyzeThemeDeep + consolidateFinalReport (todas las pasadas)
 */
export const REPORT_SYNTHESIS_PROMPT = `Estratega de mercado senior. Recibes análisis individuales ya generados para un swing trader argentino.

Tu trabajo: síntesis macro ÚNICAMENTE. No analices activos individuales — ya están analizados.

OUTPUT JSON:
- "macroContext": 4-5 oraciones integrando TODAS las temáticas activas. Menciona interacciones entre temas.
- "portfolioImpact": 2-3 oraciones sobre impacto en el portfolio actual.
- "scenarios": 2-3 escenarios globales. Cada uno: name, probability (%), distribution [{symbol, weight, reason}].
- "avoidList": 3-4 strings. Qué NO hacer y por qué CONCRETO. Nunca genérico.

REGLAS:
- Si un activo tiene unifiedAnalysis.action=SELL → no aparece en scenarios.distribution con weight > 0.
- avoidList debe ser coherente con los action/risks ya generados.
- Maximo 500 palabras total.

Responde SOLO con JSON:
{"macroContext":"...","portfolioImpact":"...","scenarios":[{"name":"...","probability":40,"distribution":[{"symbol":"LMT","weight":20,"reason":"..."}]}],"avoidList":["..."]}`;
```

- [ ] **Step 3: Exportar nuevos símbolos desde `packages/shared/src/constants/index.ts`**

Verificar que `index.ts` reexporta todo de `prompts.ts`. Si ya tiene `export * from './prompts.js'`, no hace falta cambio. Si no:

```typescript
export * from './prompts.js';
```

- [ ] **Step 4: Build shared para verificar tipos**

```bash
cd packages/shared && npm run build
```

Esperado: sin errores de TypeScript.

- [ ] **Step 5: Commit**

```bash
git add packages/shared/src/types/opportunity.ts packages/shared/src/constants/prompts.ts
git commit -m "feat(shared): UnifiedAssetAnalysis type + unified prompts"
```

---

## Task 2: Crear `unified-analysis.service.ts`

**Files:**
- Create: `apps/backend/src/intelligence/unified-analysis.service.ts`

Este servicio reemplaza `enrichWithLLM` + `generateDeepAnalyses` + `generateSymbolNarratives`. Una función, un modelo, batches paralelos.

- [ ] **Step 1: Crear el archivo**

```typescript
// apps/backend/src/intelligence/unified-analysis.service.ts
/**
 * Unified Asset Analysis Service
 *
 * Reemplaza: enrichWithLLM + generateDeepAnalyses + generateSymbolNarratives
 *
 * Principios:
 * - Un análisis por activo, contexto completo
 * - Un solo modelo (DeepSeek R1 via callAI('reasoning'))
 * - Batches de 4 en paralelo (respeta rate limits de OpenRouter)
 * - Output coherente y comparable entre activos
 */

import type {
  Opportunity,
  TechnicalSummary,
  FundamentalSummary,
  UnifiedAssetAnalysis,
} from '@trading/shared';
import { UNIFIED_ASSET_ANALYSIS_PROMPT } from '@trading/shared';
import { callAI } from '../shared/ai-router.js';
import { getPortfolioPositions } from '../db/repository.js';
import type { SentimentInput } from '../opportunities/scoring.js';

const BATCH_SIZE = 4; // DeepSeek R1 vía OpenRouter: 4 en paralelo es seguro

/**
 * Builds a compact asset card for LLM input.
 * One line per dimension. No redundant text.
 * Target: ~150-200 tokens per asset.
 */
function buildCompactCard(
  opp: Opportunity,
  tech?: TechnicalSummary,
  fund?: FundamentalSummary,
  sent?: SentimentInput,
): string {
  const lines: string[] = [];
  const positions = getPortfolioPositions();
  const pos = positions.find(p => p.symbol === opp.symbol);
  const ind = tech?.indicators;
  const w = tech?.weekly;
  const f = fund?.data;

  // Header: símbolo, precio, acción algorítmica, score, portfolio
  let header = `${opp.symbol} $${opp.currentPrice.toFixed(2)} | algoAction=${opp.action} score=${opp.opportunityScore}/100`;
  if (pos) {
    const pnl = ((opp.currentPrice - pos.avgCost) / pos.avgCost * 100).toFixed(1);
    header += ` | portfolio ${pos.quantity.toFixed(0)}acc @$${pos.avgCost.toFixed(2)} P&L${pnl}%`;
  }
  lines.push(header);

  // Técnico diario
  const techParts: string[] = [];
  if (ind?.rsi14 != null) techParts.push(`RSI_d=${ind.rsi14.toFixed(0)}`);
  if (ind?.macd?.histogram != null) techParts.push(`MACD=${ind.macd.histogram.toFixed(3)}`);
  if (ind?.priceVsSma200 != null) techParts.push(`vsSMA200=${ind.priceVsSma200.toFixed(1)}%`);
  if (ind?.bbSqueeze) techParts.push(`BB_squeeze=${ind.bbSqueezeIntensity?.toFixed(0)}%`);
  if (techParts.length > 0) lines.push(`tech_d: ${techParts.join(' ')}`);

  // Técnico semanal
  const weekParts: string[] = [];
  if (w?.rsi14 != null) weekParts.push(`RSI_w=${w.rsi14.toFixed(0)}`);
  if (w?.macd?.histogram != null) weekParts.push(`MACD_w=${w.macd.histogram.toFixed(3)}`);
  if (w?.trend) weekParts.push(`trend_w=${w.trend}`);
  if (weekParts.length > 0) lines.push(`tech_w: ${weekParts.join(' ')}`);

  // Divergencias (críticas para decisión)
  const divs = opp.divergences ?? [];
  if (divs.length > 0) {
    lines.push(`divs: ${divs.map(d => `${d.type}_${d.indicator}_${d.timeframe}`).join(' ')}`);
  }

  // Crossovers inminentes
  if (ind?.crossovers?.estimatedDaysToCross != null) {
    const dir = ind.crossovers.crossDirection === 'golden' ? 'GC' : 'DC';
    lines.push(`cross: ${dir}_~${ind.crossovers.estimatedDaysToCross}d`);
  }

  // Fundamental (solo lo relevante)
  const fundParts: string[] = [];
  if (f?.peRatio != null) fundParts.push(`PE=${f.peRatio.toFixed(1)}`);
  if (f?.forwardPE != null) fundParts.push(`fwdPE=${f.forwardPE.toFixed(1)}`);
  if (f?.priceVs52wHigh != null) fundParts.push(`vs52wH=${f.priceVs52wHigh.toFixed(1)}%`);
  if (f?.revenueGrowth != null) fundParts.push(`revGrow=${f.revenueGrowth.toFixed(1)}%`);
  if (fundParts.length > 0) lines.push(`fund: ${fundParts.join(' ')}`);

  // Sentiment + conflictos
  if (sent) {
    const sentScore = Math.round(sent.score * 100);
    const headline = sent.headlines[0] ? ` "${sent.headlines[0].slice(0, 60)}"` : '';
    lines.push(`sent: ${sentScore} ${sent.sentiment}${headline}`);
  }

  // Conflictos de señales (importantes para la narrativa)
  if (opp.signalConflicts && opp.signalConflicts.length > 0) {
    const conflicts = opp.signalConflicts
      .slice(0, 2)
      .map(c => `${c.signalA}vs${c.signalB}(${c.implication})`)
      .join(' ');
    lines.push(`conflicts: ${conflicts}`);
  }

  // Niveles de trade algorítmicos
  if (opp.tradeLevels) {
    const tl = opp.tradeLevels;
    lines.push(`levels: entry=$${tl.entryPrice.toFixed(2)} stop=$${tl.stopLoss.toFixed(2)} target=$${tl.takeProfit.toFixed(2)} RR=1:${tl.riskRewardRatio.toFixed(1)}`);
  }

  return lines.join('\n');
}

/**
 * Run unified analysis for a batch of opportunities.
 * One LLM call per batch. Same model for all. Comparable outputs.
 */
async function analyzeBatch(
  batch: Opportunity[],
  techMap: Map<string, TechnicalSummary>,
  fundMap: Map<string, FundamentalSummary>,
  sentimentMap: Map<string, SentimentInput>,
): Promise<Map<string, UnifiedAssetAnalysis>> {
  const result = new Map<string, UnifiedAssetAnalysis>();

  const cards = batch
    .map(o => buildCompactCard(o, techMap.get(o.symbol), fundMap.get(o.symbol), sentimentMap.get(o.symbol)))
    .join('\n---\n');

  try {
    const raw = await callAI('reasoning', cards, UNIFIED_ASSET_ANALYSIS_PROMPT, 6144);
    const parsed = JSON.parse(raw);

    for (const a of (parsed.analyses ?? [])) {
      if (!a.symbol) continue;
      result.set(a.symbol, {
        action: ['BUY', 'SELL', 'HOLD', 'WATCH'].includes(a.action) ? a.action : 'HOLD',
        thesis: a.thesis ?? '',
        catalysts: Array.isArray(a.catalysts) ? a.catalysts.slice(0, 3) : [],
        risks: Array.isArray(a.risks) ? a.risks.slice(0, 2) : [],
        wouldDo: Array.isArray(a.wouldDo) ? a.wouldDo.slice(0, 2) : [],
        wouldNotDo: Array.isArray(a.wouldNotDo) ? a.wouldNotDo.slice(0, 1) : [],
        narrative: a.narrative ?? '',
        macroTheme: a.macroTheme ?? null,
        generatedBy: 'deepseek',
      });
    }

    console.log(`[unified-analysis] Batch ${batch.map(o => o.symbol).join(',')}: ${result.size}/${batch.length} OK`);
  } catch (err) {
    console.warn(`[unified-analysis] Batch failed: ${(err as Error).message?.slice(0, 100)}`);
  }

  return result;
}

/**
 * Main entry point: run unified analysis for top N opportunities.
 * Batches of BATCH_SIZE in parallel. Same model. Consistent outputs.
 *
 * @param opportunities - Sorted by opportunityScore desc, already filtered by anti-hype
 * @param maxAssets - Max assets to analyze (default 12)
 */
export async function runUnifiedAnalysis(
  opportunities: Opportunity[],
  techMap: Map<string, TechnicalSummary>,
  fundMap: Map<string, FundamentalSummary>,
  sentimentMap: Map<string, SentimentInput>,
  maxAssets = 12,
): Promise<Map<string, UnifiedAssetAnalysis>> {
  const result = new Map<string, UnifiedAssetAnalysis>();

  // Portfolio assets always included, then top BUY/SELL by score
  const portfolio = opportunities.filter(o => o.inPortfolio);
  const topNonPortfolio = opportunities
    .filter(o => !o.inPortfolio && (o.action === 'BUY' || o.action === 'SELL') && o.passedAntiHype !== false)
    .slice(0, maxAssets - portfolio.length);

  const targets = [...portfolio, ...topNonPortfolio];

  if (targets.length === 0) {
    console.log('[unified-analysis] No targets to analyze');
    return result;
  }

  console.log(`[unified-analysis] Analyzing ${targets.length} assets (${portfolio.length} portfolio + ${topNonPortfolio.length} top) in batches of ${BATCH_SIZE}`);

  // Build batches
  const batches: Opportunity[][] = [];
  for (let i = 0; i < targets.length; i += BATCH_SIZE) {
    batches.push(targets.slice(i, i + BATCH_SIZE));
  }

  // Run batches in parallel
  const batchResults = await Promise.allSettled(
    batches.map(batch => analyzeBatch(batch, techMap, fundMap, sentimentMap)),
  );

  for (const r of batchResults) {
    if (r.status === 'fulfilled') {
      for (const [symbol, analysis] of r.value) {
        result.set(symbol, analysis);
      }
    }
  }

  console.log(`[unified-analysis] Complete: ${result.size}/${targets.length} assets analyzed`);
  return result;
}
```

- [ ] **Step 2: Build backend para verificar tipos**

```bash
cd apps/backend && npm run build 2>&1 | head -30
```

Esperado: sin errores relacionados a `unified-analysis.service.ts` ni `UnifiedAssetAnalysis`.

- [ ] **Step 3: Commit**

```bash
git add apps/backend/src/intelligence/unified-analysis.service.ts
git commit -m "feat(intelligence): unified-analysis service — one analysis per asset, consistent model"
```

---

## Task 3: Refactor `opportunities.service.ts` — reemplazar 4 llamadas IA por 1

**Files:**
- Modify: `apps/backend/src/opportunities/opportunities.service.ts`

Eliminar: `enrichWithLLM`, `generateDeepAnalyses`, `generateSymbolNarratives`, `generateDailyDigest`.
Agregar: `runUnifiedAnalysis` en su lugar.

- [ ] **Step 1: Agregar import de `runUnifiedAnalysis`**

En `apps/backend/src/opportunities/opportunities.service.ts`, reemplazar el bloque de imports relacionados a market-digest:

```typescript
// ANTES (línea ~25):
import { generateSymbolNarratives, generateDailyDigest } from '../intelligence/market-digest.service.js';

// DESPUÉS:
import { runUnifiedAnalysis } from '../intelligence/unified-analysis.service.js';
```

- [ ] **Step 2: Reemplazar las 4 fases IA por `runUnifiedAnalysis`**

En `runLiveScan`, localizar el bloque de FASE 3 (enrichWithLLM, ~línea 531) hasta el final de FASE 5 (generateDailyDigest, ~línea 700). Reemplazar TODO ese bloque por:

```typescript
  // ============================================================
  updateProgress('Análisis unificado con IA', 6);
  // FASE 3: Análisis unificado — un análisis por activo, mismo modelo
  // Reemplaza: enrichWithLLM + generateDeepAnalyses + generateSymbolNarratives
  // ============================================================
  try {
    const unifiedAnalyses = await runUnifiedAnalysis(
      opportunities,
      techMap,
      fundMap,
      sentimentMap,
    );

    for (const opp of opportunities) {
      const unified = unifiedAnalyses.get(opp.symbol);
      if (!unified) continue;

      // Poblar campos existentes desde unified analysis (retrocompatibilidad UI)
      opp.unifiedAnalysis = unified;
      opp.reasoning = unified.thesis;
      opp.catalysts = unified.catalysts;
      opp.risks = unified.risks;
      opp.narrativeDigest = unified.narrative;

      // deepAnalysis retrocompat (UI puede leerlo desde unifiedAnalysis.wouldDo)
      opp.deepAnalysis = {
        positives: unified.catalysts,
        concerns: unified.risks,
        recommendation: unified.thesis,
        wouldDo: unified.wouldDo,
        wouldNotDo: unified.wouldNotDo,
        generatedBy: unified.generatedBy,
      };
    }

    usedEngine = 'hybrid';
    engineDetail = `Hibrido — scoring algoritmico + DeepSeek R1 análisis unificado (${unifiedAnalyses.size} activos)`;
    console.log(`[opportunities] Análisis unificado: ${unifiedAnalyses.size}/${opportunities.length} activos`);
  } catch (err) {
    console.warn('[opportunities] Unified analysis failed (non-critical):', (err as Error).message?.slice(0, 100));
    engineDetail = 'Algoritmico (análisis unificado no disponible)';
  }
```

- [ ] **Step 3: Eliminar la función `enrichWithLLM` del archivo**

Localizar la función `enrichWithLLM` (~línea 191) y la función `buildEnrichmentMessage` (~línea 143). Eliminar ambas — ya no se usan.

- [ ] **Step 4: Verificar build**

```bash
cd apps/backend && npm run build 2>&1 | grep -E "error|Error" | head -20
```

Esperado: sin errores.

- [ ] **Step 5: Commit**

```bash
git add apps/backend/src/opportunities/opportunities.service.ts
git commit -m "refactor(opportunities): replace 4 AI calls with single runUnifiedAnalysis"
```

---

## Task 4: Refactor `market-report.service.ts` — REPORT lee STAGE 3, no re-analiza activos

**Files:**
- Modify: `apps/backend/src/intelligence/market-report.service.ts`

El problema central: STAGE 4 llama IA para analizar los mismos activos que ya analizó STAGE 3. Fix: pasar los `unifiedAnalyses` generados en STAGE 3 al generador del reporte, que solo hace síntesis macro.

- [ ] **Step 1: Modificar `generateMarketReport` para aceptar análisis previos**

Cambiar la firma de `generateMarketReport`:

```typescript
// ANTES:
export async function generateMarketReport(): Promise<MarketReport>

// DESPUÉS:
export async function generateMarketReport(
  precomputedAnalyses?: Map<string, import('@trading/shared').UnifiedAssetAnalysis>
): Promise<MarketReport>
```

- [ ] **Step 2: Reemplazar las Pasadas 1 y 2 por agrupación desde `precomputedAnalyses`**

En `generateMarketReport`, reemplazar el bloque de Pasada 1 (`identifyActiveThemes`) y Pasada 2 (`analyzeThemeDeep`) por:

```typescript
// === PASADA 1 + 2 UNIFICADAS: agrupar análisis previos por macroTheme ===
let themes: MarketReport['themes'];
let allRecs: MarketReportRecommendation[];

if (precomputedAnalyses && precomputedAnalyses.size > 0) {
  console.log(`[MarketReport] Usando ${precomputedAnalyses.size} análisis previos de STAGE 3`);

  // Agrupar por macroTheme
  const themeMap = new Map<string, MarketReportRecommendation[]>();

  for (const [symbol, analysis] of precomputedAnalyses) {
    const theme = analysis.macroTheme ?? 'Otros';
    if (!themeMap.has(theme)) themeMap.set(theme, []);

    const quote = quotes.find(q => q.symbol === symbol);
    themeMap.get(theme)!.push({
      symbol,
      name: symbol, // clasificación ya está en Opportunity; usamos symbol como fallback
      instrumentType: 'Accion US',
      sector: theme,
      thesis: analysis.thesis,
      catalysts: analysis.catalysts,
      risks: analysis.risks,
      suggestedWeight: analysis.action === 'BUY' ? 10 : 0,
    });
  }

  themes = [...themeMap.entries()].map(([theme, recs]) => ({
    theme,
    relevance: recs.some(r => r.suggestedWeight > 0) ? 'high' as const : 'medium' as const,
    summary: `${recs.length} activos analizados`,
    sectors: [],
    recommendations: recs,
  }));

  allRecs = [...themeMap.values()].flat()
    .filter(r => r.suggestedWeight > 0)
    .sort((a, b) => (b.suggestedWeight ?? 0) - (a.suggestedWeight ?? 0));

  console.log(`[MarketReport] ${themes.length} temas, ${allRecs.length} recomendaciones desde análisis previos`);
} else {
  // Fallback: pipeline temático completo (cuando no hay análisis previos — ej: re-run de solo REPORT)
  console.log('[MarketReport] Sin análisis previos — ejecutando pipeline temático completo');
  const { dbHeadlines, thematicContext } = await getNewsContext();
  const identifiedThemes = await identifyActiveThemes(dbHeadlines, thematicContext);
  const activeThemes = identifiedThemes.filter(t => t.relevance !== 'low');
  const allSuggestedTickers = [...new Set(identifiedThemes.flatMap(t => t.suggestedTickers))];
  const allTickers = [...new Set([...symbols, ...allSuggestedTickers])];
  const tickerData = await enrichWithRealData(allTickers);
  const themeAnalyses: ThemeDeepAnalysis[] = [];
  for (let i = 0; i < activeThemes.length; i += 2) {
    const batch = activeThemes.slice(i, i + 2);
    const results = await Promise.allSettled(batch.map(theme => analyzeThemeDeep(theme, tickerData)));
    for (const r of results) { if (r.status === 'fulfilled') themeAnalyses.push(r.value); }
  }
  allRecs = [];
  for (const analysis of themeAnalyses) {
    for (const rec of analysis.recommendations) {
      if (!allRecs.find(r => r.symbol === rec.symbol)) allRecs.push(rec as MarketReportRecommendation);
    }
  }
  themes = identifiedThemes.map(t => {
    const analysis = themeAnalyses.find(a => a.theme === t.theme);
    return {
      theme: t.theme,
      relevance: t.relevance,
      summary: t.summary,
      sectors: t.sectors,
      recommendations: (analysis?.recommendations ?? []) as MarketReportRecommendation[],
    };
  });
}
```

- [ ] **Step 3: Reemplazar Pasada 3 por síntesis con `REPORT_SYNTHESIS_PROMPT`**

Reemplazar la llamada a `consolidateFinalReport` por una llamada directa con el nuevo prompt:

```typescript
// === PASADA 3: Síntesis macro (no re-analiza activos) ===
console.log('[MarketReport] Pasada 3: síntesis macro...');

const themeSummaries = themes
  .map(t => `[${t.relevance?.toUpperCase() ?? 'MED'}] ${t.theme}: ${t.summary} (${t.recommendations.length} activos)`)
  .join('\n');

const topSymbols = allRecs.slice(0, 8).map(r =>
  `${r.symbol}: ${r.thesis?.slice(0, 80) ?? ''} catalysts=${r.catalysts?.slice(0,2).join(';') ?? ''}`
).join('\n');

const synthesisUserMsg = [
  `TEMATICAS (${themes.length}):`,
  themeSummaries,
  '',
  `TOP RECOMENDACIONES (${allRecs.slice(0, 8).length}):`,
  topSymbols,
  '',
  portfolioContext,
  '',
  `HEADLINES: ${dbHeadlines?.slice(0, 5).join(' | ') ?? ''}`,
].join('\n');

let macroContext = themeSummaries;
let portfolioImpact = '';
let scenarios: MarketReport['scenarios'] = [];
let avoidList: string[] = [];

try {
  const { REPORT_SYNTHESIS_PROMPT } = await import('@trading/shared');
  const rawSynthesis = await callAI('reasoning', synthesisUserMsg, REPORT_SYNTHESIS_PROMPT, 3000);
  const parsedSynthesis = JSON.parse(rawSynthesis);
  macroContext = parsedSynthesis.macroContext ?? themeSummaries;
  portfolioImpact = parsedSynthesis.portfolioImpact ?? '';
  scenarios = Array.isArray(parsedSynthesis.scenarios)
    ? parsedSynthesis.scenarios.map((s: any) => ({
        name: s.name ?? '',
        probability: s.probability ?? 0,
        distribution: Array.isArray(s.distribution)
          ? s.distribution.map((d: any) => ({ symbol: d.symbol ?? '', weight: d.weight ?? 0, reason: d.reason ?? '' }))
          : [],
      }))
    : [];
  avoidList = Array.isArray(parsedSynthesis.avoidList) ? parsedSynthesis.avoidList : [];
} catch (err) {
  console.warn('[MarketReport] Synthesis failed, using theme summaries as fallback:', (err as Error).message?.slice(0, 80));
}
```

- [ ] **Step 4: Necesita `dbHeadlines` en scope cuando viene de `precomputedAnalyses`**

Al inicio de `generateMarketReport`, después de recolectar portfolio context, agregar:

```typescript
// Siempre necesitamos headlines para el synthesis (independiente del path)
const todayArticles = getNewsArticlesForToday('medium');
const dbHeadlines = todayArticles
  .map(a => `- ${a.title} [${(a as any).sentiment ?? '?'}]`)
  .slice(0, 20);
```

(Mover el `dbHeadlines` que ya existe en `getNewsContext` para que esté disponible en ambos paths.)

- [ ] **Step 5: Verificar build**

```bash
cd apps/backend && npm run build 2>&1 | grep -E "error|Error" | head -20
```

Esperado: sin errores.

- [ ] **Step 6: Commit**

```bash
git add apps/backend/src/intelligence/market-report.service.ts
git commit -m "refactor(market-report): read STAGE 3 analyses instead of re-analyzing assets"
```

---

## Task 5: Conectar STAGE 3 → STAGE 4 en `pipeline.service.ts`

**Files:**
- Modify: `apps/backend/src/intelligence/pipeline.service.ts`

El pipeline necesita pasar los análisis generados en STAGE 3 al STAGE 4.

- [ ] **Step 1: Modificar `runAnalysisStage` para retornar análisis**

El tipo de retorno actual de `runAnalysisStage` es `Promise<StageResult>`. Necesitamos que también retorne los análisis sin cambiar el contrato de `StageResult`. Solución: módulo-level variable temporal dentro del pipeline run.

En `pipeline.service.ts`, agregar variable de estado interno:

```typescript
// State passed between stages within a single pipeline run
// Reset at the start of each checkOrRunPipeline call
let _stageUnifiedAnalyses: Map<string, import('@trading/shared').UnifiedAssetAnalysis> | null = null;
```

- [ ] **Step 2: Modificar `runAnalysisBlocking` para retornar análisis**

En `apps/backend/src/opportunities/opportunities.service.ts`, la función `runAnalysisBlocking` actualmente retorna `OpportunityScanResult`. Modificar para también exponer los análisis:

```typescript
// Agregar variable de módulo para exponer últimos análisis al pipeline
let _lastUnifiedAnalyses: Map<string, import('@trading/shared').UnifiedAssetAnalysis> = new Map();

export function getLastUnifiedAnalyses(): Map<string, import('@trading/shared').UnifiedAssetAnalysis> {
  return _lastUnifiedAnalyses;
}
```

En `runLiveScan`, después de `for (const opp of opportunities) { const unified = ...` (donde se asigna `opp.unifiedAnalysis`), agregar:

```typescript
// Exponer análisis para STAGE 4
_lastUnifiedAnalyses = unifiedAnalyses;
```

- [ ] **Step 3: Modificar `runAnalysisStage` en pipeline.service.ts**

```typescript
async function runAnalysisStage(runId: number): Promise<StageResult> {
  const startedAt = new Date().toISOString();
  updatePipelineStage(runId, 'analysis', { status: 'running', startedAt });
  try {
    const result = await runAnalysisBlocking();
    // Capturar análisis para STAGE 4
    const { getLastUnifiedAnalyses } = await import('../opportunities/opportunities.service.js');
    _stageUnifiedAnalyses = getLastUnifiedAnalyses();
    const symbolCount = result.totalSymbolsScanned ?? 0;
    const sr: StageResult = {
      status: 'ok',
      startedAt,
      finishedAt: new Date().toISOString(),
      detail: `${symbolCount} símbolos analizados, ${_stageUnifiedAnalyses.size} con análisis IA.`,
      errors: [],
    };
    updatePipelineStage(runId, 'analysis', sr);
    return sr;
  } catch (err) {
    _stageUnifiedAnalyses = null;
    const sr: StageResult = {
      status: 'failed',
      startedAt,
      finishedAt: new Date().toISOString(),
      detail: 'Error en análisis.',
      errors: [],
      criticalError: (err as Error).message.slice(0, 200),
    };
    updatePipelineStage(runId, 'analysis', sr);
    return sr;
  }
}
```

- [ ] **Step 4: Modificar `runReportStage` para recibir análisis previos**

```typescript
async function runReportStage(runId: number): Promise<StageResult> {
  const startedAt = new Date().toISOString();
  updatePipelineStage(runId, 'report', { status: 'running', startedAt });
  try {
    // Pasar análisis de STAGE 3 si están disponibles
    const report = await generateMarketReport(_stageUnifiedAnalyses ?? undefined);
    _stageUnifiedAnalyses = null; // limpiar después de uso
    const themeCount = report.themes?.length ?? 0;
    const reportErrors: string[] = report.errors ?? [];
    const sr: StageResult = {
      status: reportErrors.length > 0 ? 'partial' : 'ok',
      startedAt,
      finishedAt: new Date().toISOString(),
      detail: `Reporte generado con ${themeCount} temas.`,
      errors: reportErrors,
    };
    updatePipelineStage(runId, 'report', sr);
    return sr;
  } catch (err) {
    const sr: StageResult = {
      status: 'failed',
      startedAt,
      finishedAt: new Date().toISOString(),
      detail: 'Error generando reporte.',
      errors: [],
      criticalError: (err as Error).message.slice(0, 200),
    };
    updatePipelineStage(runId, 'report', sr);
    return sr;
  }
}
```

- [ ] **Step 5: Reset `_stageUnifiedAnalyses` al inicio de `checkOrRunPipeline`**

Al principio de `checkOrRunPipeline`, agregar:

```typescript
_stageUnifiedAnalyses = null; // reset para este run
```

- [ ] **Step 6: Verificar build completo**

```bash
cd /path/to/monorepo && npm run build 2>&1 | grep -E "error|Error" | head -30
```

Esperado: sin errores.

- [ ] **Step 7: Commit**

```bash
git add apps/backend/src/intelligence/pipeline.service.ts apps/backend/src/opportunities/opportunities.service.ts
git commit -m "feat(pipeline): pass STAGE 3 analyses to STAGE 4 — no re-analysis of assets"
```

---

## Task 6: Prueba manual end-to-end

- [ ] **Step 1: Arrancar backend**

```bash
cd apps/backend && npm run dev
```

- [ ] **Step 2: Disparar pipeline vía curl**

```bash
curl -X POST http://localhost:3001/trpc/intelligence.generateMarketReport \
  -H "Content-Type: application/json" \
  -d '{"json":{"force":true}}'
```

- [ ] **Step 3: Verificar logs del pipeline**

Esperado en orden:
```
[opportunities] Análisis unificado: N/M activos
[unified-analysis] Batch GGAL,NVDA,...: 4/4 OK
[MarketReport] Usando N análisis previos de STAGE 3
[MarketReport] N temas, M recomendaciones desde análisis previos
[MarketReport] Pasada 3: síntesis macro...
```

**NO esperado (señal de regresión):**
```
[DeepAnalysis] Generating for...
[opportunities] LM Studio enrichment...
[MarketReport] Pasada 1: Identificando temáticas activas...
[MarketReport] Analizando N temáticas en profundidad...
```

- [ ] **Step 4: Verificar ausencia de contradicciones**

Abrir el reporte generado. Para cada símbolo en `topRecommendations`:
1. Buscar ese símbolo en `opportunities` del scan
2. Verificar que `opportunity.unifiedAnalysis.action` coincide con la dirección del reporte
3. Si el reporte dice BUY, el análisis del activo no debe tener `risks` que contradigan la tesis

- [ ] **Step 5: Commit final**

```bash
git add -A
git commit -m "test: verify unified pipeline end-to-end — no contradictions between stages"
```

---

## Self-Review

### Spec coverage

| Requisito | Task |
|---|---|
| Un análisis por activo | Task 2 (`unified-analysis.service.ts`) |
| Mismo modelo para todos los activos | Task 2 (`callAI('reasoning')` = DeepSeek R1 primario) |
| Batches paralelos | Task 2 (`Promise.allSettled(batches.map(...))`) |
| REPORT lee STAGE 3, no re-analiza | Task 4 + Task 5 |
| Prompts compactos sin tokens redundantes | Task 1 (`buildCompactCard` + prompts cortos) |
| Portfolio siempre incluido en análisis | Task 2 (`portfolio` siempre en `targets`) |
| Fallback si no hay análisis previos | Task 4 (path `else` con pipeline temático completo) |
| Retrocompatibilidad con campos existentes de `Opportunity` | Task 3 (popula `reasoning`, `catalysts`, `risks`, `narrativeDigest`, `deepAnalysis`) |

### Placeholder scan

Sin TBDs, TODOs ni secciones incompletas. Todas las funciones tienen código real. Los tipos y firmas son consistentes entre tasks.

### Type consistency

- `UnifiedAssetAnalysis` definido en Task 1, usado en Task 2, 3, 4, 5.
- `runUnifiedAnalysis` definido en Task 2, importado en Task 3.
- `getLastUnifiedAnalyses` definido en Task 3, importado en Task 5.
- `generateMarketReport(precomputedAnalyses?)` modificado en Task 4, llamado en Task 5.
- `_stageUnifiedAnalyses` variable de módulo en Task 5 — tipo `Map<string, UnifiedAssetAnalysis> | null`.
