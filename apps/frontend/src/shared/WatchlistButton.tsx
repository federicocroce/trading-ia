import { trpc } from './trpc';
import { useWatchlistSet } from './useWatchlistSet';

export function WatchlistButton({ symbol }: { symbol: string }) {
  const watchlistSet = useWatchlistSet();
  const utils = trpc.useUtils();
  const mutation = trpc.opportunities.addToWatchlist.useMutation({
    onSuccess: () => utils.portfolio.symbols.list.invalidate(),
  });

  if (watchlistSet.has(symbol)) return null;

  return (
    <button
      onClick={(e) => {
        e.stopPropagation();
        mutation.mutate({ symbol });
      }}
      disabled={mutation.isPending}
      className="text-[10px] px-2 py-0.5 rounded border border-border/50 text-muted-foreground hover:text-foreground hover:border-primary/50 transition-colors disabled:opacity-50"
    >
      {mutation.isPending ? '...' : '+ Watchlist'}
    </button>
  );
}
