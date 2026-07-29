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

export interface BuyHoldMetrics {
  totalReturn: number;   // %
  maxDrawdown: number;   // %
}

/**
 * Comprar en la primera vela operable y no hacer nada más. Es la ALTERNATIVA REAL contra la que
 * hay que medir cualquier regla de salida: una estrategia que gana menos que esto destruye valor
 * aunque le gane a la otra regla.
 *
 * Fail-closed: una serie que no permite calcular un retorno honesto devuelve null. JAMÁS un 0,
 * que en el agregado se leería como "no aportó" en vez de "no se sabe".
 */
export function buyHoldMetrics(closes: number[]): BuyHoldMetrics | null {
  if (closes.length < 2) return null;
  if (closes.some((c) => !Number.isFinite(c) || c <= 0)) return null;

  let peak = -Infinity;
  let maxDd = 0;
  for (const c of closes) {
    peak = Math.max(peak, c);
    maxDd = Math.max(maxDd, ((peak - c) / peak) * 100);
  }

  return {
    totalReturn: round2((closes[closes.length - 1] / closes[0] - 1) * 100),
    maxDrawdown: round2(maxDd),
  };
}

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
