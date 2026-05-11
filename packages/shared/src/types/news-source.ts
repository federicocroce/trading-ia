// --- News Source Adapter types ---

export type NewsSourceType = 'api' | 'rss' | 'scraper' | 'web';

export interface RawNewsArticle {
  externalId: string;
  title: string;
  summary?: string;
  body?: string;              // full article body (extracted via Readability, populated lazily)
  bodyFetchedAt?: string;     // ISO datetime when body was extracted
  url: string;
  publishedAt: string;       // ISO datetime
  source: string;            // "Finnhub", "NewsAPI", "Yahoo", "RSS:Reuters"
  sourceType: NewsSourceType;
  relatedSymbols: string[];
  category?: string;
  language?: string;
}

// --- Triangulation types ---

export type TriangulationConfidence = 'high' | 'medium' | 'low';

export interface TriangulationResult {
  storyClusterId: string;
  sourceCount: number;
  sourceDiversity: number;
  confidence: TriangulationConfidence;
  corroboratedBy: string[];
}
