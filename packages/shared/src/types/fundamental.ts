export interface FundamentalData {
  symbol: string;
  marketCap: number | null;
  peRatio: number | null;
  forwardPE: number | null;
  pegRatio: number | null;    // trailing PEG (P/E ÷ crecimiento esperado); null = Yahoo no lo trae
  eps: number | null;
  dividendYield: number | null;
  fiftyTwoWeekHigh: number | null;
  fiftyTwoWeekLow: number | null;
  currentPrice: number;
  priceVs52wHigh: number | null;
  priceVs52wLow: number | null;
  avgVolume: number | null;
  beta: number | null;
  // Ampliados (datos trimestrales, cache 7 días)
  revenueGrowth: number | null;     // % crecimiento revenue YoY
  grossMargin: number | null;       // margen bruto %
  operatingMargin: number | null;   // margen operativo %
  netMargin: number | null;         // margen neto %
  debtToEquity: number | null;      // ratio deuda/equity
  freeCashFlow: number | null;      // free cash flow absoluto
  returnOnEquity: number | null;    // ROE %
  returnOnAssets: number | null;    // ROA %
  earningsSurprise: number | null;  // último earnings surprise %
  nextEarningsDate: string | null;  // fecha próximo earnings
}

export type FASignal = 'undervalued' | 'overvalued' | 'fair';

export interface FundamentalSummary {
  symbol: string;
  data: FundamentalData;
  signal: FASignal;
  score: number;
}
