import type { NewsSourceType, TriangulationResult } from './news-source.js';

export type SentimentType = 'positive' | 'negative' | 'neutral';
export type ImpactLevel = 'high' | 'medium' | 'low';
export type MarketPlaza = 'argentina-energy' | 'argentina-finance' | 'argentina-cedears' | 'us-energy' | 'us-tech' | 'crypto' | 'bonds' | 'etfs-sectors' | 'commodities' | 'emerging-markets' | 'global';

export interface NewsItem {
  id: string;
  time: string;
  title: string;
  source: string;
  impact: ImpactLevel;
  sectors: string[];
  sentiment: SentimentType;
  url?: string;
  relatedTickers: string[];
  thumbnailUrl?: string;
  sourceType?: NewsSourceType;
  triangulation?: TriangulationResult;
  summary?: string;           // adapter-provided summary (used as body fallback for paywalled tier-1 sources)
  body?: string;              // full extracted article body (lazy-populated)
  bodyFetchedAt?: string;     // ISO datetime when body was extracted
  analyzedAt?: string;        // ISO datetime del análisis LLM — seteado = no re-analizar aunque el resultado sea neutral/low
}

export interface NewsAnalysis {
  sentiment: SentimentType;
  impact: ImpactLevel;
  affectedTickers: string[];
  summary: string;
  marketPlaza: MarketPlaza;
}

export interface AnalyzedNewsItem extends NewsItem {
  analysis: NewsAnalysis;
}

// --- News Radar v2: cause + impacts ---

export type RadarTargetType = 'ticker' | 'sector';

export interface RadarImpactItem {
  target: string;
  type: RadarTargetType;
}

export interface RadarPerArticle {
  newsId: string;
  cause: string;            // 5-12 word reason
  positive: RadarImpactItem[];
  negative: RadarImpactItem[];
}

export interface RadarAggregatedSignal {
  target: string;
  type: RadarTargetType;
  positiveScore: number;       // weighted sum of positive votes
  negativeScore: number;       // weighted sum of negative votes
  netScore: number;            // positive - negative
  totalScore: number;          // positive + negative (volume)
  positiveArticles: string[];  // newsIds where target was voted positive
  negativeArticles: string[];  // newsIds where target was voted negative
}

export interface NewsRadarSnapshot {
  generatedAt: number;
  totalNewsAnalyzed: number;
  perArticle: RadarPerArticle[];
  aggregatedSignals: RadarAggregatedSignal[];
  emergingNarratives?: string[];
  llmModel?: string;
  durationMs?: number;
}

export interface SymbolTrend {
  symbol: string;
  marketPlaza: MarketPlaza;
  sentiment: SentimentType;
  sentimentScore: number;
  newsCount: number;
  positiveCount: number;
  negativeCount: number;
  neutralCount: number;
  topHeadlines: string[];
}

export interface PlazaSummary {
  plaza: MarketPlaza;
  label: string;
  overallSentiment: SentimentType;
  sentimentScore: number;
  symbolTrends: SymbolTrend[];
  keyInsight: string;
}

export interface IntelligenceAlert {
  type: 'negative_pressure' | 'positive_momentum' | 'high_impact_event' | 'unconfirmed_rumor' | 'second_order_effect';
  severity: 'critical' | 'warning' | 'info';
  symbol?: string;
  plaza: MarketPlaza;
  message: string;
}

export interface NewsIntelligence {
  analyzedAt: number;
  totalNewsCount: number;
  plazas: PlazaSummary[];
  alerts: IntelligenceAlert[];
}
