// apps/frontend/src/backtest/DrawdownChart.tsx
import { useEffect, useRef } from 'react';
import { createChart, ColorType, AreaSeries } from 'lightweight-charts';
import type { IChartApi, ISeriesApi, Time } from 'lightweight-charts';
import type { BacktestEquityPoint } from '@trading/shared';

interface Props {
  data: BacktestEquityPoint[];
}

export function DrawdownChart({ data }: Props) {
  const containerRef = useRef<HTMLDivElement>(null);
  const chartRef = useRef<IChartApi | null>(null);
  const areaSeriesRef = useRef<ISeriesApi<'Area'> | null>(null);

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
      height: 160,
      rightPriceScale: { borderColor: '#374151' },
      timeScale: { borderColor: '#374151' },
    });

    areaSeriesRef.current = chart.addSeries(AreaSeries, {
      lineColor: '#ef4444',
      topColor: '#ef444430',
      bottomColor: 'transparent',
      lineWidth: 1,
      title: 'Drawdown %',
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
      areaSeriesRef.current = null;
    };
  }, []);

  // Update data without recreating chart
  useEffect(() => {
    if (!areaSeriesRef.current || data.length === 0) return;
    areaSeriesRef.current.setData(data.map(p => ({
      time: p.date as Time,
      value: -p.drawdownPercent,
    })));
    chartRef.current?.timeScale().fitContent();
  }, [data]);

  return <div ref={containerRef} className="w-full" />;
}
