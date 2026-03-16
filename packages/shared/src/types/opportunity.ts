import type { AnalysisBreakdown, SignalAction } from './signal.js';

export type OpportunitySector =
  | 'argentina-energy'
  | 'argentina-finance'
  | 'argentina-cedears'
  | 'us-energy'
  | 'us-tech'
  | 'crypto'
  | 'bonds';

export interface ReturnEstimate {
  lowPercent: number;
  midPercent: number;
  highPercent: number;
  confidence: number;
  keyDrivers: string[];
}

export interface Opportunity {
  symbol: string;
  sector: OpportunitySector;
  sectorLabel: string;
  currentPrice: number;
  opportunityScore: number;
  action: SignalAction; // BUY, SELL, HOLD, WATCH
  confidence: number;
  shortTerm: ReturnEstimate;
  mediumTerm: ReturnEstimate;
  reasoning: string;
  catalysts: string[];
  risks: string[];
  breakdown: AnalysisBreakdown;
  inPortfolio: boolean;
  portfolioQuantity?: number;
  timestamp: number;
  scoringMethod?: 'hybrid' | 'ai-full' | 'algorithmic';
  horizonScores?: { shortTerm: number; mediumTerm: number };
  passedAntiHype?: boolean;
}

export interface SectorSummary {
  sector: OpportunitySector;
  label: string;
  symbolCount: number;
  avgScore: number;
  topOpportunity: string | null;
  sectorOutlook: string;
}

export type AnalysisEngine = 'lmstudio' | 'groq' | 'openrouter' | 'claude' | 'algorithmic' | 'hybrid';

export type ScanSource = 'live' | 'db';

export interface OpportunityScanResult {
  scannedAt: number;
  totalSymbolsScanned: number;
  opportunities: Opportunity[];
  sectorSummary: SectorSummary[];
  analysisEngine: AnalysisEngine;
  analysisDetail: string;
  source: ScanSource; // 'live' = recién escaneado, 'db' = recuperado de BD
}
