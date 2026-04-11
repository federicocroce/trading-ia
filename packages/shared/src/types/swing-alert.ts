export type SwingAlertType = 'drop-1d' | 'surge-1d' | 'drop-2d';
export type SwingAlertDirection = 'BUY' | 'SELL';
export type SwingAlertStatus = 'active' | 'resolved-win' | 'resolved-loss' | 'expired';

export interface SwingAlert {
  id: number;
  symbol: string;
  alertType: SwingAlertType;
  direction: SwingAlertDirection;
  triggerDescription: string;
  triggerPercent: number;
  triggerPrice: number;
  entryPrice: number;
  targetPrice: number | null;
  stopLoss: number | null;
  historicalWinRate: number;
  historicalAvgReturn: number;
  historicalSampleSize: number;
  status: SwingAlertStatus;
  nextDayClose: number | null;
  nextDayChange: number | null;
  createdAt: string;
  resolvedAt: string | null;
}

export interface SwingAlertScanResult {
  alerts: SwingAlert[];
  watchlist: string[];
  lastScannedAt: number;
  resolved: SwingAlert[];
}
