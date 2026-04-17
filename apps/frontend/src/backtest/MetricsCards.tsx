// apps/frontend/src/backtest/MetricsCards.tsx
import { Card } from '@/components/ui/card';
import type { BacktestMetrics } from '@trading/shared';

interface Props {
  metrics: BacktestMetrics;
  symbol: string;
}

function MetricCard({ label, value, color }: { label: string; value: string; color?: string }) {
  return (
    <Card className="p-4 flex flex-col gap-1">
      <span className="text-xs text-muted-foreground">{label}</span>
      <span className={`text-xl font-bold tabular-nums ${color ?? ''}`}>{value}</span>
    </Card>
  );
}

function pct(n: number) {
  const sign = n > 0 ? '+' : '';
  return `${sign}${n.toFixed(2)}%`;
}

function color(n: number) {
  if (n > 0) return 'text-trading-green';
  if (n < 0) return 'text-trading-red';
  return '';
}

export function MetricsCards({ metrics, symbol }: Props) {
  return (
    <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-3">
      <MetricCard
        label={`Retorno ${symbol}`}
        value={pct(metrics.totalReturnPercent)}
        color={color(metrics.totalReturnPercent)}
      />
      <MetricCard
        label="Buy & Hold"
        value={pct(metrics.buyAndHoldReturnPercent)}
        color={color(metrics.buyAndHoldReturnPercent)}
      />
      <MetricCard
        label="Sharpe Ratio"
        value={metrics.sharpeRatio.toFixed(2)}
        color={metrics.sharpeRatio >= 1 ? 'text-trading-green' : metrics.sharpeRatio < 0 ? 'text-trading-red' : ''}
      />
      <MetricCard
        label="Max Drawdown"
        value={`-${metrics.maxDrawdownPercent.toFixed(2)}%`}
        color={metrics.maxDrawdownPercent > 20 ? 'text-trading-red' : ''}
      />
      <MetricCard
        label="Win Rate"
        value={`${(metrics.winRate * 100).toFixed(0)}%`}
        color={metrics.winRate >= 0.5 ? 'text-trading-green' : 'text-trading-red'}
      />
      <MetricCard
        label="Operaciones"
        value={`${metrics.numTrades} (${metrics.avgTradeDurationDays}d avg)`}
      />
    </div>
  );
}
