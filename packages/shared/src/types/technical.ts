export interface OHLC {
  date: string;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
}

export interface TechnicalIndicators {
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
}

export type TASignal = 'bullish' | 'bearish' | 'neutral';

export interface TechnicalSummary {
  symbol: string;
  indicators: TechnicalIndicators;
  signal: TASignal;
  score: number;
}
