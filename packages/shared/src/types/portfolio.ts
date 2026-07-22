export interface PortfolioPosition {
  symbol: string;
  quantity: number;
  avgCost: number;
  currentPrice: number;
  changePercent: number;
  value: number;
  pnl: number;
  pnlPercent: number;
  /** false si Yahoo falló y currentPrice es un fallback a avgCost (no un precio vivo real). */
  hasPriceData: boolean;
}

export interface PortfolioSummary {
  totalValue: number;
  totalCost: number;
  totalPnl: number;
  totalPnlPercent: number;
  positions: PortfolioPosition[];
}
