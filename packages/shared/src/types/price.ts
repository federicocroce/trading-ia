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
  /** Estado de mercado de Yahoo: 'REGULAR' = en sesión (spot provisional), 'CLOSED'/'PRE'/'POST' = fuera. */
  marketState?: string;
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
