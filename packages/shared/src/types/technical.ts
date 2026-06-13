export interface OHLC {
  date: string;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
}

// --- Timing types ---

export interface TimingTrigger {
  type:
    | 'sma_cross'
    | 'rsi_zone'
    | 'bb_squeeze'
    | 'support_bounce'
    | 'resistance_break'
    | 'stoch_cross'
    | 'obv_divergence'
    | 'macd_cross'
    | 'rsi_divergence'
    | 'macd_divergence';
  description: string;
  /** Dirección explícita de la señal — NO derivar del texto de description. */
  direction: 'bullish' | 'bearish' | 'neutral';
  estimatedDays: number | null;
  impact: 'high' | 'medium';
}

export interface TimingSignal {
  action: 'BUY' | 'SELL' | 'WAIT';
  timing: 'now' | 'soon' | 'approaching';
  estimatedDays: number | null;
  confidence: number;
  triggers: TimingTrigger[];
}

// --- Support / Resistance ---

export interface SRLevel {
  price: number;
  strength: number;
  touches: number;
}

// --- Technical Indicators ---

export interface TechnicalIndicators {
  // Existentes
  rsi14: number | null;
  macd: {
    macdLine: number;
    signalLine: number;
    histogram: number;
  } | null;
  sma20: number | null;
  sma50: number | null;
  sma200: number | null;
  bollingerBands: {
    upper: number;
    middle: number;
    lower: number;
  } | null;
  currentPrice: number;
  priceVsSma20: number;
  priceVsSma50: number;
  priceVsSma200: number;
  volumeRatio: number;

  // Nuevos indicadores
  stochastic: { k: number; d: number } | null;
  atr14: number | null;
  atrPercent: number | null;
  obvTrend: 'rising' | 'falling' | 'flat' | null;
  obvDivergence: boolean;

  // Soporte y Resistencia
  supports: SRLevel[];
  resistances: SRLevel[];
  nearestSupport: number | null;
  nearestResistance: number | null;

  // Cruces de medias
  crossovers: {
    goldenCross: boolean;
    deathCross: boolean;
    sma20Above50: boolean;
    estimatedDaysToCross: number | null;
    crossDirection: 'golden' | 'death' | null;
  } | null;

  // Bollinger squeeze
  bbSqueeze: boolean;
  bbSqueezeIntensity: number | null;
}

export type TASignal = 'bullish' | 'bearish' | 'neutral';

// --- Divergence detection ---

export interface DivergenceSignal {
  type: 'bullish' | 'bearish';
  indicator: 'rsi' | 'macd' | 'obv';
  timeframe: 'daily' | 'weekly';
  description: string;
}

export interface WeeklyAnalysis {
  rsi14: number | null;
  macd: { macdLine: number; signalLine: number; histogram: number } | null;
  sma20: number | null;
  sma50: number | null;
  trend: 'up' | 'down' | 'sideways';
  divergences: DivergenceSignal[];
}

export interface TechnicalSummary {
  symbol: string;
  indicators: TechnicalIndicators;
  signal: TASignal;
  score: number;
  timing: TimingSignal | null;
  weekly?: WeeklyAnalysis;
  divergences?: DivergenceSignal[];
  /** Stop dinámico (trailing chandelier) calculado en el scan — fuente única para todas las vistas. */
  trailingStop?: number | null;
}

// --- Technical Report (reporte separado para frontend) ---

export interface TechnicalReport {
  symbol: string;
  currentPrice: number;
  score: number;
  signal: TASignal;
  summary: string;

  momentum: {
    rsi: { value: number; zone: 'oversold' | 'neutral' | 'overbought'; trend: 'rising' | 'falling' } | null;
    stochastic: { k: number; d: number; signal: 'buy' | 'sell' | 'neutral' } | null;
    macd: { histogram: number; trend: 'bullish' | 'bearish'; crossingSignal: boolean } | null;
  };

  trend: {
    shortTerm: 'up' | 'down' | 'sideways';
    mediumTerm: 'up' | 'down' | 'sideways';
    longTerm: 'up' | 'down' | 'sideways';
  };

  volatility: {
    atr: number | null;
    atrPercent: number | null;
    bbWidth: number | null;
    squeeze: boolean;
    regime: 'high' | 'normal' | 'low';
  };

  volume: {
    ratio: number;
    obvTrend: 'accumulation' | 'distribution' | 'neutral';
    divergence: boolean;
  };

  levels: {
    supports: { price: number; strength: number; distancePercent: number }[];
    resistances: { price: number; strength: number; distancePercent: number }[];
    stopLoss: number | null;
    takeProfit: number | null;
  };

  timing: TimingSignal | null;
}
