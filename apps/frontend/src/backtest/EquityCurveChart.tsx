// apps/frontend/src/backtest/EquityCurveChart.tsx
import { useEffect, useRef } from 'react';
import { createChart, ColorType, LineSeries } from 'lightweight-charts';
import type { BacktestEquityPoint } from '@trading/shared';

interface Props {
  data: BacktestEquityPoint[];
  symbol: string;
}

export function EquityCurveChart({ data, symbol }: Props) {
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
      height: 280,
      rightPriceScale: { borderColor: '#374151' },
      timeScale: { borderColor: '#374151' },
    });

    const stratSeries = chart.addSeries(LineSeries, {
      color: '#22c55e',
      lineWidth: 2,
      title: `Estrategia ${symbol}`,
    });

    const buhSeries = chart.addSeries(LineSeries, {
      color: '#6b7280',
      lineWidth: 1,
      lineStyle: 2, // dashed
      title: 'Buy & Hold',
    });

    const stratData = data.map(p => ({ time: p.date as import('lightweight-charts').Time, value: p.portfolioValue }));
    const buhData = data.map(p => ({ time: p.date as import('lightweight-charts').Time, value: p.buyAndHoldValue }));

    stratSeries.setData(stratData);
    buhSeries.setData(buhData);
    chart.timeScale().fitContent();

    const ro = new ResizeObserver(() => {
      if (containerRef.current) chart.applyOptions({ width: containerRef.current.clientWidth });
    });
    ro.observe(containerRef.current);

    return () => {
      ro.disconnect();
      chart.remove();
    };
  }, [data, symbol]);

  return <div ref={containerRef} className="w-full" />;
}
