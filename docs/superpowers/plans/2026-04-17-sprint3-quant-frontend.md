# Sprint 3 Quant Engine — Frontend Backtesting UI Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the Backtesting UI tab in the trading dashboard: strategy configuration form, equity curve + drawdown charts (lightweight-charts), metrics cards, and a multi-run comparison table.

**Architecture:** New `apps/frontend/src/backtest/` folder with focused components. Plugs into existing Tabs navigation in `App.tsx`. Uses `trpc.quant.*` endpoints (defined in backend plan). Polling pattern for async backtest runs.

**Prerequisite:** Backend plan (`2026-04-17-sprint3-quant-backend.md`) must be completed first — the tRPC `quant` router must be available.

**Tech Stack:** React, TypeScript, tRPC client, `lightweight-charts` v5 (already installed), shadcn/ui components (Button, Card, Badge, Input, Select already installed).

---

## File Map

**New files:**
- `apps/frontend/src/backtest/BacktestPage.tsx` — main composition, polling logic
- `apps/frontend/src/backtest/StrategyConfigForm.tsx` — form with preset selector + custom sliders
- `apps/frontend/src/backtest/MetricsCards.tsx` — 6 metric cards
- `apps/frontend/src/backtest/EquityCurveChart.tsx` — lightweight-charts line chart
- `apps/frontend/src/backtest/DrawdownChart.tsx` — lightweight-charts area chart
- `apps/frontend/src/backtest/StrategyCompareTable.tsx` — multi-run comparison table

**Modified files:**
- `apps/frontend/src/App.tsx` — add "Backtest" tab

---

## Task 14: MetricsCards Component

**Files:**
- Create: `apps/frontend/src/backtest/MetricsCards.tsx`

- [ ] **Step 1: Create MetricsCards.tsx**

```tsx
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
```

- [ ] **Step 2: Typecheck**

```bash
cd /Users/federicocroce/Documents/Fede/trading/apps/frontend && npm run typecheck
```
Expected: no errors (BacktestMetrics should resolve from @trading/shared once backend plan Task 1 is done).

- [ ] **Step 3: Commit**

```bash
git add apps/frontend/src/backtest/MetricsCards.tsx
git commit -m "feat(backtest): add MetricsCards component"
```

---

## Task 15: EquityCurveChart Component

**Files:**
- Create: `apps/frontend/src/backtest/EquityCurveChart.tsx`

- [ ] **Step 1: Create EquityCurveChart.tsx**

```tsx
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
```

- [ ] **Step 2: Typecheck**

```bash
cd /Users/federicocroce/Documents/Fede/trading/apps/frontend && npm run typecheck
```
Expected: no errors.

- [ ] **Step 3: Commit**

```bash
git add apps/frontend/src/backtest/EquityCurveChart.tsx
git commit -m "feat(backtest): add EquityCurveChart (lightweight-charts)"
```

---

## Task 16: DrawdownChart Component

**Files:**
- Create: `apps/frontend/src/backtest/DrawdownChart.tsx`

- [ ] **Step 1: Create DrawdownChart.tsx**

```tsx
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
```

- [ ] **Step 2: Typecheck**

```bash
cd /Users/federicocroce/Documents/Fede/trading/apps/frontend && npm run typecheck
```
Expected: no errors.

- [ ] **Step 3: Commit**

```bash
git add apps/frontend/src/backtest/DrawdownChart.tsx
git commit -m "feat(backtest): add DrawdownChart (lightweight-charts area)"
```

---

## Task 17: StrategyCompareTable Component

**Files:**
- Create: `apps/frontend/src/backtest/StrategyCompareTable.tsx`

- [ ] **Step 1: Create StrategyCompareTable.tsx**

```tsx
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
```

- [ ] **Step 2: Typecheck**

```bash
cd /Users/federicocroce/Documents/Fede/trading/apps/frontend && npm run typecheck
```
Expected: no errors.

- [ ] **Step 3: Commit**

```bash
git add apps/frontend/src/backtest/StrategyCompareTable.tsx
git commit -m "feat(backtest): add StrategyCompareTable for multi-run comparison"
```

---

## Task 18: StrategyConfigForm Component

**Files:**
- Create: `apps/frontend/src/backtest/StrategyConfigForm.tsx`

- [ ] **Step 1: Create StrategyConfigForm.tsx**

```tsx
// apps/frontend/src/backtest/StrategyConfigForm.tsx
import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Card } from '@/components/ui/card';
import type { StrategyConfig } from '@trading/shared';

const PRESETS: Record<string, StrategyConfig> = {
  base: {
    name: 'Base',
    shortTermWeights: { sentiment: 0.40, technical: 0.40, fundamental: 0.20 },
    mediumTermWeights: { sentiment: 0.20, technical: 0.35, fundamental: 0.45 },
    buyThreshold: 62,
    sellThreshold: 52,
    stopLossPercent: 8,
    takeProfitPercent: 25,
  },
  momentum: {
    name: 'Momentum',
    shortTermWeights: { sentiment: 0.35, technical: 0.55, fundamental: 0.10 },
    mediumTermWeights: { sentiment: 0.20, technical: 0.55, fundamental: 0.25 },
    buyThreshold: 65,
    sellThreshold: 50,
    stopLossPercent: 6,
    takeProfitPercent: 30,
  },
  fundamental: {
    name: 'Fundamental',
    shortTermWeights: { sentiment: 0.20, technical: 0.20, fundamental: 0.60 },
    mediumTermWeights: { sentiment: 0.10, technical: 0.25, fundamental: 0.65 },
    buyThreshold: 60,
    sellThreshold: 48,
    stopLossPercent: 10,
    takeProfitPercent: 20,
  },
  balanced: {
    name: 'Balanceado',
    shortTermWeights: { sentiment: 0.33, technical: 0.34, fundamental: 0.33 },
    mediumTermWeights: { sentiment: 0.33, technical: 0.34, fundamental: 0.33 },
    buyThreshold: 62,
    sellThreshold: 52,
    stopLossPercent: 8,
    takeProfitPercent: 25,
  },
};

interface Props {
  onSubmit: (symbol: string, startDate: string, endDate: string, strategy: StrategyConfig) => void;
  loading: boolean;
}

export function StrategyConfigForm({ onSubmit, loading }: Props) {
  const [symbol, setSymbol] = useState('AAPL');
  const [startDate, setStartDate] = useState(() => {
    const d = new Date();
    d.setFullYear(d.getFullYear() - 1);
    return d.toISOString().split('T')[0];
  });
  const [endDate, setEndDate] = useState(() => new Date().toISOString().split('T')[0]);
  const [selectedPreset, setSelectedPreset] = useState<string>('base');
  const [strategy, setStrategy] = useState<StrategyConfig>(PRESETS.base);

  function handlePresetChange(key: string) {
    setSelectedPreset(key);
    setStrategy(PRESETS[key]);
  }

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    onSubmit(symbol.toUpperCase().trim(), startDate, endDate, strategy);
  }

  return (
    <Card className="p-4">
      <form onSubmit={handleSubmit} className="flex flex-wrap gap-3 items-end">
        <div className="flex flex-col gap-1">
          <label className="text-xs text-muted-foreground">Símbolo</label>
          <Input
            value={symbol}
            onChange={e => setSymbol(e.target.value)}
            className="w-28 uppercase"
            placeholder="AAPL"
            required
          />
        </div>
        <div className="flex flex-col gap-1">
          <label className="text-xs text-muted-foreground">Desde</label>
          <Input
            type="date"
            value={startDate}
            onChange={e => setStartDate(e.target.value)}
            className="w-40"
            required
          />
        </div>
        <div className="flex flex-col gap-1">
          <label className="text-xs text-muted-foreground">Hasta</label>
          <Input
            type="date"
            value={endDate}
            onChange={e => setEndDate(e.target.value)}
            className="w-40"
            required
          />
        </div>
        <div className="flex flex-col gap-1">
          <label className="text-xs text-muted-foreground">Estrategia</label>
          <select
            value={selectedPreset}
            onChange={e => handlePresetChange(e.target.value)}
            className="h-9 px-2 rounded-md border border-input bg-background text-sm"
          >
            {Object.entries(PRESETS).map(([key, p]) => (
              <option key={key} value={key}>{p.name}</option>
            ))}
          </select>
        </div>
        <div className="flex flex-col gap-1">
          <label className="text-xs text-muted-foreground">Buy ≥ / Sell &lt;</label>
          <div className="flex gap-1">
            <Input
              type="number"
              value={strategy.buyThreshold}
              onChange={e => setStrategy(s => ({ ...s, name: 'Custom', buyThreshold: +e.target.value }))}
              className="w-16"
              min={0} max={100}
            />
            <span className="self-center text-muted-foreground">/</span>
            <Input
              type="number"
              value={strategy.sellThreshold}
              onChange={e => setStrategy(s => ({ ...s, name: 'Custom', sellThreshold: +e.target.value }))}
              className="w-16"
              min={0} max={100}
            />
          </div>
        </div>
        <div className="flex flex-col gap-1">
          <label className="text-xs text-muted-foreground">Stop / Target %</label>
          <div className="flex gap-1">
            <Input
              type="number"
              value={strategy.stopLossPercent}
              onChange={e => setStrategy(s => ({ ...s, name: 'Custom', stopLossPercent: +e.target.value }))}
              className="w-16"
              min={0} max={50}
            />
            <span className="self-center text-muted-foreground">/</span>
            <Input
              type="number"
              value={strategy.takeProfitPercent}
              onChange={e => setStrategy(s => ({ ...s, name: 'Custom', takeProfitPercent: +e.target.value }))}
              className="w-16"
              min={0} max={100}
            />
          </div>
        </div>
        <Button type="submit" disabled={loading} className="mt-auto">
          {loading ? 'Corriendo...' : 'Correr Backtest'}
        </Button>
      </form>
    </Card>
  );
}
```

- [ ] **Step 2: Typecheck**

```bash
cd /Users/federicocroce/Documents/Fede/trading/apps/frontend && npm run typecheck
```
Expected: no errors.

- [ ] **Step 3: Commit**

```bash
git add apps/frontend/src/backtest/StrategyConfigForm.tsx
git commit -m "feat(backtest): add StrategyConfigForm with presets and custom thresholds"
```

---

## Task 19: BacktestPage — Main Composition + Polling

**Files:**
- Create: `apps/frontend/src/backtest/BacktestPage.tsx`

- [ ] **Step 1: Create BacktestPage.tsx**

```tsx
// apps/frontend/src/backtest/BacktestPage.tsx
import { useState, useEffect, useRef } from 'react';
import { trpc } from '@/shared/trpc';
import { StrategyConfigForm } from './StrategyConfigForm';
import { MetricsCards } from './MetricsCards';
import { EquityCurveChart } from './EquityCurveChart';
import { DrawdownChart } from './DrawdownChart';
import { StrategyCompareTable } from './StrategyCompareTable';
import { Card } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import type { BacktestRun, StrategyConfig } from '@trading/shared';

export function BacktestPage() {
  const [currentRunId, setCurrentRunId] = useState<number | null>(null);
  const [compareRuns, setCompareRuns] = useState<BacktestRun[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const pollIntervalRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const utils = trpc.useUtils();
  const triggerMutation = trpc.quant.triggerBacktest.useMutation();

  const { data: currentRun } = trpc.quant.getBacktestRun.useQuery(
    { runId: currentRunId! },
    { enabled: currentRunId !== null, refetchInterval: currentRun?.status === 'running' ? 2000 : false },
  );

  useEffect(() => {
    if (currentRun?.status === 'completed' || currentRun?.status === 'failed') {
      setLoading(false);
    }
  }, [currentRun?.status]);

  async function handleSubmit(symbol: string, startDate: string, endDate: string, strategy: StrategyConfig) {
    setLoading(true);
    setError(null);
    setCurrentRunId(null);
    try {
      const { runId } = await triggerMutation.mutateAsync({ symbol, startDate, endDate, strategy });
      setCurrentRunId(runId);
    } catch (err) {
      setError((err as Error).message ?? 'Error al iniciar backtest');
      setLoading(false);
    }
  }

  function addToCompare() {
    if (currentRun && currentRun.status === 'completed') {
      setCompareRuns(prev => {
        if (prev.find(r => r.id === currentRun.id)) return prev;
        return [...prev, currentRun];
      });
    }
  }

  function removeFromCompare(id: number) {
    setCompareRuns(prev => prev.filter(r => r.id !== id));
  }

  const showResults = currentRun && currentRun.status === 'completed';

  return (
    <div className="p-4 space-y-4 max-w-7xl mx-auto">
      <div className="flex items-center justify-between">
        <h2 className="text-lg font-semibold">Backtesting de Estrategias</h2>
      </div>

      <StrategyConfigForm onSubmit={handleSubmit} loading={loading} />

      {error && (
        <div className="text-sm text-trading-red bg-trading-red/10 rounded-md px-3 py-2">{error}</div>
      )}

      {loading && currentRun?.status === 'running' && (
        <div className="text-sm text-muted-foreground animate-pulse">Calculando señales históricas...</div>
      )}

      {currentRun?.status === 'failed' && (
        <div className="text-sm text-trading-red bg-trading-red/10 rounded-md px-3 py-2">
          Backtest falló: {currentRun.error ?? 'Error desconocido'}
        </div>
      )}

      {showResults && (
        <>
          <MetricsCards metrics={currentRun.metrics} symbol={currentRun.symbol} />

          <Card className="p-4 space-y-2">
            <div className="flex items-center justify-between">
              <span className="text-sm font-medium text-muted-foreground">Curva de Equity</span>
              <Button variant="outline" size="sm" onClick={addToCompare}>
                Agregar al comparador
              </Button>
            </div>
            <EquityCurveChart data={currentRun.equityCurve} symbol={currentRun.symbol} />
          </Card>

          <Card className="p-4 space-y-2">
            <span className="text-sm font-medium text-muted-foreground">Drawdown</span>
            <DrawdownChart data={currentRun.equityCurve} />
          </Card>

          {currentRun.trades.length > 0 && (
            <Card className="p-4">
              <span className="text-sm font-medium text-muted-foreground block mb-3">
                Operaciones ({currentRun.trades.length})
              </span>
              <div className="overflow-x-auto">
                <table className="w-full text-xs">
                  <thead>
                    <tr className="text-muted-foreground">
                      <th className="text-left pb-2">Entrada</th>
                      <th className="text-left pb-2">Salida</th>
                      <th className="text-right pb-2">Precio entrada</th>
                      <th className="text-right pb-2">Precio salida</th>
                      <th className="text-right pb-2">Retorno</th>
                      <th className="text-left pb-2 pl-3">Motivo</th>
                    </tr>
                  </thead>
                  <tbody>
                    {currentRun.trades.map((t, i) => (
                      <tr key={i} className="border-t border-border/30">
                        <td className="py-1 tabular-nums">{t.entryDate}</td>
                        <td className="py-1 tabular-nums">{t.exitDate}</td>
                        <td className="py-1 text-right tabular-nums">${t.entryPrice.toFixed(2)}</td>
                        <td className="py-1 text-right tabular-nums">${t.exitPrice.toFixed(2)}</td>
                        <td className={`py-1 text-right tabular-nums ${t.returnPercent > 0 ? 'text-trading-green' : 'text-trading-red'}`}>
                          {t.returnPercent > 0 ? '+' : ''}{t.returnPercent.toFixed(2)}%
                        </td>
                        <td className="py-1 pl-3 text-muted-foreground">{t.exitReason}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </Card>
          )}
        </>
      )}

      {compareRuns.length > 0 && (
        <Card className="p-4 space-y-3">
          <span className="text-sm font-medium text-muted-foreground">Comparación de Estrategias</span>
          <StrategyCompareTable runs={compareRuns} onRemove={removeFromCompare} />
        </Card>
      )}
    </div>
  );
}
```

- [ ] **Step 2: Typecheck**

```bash
cd /Users/federicocroce/Documents/Fede/trading/apps/frontend && npm run typecheck
```
Expected: no errors. If `refetchInterval` type conflicts, use `refetchInterval: currentRun?.status === 'running' ? 2000 : (false as const)`.

- [ ] **Step 3: Commit**

```bash
git add apps/frontend/src/backtest/BacktestPage.tsx
git commit -m "feat(backtest): add BacktestPage with polling, equity curve, drawdown, trades table, and compare"
```

---

## Task 20: App.tsx — Add Backtest Tab

**Files:**
- Modify: `apps/frontend/src/App.tsx`

- [ ] **Step 1: Import BacktestPage**

At the top of `App.tsx`, add:
```typescript
import { BacktestPage } from '@/backtest/BacktestPage';
```

- [ ] **Step 2: Add tab trigger**

In the `TabsList`, after the "transactions" TabsTrigger:
```tsx
<TabsTrigger value="backtest">Backtest</TabsTrigger>
```

- [ ] **Step 3: Add tab content**

After the `transactions` TabsContent block:
```tsx
<TabsContent value="backtest" className="flex-1 overflow-y-auto">
  <BacktestPage />
</TabsContent>
```

- [ ] **Step 4: Typecheck**

```bash
cd /Users/federicocroce/Documents/Fede/trading/apps/frontend && npm run typecheck
```
Expected: no errors.

- [ ] **Step 5: Test in browser**

Start both servers:
```bash
cd /Users/federicocroce/Documents/Fede/trading && npm run dev -w apps/backend &
npm run dev -w apps/frontend
```

Open http://localhost:5173 → click "Backtest" tab → fill form: Symbol=AAPL, dates last 1 year, preset Base → click "Correr Backtest".

Verify:
- Form submits, button shows "Corriendo..."
- After ~5-10s, metrics cards appear
- Equity curve chart shows 2 lines (strategy vs buy & hold)
- Drawdown chart shows red area
- Trades table appears
- "Agregar al comparador" button works (row appears in comparison table)

- [ ] **Step 6: Commit**

```bash
git add apps/frontend/src/App.tsx
git commit -m "feat(app): add Backtest tab with BacktestPage"
```

---

## Self-Review Checklist

- [x] `BacktestRun.equityCurve` used in both EquityCurveChart and DrawdownChart — type consistent
- [x] `BacktestRun.metrics` used in MetricsCards — matches BacktestMetrics type
- [x] `BacktestRun.trades` displayed in trades table — uses all BacktestTrade fields
- [x] Polling: `refetchInterval: 2000` only when `status === 'running'` — stops automatically
- [x] Compare table: uses `BacktestRun.metrics` + `BacktestRun.strategy.name` — matches types
- [x] `trpc.quant.triggerBacktest` mutation input matches `StrategyConfig` — consistent with backend Task 13
- [x] No routing library needed — uses existing Tabs pattern from App.tsx
- [x] lightweight-charts cleanup: ResizeObserver + `chart.remove()` in useEffect cleanup — no memory leaks
