import type { TriangulationConfidence } from './news-source.js';
import type { Opportunity, SectorSummary } from './opportunity.js';

// --- Second-order effects ---

export interface SecondOrderEffect {
  triggerEvent: string;
  causalChain: string[];
  affectedTickers: string[];
  impactDirection: 'positive' | 'negative' | 'mixed';
  confidence: 'high' | 'medium' | 'low';
  reasoning: string;
}

// --- Anti-hype filter results ---

export interface AntiHypeFilterResult {
  totalCandidates: number;
  passedAll: number;
  filtered: string[];
  rejected: Array<{ symbol: string; reasons: string[] }>;
}

// --- Daily report ---

export interface DailyReport {
  id: number;
  reportDate: string;
  reportType: 'morning' | 'on-demand';
  newsSourceStats: Record<string, number>;
  triangulationStats: Record<TriangulationConfidence, number>;
  secondOrderEffects: SecondOrderEffect[];
  topRecommendations: Opportunity[];
  sectorSummary: SectorSummary[];
  antiHypeResults: AntiHypeFilterResult;
  scanId?: number;
  createdAt: string;
}

// --- Sector correlation ---

export interface SectorCorrelation {
  trigger: string;
  from: string;
  to: string[];
  direction: 'positive' | 'negative' | 'mixed';
  strength: number; // 0-1
}
