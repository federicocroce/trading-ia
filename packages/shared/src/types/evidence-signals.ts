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
  /** Number of consecutive quarters with ≥10% EPS beat (including current) */
  consecutiveBeats: number;
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

export interface TechSnapshot {
  rsi14: number | null;
  sma20: number | null;
  sma50: number | null;
  trend: 'bullish' | 'bearish' | 'mixed';
  momentum5d: number | null;
  atr14: number | null;
}

export interface FundamentalSnapshot {
  peRatio: number | null;
  forwardPE: number | null;
  revenueGrowth: number | null;
  operatingMargin: number | null;
  netMargin: number | null;
  debtToEquity: number | null;
  beta: number | null;
  marketCap: number | null;
  priceVs52wHigh: number | null;
  earningsDate: string | null;
}

export interface EvidenceSignal {
  symbol: string;
  scannedAt: string;
  conviction: EvidenceConviction;
  /** Conviction after applying market regime (bear downgrades high→medium, medium→low) */
  regimeAdjustedConviction: EvidenceConviction;
  activeSignals: number;
  pead: PEADSignal;
  insider: InsiderSignal;
  optionsFlow: OptionsFlowSignal;
  compositeScore: number;
  recommendation: EvidenceRecommendation;
  reasoning: string;
  currentPrice?: number;
  /** Sector ETF momentum context */
  sectorTrend?: {
    etf: string;
    name: string;
    trend: 'outperforming' | 'underperforming' | 'neutral';
    priceVsSma50Pct: number;
  };
  /** Technical indicators snapshot — computed at scan time from 3mo OHLC */
  techSnapshot?: TechSnapshot;
  /** Fundamental data snapshot — computed at scan time from Yahoo Finance */
  fundamentalSnapshot?: FundamentalSnapshot;
}

export type EvidenceMarketRegime = 'bull' | 'bear' | 'neutral';

export interface MarketRegimeData {
  regime: EvidenceMarketRegime;
  spyPrice: number;
  sma200: number;
  priceVsSma200Pct: number;
  checkedAt: string;
  /** true = el régimen no pudo calcularse con datos frescos (fallo de fetch). Tratarlo como bloqueo de LONGs nuevos. */
  degraded?: boolean;
}

export interface EvidenceScanResult {
  scannedAt: string;
  totalSymbols: number;
  highConviction: number;
  mediumConviction: number;
  signals: EvidenceSignal[];
  marketRegime?: MarketRegimeData;
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
