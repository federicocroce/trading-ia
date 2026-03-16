export interface FundamentalData {
  symbol: string;
  marketCap: number | null;
  peRatio: number | null;
  forwardPE: number | null;
  eps: number | null;
  dividendYield: number | null;
  fiftyTwoWeekHigh: number | null;
  fiftyTwoWeekLow: number | null;
  currentPrice: number;
  priceVs52wHigh: number | null;
  priceVs52wLow: number | null;
  avgVolume: number | null;
  beta: number | null;
}

export type FASignal = 'undervalued' | 'overvalued' | 'fair';

export interface FundamentalSummary {
  symbol: string;
  data: FundamentalData;
  signal: FASignal;
  score: number;
}
