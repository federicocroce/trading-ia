/**
 * Veredicto único por posición, con STOP DINÁMICO que se recalcula solo según el precio.
 *
 * Jerarquía de decisión (tres niveles, en este orden):
 *   1. Stop tocado (o cerrado abajo) ⇒ VENDER. Prioridad máxima, aunque el motor diga BUY.
 *   2. Motor SELL sin stop tocado ⇒ REVISAR. El motor advierte (ej. divergencia) pero tu regla
 *      dura (el stop) todavía no se activó — nunca se esconde como un MANTENER a secas: las
 *      dos fuentes (motor + stop) quedan nombradas en el reason para que decidas vos.
 *   3. Motor HOLD/BUY sin stop tocado ⇒ MANTENER. Dejá correr al ganador.
 *
 * Puro y testeable: sin DB ni red. La parte de I/O vive en today-decisions.service.ts.
 */

import type { TimingView } from '@trading/shared';

export type PortfolioVerb = 'MANTENER' | 'REVISAR' | 'VENDER';
export type ScanAction = 'BUY' | 'SELL' | 'HOLD' | 'WATCH';

/**
 * Coherencia entre secciones (objetivo #4 del prompt maestro): si la tarjeta de Hoy marca
 * el papel como OPERABLE pero la vista de timing del mismo scan dice SELL, esa
 * contradicción tiene que viajar CON la tarjeta — no quedar escondida en el detalle
 * (caso DAL 2026-07-06).
 *
 * Es advertencia, no gate: el timing NO degrada el verbo porque no hay evidencia medida
 * de su poder predictivo todavía (sección 4 del prompt maestro — medir antes de dar veto).
 * Fail-closed en el otro sentido: sin timingView no se inventa advertencia.
 * Solo aplica a OPERABLE: sobre un EN ESPERA la advertencia es redundante (ya está marcado).
 */
export function timingCaveatFor(
  verb: 'OPERABLE' | 'EN SEGUIMIENTO' | 'EN ESPERA',
  timing?: TimingView | null,
): string | undefined {
  if (verb !== 'OPERABLE' || !timing || timing.action !== 'SELL') return undefined;

  const bearish = (timing.triggers ?? []).filter((t) => t.direction === 'bearish');
  // El trigger de mayor impacto le pone nombre concreto a la advertencia.
  const top = bearish.find((t) => t.impact === 'high') ?? bearish[0];
  const detail = top ? ` — ${top.description}` : '';
  return `El timing de corto plazo contradice la compra: la vista técnica dice VENDER (${timing.confidence}%)${detail}. Papel válido, momento estirado — considerá esperar el retroceso.`;
}

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
  /** El motor marcó SELL hoy (ej. divergencia). Es advertencia, no orden: el stop decide. */
  engineWarnsSell?: boolean;
  /** Motivo del SELL del motor (ej. "divergencia bajista semanal"). Se nombra en el REVISAR. */
  engineSellReason?: string;
  /**
   * Cierre confirmado (última vela diaria cerrada) con el que se DECIDE VENDER.
   * El backtest 7y muestra que decidir por cierre (no por toque intradiario) gana en 11/11
   * y corta whipsaws. Si se omite, cae al comportamiento viejo (decide por currentPrice).
   */
  closePrice?: number;
  /** Mercado en sesión: el currentPrice es spot provisional, un toque NO confirma venta. */
  intraday?: boolean;
  /**
   * El precio NO vino de una cotización viva (falló el fetch y se cayó al último scan).
   * Un stop es una comparación contra el precio de HOY: con un precio viejo no se sabe si se
   * perforó, y la regla dura #1 exige decirlo en vez de elegir entre inventar una venta o
   * dejar pasar en silencio. AD-015.
   */
  priceIsStale?: boolean;
  /** Fecha del precio usado cuando es viejo (YYYY-MM-DD). null si ni eso se sabe. */
  priceAsOf?: string | null;
}

/**
 * De dónde sale el precio con el que se juzga el stop, y si eso es de hoy o no (AD-015).
 * Antes era una cadena de `??` dentro del servicio: cuando la cotización fallaba, el precio del
 * último scan entraba en silencio y el veredicto salía como si fuera del día.
 * Fail-closed: sin ninguna fuente devuelve null — el llamador tiene que REPORTAR la posición
 * como no evaluada, nunca saltearla.
 */
export function resolvePositionPrice(
  quote: { current?: number | null } | undefined,
  scanned: { currentPrice?: number | null } | undefined,
  scanDate: string | null,
): { price: number; isStale: boolean; asOf: string | null } | null {
  const vivo = quote?.current;
  if (typeof vivo === 'number' && Number.isFinite(vivo) && vivo > 0) {
    return { price: vivo, isStale: false, asOf: null };
  }
  const viejo = scanned?.currentPrice;
  if (typeof viejo === 'number' && Number.isFinite(viejo) && viejo > 0) {
    return { price: viejo, isStale: true, asOf: scanDate };
  }
  return null;
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
  const { avgCost, currentPrice, trailingStop, target, engineWarnsSell, engineSellReason, closePrice, intraday, priceIsStale, priceAsOf } = input;
  const gainPct = round2(((currentPrice - avgCost) / avgCost) * 100);
  const tgt = target ?? null;
  // Se DECIDE por el cierre confirmado; el spot vivo solo informa gain%/aviso intradiario.
  const decisionPrice = closePrice ?? currentPrice;

  // FAIL-CLOSED (AD-015): antes que cualquier otra rama. Con un precio que no es de hoy no se
  // puede afirmar ni que el stop se perforó ni que no — las dos salidas serían inventadas.
  if (priceIsStale) {
    const cuando = priceAsOf ? `del ${priceAsOf}` : 'de fecha desconocida';
    const dondeQuedo = trailingStop != null
      ? (decisionPrice <= trailingStop
        ? ` Con ese precio ($${round2(decisionPrice)}) estarías BAJO el stop $${trailingStop}.`
        : ` Con ese precio ($${round2(decisionPrice)}) estabas arriba del stop $${trailingStop}.`)
      : ' Tampoco pude recalcular el stop.';
    return {
      verb: 'REVISAR',
      reason: `No pude cotizar hoy: el último precio disponible es ${cuando}. Revisá el precio real antes de decidir.`,
      stop: trailingStop,
      target: tgt,
      gainPct,
      warning: `Precio ${cuando}, no de hoy — no pude confirmar contra el stop.${dondeQuedo} La app NO está vigilando esta posición hasta que vuelva a cotizar.`,
    };
  }

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

  if (trailingStop == null) {
    // Sin stop no hay una regla dura con la que confrontar al motor — se avisa, no se decide.
    const warning = engineWarnsSell
      ? 'El motor ve deterioro (divergencia) — es una advertencia, no una orden. No pude recalcular el stop para confrontarla: revisá manualmente.'
      : undefined;
    return { verb: 'MANTENER', reason: 'No pude recalcular el stop (faltan datos de precio). Mantené y revisá.', stop: null, target: tgt, gainPct, warning };
  }

  // Nivel 2 de la jerarquía: el motor advierte SELL pero el stop (regla dura) no se tocó.
  // Ya no se degrada a un warning oculto dentro de un MANTENER — se nombra como REVISAR con
  // ambas fuentes explícitas (el motivo del motor y el stop duro) para que la persona decida.
  if (engineWarnsSell) {
    return {
      verb: 'REVISAR',
      reason: `El motor recomienda salir${engineSellReason ? ` (${engineSellReason})` : ''}. Tu regla dura es el stop en $${trailingStop} — decidí: vender ya o ajustar el stop.`,
      stop: trailingStop,
      target: tgt,
      gainPct,
    };
  }

  return {
    verb: 'MANTENER',
    reason: `Dejá correr. Tu stop sube solo a $${trailingStop}${tgt != null ? ` y el objetivo es $${tgt}` : ''} — salís solo si el precio lo toca.`,
    stop: trailingStop,
    target: tgt,
    gainPct,
  };
}
