// apps/frontend/src/backtest/EquityCurveChart.tsx
import { useEffect, useRef } from 'react';
import { createChart, ColorType, LineSeries } from 'lightweight-charts';
import type { IChartApi, ISeriesApi, Time } from 'lightweight-charts';
import type { BacktestEquityPoint } from '@trading/shared';

interface Props {
  data: BacktestEquityPoint[];
  symbol: string;
}

export function EquityCurveChart({ data, symbol }: Props) {
  const containerRef = useRef<HTMLDivElement>(null);
  const chartRef = useRef<IChartApi | null>(null);
  const stratSeriesRef = useRef<ISeriesApi<'Line'> | null>(null);
  const buhSeriesRef = useRef<ISeriesApi<'Line'> | null>(null);

  // Create chart once on mount
  useEffect(() => {
    if (!containerRef.current) return;

    const chart = createChart(containerRef.current, {
      layout: {
        background: { type: ColorType.Solid, color: 'transparent' },
        textColor: '#9ca3af',
      },
      grid: {
        vertLines: { color: '#1f2937' },
        horzLines: { color: '#1f2937' },
      },
      width: containerRef.current.clientWidth,
      height: 280,
      rightPriceScale: { borderColor: '#374151' },
      timeScale: { borderColor: '#374151' },
    });

    stratSeriesRef.current = chart.addSeries(LineSeries, {
      color: '#22c55e',
      lineWidth: 2,
      title: `Estrategia ${symbol}`,
    });

    buhSeriesRef.current = chart.addSeries(LineSeries, {
      color: '#6b7280',
      lineWidth: 1,
      lineStyle: 2,
      title: 'Buy & Hold',
    });

    chartRef.current = chart;

    const ro = new ResizeObserver(() => {
      if (containerRef.current) chart.applyOptions({ width: containerRef.current.clientWidth });
    });
    ro.observe(containerRef.current);

    return () => {
      ro.disconnect();
      chart.remove();
      chartRef.current = null;
      stratSeriesRef.current = null;
      buhSeriesRef.current = null;
    };
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // Update data without recreating chart
  useEffect(() => {
    if (!stratSeriesRef.current || !buhSeriesRef.current || data.length === 0) return;
    stratSeriesRef.current.setData(data.map(p => ({ time: p.date as Time, value: p.portfolioValue })));
    buhSeriesRef.current.setData(data.map(p => ({ time: p.date as Time, value: p.buyAndHoldValue })));
    chartRef.current?.timeScale().fitContent();
  }, [data]);

  return <div ref={containerRef} className="w-full" />;
}
