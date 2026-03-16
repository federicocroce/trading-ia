import { useState } from 'react';
import { Separator } from '@/components/ui/separator';
import { Button } from '@/components/ui/button';
import { trpc } from '@/shared/trpc';
import { useNavigation } from '@/shared/navigation';
import { AddSymbolDialog } from './AddSymbolDialog';

export function Sidebar() {
  const { goToSymbol } = useNavigation();
  const [dialogOpen, setDialogOpen] = useState(false);
  const utils = trpc.useUtils();

  const { data: symbols } = trpc.portfolio.symbols.list.useQuery();
  const { data: prices } = trpc.prices.getAll.useQuery(undefined, {
    refetchInterval: 10_000,
  });
  const deleteMutation = trpc.portfolio.symbols.delete.useMutation({
    onSuccess: () => {
      utils.portfolio.symbols.list.invalidate();
      utils.prices.getAll.invalidate();
    },
  });

  const priceMap = new Map(prices?.map((p) => [p.symbol, p]) ?? []);

  return (
    <aside className="w-64 bg-card border-r border-border flex flex-col overflow-hidden">
      <div className="p-4 flex items-center justify-between">
        <h2 className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">
          Watchlist
        </h2>
        <Button
          variant="ghost"
          size="sm"
          onClick={() => setDialogOpen(true)}
          className="h-6 w-6 p-0 text-muted-foreground hover:text-foreground"
        >
          +
        </Button>
      </div>
      <Separator />
      <div className="flex-1 overflow-y-auto min-h-0">
        {symbols?.map((stock) => {
          const price = priceMap.get(stock.symbol);
          return (
            <div
              key={stock.symbol}
              className="group flex items-center justify-between px-4 py-3 hover:bg-accent cursor-pointer transition-colors"
              onClick={() => goToSymbol(stock.symbol)}
            >
              <div>
                <div className="flex items-center gap-1.5">
                  <span className="text-xs">{stock.flag}</span>
                  <span className="font-medium text-sm">{stock.symbol}</span>
                </div>
                <span className="text-xs text-muted-foreground">{stock.name}</span>
              </div>
              <div className="flex items-center gap-2">
                {price ? (
                  <div className="text-right">
                    <div className="text-sm font-medium">${price.current.toFixed(2)}</div>
                    <div className={`text-xs font-medium ${price.changePercent >= 0 ? 'text-trading-green' : 'text-trading-red'}`}>
                      {price.changePercent >= 0 ? '+' : ''}{price.changePercent.toFixed(2)}%
                    </div>
                  </div>
                ) : (
                  <div className="text-xs text-muted-foreground">...</div>
                )}
                <button
                  className="hidden group-hover:block text-muted-foreground hover:text-destructive text-xs"
                  onClick={(e) => {
                    e.stopPropagation();
                    deleteMutation.mutate({ symbol: stock.symbol });
                  }}
                >
                  ×
                </button>
              </div>
            </div>
          );
        })}
      </div>
      <AddSymbolDialog open={dialogOpen} onOpenChange={setDialogOpen} />
    </aside>
  );
}
