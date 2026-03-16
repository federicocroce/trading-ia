export interface Price {
  symbol: string;
  open: number;
  current: number;
  high: number;
  low: number;
  previousClose: number;
  change: number;
  changePercent: number;
  timestamp: number;
}

export interface TopMover {
  symbol: string;
  name: string;
  price: number;
  change: number;
  changePercent: number;
}

export interface MarketMovers {
  gainers: TopMover[];
  losers: TopMover[];
}
