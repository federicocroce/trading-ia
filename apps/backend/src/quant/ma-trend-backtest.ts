/**
 * Motor de backtest de REGLA PURA de medias móviles (trend-following).
 *
 * Regla: comprar cuando el precio está por encima de TODAS las medias de entrada
 * (ej. SMA300 y SMA1000) y vender cuando cae por debajo de la media de salida (ej. SMA300).
 * Opcionalmente respeta stop-loss / take-profit duros.
 *
 * A diferencia del backtest por "score técnico", esto es una regla mecánica limpia y
 * auditable, con comisiones + slippage para que el número no mienta. 100% puro y testeable:
 * recibe velas, no toca red ni DB.
 */
import type { BacktestTrade, BacktestEquityPoint, BacktestMetrics } from '@trading/shared';

export interface Candle {
  date: string; // YYYY-MM-DD ascendente
  close: number;
}

export interface MaTrendConfig {
  /** El precio debe estar por encima de TODAS estas SMAs para entrar (ej. [300, 1000]). */
  entryMas: number[];
  /** Se sale cuando el precio cae por debajo de esta SMA (ej. 300). */
  exitMa: number;
  /** Comisión por transacción (compra y venta, cada una), en %. Default 0. */
  commissionPct?: number;
  /** Slippage por ejecución, en %. Empeora el precio de fill. Default 0. */
  slippagePct?: number;
  /** Stop-loss duro opcional, en % (sobre el precio de entrada). */
  stopLossPct?: number;
  /** Take-profit duro opcional, en %. */
  takeProfitPct?: number;
}

export interface BacktestResult {
  trades: BacktestTrade[];
  equityCurve: BacktestEquityPoint[];
  metrics: BacktestMetrics;
}

/** SMA de `period` cierres terminando en el índice i. null si no hay suficientes barras. */
function smaAt(closes: number[], i: number, period: number): number | null {
  if (i + 1 < period) return null;
  let sum = 0;
  for (let k = i - period + 1; k <= i; k++) sum += closes[k];
  return sum / period;
}

export function simulateMaTrend(symbol: string, candles: Candle[], cfg: MaTrendConfig): BacktestResult {
  const closes = candles.map((c) => c.close);
  const maxMa = Math.max(cfg.exitMa, ...cfg.entryMas);
  const slip = (cfg.slippagePct ?? 0) / 100;
  const comm = (cfg.commissionPct ?? 0) / 100;

  const trades: BacktestTrade[] = [];
  const equityCurve: BacktestEquityPoint[] = [];

  let portfolio = 100;        // valor de la cartera (parte líquida cuando no hay posición)
  let entryPortfolio = 0;     // valor de cartera al entrar (post-comisión)
  let entryFill = 0;          // precio de compra efectivo (con slippage)
  let inPosition = false;
  let entryDate = '';
  let peak = 100;
  let bhEntry: number | null = null;
  let bhValue = 100;

  for (let i = 0; i < candles.length; i++) {
    if (i + 1 < maxMa) continue; // warmup: la SMA más larga aún no existe
    const c = candles[i];
    const price = c.close;

    if (bhEntry === null) bhEntry = price;
    bhValue = 100 * (price / bhEntry);

    if (inPosition) portfolio = entryPortfolio * (price / entryFill);

    const aboveAllEntry = cfg.entryMas.every((n) => {
      const m = smaAt(closes, i, n);
      return m != null && price > m;
    });
    const belowExit = (() => {
      const m = smaAt(closes, i, cfg.exitMa);
      return m != null && price < m;
    })();

    if (!inPosition) {
      if (aboveAllEntry) {
        entryFill = price * (1 + slip);
        portfolio *= 1 - comm;
        entryPortfolio = portfolio;
        entryDate = c.date;
        inPosition = true;
      }
    } else {
      const unrealized = (price - entryFill) / entryFill;
      const hitStop = cfg.stopLossPct != null && unrealized <= -(cfg.stopLossPct / 100);
      const hitTarget = cfg.takeProfitPct != null && unrealized >= cfg.takeProfitPct / 100;
      if (hitStop || hitTarget || belowExit) {
        const sellFill = price * (1 - slip);
        const exitReason: BacktestTrade['exitReason'] = hitStop ? 'stop_loss' : hitTarget ? 'take_profit' : 'signal';
        portfolio = entryPortfolio * (sellFill / entryFill) * (1 - comm);
        trades.push(makeTrade(symbol, entryDate, c.date, entryFill, sellFill, exitReason));
        inPosition = false;
      }
    }

    peak = Math.max(peak, portfolio);
    const drawdown = peak > 0 ? ((peak - portfolio) / peak) * 100 : 0;
    equityCurve.push({
      date: c.date,
      portfolioValue: Math.round(portfolio * 100) / 100,
      buyAndHoldValue: Math.round(bhValue * 100) / 100,
      drawdownPercent: Math.round(drawdown * 100) / 100,
    });
  }

  // Cerrar posición abierta al final del período.
  if (inPosition && candles.length > 0) {
    const last = candles[candles.length - 1];
    const sellFill = last.close * (1 - slip);
    portfolio = entryPortfolio * (sellFill / entryFill) * (1 - comm);
    trades.push(makeTrade(symbol, entryDate, last.date, entryFill, sellFill, 'end_of_period'));
  }

  return { trades, equityCurve, metrics: computeMetrics(equityCurve, trades) };
}

function makeTrade(
  symbol: string, entryDate: string, exitDate: string, entryPrice: number, exitPrice: number,
  exitReason: BacktestTrade['exitReason'],
): BacktestTrade {
  return {
    symbol, entryDate, exitDate,
    entryPrice: Math.round(entryPrice * 1e6) / 1e6,
    exitPrice: Math.round(exitPrice * 1e6) / 1e6,
    returnPercent: Math.round(((exitPrice - entryPrice) / entryPrice) * 10000) / 100,
    exitReason,
  };
}

export function computeMetrics(equityCurve: BacktestEquityPoint[], trades: BacktestTrade[]): BacktestMetrics {
  if (equityCurve.length === 0) {
    return { totalReturnPercent: 0, buyAndHoldReturnPercent: 0, sharpeRatio: 0, maxDrawdownPercent: 0, winRate: 0, numTrades: 0, avgTradeDurationDays: 0 };
  }
  const last = equityCurve[equityCurve.length - 1];
  const maxDrawdown = equityCurve.reduce((m, p) => Math.max(m, p.drawdownPercent), 0);

  const dailyReturns: number[] = [];
  for (let i = 1; i < equityCurve.length; i++) {
    const prev = equityCurve[i - 1].portfolioValue;
    if (prev > 0) dailyReturns.push((equityCurve[i].portfolioValue - prev) / prev);
  }
  const avgR = dailyReturns.length > 0 ? dailyReturns.reduce((a, b) => a + b, 0) / dailyReturns.length : 0;
  const variance = dailyReturns.reduce((s, r) => s + (r - avgR) ** 2, 0) / (dailyReturns.length || 1);
  const stdDev = Math.sqrt(variance);
  const sharpe = stdDev > 0 ? (avgR / stdDev) * Math.sqrt(252) : 0;

  const winners = trades.filter((t) => t.returnPercent > 0).length;
  const winRate = trades.length > 0 ? winners / trades.length : 0;
  let totalDays = 0;
  for (const t of trades) totalDays += (Date.parse(t.exitDate) - Date.parse(t.entryDate)) / 86_400_000;

  return {
    totalReturnPercent: Math.round((last.portfolioValue - 100) * 100) / 100,
    buyAndHoldReturnPercent: Math.round((last.buyAndHoldValue - 100) * 100) / 100,
    sharpeRatio: Math.round(sharpe * 100) / 100,
    maxDrawdownPercent: Math.round(maxDrawdown * 100) / 100,
    winRate: Math.round(winRate * 100) / 100,
    numTrades: trades.length,
    avgTradeDurationDays: trades.length > 0 ? Math.round(totalDays / trades.length) : 0,
  };
}
