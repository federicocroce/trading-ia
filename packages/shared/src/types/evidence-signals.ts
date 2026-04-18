export interface PEADSignal {
  active: boolean;
  beatPercent: number;
  daysSinceEarnings: number;
  daysInDriftWindow: number;
  score: number;
  epsActual: number | null;
  epsEstimate: number | null;
  earningsDate: string | null;
  /** Price moved up ≥1.5% within 5 trading days of earnings announcement */
  priceConfirmed: boolean;
  /** Max close % change in 5 days post-earnings vs pre-earnings close */
  priceChangePct: number | null;
}

export interface InsiderTransaction {
  filerName: string;
  relation: string;
  transactionText: string;
  date: string;
  valueUsd: number;
  shares?: number;
}

export interface InsiderSignal {
  active: boolean;
  recentBuys: InsiderTransaction[];
  totalValue: number;
  numberOfBuyers: number;
  mostRecentBuyDate: string | null;
  score: number;
}

export interface OptionsFlowSignal {
  active: boolean;
  callVolume: number;
  putVolume: number;
  callPutRatio: number;
  nearestExpiry: string | null;
  dominantSentiment: 'bullish' | 'bearish' | 'neutral';
  score: number;
  /** Number of OTM call strikes with unusual V/OI ratio (fresh positioning) */
  unusualStrikes: number;
}

export type EvidenceConviction = 'high' | 'medium' | 'low' | 'none';
export type EvidenceRecommendation = 'WATCH_CLOSELY' | 'INTERESTING' | 'NO_SIGNAL';

export interface EvidenceSignal {
  symbol: string;
  scannedAt: string;
  conviction: EvidenceConviction;
  activeSignals: number;
  pead: PEADSignal;
  insider: InsiderSignal;
  optionsFlow: OptionsFlowSignal;
  compositeScore: number;
  recommendation: EvidenceRecommendation;
  reasoning: string;
  currentPrice?: number;
}

export interface EvidenceScanResult {
  scannedAt: string;
  totalSymbols: number;
  highConviction: number;
  mediumConviction: number;
  signals: EvidenceSignal[];
}

export type DeepVerdict = 'BUY_SETUP' | 'WAIT' | 'PASS';

export interface EvidenceDeepAnalysis {
  symbol: string;
  analysisDate: string;
  verdict: DeepVerdict;
  reasoning: string;
  entryZone: string;
  target: string;
  stopLoss: string;
  riskReward: string;
  confidence: number;
  keyRisks: string[];
  timeframe: string;
  model: string;
  fetchedAt: string;
}
