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
  shortTermWeights?: { sentiment: number; technical: number; fundamental: number; evidence: number };
  mediumTermWeights?: { sentiment: number; technical: number; fundamental: number; evidence: number };
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
  metrics: BacktestMetrics | null;
  trades: BacktestTrade[] | null;
  equityCurve: BacktestEquityPoint[] | null;
  createdAt: string;
  status: 'running' | 'completed' | 'failed';
  error?: string;
}

// --- MA-trend (regla pura de medias móviles) ---

export interface MaTrendStrategy {
  /** El precio debe estar por encima de TODAS estas SMAs para entrar (ej. [300, 1000]). */
  entryMas: number[];
  /** Se sale cuando el precio cae por debajo de esta SMA (ej. 300). */
  exitMa: number;
  /** Comisión por transacción (compra y venta, cada una), en %. */
  commissionPct?: number;
  /** Slippage por ejecución, en %. */
  slippagePct?: number;
  stopLossPct?: number;
  takeProfitPct?: number;
}

export type MaTrendGroup = 'portfolio' | 'watchlist' | 'benchmark';

export interface MaTrendTickerResult {
  symbol: string;
  group: MaTrendGroup;
  strategyReturnPct: number | null;
  buyHoldReturnPct: number | null;
  strategyMaxDrawdownPct: number | null;
  buyHoldMaxDrawdownPct: number | null;
  numTrades: number | null;
  winRate: number | null;
  sharpe: number | null;
  /** ¿La regla superó a comprar-y-aguantar en retorno total? */
  beatBuyHold: boolean | null;
  error?: string;
}

export interface MaTrendUniverseSummary {
  strategy: MaTrendStrategy;
  years: number;
  tickers: MaTrendTickerResult[];
  aggregate: {
    evaluated: number;
    beatBuyHold: number;
    beatBuyHoldPct: number;
    avgStrategyReturn: number;
    avgBuyHoldReturn: number;
    avgStrategyMaxDrawdown: number;
    avgBuyHoldMaxDrawdown: number;
    avgNumTrades: number;
    avgWinRate: number;
  };
}
