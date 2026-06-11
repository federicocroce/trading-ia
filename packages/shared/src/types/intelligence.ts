import type { TriangulationConfidence } from './news-source.js';
import type { Opportunity, SectorSummary } from './opportunity.js';
import type { SignalAction } from './signal.js';

// --- Sector impact map (macro → sectores) ---

export type SectorImpactDirection = 'positive' | 'negative' | 'mixed' | 'neutral';

export interface SectorDriver {
  event: string;                          // "Volatilidad en activos argentinos"
  category: string;                       // causal category
  direction: 'positive' | 'negative';
  magnitude: 'high' | 'medium' | 'low';
}

export interface SectorImpactTicker {
  symbol: string;
  action: SignalAction;
  score: number;
  inPortfolio: boolean;
}

export interface SectorImpactMapEntry {
  sector: string;                         // OpportunitySector value
  label: string;                          // human label
  netImpact: SectorImpactDirection;
  confidence: 'high' | 'medium' | 'low';
  drivers: SectorDriver[];                // the macro "knobs" hitting this sector
  winners: SectorImpactTicker[];          // BUY / positive-causal tickers
  losers: SectorImpactTicker[];           // SELL / negative-causal tickers
  yourHoldings: Array<{ symbol: string; side: 'winner' | 'loser' | 'neutral' }>;
}

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

/**
 * Una recomendación del digest, proyectada DETERMINÍSTICAMENTE desde el scan.
 * El motor es dueño de `action`, `tradeLevels`, números y `reason`; el LLM no los toca.
 * Garantiza que el digest nunca contradiga al scan (misma fuente de verdad).
 */
export interface DigestRecommendation {
  symbol: string;
  action: SignalAction;            // verbatim del scan (BUY/SELL/HOLD/WATCH)
  reason: string;                  // Opportunity.simpleReasoning (verbatim)
  currentPrice: number;
  score: number;                   // Opportunity.opportunityScore
  // SOLO presente cuando action === 'BUY' — un hold/observar no lleva precio de entrada.
  tradeLevels?: { entryPrice: number; stopLoss: number; takeProfit: number };
}

export interface MarketDigest {
  generatedAt: number;
  overnightSummary: string;
  portfolioImpact: string;
  topOpportunities: Array<{
    symbol: string;
    action: 'BUY' | 'SELL';
    narrative: string;
  }>;
  watching?: Array<{
    symbol: string;
    narrative: string;  // "noticia que lo trajo + trigger BUY concreto"
  }>;
  warnings: string[];
  marketMood: 'risk-on' | 'risk-off' | 'mixed';
  // Recomendaciones proyectadas desde el scan (acción + motivo reales, sin contradicción).
  portfolioRecommendations: DigestRecommendation[];  // opportunities con inPortfolio === true
  marketRecommendations: DigestRecommendation[];     // opportunities con inPortfolio === false
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

export interface TopImpactNewsItem {
  headline: string;
  sectors: Array<{ name: string; direction: 'positive' | 'negative' | 'neutral' }>;
  confidence: 'high' | 'medium' | 'low';
  tickers: string[];
}

export interface MarketReport {
  generatedAt: number;
  macroContext: string;
  portfolioImpact: string;
  topImpactNews?: TopImpactNewsItem[];
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
  impact: 'positive' | 'negative' | 'mixed' | 'neutral';
  summary: string;
  keyNews: string[];
  suggestedTickers: string[];
  riskFactors: string[];
  catalysts: string[];
  conviccion: 'alta' | 'media' | 'baja';
  tension: string | null;
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

export type StageStatus = 'pending' | 'running' | 'ok' | 'partial' | 'failed' | 'skipped' | 'waiting_user'

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
  status: 'running' | 'ok' | 'partial' | 'failed' | 'waiting_user' | 'cancelled'
  stages: {
    webSearch: StageResult
    news: StageResult
    macroIntelligence: StageResult
    sectorIntelligence: StageResult
    fundamentals: StageResult
    analysis: StageResult
    quant?: StageResult
    report: StageResult
  }
  startedAt: string
  finishedAt: string | null
}
