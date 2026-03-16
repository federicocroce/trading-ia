import { useState, useEffect, useRef } from 'react';
import {
  AreaChart,
  Area,
  XAxis,
  YAxis,
  Tooltip,
  ResponsiveContainer,
} from 'recharts';
import { trpc } from '@/shared/trpc';

const TIMEFRAMES = [
  { label: '1D', range: '1d' as const, interval: '5m' as const },
  { label: '1S', range: '5d' as const, interval: '15m' as const },
  { label: '1M', range: '1mo' as const, interval: '1h' as const },
  { label: '1A', range: '1y' as const, interval: '1d' as const },
  { label: '5A', range: '5y' as const, interval: '1wk' as const },
];

export interface PeriodChange {
  label: string;
  change: number;
  changePercent: number;
}

interface PriceChartProps {
  symbol: string;
  onPeriodChange?: (info: PeriodChange | null) => void;
}

export function PriceChart({ symbol, onPeriodChange }: PriceChartProps) {
  const [tfIdx, setTfIdx] = useState(2); // default: 1M
  const tf = TIMEFRAMES[tfIdx];

  const { data: ohlc, isLoading } = trpc.prices.getHistory.useQuery(
    { symbol, range: tf.range, interval: tf.interval },
    { staleTime: 60_000 },
  );

  const chartData = ohlc?.map((d) => ({ date: d.date, price: d.close })) ?? [];
  const isUp = chartData.length >= 2 && chartData[chartData.length - 1].price >= chartData[0].price;
  const color = isUp ? 'var(--color-trading-green)' : 'var(--color-trading-red)';

  // Notify parent of period change
  const onPeriodChangeRef = useRef(onPeriodChange);
  onPeriodChangeRef.current = onPeriodChange;

  const firstPrice = chartData.length >= 2 ? chartData[0].price : null;
  const lastPrice = chartData.length >= 2 ? chartData[chartData.length - 1].price : null;

  useEffect(() => {
    if (!onPeriodChangeRef.current) return;
    if (firstPrice !== null && lastPrice !== null) {
      const change = lastPrice - firstPrice;
      const changePercent = (change / firstPrice) * 100;
      onPeriodChangeRef.current({ label: tf.label, change, changePercent });
    } else {
      onPeriodChangeRef.current(null);
    }
  }, [tf.label, firstPrice, lastPrice]);

  function formatDate(date: string) {
    if (tf.range === '1d' || tf.range === '5d') {
      // For intraday, show time
      const d = new Date(date);
      return d.toLocaleTimeString('es-AR', { hour: '2-digit', minute: '2-digit' });
    }
    if (tf.range === '1mo') {
      return new Date(date).toLocaleDateString('es-AR', { day: '2-digit', month: 'short' });
    }
    if (tf.range === '5y') {
      return new Date(date).toLocaleDateString('es-AR', { month: 'short', year: '2-digit' });
    }
    return new Date(date).toLocaleDateString('es-AR', { day: '2-digit', month: 'short' });
  }

  return (
    <div>
      {/* Timeframe tabs */}
      <div className="flex items-center justify-end gap-1 mb-3">
        {TIMEFRAMES.map((t, i) => (
          <button
            key={t.label}
            onClick={() => setTfIdx(i)}
            className={`px-3 py-1.5 text-xs font-medium rounded-md transition-colors ${
              i === tfIdx
                ? 'bg-accent text-accent-foreground'
                : 'text-muted-foreground hover:text-foreground hover:bg-accent/50'
            }`}
          >
            {t.label}
          </button>
        ))}
      </div>

      {/* Chart */}
      <div className="h-[300px]">
        {isLoading ? (
          <div className="h-full flex items-center justify-center text-muted-foreground text-sm">
            Cargando grafico...
          </div>
        ) : chartData.length === 0 ? (
          <div className="h-full flex items-center justify-center text-muted-foreground text-sm">
            Sin datos para este periodo
          </div>
        ) : (
          <ResponsiveContainer width="100%" height="100%">
            <AreaChart data={chartData} margin={{ top: 5, right: 5, left: 5, bottom: 5 }}>
              <defs>
                <linearGradient id={`gradient-${symbol}`} x1="0" y1="0" x2="0" y2="1">
                  <stop offset="5%" stopColor={color} stopOpacity={0.3} />
                  <stop offset="95%" stopColor={color} stopOpacity={0} />
                </linearGradient>
              </defs>
              <XAxis
                dataKey="date"
                tickFormatter={formatDate}
                tick={{ fontSize: 10, fill: 'var(--color-muted-foreground)' }}
                axisLine={false}
                tickLine={false}
                minTickGap={40}
              />
              <YAxis
                domain={['auto', 'auto']}
                tick={{ fontSize: 10, fill: 'var(--color-muted-foreground)' }}
                axisLine={false}
                tickLine={false}
                tickFormatter={(v: number) => `$${v.toFixed(0)}`}
                width={50}
              />
              <Tooltip
                contentStyle={{
                  backgroundColor: 'var(--color-card)',
                  border: '1px solid var(--color-border)',
                  borderRadius: '6px',
                  fontSize: '12px',
                }}
                labelFormatter={(label) => new Date(String(label)).toLocaleDateString('es-AR', {
                  day: '2-digit',
                  month: 'short',
                  year: 'numeric',
                })}
                formatter={(value) => [`$${Number(value).toFixed(2)}`, 'Precio']}
              />
              <Area
                type="monotone"
                dataKey="price"
                stroke={color}
                strokeWidth={2}
                fill={`url(#gradient-${symbol})`}
                isAnimationActive={false}
              />
            </AreaChart>
          </ResponsiveContainer>
        )}
      </div>
    </div>
  );
}
