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
  const [validationError, setValidationError] = useState<string | null>(null);

  function handlePresetChange(key: string) {
    setSelectedPreset(key);
    setStrategy(PRESETS[key]);
  }

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (strategy.buyThreshold <= strategy.sellThreshold) {
      setValidationError('Buy threshold debe ser mayor que Sell threshold');
      return;
    }
    setValidationError(null);
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
              onChange={e => { const v = +e.target.value; setStrategy((s: StrategyConfig) => ({ ...s, name: 'Custom', buyThreshold: v })); }}
              className="w-16"
              min={0} max={100}
            />
            <span className="self-center text-muted-foreground">/</span>
            <Input
              type="number"
              value={strategy.sellThreshold}
              onChange={e => { const v = +e.target.value; setStrategy((s: StrategyConfig) => ({ ...s, name: 'Custom', sellThreshold: v })); }}
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
              onChange={e => { const v = +e.target.value; setStrategy((s: StrategyConfig) => ({ ...s, name: 'Custom', stopLossPercent: v })); }}
              className="w-16"
              min={0} max={50}
            />
            <span className="self-center text-muted-foreground">/</span>
            <Input
              type="number"
              value={strategy.takeProfitPercent}
              onChange={e => { const v = +e.target.value; setStrategy((s: StrategyConfig) => ({ ...s, name: 'Custom', takeProfitPercent: v })); }}
              className="w-16"
              min={0} max={100}
            />
          </div>
        </div>
        <Button type="submit" disabled={loading} className="mt-auto">
          {loading ? 'Corriendo...' : 'Correr Backtest'}
        </Button>
        {validationError && (
          <span className="self-center text-xs text-trading-red">{validationError}</span>
        )}
      </form>
    </Card>
  );
}
