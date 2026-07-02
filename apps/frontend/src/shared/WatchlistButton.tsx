import { trpc } from './trpc';
import { useWatchlistSet } from './useWatchlistSet';
import { useWatchlistStatusMap } from './useWatchlistStatus';
import { WatchlistStatusBadge } from './WatchlistStatusBadge';

/** Snapshot de la recomendación al agregar — habilita el ciclo de vida. */
export interface WatchlistEntry {
  price?: number;
  action?: string;
  score?: number | null;
  confidence?: number | null;
  targetPrice?: number | null;
  stopLoss?: number | null;
  thesis?: string | null;
}

export function WatchlistButton({ symbol, entry }: { symbol: string; entry?: WatchlistEntry }) {
  const watchlistSet = useWatchlistSet();
  const statusMap = useWatchlistStatusMap();
  const utils = trpc.useUtils();
  const mutation = trpc.opportunities.addToWatchlist.useMutation({
    onSuccess: () => {
      utils.portfolio.symbols.list.invalidate();
      utils.opportunities.watchlistStatus.invalidate();
    },
  });

  // Ya en watchlist → mostramos el estado del ciclo de vida (no el botón de alta).
  if (watchlistSet.has(symbol)) {
    const item = statusMap.get(symbol);
    return item ? <WatchlistStatusBadge item={item} /> : null;
  }

  return (
    <button
      onClick={(e) => {
        e.stopPropagation();
        mutation.mutate({ symbol, entry });
      }}
      disabled={mutation.isPending}
      className="text-[10px] px-2 py-0.5 rounded border border-border/50 text-muted-foreground hover:text-foreground hover:border-primary/50 transition-colors disabled:opacity-50"
    >
      {mutation.isPending ? '...' : '+ Watchlist'}
    </button>
  );
}
