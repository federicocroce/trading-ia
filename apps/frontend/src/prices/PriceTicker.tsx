import { Separator } from '@/components/ui/separator';
import { trpc } from '@/shared/trpc';
import { useNavigation } from '@/shared/navigation';
import type { TopMover } from '@trading/shared';

function MoverItem({ mover, direction, onClick }: { mover: TopMover; direction: 'up' | 'down'; onClick: () => void }) {
  const isUp = direction === 'up';
  const colorClass = isUp ? 'text-trading-green' : 'text-trading-red';
  const arrow = isUp ? '▲' : '▼';

  return (
    <button
      onClick={onClick}
      className="flex items-center gap-1.5 shrink-0 hover:opacity-75 transition-opacity"
    >
      <span className={`text-xs font-medium ${colorClass}`}>{arrow}</span>
      <span className="text-xs font-medium text-foreground">{mover.symbol}</span>
      <span className="text-xs text-muted-foreground">${mover.price.toFixed(2)}</span>
      <span className={`text-xs font-medium ${colorClass}`}>
        {mover.changePercent >= 0 ? '+' : ''}{mover.changePercent.toFixed(2)}%
      </span>
    </button>
  );
}

export function PriceTicker() {
  const { goToSymbol } = useNavigation();

  const { data: movers } = trpc.prices.getMarketMovers.useQuery(undefined, {
    staleTime: 10 * 60_000,
    refetchInterval: 10 * 60_000,
  });

  const { data: prices } = trpc.prices.getAll.useQuery(undefined, {
    refetchInterval: 10_000,
  });

  // Si hay movers de FMP, usarlos. Sino fallback al watchlist ordenado por |changePercent|
  const hasMovers = movers && (movers.gainers.length > 0 || movers.losers.length > 0);

  if (!hasMovers && !prices) return null;

  if (hasMovers) {
    return (
      <div className="bg-background border-b border-border overflow-hidden">
        <div className="flex items-center gap-4 px-4 py-1.5 overflow-x-auto">
          {movers.gainers.map((m) => (
            <MoverItem key={m.symbol} mover={m} direction="up" onClick={() => goToSymbol(m.symbol)} />
          ))}

          {movers.gainers.length > 0 && movers.losers.length > 0 && (
            <Separator orientation="vertical" className="h-4 mx-1" />
          )}

          {movers.losers.map((m) => (
            <MoverItem key={m.symbol} mover={m} direction="down" onClick={() => goToSymbol(m.symbol)} />
          ))}
        </div>
      </div>
    );
  }

  // Fallback: watchlist ordenado por mayor movimiento %
  const sorted = [...(prices ?? [])].sort((a, b) => Math.abs(b.changePercent) - Math.abs(a.changePercent));

  return (
    <div className="bg-background border-b border-border overflow-hidden">
      <div className="flex items-center gap-4 px-4 py-1.5 overflow-x-auto">
        {sorted.map((p, i) => {
          const isUp = p.changePercent >= 0;
          const colorClass = isUp ? 'text-trading-green' : 'text-trading-red';
          const arrow = isUp ? '▲' : '▼';
          return (
            <button
              key={p.symbol}
              onClick={() => goToSymbol(p.symbol)}
              className="flex items-center gap-1.5 shrink-0 hover:opacity-75 transition-opacity"
            >
              <span className={`text-xs font-medium ${colorClass}`}>{arrow}</span>
              <span className="text-xs font-medium text-foreground">{p.symbol}</span>
              <span className="text-xs text-muted-foreground">${p.current.toFixed(2)}</span>
              <span className={`text-xs font-medium ${colorClass}`}>
                {p.changePercent >= 0 ? '+' : ''}{p.changePercent.toFixed(2)}%
              </span>
              {i < sorted.length - 1 && <Separator orientation="vertical" className="h-3 ml-1" />}
            </button>
          );
        })}
      </div>
    </div>
  );
}
