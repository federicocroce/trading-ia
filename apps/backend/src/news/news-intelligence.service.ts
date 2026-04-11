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
import { getActiveSymbolList, updateNewsAnalysis } from '../db/repository.js';
import { getFullSymbolUniverse } from '../discovery/discovery-registry.js';
import { callAI } from '../shared/ai-router.js';
import { getNews, getNewsFromDB } from './news.service.js';
import { triangulateNews } from './triangulation.service.js';

function getMaxBatchSize(): number {
  // Adaptive batch size based on AI provider
  // LMStudio local (Qwen 9B) → small batches for quality
  // Cloud models (Groq 70B, OpenRouter) → larger batches
  const isLocal = process.env.LMSTUDIO_URL || !process.env.GROQ_API_KEY;
  return isLocal ? 6 : 15;
}
const INTELLIGENCE_TTL = 60 * 60 * 1000; // 60 minutes — swing trader revisa 1-2x/dia

// Keyword-based sentiment analysis — funciona sin IA
const POSITIVE_KEYWORDS = [
  // English
  'surge', 'surges', 'soar', 'soars', 'rally', 'rallies', 'gain', 'gains', 'jump', 'jumps',
  'rise', 'rises', 'climb', 'climbs', 'boost', 'record high', 'all-time high', 'breakout',
  'upgrade', 'upgrades', 'outperform', 'beat', 'beats', 'strong', 'bullish', 'upbeat',
  'recovery', 'recovers', 'profit', 'profits', 'dividend', 'buyback', 'growth',
  'positive', 'optimism', 'optimistic', 'momentum', 'opportunity', 'upside',
  'acquisition', 'merger', 'partnership', 'expansion', 'innovation',
  'revenue beat', 'earnings beat', 'guidance raise', 'margin expansion',
  'short squeeze', 'golden cross', 'accumulation', 'inflows', 'rebound',
  'approval', 'contract win', 'price target raise', 'overweight',
  'buyback program', 'special dividend', 'stock split',
  // Spanish
  'sube', 'suba', 'alcista', 'récord', 'crece', 'crecimiento', 'ganancias',
  'mejora', 'repunte', 'impulso', 'oportunidad', 'recuperacion', 'expansion',
  'licitacion exitosa', 'flujo de capitales', 'superavit', 'desregulacion',
  'acuerdo comercial', 'inversion extranjera', 'produccion record',
];

const NEGATIVE_KEYWORDS = [
  // English
  'crash', 'crashes', 'plunge', 'plunges', 'drop', 'drops', 'fall', 'falls', 'sink', 'sinks',
  'decline', 'declines', 'tumble', 'tumbles', 'slump', 'loss', 'losses', 'sell-off', 'selloff',
  'downgrade', 'downgrades', 'underperform', 'miss', 'misses', 'weak', 'bearish',
  'risk', 'risks', 'warning', 'warns', 'fear', 'fears', 'crisis', 'recession',
  'bankruptcy', 'default', 'layoff', 'layoffs', 'cut', 'cuts', 'fraud', 'investigation',
  'sanction', 'sanctions', 'tariff', 'tariffs', 'inflation', 'shutdown',
  'profit warning', 'guidance cut', 'margin compression', 'debt restructuring',
  'death cross', 'distribution', 'outflows', 'delisting', 'sec probe',
  'class action', 'recall', 'supply disruption', 'margin call',
  'price target cut', 'underweight', 'downside', 'headwinds',
  // Spanish
  'baja', 'bajista', 'caída', 'pérdida', 'pérdidas', 'riesgo', 'crisis',
  'toma de ganancias', 'presion vendedora', 'riesgo pais', 'dolar blue',
  'brecha cambiaria', 'cepo', 'default', 'devaluacion', 'inflacion',
  'conflicto gremial', 'paro', 'embargo', 'deuda soberana',
];

const HIGH_IMPACT_KEYWORDS = [
  'crash', 'surge', 'record', 'all-time', 'bankruptcy', 'merger', 'acquisition',
  'fed', 'interest rate', 'earnings', 'guidance', 'tariff', 'sanction', 'war',
  'crisis', 'default', 'rally', 'breakout', 'plunge',
  'fed rate', 'rate cut', 'rate hike', 'quantitative', 'stimulus',
  'opec', 'embargo', 'invasion', 'ceasefire', 'election',
  'devaluation', 'devaluacion', 'riesgo pais',
];

function keywordSentimentAnalysis(title: string): { sentiment: SentimentType; impact: 'high' | 'medium' | 'low' } {
  const lower = title.toLowerCase();
  let posScore = 0;
  let negScore = 0;

  for (const kw of POSITIVE_KEYWORDS) {
    if (lower.includes(kw)) posScore++;
  }
  for (const kw of NEGATIVE_KEYWORDS) {
    if (lower.includes(kw)) negScore++;
  }

  const sentiment: SentimentType = posScore > negScore ? 'positive'
    : negScore > posScore ? 'negative'
    : 'neutral';

  let impact: 'high' | 'medium' | 'low' = 'low';
  for (const kw of HIGH_IMPACT_KEYWORDS) {
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

  return {
    sentiment,
    impact,
    affectedTickers: item.relatedTickers.filter((t) => getFullSymbolUniverse().includes(t)),
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

  // Pre-populate with DB values: noticias que ya tienen sentiment/impact guardado no necesitan re-analisis
  const needsAnalysis: NewsItem[] = [];
  for (const n of news) {
    if (n.sentiment !== 'neutral' || n.impact !== 'low') {
      // Ya tiene analisis de la BD — usar directamente
      const plaza = n.relatedTickers.length > 0 ? getPlazaForSymbol(n.relatedTickers[0]) : 'global';
      analysisMap.set(n.id, {
        sentiment: n.sentiment as SentimentType,
        impact: n.impact as 'high' | 'medium' | 'low',
        affectedTickers: n.relatedTickers.filter((t) => getActiveSymbolList().includes(t)),
        summary: '',
        marketPlaza: plaza,
      });
    } else {
      needsAnalysis.push(n);
    }
  }

  console.log(`[intelligence] ${news.length} noticias total, ${news.length - needsAnalysis.length} ya analizadas en BD, ${needsAnalysis.length} pendientes`);

  // Analizar en batches de MAX_NEWS_FOR_BATCH
  const batchSize = getMaxBatchSize();
  for (let i = 0; i < needsAnalysis.length; i += batchSize) {
    const batch = needsAnalysis.slice(i, i + batchSize);
    const batchNum = Math.floor(i / batchSize) + 1;
    const totalBatches = Math.ceil(needsAnalysis.length / batchSize);

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
        updateNewsAnalysis(a.newsId, a.sentiment, a.impact);
      }
      console.log(`[intelligence] Batch ${batchNum}/${totalBatches}: ${batchResults.length} analizadas con IA y persistidas`);
    } else {
      // Fallback algoritmico por keywords
      for (const n of batch) {
        const fa = fallbackAnalysis(n);
        analysisMap.set(n.id, fa);
        updateNewsAnalysis(n.id, fa.sentiment, fa.impact);
      }
      console.log(`[intelligence] Batch ${batchNum}/${totalBatches}: ${batch.length} analizadas con fallback algoritmico`);
    }

    // Rate limit protection: wait 2s between batches
    if (batchNum < totalBatches) {
      await new Promise(resolve => setTimeout(resolve, 2000));
    }
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

    const symbolTrends: SymbolTrend[] = Array.from(bySymbol.entries()).map(([symbol, symbolItems]) => {
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
