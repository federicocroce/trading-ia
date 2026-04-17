// apps/frontend/src/backtest/DrawdownChart.tsx
import { useEffect, useRef } from 'react';
import { createChart, ColorType, AreaSeries } from 'lightweight-charts';
import type { BacktestEquityPoint } from '@trading/shared';

interface Props {
  data: BacktestEquityPoint[];
}

export function DrawdownChart({ data }: Props) {
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!containerRef.current || data.length === 0) return;

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

    const areaSeries = chart.addSeries(AreaSeries, {
      lineColor: '#ef4444',
      topColor: '#ef444430',
      bottomColor: 'transparent',
      lineWidth: 1,
      title: 'Drawdown %',
    });

    // Negate so it shows as downward area
    const ddData = data.map(p => ({
      time: p.date as import('lightweight-charts').Time,
      value: -p.drawdownPercent,
    }));
    areaSeries.setData(ddData);
    chart.timeScale().fitContent();

    const ro = new ResizeObserver(() => {
      if (containerRef.current) chart.applyOptions({ width: containerRef.current.clientWidth });
    });
    ro.observe(containerRef.current);

    return () => {
      ro.disconnect();
      chart.remove();
    };
  }, [data]);

  return <div ref={containerRef} className="w-full" />;
}
