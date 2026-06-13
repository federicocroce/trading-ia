/**
 * Head-to-head: valida CON DATOS cuál de las dos reglas opuestas conviene cuando el motor y
 * "Hoy" se contradicen. Misma entrada y mismo trailing stop para ambas; la única diferencia:
 *   - 'sell_on_warning' (el motor): además sale ante una divergencia bajista.
 *   - 'let_it_run' ("Hoy"): ignora la advertencia, sale solo si toca el stop.
 *
 * Lógica pura acá; la simulación con precios (I/O) en exit-rule-backtest.service.ts.
 */

export type ExitRule = 'sell_on_warning' | 'let_it_run';

export interface ExitState {
  price: number;
  trailingStop: number | null;
  hasBearishDiv: boolean;
}

export function shouldExit(rule: ExitRule, s: ExitState): boolean {
  if (s.trailingStop != null && s.price <= s.trailingStop) return true; // ambas: protección
  if (rule === 'sell_on_warning' && s.hasBearishDiv) return true;       // A: vende la advertencia
  return false;
}

const round2 = (n: number) => Math.round(n * 100) / 100;

export interface StrategyMetrics {
  totalReturn: number;   // % (equity arranca en 100)
  maxDrawdown: number;   // %
  numTrades: number;
  winRate: number;       // %
  profitFactor: number;  // ganancia bruta / pérdida bruta (99 = sin pérdidas)
  avgWin: number;
  avgLoss: number;
}

export function strategyMetrics(equity: number[], tradeReturns: number[]): StrategyMetrics {
  const totalReturn = equity.length > 0 ? round2(equity[equity.length - 1] - 100) : 0;

  let peak = -Infinity;
  let maxDd = 0;
  for (const v of equity) {
    peak = Math.max(peak, v);
    if (peak > 0) maxDd = Math.max(maxDd, ((peak - v) / peak) * 100);
  }

  const wins = tradeReturns.filter((r) => r > 0);
  const losses = tradeReturns.filter((r) => r < 0);
  const grossWin = wins.reduce((a, b) => a + b, 0);
  const grossLoss = Math.abs(losses.reduce((a, b) => a + b, 0));

  return {
    totalReturn,
    maxDrawdown: round2(maxDd),
    numTrades: tradeReturns.length,
    winRate: tradeReturns.length > 0 ? Math.round((wins.length / tradeReturns.length) * 100) : 0,
    profitFactor: grossLoss > 0 ? round2(grossWin / grossLoss) : (grossWin > 0 ? 99 : 0),
    avgWin: wins.length > 0 ? round2(grossWin / wins.length) : 0,
    avgLoss: losses.length > 0 ? round2(-grossLoss / losses.length) : 0,
  };
}
