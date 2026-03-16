import type { NewsSourceType, TriangulationResult } from './news-source.js';

export type SentimentType = 'positive' | 'negative' | 'neutral';
export type ImpactLevel = 'high' | 'medium' | 'low';
export type MarketPlaza = 'argentina-energy' | 'argentina-finance' | 'argentina-cedears' | 'us-energy' | 'us-tech' | 'crypto' | 'bonds' | 'global';

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
