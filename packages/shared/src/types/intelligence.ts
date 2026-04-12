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
  mode: 'strict' | 'relaxed';
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

// --- Market Digest ---

export interface MarketDigest {
  generatedAt: number;
  overnightSummary: string;
  portfolioImpact: string;
  topOpportunities: Array<{
    symbol: string;
    action: 'BUY' | 'SELL';
    narrative: string;
  }>;
  warnings: string[];
  marketMood: 'risk-on' | 'risk-off' | 'mixed';
  wouldDo: string[];      // "Cosas que SÍ haría"
  wouldNotDo: string[];   // "Cosas que NO haría"
}

// --- Market Report (full investment report) ---

export interface MarketReportRecommendation {
  symbol: string;
  name: string;
  instrumentType: string;
  sector: string;
  thesis: string;
  catalysts: string[];
  risks: string[];
  suggestedWeight: number;
}

export interface MarketReportAlternative {
  tier: 'A' | 'B';
  symbol: string;
  name: string;
  sector: string;
  thesis: string;
}

export interface MarketReportScenario {
  name: string;
  probability: number;
  distribution: Array<{ symbol: string; weight: number; reason: string }>;
}

export interface MarketReportTheme {
  theme: string;
  relevance: 'high' | 'medium' | 'low';
  summary: string;
  sectors: string[];
  recommendations: MarketReportRecommendation[];
}

export interface MarketReport {
  generatedAt: number;
  macroContext: string;
  portfolioImpact: string;
  themes: MarketReportTheme[];
  topRecommendations: MarketReportRecommendation[];
  alternatives: MarketReportAlternative[];
  scenarios: MarketReportScenario[];
  avoidList: string[];
  engine: string;
  status?: 'ok' | 'partial' | 'failed';
  errors?: string[];
}

// --- Sector Impact & Reports (news-first pipeline) ---

export interface SectorImpact {
  sector: string;
  impact: 'positive' | 'negative' | 'mixed';
  event: string;
  confidence: 'high' | 'medium';
  affectedPlazas: string[];
}

export interface SectorReport {
  sector: string;
  impact: 'positive' | 'negative' | 'mixed';
  summary: string;
  keyNews: string[];
  suggestedTickers: string[];
  riskFactors: string[];
  generatedAt: number;
}

// --- Process Status (for 3 independent buttons) ---

export interface ProcessStatus {
  isRunning: boolean;
  lastRun: number | null;
  currentStep?: string;
  percentComplete?: number;
  error?: string;
}

export interface AllProcessStatus {
  news: ProcessStatus;
  fundamentals: ProcessStatus;
  analysis: ProcessStatus;
}

// --- Sector correlation ---

export interface SectorCorrelation {
  trigger: string;
  from: string;
  to: string[];
  direction: 'positive' | 'negative' | 'mixed';
  strength: number; // 0-1
}

// ============================================================
// PIPELINE TYPES
// ============================================================

export type StageStatus = 'pending' | 'running' | 'ok' | 'partial' | 'failed' | 'skipped'

export interface StageResult {
  status: StageStatus
  startedAt: string | null
  finishedAt: string | null
  detail: string
  errors: string[]
  criticalError?: string
}

export interface PipelineRun {
  id: number
  date: string
  status: 'running' | 'ok' | 'partial' | 'failed'
  stages: {
    news: StageResult
    fundamentals: StageResult
    analysis: StageResult
    report: StageResult
  }
  startedAt: string
  finishedAt: string | null
}
