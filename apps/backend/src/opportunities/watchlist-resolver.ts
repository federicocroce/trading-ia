/**
 * Resolver puro del ciclo de vida del watchlist.
 *
 * Dado el snapshot de alta (precio, acción, target, stop) y el precio actual,
 * decide el estado del item. Misma lógica de hit que `resolveExpiredSignals`
 * (signal-tracking), mapeada a estados de watchlist.
 *
 * Pura y sin dependencias — testeable en aislamiento.
 */

export type WatchlistStatus = 'live' | 'triggered' | 'invalidated' | 'expired';

export interface WatchlistResolveInput {
  /** Acción de la recomendación al agregar: BUY | SELL | WATCH | HOLD | manual */
  entryAction: string;
  entryPrice: number;
  /** takeProfit capturado; null para altas manuales sin tesis */
  targetPrice: number | null;
  /** stopLoss capturado; null para altas manuales sin tesis */
  stopLoss: number | null;
  currentPrice: number;
  /** días transcurridos desde el alta */
  daysSince: number;
  /** ventana antes de expirar */
  horizonDays: number;
}

export interface WatchlistResolveResult {
  status: WatchlistStatus;
  /** retorno % crudo del precio vs entry (current vs entry) */
  returnPct: number;
  hitTarget: boolean;
  hitStop: boolean;
}

/**
 * SELL invierte la geometría: target por debajo del entry, stop por encima.
 * Cualquier otra acción (BUY/WATCH/HOLD/manual) usa el marco long.
 */
export function resolveWatchlistStatus(input: WatchlistResolveInput): WatchlistResolveResult {
  const { entryAction, entryPrice, targetPrice, stopLoss, currentPrice, daysSince, horizonDays } = input;

  const returnPct = entryPrice > 0 ? ((currentPrice - entryPrice) / entryPrice) * 100 : 0;
  const isShort = entryAction === 'SELL';

  const hitTarget = targetPrice != null && (isShort ? currentPrice <= targetPrice : currentPrice >= targetPrice);
  const hitStop = stopLoss != null && (isShort ? currentPrice >= stopLoss : currentPrice <= stopLoss);

  let status: WatchlistStatus;
  if (hitStop) status = 'invalidated';
  else if (hitTarget) status = 'triggered';
  else if (daysSince >= horizonDays) status = 'expired';
  else status = 'live';

  return { status, returnPct, hitTarget, hitStop };
}
