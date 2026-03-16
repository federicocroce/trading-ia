import { Badge } from '@/components/ui/badge';
import { trpc } from '@/shared/trpc';

export function Header() {
  const { data: summary } = trpc.portfolio.summary.useQuery(undefined, {
    refetchInterval: 10_000,
  });

  return (
    <header className="bg-card border-b border-border px-6 py-3 flex items-center justify-between">
      <div className="flex items-center gap-3">
        <h1 className="text-xl font-bold tracking-tight">Trading Dashboard</h1>
        <Badge variant="secondary">Argentina & Global</Badge>
      </div>

      {summary && (
        <div className="flex items-center gap-6 text-sm">
          <div className="flex items-center gap-2">
            <span className="text-muted-foreground">Portfolio</span>
            <span className="font-semibold">
              ${summary.totalValue.toLocaleString('en-US', { minimumFractionDigits: 0 })}
            </span>
          </div>
          <div className="flex items-center gap-2">
            <span className="text-muted-foreground">P&L</span>
            <Badge variant={summary.totalPnl >= 0 ? 'default' : 'destructive'}>
              {summary.totalPnl >= 0 ? '+' : ''}${summary.totalPnl.toLocaleString('en-US', { minimumFractionDigits: 0 })}
              {' '}({summary.totalPnlPercent >= 0 ? '+' : ''}{summary.totalPnlPercent.toFixed(1)}%)
            </Badge>
          </div>
          <span className="text-muted-foreground text-xs">{summary.positionCount} posiciones</span>
        </div>
      )}
    </header>
  );
}
