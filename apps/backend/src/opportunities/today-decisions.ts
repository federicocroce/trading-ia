/**
 * Veredicto único por posición, con STOP DINÁMICO que se recalcula solo según el precio.
 *
 * Principio: dejá correr los ganadores. El stop SUBE atrás del precio (trailing chandelier);
 * mientras el precio esté por encima, MANTENER. Solo VENDER cuando el precio realmente se da
 * vuelta y toca ese stop. Una señal SELL del motor (ej. divergencia) NO te saca de un ganador:
 * es una advertencia; el stop decide.
 *
 * Puro y testeable: sin DB ni red. La parte de I/O vive en today-decisions.service.ts.
 */

export type PortfolioVerb = 'MANTENER' | 'VENDER';
export type ScanAction = 'BUY' | 'SELL' | 'HOLD' | 'WATCH';

export interface Candle {
  date: string;
  high: number;
  low: number;
  close: number;
}

/**
 * Trailing stop estilo "chandelier exit": mayor máximo de las últimas `period` velas menos
 * `atrMult` × ATR(period). Sube cuando la acción hace nuevos máximos; no baja. Es el stop que
 * deja correr al ganador y lo saca solo si revierte.
 */
export function computeTrailingStop(
  candles: Candle[],
  opts: { period?: number; atrMult?: number } = {},
): number | null {
  const period = opts.period ?? 22;
  const atrMult = opts.atrMult ?? 3;
  if (candles.length < period + 1) return null;

  const window = candles.slice(-period);
  const highestHigh = Math.max(...window.map((c) => c.high));

  // ATR(period): media del true range sobre las últimas `period` velas.
  let trSum = 0;
  for (let i = candles.length - period; i < candles.length; i++) {
    const cur = candles[i];
    const prevClose = candles[i - 1].close;
    const tr = Math.max(cur.high - cur.low, Math.abs(cur.high - prevClose), Math.abs(cur.low - prevClose));
    trSum += tr;
  }
  const atr = trSum / period;

  return Math.round((highestHigh - atrMult * atr) * 100) / 100;
}

export interface PositionInput {
  avgCost: number;
  currentPrice: number;
  /** Stop dinámico recalculado (chandelier). null si no hay datos suficientes. */
  trailingStop: number | null;
  /** Objetivo recalculado (resistencia o proyección). */
  target?: number | null;
  /** El motor marcó SELL hoy (ej. divergencia). Es advertencia, no orden. */
  engineWarnsSell?: boolean;
  /**
   * Cierre confirmado (última vela diaria cerrada) con el que se DECIDE VENDER.
   * El backtest 7y muestra que decidir por cierre (no por toque intradiario) gana en 11/11
   * y corta whipsaws. Si se omite, cae al comportamiento viejo (decide por currentPrice).
   */
  closePrice?: number;
  /** Mercado en sesión: el currentPrice es spot provisional, un toque NO confirma venta. */
  intraday?: boolean;
}

export interface PositionVerdict {
  verb: PortfolioVerb;
  reason: string;
  stop: number | null;
  target: number | null;
  gainPct: number;
  warning?: string;
}

const round2 = (n: number) => Math.round(n * 100) / 100;

export function decidePositionVerb(input: PositionInput): PositionVerdict {
  const { avgCost, currentPrice, trailingStop, target, engineWarnsSell, closePrice, intraday } = input;
  const gainPct = round2(((currentPrice - avgCost) / avgCost) * 100);
  const tgt = target ?? null;
  // Se DECIDE por el cierre confirmado; el spot vivo solo informa gain%/aviso intradiario.
  const decisionPrice = closePrice ?? currentPrice;

  if (trailingStop != null && decisionPrice <= trailingStop) {
    const breach = closePrice != null ? 'Cerró bajo' : 'Tocó';
    return {
      verb: 'VENDER',
      reason: `${breach} tu stop dinámico $${trailingStop} — el precio se dio vuelta. Salí para proteger ${gainPct >= 0 ? 'la ganancia' : 'capital'}.`,
      stop: trailingStop,
      target: tgt,
      gainPct,
    };
  }

  // En sesión, un toque del spot NO confirma venta: se avisa, pero el cierre decide.
  if (intraday && trailingStop != null && currentPrice <= trailingStop) {
    return {
      verb: 'MANTENER',
      reason: `Dejá correr. Tu stop está en $${trailingStop}${tgt != null ? ` y el objetivo es $${tgt}` : ''} — salís solo si CIERRA abajo.`,
      stop: trailingStop,
      target: tgt,
      gainPct,
      warning: `Intradiario tocó tu stop $${trailingStop}, pero todavía no cerró abajo. La venta se confirma solo si CIERRA bajo el stop — esperá el cierre.`,
    };
  }

  const warning = engineWarnsSell
    ? 'El motor ve deterioro (divergencia) — es una advertencia, no una orden. El stop decide.'
    : undefined;

  if (trailingStop == null) {
    return { verb: 'MANTENER', reason: 'No pude recalcular el stop (faltan datos de precio). Mantené y revisá.', stop: null, target: tgt, gainPct, warning };
  }

  return {
    verb: 'MANTENER',
    reason: `Dejá correr. Tu stop sube solo a $${trailingStop}${tgt != null ? ` y el objetivo es $${tgt}` : ''} — salís solo si el precio lo toca.`,
    stop: trailingStop,
    target: tgt,
    gainPct,
    warning,
  };
}
