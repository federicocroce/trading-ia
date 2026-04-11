import { useState, useEffect, useRef } from 'react';
import { createChart, type IChartApi, ColorType, CandlestickSeries, AreaSeries, LineSeries, HistogramSeries } from 'lightweight-charts';
import { trpc } from '@/shared/trpc';

// Chart colors — hex only (canvas doesn't support oklch)
const COLORS = {
  green: '#22c55e',
  red: '#ef4444',
  greenFaded: 'rgba(34, 197, 94, 0.3)',
  redFaded: 'rgba(239, 68, 68, 0.3)',
  greenVolume: 'rgba(34, 197, 94, 0.2)',
  redVolume: 'rgba(239, 68, 68, 0.2)',
  text: '#737373',
  grid: '#262626',
  border: '#333333',
};

const TIMEFRAMES = [
  { label: '1D', range: '1d' as const, interval: '5m' as const },
  { label: '1S', range: '5d' as const, interval: '15m' as const },
  { label: '1M', range: '1mo' as const, interval: '1h' as const },
  { label: '1A', range: '1y' as const, interval: '1d' as const },
  { label: '5A', range: '5y' as const, interval: '1wk' as const },
];

type ChartType = 'candle' | 'line' | 'area';

const CHART_TYPES: { value: ChartType; label: string }[] = [
  { value: 'candle', label: 'Velas' },
  { value: 'line', label: 'Linea' },
  { value: 'area', label: 'Area' },
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
  const [chartType, setChartType] = useState<ChartType>('candle');
  const tf = TIMEFRAMES[tfIdx];
  const chartContainerRef = useRef<HTMLDivElement>(null);
  const chartRef = useRef<IChartApi | null>(null);

  const { data: ohlc, isLoading } = trpc.prices.getHistory.useQuery(
    { symbol, range: tf.range, interval: tf.interval },
    { staleTime: 60_000 },
  );

  // Notify parent of period change
  const onPeriodChangeRef = useRef(onPeriodChange);
  onPeriodChangeRef.current = onPeriodChange;

  useEffect(() => {
    if (!onPeriodChangeRef.current || !ohlc || ohlc.length < 2) {
      onPeriodChangeRef.current?.(null);
      return;
    }
    const first = ohlc[0].close;
    const last = ohlc[ohlc.length - 1].close;
    const change = last - first;
    const changePercent = (change / first) * 100;
    onPeriodChangeRef.current({ label: tf.label, change, changePercent });
  }, [tf.label, ohlc]);

  // Create / update chart
  useEffect(() => {
    if (!chartContainerRef.current || !ohlc || ohlc.length === 0) return;

    // Clean up previous chart
    if (chartRef.current) {
      chartRef.current.remove();
      chartRef.current = null;
    }

    const chart = createChart(chartContainerRef.current, {
      layout: {
        background: { type: ColorType.Solid, color: 'transparent' },
        textColor: COLORS.text,
      },
      grid: {
        vertLines: { color: COLORS.grid },
        horzLines: { color: COLORS.grid },
      },
      width: chartContainerRef.current.clientWidth,
      height: 400,
      crosshair: { mode: 0 },
      timeScale: {
        timeVisible: tf.interval.includes('m') || tf.interval.includes('h'),
        borderColor: COLORS.border,
      },
      rightPriceScale: {
        borderColor: COLORS.border,
      },
    });

    const isUp = ohlc[ohlc.length - 1].close >= ohlc[0].close;

    // Sort + deduplicate by timestamp — lightweight-charts requires strictly ascending unique times
    const sorted = [...ohlc].sort((a, b) => new Date(a.date).getTime() - new Date(b.date).getTime());
    const seen = new Set<number>();
    const dedupedOhlc = sorted.filter(d => {
      const ts = Math.floor(new Date(d.date).getTime() / 1000);
      if (seen.has(ts)) return false;
      seen.add(ts);
      return true;
    });

    if (dedupedOhlc.length === 0) return;

    // ART = UTC-3. Shift timestamps so the chart labels show local time.
    const ART_OFFSET_S = -3 * 3600;
    const toChartTime = (dateStr: string) =>
      (Math.floor(new Date(dateStr).getTime() / 1000) + ART_OFFSET_S) as any;

    const timeOhlc = dedupedOhlc.map(d => ({
      time: toChartTime(d.date),
      open: d.open,
      high: d.high,
      low: d.low,
      close: d.close,
    }));

    const timeValues = dedupedOhlc.map(d => ({
      time: toChartTime(d.date),
      value: d.close,
    }));

    if (chartType === 'candle') {
      const series = chart.addSeries(CandlestickSeries, {
        upColor: COLORS.green,
        downColor: COLORS.red,
        borderUpColor: COLORS.green,
        borderDownColor: COLORS.red,
        wickUpColor: COLORS.green,
        wickDownColor: COLORS.red,
      });
      series.setData(timeOhlc);
    } else if (chartType === 'line') {
      const series = chart.addSeries(LineSeries, {
        color: isUp ? COLORS.green : COLORS.red,
        lineWidth: 2,
      });
      series.setData(timeValues);
    } else {
      // area
      const series = chart.addSeries(AreaSeries, {
        lineColor: isUp ? COLORS.green : COLORS.red,
        topColor: isUp ? COLORS.greenFaded : COLORS.redFaded,
        bottomColor: 'transparent',
        lineWidth: 2,
      });
      series.setData(timeValues);
    }

    // Volume histogram (uses dedupedOhlc to match time series)
    if (dedupedOhlc.some(d => d.volume > 0)) {
      const volumeSeries = chart.addSeries(HistogramSeries, {
        priceFormat: { type: 'volume' },
        priceScaleId: 'volume',
      });
      chart.priceScale('volume').applyOptions({
        scaleMargins: { top: 0.8, bottom: 0 },
      });
      volumeSeries.setData(dedupedOhlc.filter(d => d.volume > 0).map(d => ({
        time: toChartTime(d.date),
        value: d.volume,
        color: d.close >= d.open ? COLORS.greenVolume : COLORS.redVolume,
      })));
    }

    chart.timeScale().fitContent();
    chartRef.current = chart;

    const handleResize = () => {
      if (chartContainerRef.current) {
        chart.applyOptions({ width: chartContainerRef.current.clientWidth });
      }
    };
    window.addEventListener('resize', handleResize);

    return () => {
      window.removeEventListener('resize', handleResize);
      chart.remove();
      chartRef.current = null;
    };
  }, [ohlc, tf.range, chartType]);

  return (
    <div>
      {/* Controls: chart type + timeframe */}
      <div className="flex items-center justify-between mb-3">
        {/* Chart type selector */}
        <div className="flex items-center gap-1">
          {CHART_TYPES.map(ct => (
            <button
              key={ct.value}
              onClick={() => setChartType(ct.value)}
              className={`px-2.5 py-1 text-xs font-medium rounded-md transition-colors ${
                chartType === ct.value
                  ? 'bg-accent text-accent-foreground'
                  : 'text-muted-foreground hover:text-foreground hover:bg-accent/50'
              }`}
            >
              {ct.label}
            </button>
          ))}
        </div>

        {/* Timeframe selector */}
        <div className="flex items-center gap-1">
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
      </div>

      {/* Chart */}
      <div className="h-100">
        {isLoading ? (
          <div className="h-full w-full bg-muted/20 animate-pulse rounded" />
        ) : !ohlc || ohlc.length === 0 ? (
          <div className="h-full flex items-center justify-center text-muted-foreground text-sm">
            Sin datos para este periodo
          </div>
        ) : (
          <div ref={chartContainerRef} className="w-full h-full" />
        )}
      </div>
    </div>
  );
}
