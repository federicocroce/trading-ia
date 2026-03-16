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
import { BATCH_NEWS_ANALYSIS_PROMPT, getPlazaForSymbol, PLAZA_CONFIG } from '@trading/shared';
import { getActiveSymbolList } from '../db/repository.js';
import { askLMStudio } from '../shared/lmstudio.js';
import { getNews } from './news.service.js';
import { triangulateNews } from './triangulation.service.js';

const MAX_NEWS_FOR_BATCH = 10; // Qwen 3.5 9B con ctx 4096 no soporta más
const INTELLIGENCE_TTL = 15 * 60 * 1000; // 15 minutes

function fallbackAnalysis(item: NewsItem): NewsAnalysis {
  const plaza = item.relatedTickers.length > 0
    ? getPlazaForSymbol(item.relatedTickers[0])
    : 'global';

  return {
    sentiment: item.sentiment,
    impact: item.impact,
    affectedTickers: item.relatedTickers.filter((t) => getActiveSymbolList().includes(t)),
    summary: '',
    marketPlaza: plaza,
  };
}

async function analyzeBatch(news: NewsItem[]): Promise<AnalyzedNewsItem[]> {
  const toAnalyze = news.slice(0, MAX_NEWS_FOR_BATCH);

  // Include triangulation confidence in the payload for the LLM
  const newsPayload = toAnalyze.map((n) => ({
    newsId: n.id,
    title: n.title,
    tickers: n.relatedTickers.join(','),
    confidence: n.triangulation?.confidence ?? 'unknown',
    sources: n.triangulation?.sourceCount ?? 1,
  }));

  const prompt = `Noticias a analizar (incluye nivel de confianza por triangulacion de fuentes — priorizá las de confianza "high"):\n${JSON.stringify(newsPayload)}\n\nRespondé con un objeto JSON con la clave "analyses" conteniendo el array de resultados.`;

  function parseAnalysesResponse(raw: string, engineName: string): AnalyzedNewsItem[] | null {
    try {
      const parsed = JSON.parse(raw);
      const analyses: Array<{
        newsId: string;
        sentiment: SentimentType;
        impact: 'high' | 'medium' | 'low';
        affectedTickers: string[];
        summary: string;
        marketPlaza: MarketPlaza;
      }> = parsed.analyses ?? parsed;

      if (!Array.isArray(analyses)) {
        console.warn(`[intelligence] ${engineName}: unexpected response format`);
        return null;
      }

      const analysisMap = new Map(analyses.map((a) => [a.newsId, a]));
      console.log(`[intelligence] ${engineName} analyzed ${analyses.length}/${news.length} news items`);

      return news.map((n) => {
        const a = analysisMap.get(n.id);
        if (a) {
          return {
            ...n,
            sentiment: a.sentiment,
            impact: a.impact,
            analysis: {
              sentiment: a.sentiment,
              impact: a.impact,
              affectedTickers: a.affectedTickers,
              summary: a.summary,
              marketPlaza: a.marketPlaza,
            },
          };
        }
        return { ...n, analysis: fallbackAnalysis(n) };
      });
    } catch {
      console.warn(`[intelligence] ${engineName}: failed to parse response`);
      return null;
    }
  }

  // 1. Try LM Studio (local, no API key needed)
  try {
    const raw = await askLMStudio(prompt, BATCH_NEWS_ANALYSIS_PROMPT, 2048);
    const result = parseAnalysesResponse(raw, 'LM Studio');
    if (result) return result;
  } catch (lmErr) {
    console.warn('[intelligence] LM Studio failed:', (lmErr as Error).message.slice(0, 120));
  }

  // 2. Fallbacks deshabilitados — solo LM Studio local
  // if (process.env.GROQ_API_KEY) { ... }

  // 3. Fallback (si LM Studio falla)
  console.warn('[intelligence] LM Studio failed, using fallback');
  return news.map((n) => ({ ...n, analysis: fallbackAnalysis(n) }));
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
      for (const ticker of item.analysis.affectedTickers) {
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

export async function refreshIntelligence(): Promise<NewsIntelligence> {
  // Force cache invalidation
  cachedAnalyzedNews = [];
  analyzedTimestamp = 0;
  cachedIntelligence = null;
  intelligenceTimestamp = 0;

  return getIntelligence();
}
