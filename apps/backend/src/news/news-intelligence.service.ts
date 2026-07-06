import type {
  NewsItem,
  AnalyzedNewsItem,
  NewsAnalysis,
  NewsIntelligence,
  PlazaSummary,
  SymbolTrend,
  IntelligenceAlert,
  ImpactLevel,
  SentimentType,
  MarketPlaza,
} from '@trading/shared';
import { buildBatchNewsAnalysisPrompt, getPlazaForSymbol, PLAZA_CONFIG } from '@trading/shared';
import { updateNewsAnalysis, getActiveSentimentKeywords, insertNewsIntelligenceSnapshot } from '../db/repository.js';
import { validateTickers } from '../discovery/ticker-validator.js';
import { partitionTickersForValidation } from '../discovery/ticker-partition.js';
import { needsLlmAnalysis } from './analysis-pending.js';
import { mapWithConcurrency } from '../shared/concurrency.js';
import { envNumber } from '../shared/env-number.js';
import { getLastTriangulationStats } from './triangulation.service.js';
import { getFullSymbolUniverse } from '../discovery/discovery-registry.js';
import { callAI } from '../shared/ai-router.js';
import { getNews, getNewsFromDB } from './news.service.js';
import { headlineMatchesSymbol } from './headline-match.js';
import { aliasesFor } from './symbol-aliases.js';
import { triangulateNews } from './triangulation.service.js';
import { enrichNewsWithBodies } from './body-fetcher.service.js';
import { filterForDeepAnalysis, logFilterStats, type DeepAnalysisFilterOptions } from './news-filters.service.js';

function getMaxBatchSize(): number {
  // Override explícito por env — OJO: tener LMSTUDIO_URL seteado fuerza batches chicos
  // aunque el router termine usando Groq; el override permite corregir ese caso.
  const override = envNumber('NEWS_BATCH_SIZE', 0);
  if (override > 0) return override;
  // Adaptive batch size based on AI provider
  // LMStudio local (Qwen 9B) → small batches for quality
  // Cloud models (Groq 70B, OpenRouter) → larger batches
  const isLocal = process.env.LMSTUDIO_URL || !process.env.GROQ_API_KEY;
  return isLocal ? 6 : 15;
}
const INTELLIGENCE_TTL = 60 * 60 * 1000; // 60 minutes — swing trader revisa 1-2x/dia

// Keyword-based sentiment analysis — funciona sin IA
// Keywords are loaded from DB (sentiment_keywords table) with in-memory cache.
// The cache is populated on first use and reused for the lifetime of the process.

let _sentimentCache: {
  positive: Set<string>;
  negative: Set<string>;
  highImpact: Set<string>;
} | null = null;

function getSentimentSets(): { positive: Set<string>; negative: Set<string>; highImpact: Set<string> } {
  if (_sentimentCache) return _sentimentCache;
  const keywords = getActiveSentimentKeywords();
  _sentimentCache = {
    positive: new Set(keywords.filter((k) => k.sentiment === 'positive').map((k) => k.keyword.toLowerCase())),
    negative: new Set(keywords.filter((k) => k.sentiment === 'negative').map((k) => k.keyword.toLowerCase())),
    highImpact: new Set(keywords.filter((k) => k.impactLevel === 'high').map((k) => k.keyword.toLowerCase())),
  };
  return _sentimentCache;
}

function keywordSentimentAnalysis(title: string): { sentiment: SentimentType; impact: 'high' | 'medium' | 'low' } {
  const lower = title.toLowerCase();
  const { positive, negative, highImpact } = getSentimentSets();

  let posScore = 0;
  let negScore = 0;

  for (const kw of positive) {
    if (lower.includes(kw)) posScore++;
  }
  for (const kw of negative) {
    if (lower.includes(kw)) negScore++;
  }

  const sentiment: SentimentType = posScore > negScore ? 'positive'
    : negScore > posScore ? 'negative'
    : 'neutral';

  let impact: 'high' | 'medium' | 'low' = 'low';
  for (const kw of highImpact) {
    if (lower.includes(kw)) { impact = 'high'; break; }
  }
  if (impact === 'low' && (posScore + negScore) >= 2) impact = 'medium';

  return { sentiment, impact };
}

function fallbackAnalysis(item: NewsItem): NewsAnalysis {
  const plaza = item.relatedTickers.length > 0
    ? getPlazaForSymbol(item.relatedTickers[0])
    : 'global';

  const { sentiment, impact } = keywordSentimentAnalysis(item.title);

  // Accept all relatedTickers — do NOT filter to current universe, otherwise
  // freshly-discovered tickers (registered in same run) get stripped before
  // they can populate sentimentMap → unified-analysis filter loses them.
  return {
    sentiment,
    impact,
    affectedTickers: item.relatedTickers,
    summary: '',
    marketPlaza: plaza,
  };
}

function parseBatchResponse(raw: string, engineName: string): Array<{
  newsId: string;
  sentiment: SentimentType;
  impact: 'high' | 'medium' | 'low';
  affectedTickers: string[];
  summary: string;
  marketPlaza: MarketPlaza;
}> | null {
  try {
    const parsed = JSON.parse(raw);
    const rawAnalyses = parsed.analyses ?? parsed.results ?? parsed.data ?? parsed;
    const analyses = Array.isArray(rawAnalyses) ? rawAnalyses
      : typeof rawAnalyses === 'object' ? Object.values(rawAnalyses).find(Array.isArray) as typeof rawAnalyses ?? []
      : [];

    if (!Array.isArray(analyses) || analyses.length === 0) {
      console.warn(`[intelligence] ${engineName}: no analyses found. Keys: ${Object.keys(parsed).join(', ')}. Raw: ${raw.slice(0, 300)}`);
      return null;
    }
    return analyses;
  } catch {
    console.warn(`[intelligence] ${engineName}: failed to parse response`);
    return null;
  }
}

async function analyzeBatch(news: NewsItem[]): Promise<AnalyzedNewsItem[]> {
  const analysisMap = new Map<string, {
    sentiment: SentimentType;
    impact: 'high' | 'medium' | 'low';
    affectedTickers: string[];
    summary: string;
    marketPlaza: MarketPlaza;
  }>();

  // Pre-populate with DB values: noticias que ya tienen análisis persistido no necesitan re-analisis.
  // El flag analyzedAt distingue "analizada con resultado neutral/low" de "sin analizar".
  const needsAnalysis: NewsItem[] = [];
  for (const n of news) {
    if (!needsLlmAnalysis(n)) {
      // Ya tiene analisis de la BD — usar directamente
      const plaza = n.relatedTickers.length > 0 ? getPlazaForSymbol(n.relatedTickers[0]) : 'global';
      analysisMap.set(n.id, {
        sentiment: n.sentiment as SentimentType,
        impact: n.impact as 'high' | 'medium' | 'low',
        affectedTickers: n.relatedTickers,
        summary: '',
        marketPlaza: plaza,
      });
    } else {
      needsAnalysis.push(n);
    }
  }

  console.log(`[intelligence] ${news.length} noticias total, ${news.length - needsAnalysis.length} ya analizadas en BD, ${needsAnalysis.length} pendientes`);

  // Analizar en batches con concurrencia limitada (antes: secuencial + sleep fijo → horas con backlog grande)
  const batchSize = getMaxBatchSize();
  const batches: NewsItem[][] = [];
  for (let i = 0; i < needsAnalysis.length; i += batchSize) {
    batches.push(needsAnalysis.slice(i, i + batchSize));
  }
  const totalBatches = batches.length;
  // Análisis que salieron del LLM en esta corrida: sus tickers se validan UNA vez al final,
  // sobre el set deduplicado, en vez de pegarle a Yahoo por cada batch.
  const llmAnalyses: NonNullable<ReturnType<typeof parseBatchResponse>> = [];

  await mapWithConcurrency(batches, envNumber('NEWS_LLM_CONCURRENCY', 3), async (batch, idx) => {
    const batchNum = idx + 1;
    const newsPayload = batch.map((n) => ({
      newsId: n.id,
      title: n.title,
      tickers: n.relatedTickers.join(','),
      confidence: n.triangulation?.confidence ?? 'unknown',
      sources: n.triangulation?.sourceCount ?? 1,
    }));

    const prompt = `Noticias a analizar (incluye nivel de confianza por triangulacion de fuentes — priorizá las de confianza "high"):\n${JSON.stringify(newsPayload)}\n\nRespondé con un objeto JSON con la clave "analyses" conteniendo el array de resultados.`;

    let batchResults: ReturnType<typeof parseBatchResponse> = null;

    try {
      const raw = await callAI('classification', prompt, buildBatchNewsAnalysisPrompt(getFullSymbolUniverse()), 3072);
      batchResults = parseBatchResponse(raw, `LM Studio batch ${batchNum}/${totalBatches}`);
    } catch (lmErr) {
      console.warn(`[intelligence] LM Studio batch ${batchNum}/${totalBatches} failed:`, (lmErr as Error).message.slice(0, 120));
    }

    if (batchResults) {
      for (const a of batchResults) {
        analysisMap.set(a.newsId, a);
        llmAnalyses.push(a);
        const original = batch.find((n) => n.id === a.newsId);
        updateNewsAnalysis(a.newsId, a.sentiment, a.impact,
          original?.triangulation?.storyClusterId,
          original?.triangulation?.confidence);
      }
      console.log(`[intelligence] Batch ${batchNum}/${totalBatches}: ${batchResults.length} analizadas con IA y persistidas`);
    } else {
      // Fallback algoritmico por keywords
      for (const n of batch) {
        const fa = fallbackAnalysis(n);
        analysisMap.set(n.id, fa);
        updateNewsAnalysis(n.id, fa.sentiment, fa.impact,
          n.triangulation?.storyClusterId,
          n.triangulation?.confidence);
      }
      console.log(`[intelligence] Batch ${batchNum}/${totalBatches}: ${batch.length} analizadas con fallback algoritmico`);
    }

    // Rate limit protection: pausa por worker entre batches
    if (batchNum < totalBatches) {
      await new Promise(resolve => setTimeout(resolve, envNumber('NEWS_BATCH_DELAY_MS', 2000)));
    }
  });

  // Anclaje anti-alucinación: descartar los tickers inventados por el LLM antes de que
  // alimenten el sentiment por símbolo. Los que ya están en el universo conocido son
  // válidos por definición (el LLM los recibió en el prompt) — solo los desconocidos
  // pasan por Yahoo, con cap: validar cientos de inventados con retries tenía la etapa
  // horas moliendo contra un API rate-limiteado.
  // Guarda: el LLM a veces devuelve affectedTickers como NO-array (string/objeto) → normalizar.
  // Los objetos de llmAnalyses son las mismas referencias guardadas en analysisMap:
  // mutar affectedTickers acá filtra también lo que ve el resto del pipeline.
  const tickersOf = (a: { affectedTickers?: unknown }): string[] =>
    Array.isArray(a.affectedTickers) ? a.affectedTickers.filter((t): t is string => typeof t === 'string') : [];
  const llmTickers = [...new Set(llmAnalyses.flatMap(tickersOf))];
  const { trusted, toValidate, dropped } = partitionTickersForValidation(
    llmTickers,
    new Set(getFullSymbolUniverse()),
    envNumber('NEWS_TICKER_VALIDATION_CAP', 50),
  );
  if (dropped.length > 0) {
    console.warn(`[intelligence] ${dropped.length} tickers fuera de universo descartados sin validar (cap): ${dropped.slice(0, 10).join(', ')}${dropped.length > 10 ? '…' : ''}`);
  }
  const validSet = new Set([...trusted, ...(await validateTickers(toValidate))]);
  for (const a of llmAnalyses) {
    a.affectedTickers = tickersOf(a).filter((t) => validSet.has(t));
  }

  // Construir resultado final
  return news.map((n) => {
    const a = analysisMap.get(n.id);
    if (a) {
      return {
        ...n,
        sentiment: a.sentiment,
        impact: a.impact,
        analysis: a,
      };
    }
    // No deberia llegar aca, pero por seguridad
    const fa = fallbackAnalysis(n);
    return { ...n, sentiment: fa.sentiment, impact: fa.impact, analysis: fa };
  });
}

function aggregateTrends(analyzed: AnalyzedNewsItem[]): PlazaSummary[] {
  const byPlaza = new Map<MarketPlaza, AnalyzedNewsItem[]>();

  for (const item of analyzed) {
    const plaza = item.analysis.marketPlaza;
    if (!byPlaza.has(plaza)) byPlaza.set(plaza, []);
    byPlaza.get(plaza)!.push(item);
  }

  const plazas: PlazaSummary[] = [];

  for (const [plaza, items] of byPlaza) {
    const bySymbol = new Map<string, AnalyzedNewsItem[]>();
    for (const item of items) {
      for (const ticker of (item.analysis.affectedTickers ?? [])) {
        if (!bySymbol.has(ticker)) bySymbol.set(ticker, []);
        bySymbol.get(ticker)!.push(item);
      }
    }

    const weights: Record<ImpactLevel, number> = { high: 3, medium: 2, low: 1 };
    const sentimentValues: Record<SentimentType, number> = { positive: 1, neutral: 0, negative: -1 };

    // Triangulation confidence multiplier — high-confidence news weighs more
    const confidenceMultiplier = (item: AnalyzedNewsItem): number => {
      const conf = item.triangulation?.confidence;
      if (conf === 'high') return 1.5;
      if (conf === 'medium') return 1.0;
      return 0.6; // low confidence weighs less
    };

    const allSymbols = [...bySymbol.keys()];
    const symbolTrends: SymbolTrend[] = Array.from(bySymbol.entries()).map(([symbol, rawItems]) => {
      // Drop headlines that clearly name a DIFFERENT company (feed mismatch). The matcher only
      // removes competitor-named headlines, so unnamed real news survives — no raw fallback, and a
      // symbol whose news was ALL misattributed ends up neutral instead of showing wrong headlines.
      const otherAliases = allSymbols.filter(s => s !== symbol).flatMap(aliasesFor);
      const symbolItems = rawItems.filter(it => headlineMatchesSymbol(it.title, symbol, aliasesFor(symbol), otherAliases));

      let totalWeight = 0;
      let weightedSum = 0;
      let pos = 0;
      let neg = 0;
      let neu = 0;

      for (const item of symbolItems) {
        const w = weights[item.analysis.impact] * confidenceMultiplier(item);
        weightedSum += sentimentValues[item.analysis.sentiment] * w;
        totalWeight += w;
        if (item.analysis.sentiment === 'positive') pos++;
        else if (item.analysis.sentiment === 'negative') neg++;
        else neu++;
      }

      const score = totalWeight > 0 ? weightedSum / totalWeight : 0;
      const majority: SentimentType = pos > neg ? 'positive' : neg > pos ? 'negative' : 'neutral';

      return {
        symbol,
        marketPlaza: getPlazaForSymbol(symbol),
        sentiment: majority,
        sentimentScore: Math.round(score * 100) / 100,
        newsCount: symbolItems.length,
        positiveCount: pos,
        negativeCount: neg,
        neutralCount: neu,
        topHeadlines: symbolItems
          .sort((a, b) => weights[b.analysis.impact] - weights[a.analysis.impact])
          .slice(0, 3)
          .map((i) => i.title),
      };
    });

    symbolTrends.sort((a, b) => Math.abs(b.sentimentScore) - Math.abs(a.sentimentScore));

    const plazaScore =
      symbolTrends.length > 0
        ? symbolTrends.reduce((sum, t) => sum + t.sentimentScore, 0) / symbolTrends.length
        : 0;

    const overallSentiment: SentimentType =
      plazaScore > 0.2 ? 'positive' : plazaScore < -0.2 ? 'negative' : 'neutral';

    const config = PLAZA_CONFIG[plaza];
    if (!config) continue; // Skip unknown plazas (discovered tickers without plaza mapping)
    const trendWord = overallSentiment === 'positive' ? 'positiva' : overallSentiment === 'negative' ? 'negativa' : 'neutral';
    const keyInsight = symbolTrends.length > 0
      ? `${config.label}: tendencia ${trendWord} con ${items.length} noticias y ${symbolTrends.length} tickers afectados`
      : `${config.label}: sin actividad relevante`;

    plazas.push({
      plaza,
      label: config.label,
      overallSentiment,
      sentimentScore: Math.round(plazaScore * 100) / 100,
      symbolTrends,
      keyInsight,
    });
  }

  plazas.sort((a, b) => Math.abs(b.sentimentScore) - Math.abs(a.sentimentScore));
  return plazas;
}

function generateAlerts(plazas: PlazaSummary[], analyzedNews: AnalyzedNewsItem[]): IntelligenceAlert[] {
  const alerts: IntelligenceAlert[] = [];

  for (const plaza of plazas) {
    for (const trend of plaza.symbolTrends) {
      if (trend.sentimentScore < -0.5 && trend.newsCount >= 2) {
        alerts.push({
          type: 'negative_pressure',
          severity: 'critical',
          symbol: trend.symbol,
          plaza: plaza.plaza,
          message: `${trend.symbol} tiene presión negativa fuerte (${trend.negativeCount} noticias negativas)`,
        });
      }
      if (trend.sentimentScore > 0.5 && trend.newsCount >= 2) {
        alerts.push({
          type: 'positive_momentum',
          severity: 'info',
          symbol: trend.symbol,
          plaza: plaza.plaza,
          message: `${trend.symbol} muestra momentum positivo (${trend.positiveCount} noticias positivas)`,
        });
      }
    }

    if (plaza.sentimentScore < -0.4) {
      alerts.push({
        type: 'high_impact_event',
        severity: 'warning',
        plaza: plaza.plaza,
        message: `Plaza ${plaza.label} bajo presión general negativa`,
      });
    }
  }

  // Unconfirmed rumor alerts: low-confidence news with high sentiment magnitude
  for (const item of analyzedNews) {
    if (
      item.triangulation?.confidence === 'low' &&
      item.analysis.impact === 'high' &&
      item.analysis.sentiment !== 'neutral'
    ) {
      const plaza = item.analysis.marketPlaza;
      alerts.push({
        type: 'unconfirmed_rumor',
        severity: 'warning',
        symbol: item.analysis.affectedTickers[0],
        plaza,
        message: `Rumor no confirmado (1 fuente): "${item.title.slice(0, 80)}"`,
      });
    }
  }

  const severityOrder: Record<IntelligenceAlert['severity'], number> = { critical: 0, warning: 1, info: 2 };
  alerts.sort((a, b) => severityOrder[a.severity] - severityOrder[b.severity]);
  return alerts;
}

// Cache
let cachedIntelligence: NewsIntelligence | null = null;
let intelligenceTimestamp = 0;

let cachedAnalyzedNews: AnalyzedNewsItem[] = [];
let analyzedTimestamp = 0;

async function buildAnalyzedNews(): Promise<AnalyzedNewsItem[]> {
  const now = Date.now();
  if (cachedAnalyzedNews.length > 0 && now - analyzedTimestamp < INTELLIGENCE_TTL) {
    return cachedAnalyzedNews;
  }

  // 1. Fetch news from all sources (via aggregator)
  const rawNews = await getNews();

  // 2. Triangulate — assign confidence based on multi-source corroboration
  const triangulatedNews = triangulateNews(rawNews);

  // 3. Analyze with LLM (sentiment, impact, etc.)
  cachedAnalyzedNews = await analyzeBatch(triangulatedNews);
  analyzedTimestamp = now;
  return cachedAnalyzedNews;
}

export async function getAnalyzedNews(): Promise<AnalyzedNewsItem[]> {
  return buildAnalyzedNews();
}

/**
 * Prepare the curated subset of news for deep LLM analysis (v2 prompt).
 *
 * Pipeline: fetch → triangulate → filter (confidence + recency + source tier)
 *           → enrich with bodies → re-filter by body length + dedup → top-N cap.
 *
 * This is the input to the deep-analysis LLM (cause + impacts radar). It runs
 * INDEPENDENTLY of the existing analyzeBatch flow which still tags every news
 * with sentiment/impact for downstream sentimentMap consumers.
 *
 * Returns 30-60 high-quality items with `body` populated.
 */
export async function prepareDeepAnalysisNews(
  options?: DeepAnalysisFilterOptions,
): Promise<NewsItem[]> {
  const rawNews = await getNews();

  // STEP 0: Recency filter BEFORE triangulation. Triangulation is O(n²) on title
  // similarity, so processing 3-day-old DB news inflates work and adds noise.
  // Cap at 30h to give some buffer for high-confidence items that get 24h max in
  // filterForDeepAnalysis. Older news is irrelevant for "ride the wave" anyway.
  const RECENCY_HOURS = 30;
  const cutoffMs = Date.now() - RECENCY_HOURS * 60 * 60 * 1000;
  const recent = rawNews.filter(n => new Date(n.time).getTime() >= cutoffMs);
  console.log(`[deep-analysis-prep] Recency cap: ${rawNews.length} → ${recent.length} (last ${RECENCY_HOURS}h)`);

  const triangulated = triangulateNews(recent);

  // First-pass filter: drop by confidence/recency/source/blocked-domain BEFORE
  // body fetching, so we don't waste fetches on items that won't survive anyway.
  const prePass = filterForDeepAnalysis(triangulated, { ...options, requireBody: false });
  console.log(`[deep-analysis-prep] Pre-fetch filter: ${triangulated.length} → ${prePass.kept.length}`);

  // Fetch bodies for survivors only
  const enriched = await enrichNewsWithBodies(prePass.kept);

  // Second-pass filter: now require body + dedup by body content + top-N cap
  const finalPass = filterForDeepAnalysis(enriched, options);
  logFilterStats(enriched.length, finalPass);

  return finalPass.kept;
}

export async function getIntelligence(): Promise<NewsIntelligence> {
  const now = Date.now();
  if (cachedIntelligence && now - intelligenceTimestamp < INTELLIGENCE_TTL) {
    return cachedIntelligence;
  }

  const analyzed = await buildAnalyzedNews();
  const plazas = aggregateTrends(analyzed);
  const alerts = generateAlerts(plazas, analyzed);

  cachedIntelligence = {
    analyzedAt: now,
    totalNewsCount: analyzed.length,
    plazas,
    alerts,
  };
  intelligenceTimestamp = now;

  // Persist snapshot of plazas + symbolTrends frozen-in-time. Lets us audit
  // historical sentiment without re-running aggregateTrends from raw articles.
  try {
    const topHeadlines = plazas.flatMap(p => p.symbolTrends.flatMap(t => t.topHeadlines)).slice(0, 30);
    insertNewsIntelligenceSnapshot({
      totalNewsCount: analyzed.length,
      plazas: JSON.stringify(plazas),
      alerts: JSON.stringify(alerts),
      topHeadlines: JSON.stringify(topHeadlines),
      triangulationStats: JSON.stringify(getLastTriangulationStats()),
    });
  } catch (err) {
    console.warn('[news-intelligence] Failed to persist snapshot:', (err as Error).message?.slice(0, 100));
  }

  return cachedIntelligence;
}

/**
 * Get intelligence from BD only — no API fetch, no LLM analysis.
 * Uses only news that were ALREADY analyzed (have sentiment in DB).
 * Used by "Analizar" process.
 */
export async function getIntelligenceFromDB(): Promise<NewsIntelligence> {
  const now = Date.now();
  if (cachedIntelligence && now - intelligenceTimestamp < INTELLIGENCE_TTL) {
    return cachedIntelligence;
  }

  // Read news from BD — only those already analyzed (have sentiment)
  const rawNews = getNewsFromDB();
  if (rawNews.length === 0) {
    return { analyzedAt: now, totalNewsCount: 0, plazas: [], alerts: [] };
  }

  // Use already-analyzed news only (skip analyzeBatch / LLM entirely)
  const validSentiments = new Set(['positive', 'negative', 'neutral']);
  const alreadyAnalyzed: AnalyzedNewsItem[] = rawNews
    .filter(n => n.sentiment && validSentiments.has(n.sentiment))
    .map(n => ({
      ...n,
      analysis: {
        sentiment: n.sentiment as 'positive' | 'negative' | 'neutral',
        impact: (n.impact ?? 'low') as 'high' | 'medium' | 'low',
        affectedTickers: n.relatedTickers,
        summary: n.title,
        marketPlaza: 'global' as const,
      },
    }));

  const plazas = aggregateTrends(alreadyAnalyzed);
  const alerts = generateAlerts(plazas, alreadyAnalyzed);

  cachedIntelligence = { analyzedAt: now, totalNewsCount: alreadyAnalyzed.length, plazas, alerts };
  intelligenceTimestamp = now;

  return cachedIntelligence;
}

export async function refreshIntelligence(): Promise<NewsIntelligence> {
  // Force cache invalidation
  cachedAnalyzedNews = [];
  analyzedTimestamp = 0;
  cachedIntelligence = null;
  intelligenceTimestamp = 0;

  return getIntelligence();
}
