import { useMemo } from 'react';
import { trpc } from './trpc';
import { useMarketRefetchInterval } from './useMarketRefetchInterval';

export type WatchlistStatus = 'live' | 'triggered' | 'invalidated' | 'expired' | 'archived';

export interface WatchlistStatusItem {
  symbol: string;
  status: WatchlistStatus;
  source: string;
  addedAt: string;
  entryPrice: number;
  entryAction: string;
  targetPrice: number | null;
  stopLoss: number | null;
  thesis: string | null;
  lastReturn: number | null;
  resolutionReturn: number | null;
  resolvedAt: string | null;
}

/** Estados que requieren acción del usuario (sacarlos del watchlist). */
export const RESOLVED_STATUSES: WatchlistStatus[] = ['triggered', 'invalidated', 'expired'];

export function isResolved(status: WatchlistStatus): boolean {
  return RESOLVED_STATUSES.includes(status);
}

/** Mapa símbolo → estado de ciclo de vida del watchlist. */
export function useWatchlistStatusMap(): Map<string, WatchlistStatusItem> {
  const refetchInterval = useMarketRefetchInterval();
  const { data } = trpc.opportunities.watchlistStatus.useQuery(undefined, {
    staleTime: 60_000,
    refetchInterval,
  });
  return useMemo(
    () => new Map((data ?? []).map((i) => [i.symbol, i as WatchlistStatusItem])),
    [data],
  );
}
