export type BullishSignalCategory =
  | 'divergence'
  | 'golden_cross'
  | 'bb_squeeze'
  | 'macd_cross'
  | 'oversold_bounce';

export interface BullishSignal {
  category: BullishSignalCategory;
  description: string;       // verbatim de la señal del motor
  estimatedDays: number | null;
  timeframe?: 'daily' | 'weekly';
}

export type AnticipatoryAlertStatus = 'active' | 'triggered' | 'expired';

export interface AnticipatoryAlert {
  /** Clave estable: `${symbol}:${categorias ordenadas join '+'}` (kind anticipatory), `stop:${symbol}` (stop_breach) o `rearm:${symbol}` (rearm). */
  id: string;
  kind: 'anticipatory' | 'stop_breach' | 'rearm';
  symbol: string;
  signals: BullishSignal[];
  currentPrice: number;
  entryPrice?: number;
  stopLoss?: number;
  takeProfit?: number;
  score: number;             // opportunityScore
  status: AnticipatoryAlertStatus;
  firstSeenDate: string;     // YYYY-MM-DD
  lastSeenDate: string;
  seen: boolean;
}
