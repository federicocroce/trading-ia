// apps/frontend/src/backtest/BacktestPage.tsx
import { useState, useEffect } from 'react';
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

  const triggerMutation = trpc.quant.triggerBacktest.useMutation();

  const { data: currentRun } = trpc.quant.getBacktestRun.useQuery(
    { runId: currentRunId! },
    {
      enabled: currentRunId !== null,
      refetchInterval: (query) => {
        const data = query.state.data;
        return data?.status === 'running' ? 2000 : false;
      },
    },
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

      {loading && (currentRun?.status === 'running' || !currentRun) && (
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
