// apps/frontend/src/backtest/StrategyCompareTable.tsx
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import type { BacktestRun } from '@trading/shared';

interface Props {
  runs: BacktestRun[];
  onRemove: (id: number) => void;
}

function pct(n: number) {
  const sign = n > 0 ? '+' : '';
  return `${sign}${n.toFixed(2)}%`;
}

function colorClass(n: number) {
  if (n > 0) return 'text-trading-green';
  if (n < 0) return 'text-trading-red';
  return 'text-muted-foreground';
}

export function StrategyCompareTable({ runs, onRemove }: Props) {
  if (runs.length === 0) return null;

  return (
    <div className="overflow-x-auto rounded-md border border-border">
      <table className="w-full text-sm">
        <thead className="bg-card border-b border-border">
          <tr>
            <th className="px-3 py-2 text-left text-muted-foreground font-normal">Estrategia</th>
            <th className="px-3 py-2 text-right text-muted-foreground font-normal">Símbolo</th>
            <th className="px-3 py-2 text-right text-muted-foreground font-normal">Retorno</th>
            <th className="px-3 py-2 text-right text-muted-foreground font-normal">B&H</th>
            <th className="px-3 py-2 text-right text-muted-foreground font-normal">Sharpe</th>
            <th className="px-3 py-2 text-right text-muted-foreground font-normal">Max DD</th>
            <th className="px-3 py-2 text-right text-muted-foreground font-normal">Win %</th>
            <th className="px-3 py-2 text-right text-muted-foreground font-normal">Ops</th>
            <th className="px-3 py-2" />
          </tr>
        </thead>
        <tbody>
          {runs.map(run => (
            <tr key={run.id} className="border-b border-border/50 hover:bg-muted/20">
              <td className="px-3 py-2 font-medium">
                {run.strategy.name}
                <span className="ml-2 text-xs text-muted-foreground">{run.startDate} → {run.endDate}</span>
              </td>
              <td className="px-3 py-2 text-right">
                <Badge variant="outline">{run.symbol}</Badge>
              </td>
              <td className={`px-3 py-2 text-right tabular-nums ${colorClass(run.metrics.totalReturnPercent)}`}>
                {pct(run.metrics.totalReturnPercent)}
              </td>
              <td className={`px-3 py-2 text-right tabular-nums ${colorClass(run.metrics.buyAndHoldReturnPercent)}`}>
                {pct(run.metrics.buyAndHoldReturnPercent)}
              </td>
              <td className={`px-3 py-2 text-right tabular-nums ${colorClass(run.metrics.sharpeRatio)}`}>
                {run.metrics.sharpeRatio.toFixed(2)}
              </td>
              <td className="px-3 py-2 text-right tabular-nums text-trading-red">
                -{run.metrics.maxDrawdownPercent.toFixed(1)}%
              </td>
              <td className={`px-3 py-2 text-right tabular-nums ${run.metrics.winRate >= 0.5 ? 'text-trading-green' : 'text-trading-red'}`}>
                {(run.metrics.winRate * 100).toFixed(0)}%
              </td>
              <td className="px-3 py-2 text-right tabular-nums text-muted-foreground">
                {run.metrics.numTrades}
              </td>
              <td className="px-3 py-2 text-right">
                <Button variant="ghost" size="sm" className="h-6 px-2 text-xs" onClick={() => onRemove(run.id)}>
                  ✕
                </Button>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
