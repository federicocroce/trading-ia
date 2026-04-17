// packages/shared/src/types/quant.ts

export type MarketRegime =
  | 'trending_bull'
  | 'trending_bear'
  | 'mean_reverting'
  | 'volatile'
  | 'unknown';

export interface RegimeResult {
  regime: MarketRegime;
  confidence: number;
  indicators: {
    adxValue: number;
    atrRatio: number;
    trendConsistency: number;
    spyMomentum: number;
  };
  detectedAt: string;
}

export interface MomentumRanking {
  symbol: string;
  rank: number;
  relativeStrength: number;
  absoluteMomentum: number;
  percentile: number;
}

export interface CalibratedWeights {
  shortTerm: { sentiment: number; technical: number; fundamental: number };
  mediumTerm: { sentiment: number; technical: number; fundamental: number };
  calibratedAt: string;
  basedOnDays: number;
  signalAccuracies: Record<string, number>;
}

export interface QuantContext {
  regime: RegimeResult;
  momentumRankings: MomentumRanking[];
  calibratedWeights: CalibratedWeights | null;
}

export interface StrategyConfig {
  name: string;
  shortTermWeights?: { sentiment: number; technical: number; fundamental: number };
  mediumTermWeights?: { sentiment: number; technical: number; fundamental: number };
  buyThreshold: number;
  sellThreshold: number;
  stopLossPercent: number;
  takeProfitPercent: number;
}

export interface BacktestTrade {
  symbol: string;
  entryDate: string;
  exitDate: string;
  entryPrice: number;
  exitPrice: number;
  returnPercent: number;
  exitReason: 'signal' | 'stop_loss' | 'take_profit' | 'end_of_period';
}

export interface BacktestMetrics {
  totalReturnPercent: number;
  buyAndHoldReturnPercent: number;
  sharpeRatio: number;
  maxDrawdownPercent: number;
  winRate: number;
  numTrades: number;
  avgTradeDurationDays: number;
}

export interface BacktestEquityPoint {
  date: string;
  portfolioValue: number;
  buyAndHoldValue: number;
  drawdownPercent: number;
}

export interface BacktestRun {
  id: number;
  symbol: string;
  startDate: string;
  endDate: string;
  strategy: StrategyConfig;
  metrics: BacktestMetrics;
  trades: BacktestTrade[];
  equityCurve: BacktestEquityPoint[];
  createdAt: string;
  status: 'running' | 'completed' | 'failed';
  error?: string;
}
