# Pipeline Audit Fixes — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Corregir todos los bugs críticos y problemas de fidelidad identificados en la auditoría del pipeline de análisis.

**Architecture:** Fixes distribuidos en 5 archivos core del backend + 1 archivo de tipos compartidos. Sin cambios estructurales — cada fix es quirúrgico en su archivo correspondiente.

**Tech Stack:** TypeScript, Hono, tRPC, DeepSeek R1 / Groq / Gemini 2.5, SQLite + Drizzle, Yahoo Finance v8

---

## Task 1: Integrar Gemini 2.5 al ai-router.ts

**Files:**
- Modify: `apps/backend/src/shared/gemini.ts`
- Modify: `apps/backend/src/shared/ai-router.ts`

**El bug:** `gemini.ts` está 100% implementado con 4 keys y rotación, pero NUNCA se importa en ai-router.ts. El pipeline desperdicia el modelo más capaz disponible.

- [ ] Agregar `askGeminiFlash` a gemini.ts (solo usa Flash, preserva Pro quota para reasoning):

```typescript
// Al final de gemini.ts, antes del último export
const GEMINI_FLASH_ONLY: GeminiModel[] = ['gemini-2.5-flash'];

export async function askGeminiFlash(
  userMessage: string,
  systemPrompt: string,
  maxTokens: number = 4096,
): Promise<string> {
  const keys = getApiKeys();
  if (keys.length === 0) throw new Error('No Gemini API keys configured');

  let lastError: Error | null = null;
  let skipped = 0;

  for (const model of GEMINI_FLASH_ONLY) {
    for (let keyIndex = 0; keyIndex < keys.length; keyIndex++) {
      if (isExhausted('gemini', model, keyIndex)) { skipped++; continue; }

      const client = new GoogleGenerativeAI(keys[keyIndex]);
      const genModel = client.getGenerativeModel({
        model,
        systemInstruction: systemPrompt + '\n\nResponde SOLO con JSON valido.',
      });

      try {
        const result = await genModel.generateContent({
          contents: [{ role: 'user', parts: [{ text: userMessage }] }],
          generationConfig: { maxOutputTokens: maxTokens, temperature: 0.1, responseMimeType: 'application/json' },
        });
        const content = result.response.text();
        if (content) {
          console.log(`[gemini-flash] Success — key: #${keyIndex + 1}`);
          return content;
        }
      } catch (err) {
        const msg = (err as Error).message || '';
        const quota = isQuotaError(msg);
        console.warn(`[gemini-flash] key#${keyIndex + 1} failed${quota ? ' (quota)' : ''}: ${msg.slice(0, 120)}`);
        if (quota) markExhausted('gemini', model, dailyResetAt(), keyIndex);
        lastError = err as Error;
        if (!isRetryableError(msg)) throw err;
      }
    }
  }

  throw lastError ?? new Error('All Gemini Flash keys exhausted');
}
```

- [ ] Actualizar ai-router.ts para importar y usar Gemini:

```typescript
// Reemplazar imports al inicio del archivo
import { askGroq, askGroqLight } from './groq.js';
import { askOpenRouter } from './openrouter.js';
import { askLMStudio } from './lmstudio.js';
import { askGemini, askGeminiFlash, isGeminiAvailable } from './gemini.js';
```

- [ ] Actualizar `getProviderChain` en ai-router.ts:

```typescript
function getProviderChain(
  task: AITask,
  userMessage: string,
  systemPrompt: string,
  maxTokens: number,
): Array<{ name: string; fn: () => Promise<string> }> {
  const gemini = {
    name: 'Gemini 2.5 Pro',
    fn: () => askGemini(userMessage, systemPrompt, maxTokens),
  };

  const geminiFlash = {
    name: 'Gemini 2.5 Flash',
    fn: () => askGeminiFlash(userMessage, systemPrompt, maxTokens),
  };

  const deepseek = {
    name: 'DeepSeek R1 (OpenRouter)',
    fn: () => askOpenRouter(userMessage, systemPrompt, maxTokens),
  };

  const groq = {
    name: 'Groq (Llama 70B)',
    fn: () => askGroq(userMessage, systemPrompt, maxTokens),
  };

  const groqLight = {
    name: 'Groq Light (gemma2/8b)',
    fn: () => askGroqLight(userMessage, systemPrompt, Math.min(maxTokens, 2048)),
  };

  const qwen = {
    name: 'Qwen 3.5 9B (local)',
    fn: () => askLMStudio(userMessage, systemPrompt, Math.min(maxTokens, 4096)),
  };

  switch (task) {
    case 'reasoning':
      // Gemini Pro primero (mejor razonamiento) → DeepSeek R1 → Groq 70B → Qwen
      return isGeminiAvailable()
        ? [gemini, deepseek, groq, qwen]
        : [deepseek, groq, qwen];

    case 'classification':
      // Flash para tareas rápidas → preserva Pro quota → Groq light → DeepSeek → Qwen
      return isGeminiAvailable()
        ? [geminiFlash, groqLight, deepseek, qwen]
        : [groqLight, deepseek, qwen];

    case 'narrative':
      // Flash suficiente para texto corto
      return isGeminiAvailable()
        ? [geminiFlash, groqLight, qwen]
        : [groqLight, qwen];
  }
}
```

- [ ] Commit: `fix(ai-router): integrate Gemini 2.5 Pro/Flash as primary reasoning provider`

---

## Task 2: Fix crítico — Stage 3 analyses nunca se pasan a generateMarketReport

**Files:**
- Modify: `apps/backend/src/intelligence/pipeline.service.ts`

**El bug:** `_stageUnifiedAnalyses` se asigna en `runAnalysisStage()` (línea 196) pero `runReportStage()` llama `generateMarketReport()` SIN pasarle el argumento. El parámetro `precomputedAnalyses` en market-report.service.ts es dead code — nunca recibe datos del Stage 3.

- [ ] En `runReportStage()`, pasar `_stageUnifiedAnalyses` a `generateMarketReport`:

```typescript
async function runReportStage(runId: number): Promise<StageResult> {
  const startedAt = new Date().toISOString();
  updatePipelineStage(runId, 'report', { status: 'running', startedAt });
  try {
    // FIX: pasar precomputedAnalyses del Stage 3 (antes nunca se pasaban)
    const precomputed = _stageUnifiedAnalyses ?? undefined;
    const report = await generateMarketReport(precomputed);
    _stageUnifiedAnalyses = null;
    // ... resto igual
```

- [ ] Commit: `fix(pipeline): pass stage3 unified analyses to generateMarketReport`

---

## Task 3: Fix re-run Stage 5 — cargar análisis del Stage 3 desde memoria

**Files:**
- Modify: `apps/backend/src/intelligence/pipeline.service.ts`

**El bug:** `rerunPipelineStage()` nullea `_stageUnifiedAnalyses` en línea 387 antes de saber qué stage se va a re-ejecutar. Si el usuario re-corre solo Stage 5 (report), los análisis del Stage 3 que siguen en memoria se pierden.

- [ ] En `rerunPipelineStage()`, cargar desde `getLastUnifiedAnalyses()` en lugar de nullear:

```typescript
export async function rerunPipelineStage(
  stage: 'webSearch' | 'news' | 'fundamentals' | 'analysis' | 'report'
): Promise<PipelineRun> {
  const today = getToday();
  const activeRun = getActivePipelineRun();
  if (activeRun) return activeRun;

  const existingRun = getPipelineRunByDate(today);
  const run = existingRun ?? createPipelineRun(today);
  const runId = run.id;

  // FIX: en lugar de nullear, cargar los análisis que estén en memoria del Stage 3
  // Si se re-corre solo el report, los análisis del analysis stage siguen disponibles
  _stageUnifiedAnalyses = stage === 'report' ? (getLastUnifiedAnalyses() ?? null) : null;
  markRunAsRunning(runId);
  // ... resto igual
```

- [ ] Commit: `fix(pipeline): rerun stage5 reuses stage3 analyses from memory`

---

## Task 4: Fix `generatedBy` y `engine` hardcodeados — exponer modelo real

**Files:**
- Modify: `apps/backend/src/shared/ai-router.ts`
- Modify: `apps/backend/src/intelligence/unified-analysis.service.ts`
- Modify: `apps/backend/src/intelligence/market-report.service.ts`

**El bug:** `generatedBy` siempre dice `'deepseek'` y `engine` siempre `'groq-pipeline-thematic'` sin importar qué modelo corrió realmente.

- [ ] Agregar `callAIWithModel` a ai-router.ts:

```typescript
// Agregar después de callAIText (línea 97)

/**
 * Call AI returning both content and the model name that succeeded.
 */
export async function callAIWithModel(
  task: AITask,
  userMessage: string,
  systemPrompt: string,
  maxTokens: number = 4096,
): Promise<{ content: string; model: string }> {
  const providers = getProviderChain(task, userMessage, systemPrompt, maxTokens);

  for (const { name, fn } of providers) {
    const result = await tryProvider(name, fn, true);
    if (result) return { content: result, model: name };
  }

  throw new Error(`[ai-router] All providers failed for task: ${task}`);
}
```

- [ ] Actualizar `analyzeBatch` en unified-analysis.service.ts para usar `callAIWithModel`:

```typescript
// Cambiar import
import { callAI, callAIWithModel } from '../shared/ai-router.js';

// En analyzeBatch(), cambiar la llamada:
const { content: raw, model: usedModel } = await callAIWithModel('reasoning', cards, UNIFIED_ASSET_ANALYSIS_PROMPT, 6144);
const parsed = JSON.parse(raw);

// Al mapear el resultado, derivar generatedBy del nombre del modelo real:
function modelNameToProvider(name: string): UnifiedAssetAnalysis['generatedBy'] {
  if (name.includes('Gemini')) return 'claude'; // reutilizar 'claude' para Gemini — o agregar tipo
  if (name.includes('DeepSeek')) return 'deepseek';
  if (name.includes('Groq')) return 'groq';
  if (name.includes('Qwen') || name.includes('local')) return 'qwen';
  return 'openrouter';
}

// En el resultado:
generatedBy: modelNameToProvider(usedModel),
```

**Nota:** `UnifiedAssetAnalysis.generatedBy` ya tiene el tipo `'deepseek' | 'groq' | 'qwen' | 'claude' | 'openrouter'` en `packages/shared/src/types/opportunity.ts:133` — reusar `'claude'` para Gemini (ya está el tipo).

- [ ] Actualizar `generateMarketReport` en market-report.service.ts para trackear engine real:

```typescript
// Al inicio de generateMarketReport, agregar variable:
let actualEngine = 'groq-pipeline-thematic';

// Al hacer las llamadas callAI, cambiar por callAIWithModel las que importan
// (al menos la síntesis final). Ejemplo en síntesis (línea ~668):
import { callAI, callAIWithModel } from '../shared/ai-router.js';

// Pasada de síntesis:
const { content: rawSynthesis, model: synthModel } = await callAIWithModel('reasoning', synthesisUserMsg, REPORT_SYNTHESIS_PROMPT, 3000);
actualEngine = synthModel;

// En el report final (línea 709):
engine: actualEngine,
```

- [ ] Commit: `fix(ai-router): expose actual model name via callAIWithModel, fix hardcoded generatedBy`

---

## Task 5: Fix HOLD/WATCH — incluir posiciones del portfolio en el reporte

**Files:**
- Modify: `apps/backend/src/intelligence/market-report.service.ts`

**El bug:** línea 544 filtra `HOLD` y `WATCH` completamente. Si todo el portfolio es HOLD, el reporte no menciona ninguna posición del usuario.

- [ ] En el bloque `precomputedAnalyses` (línea ~537 de market-report.service.ts), obtener portfolio y cambiar el filtro:

```typescript
// Obtener posiciones del portfolio para saber qué activos pertenecen al usuario
const portfolioPositions = getPortfolioPositions();
const portfolioSymbolSet = new Set(portfolioPositions.map(p => p.symbol));

for (const [symbol, analysis] of precomputedAnalyses) {
  // FIX: incluir activos del portfolio aunque sean HOLD/WATCH
  // Solo filtrar HOLD/WATCH para activos que NO están en el portfolio
  const isInPortfolio = portfolioSymbolSet.has(symbol);
  if (!isInPortfolio && (analysis.action === 'HOLD' || analysis.action === 'WATCH')) continue;

  const theme = analysis.macroTheme ?? 'Portfolio';
  // ...resto igual
```

- [ ] Commit: `fix(market-report): include portfolio HOLD/WATCH positions in precomputed path`

---

## Task 6: Fix instrumentType y name en el path precomputed

**Files:**
- Modify: `apps/backend/src/intelligence/market-report.service.ts`

**El bug:** líneas 552-553: todos los activos quedan como `name: symbol` (ej: "GGAL") y `instrumentType: 'Accion US'` aunque sean CEDEARs o crypto. Incorrecto para inversor argentino.

- [ ] Al inicio del bloque `precomputedAnalyses` (antes del loop), construir mapa tipo/nombre desde DB:

```typescript
// Agregar imports al inicio del archivo si no están:
import { getAllSymbols } from '../db/repository.js';

// Dentro de generateMarketReport, antes del loop de precomputedAnalyses:
// Construir mapa symbol → {name, instrumentType} desde DB (síncrono)
const allSymbols = getAllSymbols();
const symbolMetaMap = new Map<string, { name: string; instrumentType: string }>();
for (const s of allSymbols) {
  let instrumentType = 'Accion US';
  if (s.plaza === 'argentina-cedears') instrumentType = 'CEDEAR';
  else if (s.type === 'crypto') instrumentType = 'Crypto';
  else if (s.plaza?.includes('etf') || s.type === 'us' && s.plaza === 'etfs-sectors') instrumentType = 'ETF';
  symbolMetaMap.set(s.symbol, { name: s.name || s.symbol, instrumentType });
}
```

- [ ] En el mapeo de recomendaciones (línea ~548), usar el mapa:

```typescript
const meta = symbolMetaMap.get(symbol);
themeMap.get(theme)!.push({
  symbol,
  name: meta?.name ?? symbol,                          // FIX: nombre real de DB
  instrumentType: meta?.instrumentType ?? 'Accion US', // FIX: tipo real (CEDEAR, Crypto, etc.)
  sector: theme,
  thesis: analysis.thesis,
  catalysts: analysis.catalysts,
  risks: analysis.risks,
  suggestedWeight: analysis.action === 'BUY' ? 10 : analysis.action === 'SELL' ? 0 : 5,
});
```

- [ ] Commit: `fix(market-report): use real name/instrumentType from DB in precomputed path`

---

## Task 7: Fix discovery queries — paralelas + queries en español para Argentina

**Files:**
- Modify: `apps/backend/src/web-search/web-search.service.ts`

**Bug 1:** discovery queries corren secuencialmente (5-10s de latencia gratis).
**Bug 2:** queries en inglés solo — pierden cobertura de fuentes argentinas en español.

- [ ] Reemplazar `DISCOVERY_QUERIES` con versión bilingüe:

```typescript
const DISCOVERY_QUERIES = [
  // EN — cobertura global
  'best stock market opportunities today',
  'AI semiconductors stocks news today',
  'oil energy stocks opportunities today',
  // ES — cobertura argentina y regional
  'acciones argentinas oportunidades hoy merval cedears',
  'bitcoin criptomonedas oportunidades esta semana',
  'noticias economicas argentina inversiones hoy',
  'bolsa new york oportunidades acciones hoy',
];
```

- [ ] Cambiar el loop secuencial por `Promise.allSettled` (líneas 89-116):

```typescript
// Layer 2: Discovery (paralelo — antes era secuencial)
const discoveryResults = await Promise.allSettled(
  DISCOVERY_QUERIES.map(async (query) => {
    const results = await searchWithFallback(query);
    const discoveryArticles: WebSearchArticle[] = results.map(result => {
      const tickers = extractTickers(result.title + ' ' + result.content);
      return {
        date,
        symbol: null,
        query,
        layer: 'discovery' as const,
        title: result.title,
        url: result.url,
        content: result.content,
        publishedAt: result.publishedAt,
        relatedSymbols: tickers,
      };
    });
    // Register novel tickers
    const allTickers = results.flatMap(r => extractTickers(r.title + ' ' + r.content));
    if (allTickers.length > 0) {
      registerNovelTickers(allTickers, 'yahoo').catch(() => {});
    }
    return discoveryArticles;
  }),
);

let discoverySuccessCount = 0;
for (const r of discoveryResults) {
  if (r.status === 'fulfilled') {
    discoverySuccessCount++;
    articles.push(...r.value);
  } else {
    errors.push(`Discovery failed: ${(r as PromiseRejectedResult).reason?.message?.slice(0, 80)}`);
  }
}
```

- [ ] Commit: `perf(web-search): parallelize discovery queries, add Spanish queries for Argentina`

---

## Task 8: Reducir TTL de fundamentales de 7 → 3 días

**Files:**
- Modify: `apps/backend/src/intelligence/pipeline.service.ts`

**El bug:** P/E, EPS, revenue guidance cachean 7 días. En earnings season los datos pueden estar completamente desactualizados al momento del análisis.

- [ ] En `runFundamentalsStage()` línea 152:

```typescript
// Antes:
if (daysOld < 7) {
// Después:
if (daysOld < 3) {
```

- [ ] Actualizar el mensaje de detalle:

```typescript
detail: `Cache válido (${daysOld.toFixed(1)} días). Próxima actualización en ${(3 - daysOld).toFixed(1)} días.`,
// y en el log:
detail: `${result.refreshed} fundamentales actualizados.`,
```

- [ ] Commit: `fix(pipeline): reduce fundamentals cache TTL from 7 to 3 days`

---

## Task 9: Fix maxTokens para DeepSeek R1 chain-of-thought

**Files:**
- Modify: `apps/backend/src/shared/openrouter.ts`

**El bug:** DeepSeek R1 usa `<think>...</think>` antes del JSON. Si el thinking toma 3000 tokens del límite de 6144, el JSON queda truncado → falla → fallback innecesario a modelos peores.

- [ ] En `askOpenRouter`, ajustar maxTokens para modelos reasoning:

```typescript
export async function askOpenRouter(
  userMessage: string,
  systemPrompt: string,
  maxTokens: number = 4096,
): Promise<string> {
  let lastError: Error | null = null;

  for (const model of OPENROUTER_FREE_MODELS) {
    if (isExhausted('openrouter', model)) continue;

    // FIX: modelos reasoning (R1, etc.) usan tokens para chain-of-thought
    // Duplicar el límite para darles espacio al thinking sin truncar el JSON
    const isReasoningModel = model.includes('r1') || model.includes('deepseek');
    const effectiveMaxTokens = isReasoningModel ? Math.min(maxTokens * 2, 16384) : maxTokens;

    try {
      const response = await getClient().chat.completions.create({
        model,
        max_tokens: effectiveMaxTokens,  // FIX: usar effectiveMaxTokens
        // ...resto igual
```

- [ ] Commit: `fix(openrouter): double maxTokens for reasoning models to accommodate CoT`

---

## Task 10: Fix timezone Argentina — getToday() usa UTC

**Files:**
- Modify: `apps/backend/src/intelligence/pipeline.service.ts`

**El bug:** `new Date().toISOString().split('T')[0]` retorna fecha UTC. Después de las 21hs en Argentina (UTC-3), el pipeline trabaja con "mañana" aunque localmente sea hoy.

- [ ] Reemplazar `getToday()`:

```typescript
function getToday(): string {
  // FIX: usar timezone de Buenos Aires (UTC-3, maneja DST automáticamente)
  return new Date().toLocaleDateString('en-CA', { timeZone: 'America/Argentina/Buenos_Aires' });
}
```

`en-CA` locale retorna formato ISO `YYYY-MM-DD` directamente.

- [ ] Commit: `fix(pipeline): use Buenos Aires timezone for date calculation`

---

## Task 11: Fix macroTheme — normalizar claves para evitar fragmentación

**Files:**
- Modify: `apps/backend/src/intelligence/market-report.service.ts`

**El bug:** `macroTheme` es texto libre del LLM. El mismo sector puede quedar como "Semiconductores", "AI/Chips", "semiconductors", fragmentando el reporte en temas duplicados.

- [ ] Agregar función de normalización antes del bloque `precomputedAnalyses`:

```typescript
function normalizeMacroTheme(theme: string | null): string {
  if (!theme) return 'Otros';
  const t = theme.toLowerCase().trim();

  // Semiconductores / IA
  if (t.includes('semiconductor') || t.includes('chip') || t.includes('nvda') ||
      t.includes('ai/') || t.includes('inteligencia artificial')) return 'Semiconductores / IA';

  // Energía
  if (t.includes('petróleo') || t.includes('petroleo') || t.includes('oil') ||
      t.includes('energía') || t.includes('energia') || t.includes('opec')) return 'Energía';

  // Argentina / Mercados emergentes
  if (t.includes('argentina') || t.includes('cedear') || t.includes('merval') ||
      t.includes('emergente') || t.includes('latam')) return 'Argentina / Emergentes';

  // Cripto
  if (t.includes('crypto') || t.includes('cripto') || t.includes('bitcoin') ||
      t.includes('blockchain')) return 'Cripto';

  // Defensa / Geopolítica
  if (t.includes('defensa') || t.includes('defense') || t.includes('geopolít') ||
      t.includes('guerra') || t.includes('conflicto')) return 'Defensa / Geopolítica';

  // Finanzas / Banca
  if (t.includes('banco') || t.includes('bank') || t.includes('finanzas') ||
      t.includes('finance')) return 'Finanzas';

  // Farmacéutica / Salud
  if (t.includes('farma') || t.includes('pharma') || t.includes('salud') ||
      t.includes('health') || t.includes('biotech')) return 'Salud / Farmacéutica';

  return theme.trim(); // mantener original si no matchea
}
```

- [ ] En el loop del precomputed path, aplicar normalización:

```typescript
const theme = normalizeMacroTheme(analysis.macroTheme);
```

- [ ] Commit: `fix(market-report): normalize macroTheme keys to prevent theme fragmentation`

---

## Task 12: Validar probabilidades de escenarios

**Files:**
- Modify: `apps/backend/src/intelligence/market-report.service.ts`

**El bug:** los escenarios del LLM pueden tener probabilidades que no suman 100%, y pesos de distribución inconsistentes.

- [ ] Agregar función de normalización de escenarios (antes del return del report):

```typescript
function normalizeScenarios(
  scenarios: MarketReport['scenarios']
): MarketReport['scenarios'] {
  if (!scenarios || scenarios.length === 0) return scenarios;

  // Normalizar probabilidades para que sumen 100
  const totalProb = scenarios.reduce((sum, s) => sum + (s.probability ?? 0), 0);
  if (totalProb > 0 && Math.abs(totalProb - 100) > 5) {
    scenarios = scenarios.map(s => ({
      ...s,
      probability: Math.round((s.probability ?? 0) / totalProb * 100),
    }));
  }

  // Normalizar pesos de distribución por escenario
  scenarios = scenarios.map(s => {
    const totalWeight = (s.distribution ?? []).reduce((sum, d) => sum + (d.weight ?? 0), 0);
    if (totalWeight > 0 && Math.abs(totalWeight - 100) > 5) {
      return {
        ...s,
        distribution: s.distribution.map(d => ({
          ...d,
          weight: Math.round((d.weight ?? 0) / totalWeight * 100),
        })),
      };
    }
    return s;
  });

  return scenarios;
}
```

- [ ] Aplicar en el report final (antes de `saveMarketReport`):

```typescript
const report: MarketReport = {
  // ...
  scenarios: normalizeScenarios(scenarios),
  // ...
};
```

- [ ] Commit: `fix(market-report): normalize scenario probabilities and distribution weights`

---

## Resumen de issues resueltos

| # | Issue | Task |
|---|-------|------|
| 0 | Gemini 2.5 Pro/Flash nunca conectado al router | Task 1 |
| 1 | Stage 3 analyses nunca pasan a generateMarketReport (dead code) | Task 2 |
| 2 | Re-run Stage 5 ignora Stage 3 analyses | Task 3 |
| 3 | generatedBy y engine hardcodeados | Task 4 |
| 4 | HOLD/WATCH portfolio excluidos del reporte | Task 5 |
| 5 | instrumentType siempre 'Accion US', name = ticker | Task 6 |
| 6 | Discovery queries secuenciales (5-10s gratis) | Task 7 |
| 7 | Discovery queries solo en inglés, miss fuentes AR | Task 7 |
| 8 | Fundamentales TTL 7 días en earnings season | Task 8 |
| 9 | DeepSeek R1 maxTokens causa truncación de JSON | Task 9 |
| 10 | getToday() usa UTC, no Argentina timezone | Task 10 |
| 11 | macroTheme texto libre → temas fragmentados | Task 11 |
| 12 | Scenarios sin validación de probabilidades | Task 12 |
