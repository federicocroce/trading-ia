import { trpc } from './trpc';

export function useWatchlistSet(): Set<string> {
  const { data } = trpc.portfolio.symbols.list.useQuery(undefined, {
    staleTime: 30_000,
  });
  return new Set((data ?? []).map((s) => s.symbol));
}
