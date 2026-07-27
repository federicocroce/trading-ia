/**
 * Outcome resolver — la máquina única que mide "predicción vs realidad" para las tres
 * cosas que el sistema afirma anticipar:
 *   1. Señales trackeadas  → win/loss/neutral (vive en signal-tracking.service.ts)
 *   2. Alertas anticipatorias → triggered/missed/expired (¿el movimiento anticipado ocurrió?)
 *   3. Cadenas causales de noticias → correct/incorrect/neutral (¿la dirección predicha acertó?)
 *
 * Este archivo contiene la LÓGICA PURA (sin I/O), 100% testeable. Los orquestadores que
 * leen precios y persisten viven al final, separados, y se disparan desde el cron diario.
 */

export interface PriceCandle {
  date: string; // YYYY-MM-DD
  high: number;
  low: number;
  close: number;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Días calendario entre dos fechas YYYY-MM-DD (parseadas como UTC midnight). */
function daysBetween(fromYmd: string, toYmd: string): number {
  return Math.floor((Date.parse(toYmd) - Date.parse(fromYmd)) / 86_400_000);
}

function pctChange(from: number, to: number): number {
  return ((to - from) / from) * 100;
}

// ---------------------------------------------------------------------------
// 1) Alertas anticipatorias
// ---------------------------------------------------------------------------

export type AlertOutcome = 'triggered' | 'missed' | 'expired' | 'pending';

export interface AlertResolutionInput {
  entryPrice: number;
  takeProfit?: number | null;
  stopLoss?: number | null;
  firstSeenDate: string; // YYYY-MM-DD — el día del setup; los hits se miden DESPUÉS
}

export interface AlertResolution {
  outcome: AlertOutcome;
  resolutionPrice: number | null;
  resolutionReturn: number | null; // % vs entryPrice
  resolvedDate: string | null;
}

export interface AlertResolveOpts {
  /** Ventana de anticipación en días calendario. Pasada esta, sin hit ⇒ expired. */
  horizonDays?: number;
  /** Banda fallback (%) cuando no hay takeProfit/stopLoss explícitos. */
  fallbackBandPct?: number;
}

/**
 * ¿El movimiento alcista anticipado ocurrió? Camina las velas POSTERIORES al setup:
 *   - high ≥ target  ⇒ triggered (la movida llegó)
 *   - low  ≤ stop    ⇒ missed    (fue para el otro lado / falló)
 *   - una vela que toca ambos: conservador ⇒ missed (asumimos stop-first, peor caso)
 *   - nada y venció el horizonte ⇒ expired
 *   - nada y aún dentro del horizonte ⇒ pending
 */
export function resolveAlertOutcome(
  input: AlertResolutionInput,
  candles: PriceCandle[],
  asOfDate: string,
  opts: AlertResolveOpts = {},
): AlertResolution {
  const horizonDays = opts.horizonDays ?? 14;
  const fallbackBandPct = opts.fallbackBandPct ?? 4;

  const target = input.takeProfit ?? input.entryPrice * (1 + fallbackBandPct / 100);
  const stop = input.stopLoss ?? input.entryPrice * (1 - fallbackBandPct / 100);

  const after = candles
    .filter((c) => c.date > input.firstSeenDate)
    .sort((a, b) => a.date.localeCompare(b.date));

  for (const c of after) {
    const hitTarget = c.high >= target;
    const hitStop = c.low <= stop;

    if (hitTarget && hitStop) {
      return { outcome: 'missed', resolutionPrice: stop, resolutionReturn: pctChange(input.entryPrice, stop), resolvedDate: c.date };
    }
    if (hitTarget) {
      return { outcome: 'triggered', resolutionPrice: target, resolutionReturn: pctChange(input.entryPrice, target), resolvedDate: c.date };
    }
    if (hitStop) {
      return { outcome: 'missed', resolutionPrice: stop, resolutionReturn: pctChange(input.entryPrice, stop), resolvedDate: c.date };
    }
  }

  if (daysBetween(input.firstSeenDate, asOfDate) >= horizonDays) {
    const last = after.at(-1);
    if (!last) return { outcome: 'expired', resolutionPrice: null, resolutionReturn: null, resolvedDate: null };
    return { outcome: 'expired', resolutionPrice: last.close, resolutionReturn: pctChange(input.entryPrice, last.close), resolvedDate: last.date };
  }

  return { outcome: 'pending', resolutionPrice: null, resolutionReturn: null, resolvedDate: null };
}

// ---------------------------------------------------------------------------
// 2) Cadenas causales de noticias
// ---------------------------------------------------------------------------

export type CausalOutcome = 'correct' | 'incorrect' | 'neutral' | 'pending';

export interface CausalResolution {
  outcome: CausalOutcome;
  resolutionPrice: number | null;
  resolutionReturn: number | null; // % vs entryPrice (precio en la fecha del evento)
}

export interface CausalResolveOpts {
  /** Días calendario que deben pasar para que la tesis se pueda evaluar. */
  horizonDays?: number;
  /** Movimiento mínimo (%) para no considerarlo "ruido" (neutral). */
  moveThresholdPct?: number;
}

/**
 * ¿La dirección predicha por la cadena causal acertó? Compara el precio en la fecha del
 * evento contra el cierre al final de la ventana. Movimiento dentro del umbral ⇒ neutral
 * (la noticia no movió nada apreciable, ni a favor ni en contra de la tesis).
 */
export function resolveCausalOutcome(
  direction: 'positive' | 'negative',
  entryPrice: number,
  candles: PriceCandle[],
  asOfDate: string,
  eventDate: string,
  opts: CausalResolveOpts = {},
): CausalResolution {
  const horizonDays = opts.horizonDays ?? 5;
  const moveThresholdPct = opts.moveThresholdPct ?? 2;

  if (candles.length === 0 || daysBetween(eventDate, asOfDate) < horizonDays) {
    return { outcome: 'pending', resolutionPrice: null, resolutionReturn: null };
  }

  const sorted = [...candles].sort((a, b) => a.date.localeCompare(b.date));
  const lastClose = sorted.at(-1)!.close;
  const ret = pctChange(entryPrice, lastClose);

  if (Math.abs(ret) < moveThresholdPct) {
    return { outcome: 'neutral', resolutionPrice: lastClose, resolutionReturn: ret };
  }

  const movedUp = ret > 0;
  const correct = (direction === 'positive' && movedUp) || (direction === 'negative' && !movedUp);
  return { outcome: correct ? 'correct' : 'incorrect', resolutionPrice: lastClose, resolutionReturn: ret };
}

// ---------------------------------------------------------------------------
// 3) Señales trackeadas (signal_tracking) — reemplaza la lógica rota que
//    evaluaba WATCH/HOLD como shorts (caso SDOT: win automático cayendo -72%).
// ---------------------------------------------------------------------------

export type SignalOutcome = 'win' | 'loss' | 'neutral' | 'pending' | 'invalid';

export interface TrackedSignalInput {
  action: 'BUY' | 'SELL' | 'HOLD' | 'WATCH';
  entryPrice: number;
  targetPrice?: number | null;
  stopLoss?: number | null;
  signalDate: string; // YYYY-MM-DD
}

export interface TrackedSignalOpts {
  /** Días para resolución definitiva por horizonte. */
  horizonDays?: number;
  /** Banda (%) dentro de la cual el resultado es neutral. */
  neutralBandPct?: number;
  /** Retorno absoluto (%) por encima del cual los datos se consideran rotos (splits). */
  maxPlausibleReturnPct?: number;
}

export interface TrackedSignalResolution {
  outcome: SignalOutcome;
  resolutionPrice: number | null;
  resolutionReturn: number | null; // % a favor de la dirección de la señal
  hitTarget: boolean;
  hitStop: boolean;
  resolvedDate: string | null;
}

/**
 * Resuelve una señal trackeada caminando las velas POSTERIORES a la fecha de señal.
 * Reglas:
 *   - SOLO SELL se mide como short. BUY/HOLD/WATCH son tesis alcistas.
 *   - Target/stop incoherentes con la dirección se ignoran (defensa vs niveles absurdos).
 *   - Stop y target en la misma vela ⇒ conservador: loss (asumimos stop-first).
 *   - Retorno implausible ⇒ invalid (split sin ajustar / feed roto), nunca win/loss.
 */
export function resolveTrackedSignal(
  input: TrackedSignalInput,
  candles: PriceCandle[],
  asOfDate: string,
  opts: TrackedSignalOpts = {},
): TrackedSignalResolution {
  const horizonDays = opts.horizonDays ?? 30;
  const neutralBandPct = opts.neutralBandPct ?? 2;
  const maxPlausible = opts.maxPlausibleReturnPct ?? 200;

  const isShort = input.action === 'SELL';
  const none: TrackedSignalResolution = {
    outcome: 'pending', resolutionPrice: null, resolutionReturn: null,
    hitTarget: false, hitStop: false, resolvedDate: null,
  };

  const after = candles
    .filter((c) => c.date > input.signalDate)
    .sort((a, b) => a.date.localeCompare(b.date));
  if (after.length === 0) {
    return daysBetween(input.signalDate, asOfDate) >= horizonDays
      ? { ...none, outcome: 'invalid' } // horizonte vencido y sin datos = no evaluable
      : none;
  }

  // Niveles coherentes con la dirección; si no lo son, se ignoran.
  const target =
    input.targetPrice != null && (isShort ? input.targetPrice < input.entryPrice : input.targetPrice > input.entryPrice)
      ? input.targetPrice : null;
  const stop =
    input.stopLoss != null && (isShort ? input.stopLoss > input.entryPrice : input.stopLoss < input.entryPrice)
      ? input.stopLoss : null;

  for (const c of after) {
    // Sanity por vela: candle incoherente con el entry (split sin ajustar / feed
    // roto) invalida el tracking entero — nunca resolver win/loss con datos corruptos.
    if (Math.abs(pctChange(input.entryPrice, c.close)) > maxPlausible) {
      return { ...none, outcome: 'invalid', resolutionPrice: c.close, resolvedDate: c.date };
    }

    const hitTarget = target != null && (isShort ? c.low <= target : c.high >= target);
    const hitStop = stop != null && (isShort ? c.high >= stop : c.low <= stop);

    if (hitStop) {
      // stop-first también cuando la misma vela toca ambos (conservador)
      const ret = pctChange(input.entryPrice, stop!);
      return {
        outcome: 'loss', resolutionPrice: stop!, resolutionReturn: isShort ? -ret : ret,
        hitTarget: false, hitStop: true, resolvedDate: c.date,
      };
    }
    if (hitTarget) {
      const ret = pctChange(input.entryPrice, target!);
      return {
        outcome: 'win', resolutionPrice: target!, resolutionReturn: isShort ? -ret : ret,
        hitTarget: true, hitStop: false, resolvedDate: c.date,
      };
    }
  }

  if (daysBetween(input.signalDate, asOfDate) < horizonDays) return none;

  const last = after.at(-1)!;
  const ret = pctChange(input.entryPrice, last.close);
  const dirRet = isShort ? -ret : ret;
  const outcome: SignalOutcome =
    dirRet > neutralBandPct ? 'win' : dirRet < -neutralBandPct ? 'loss' : 'neutral';
  return {
    outcome, resolutionPrice: last.close, resolutionReturn: dirRet,
    hitTarget: false, hitStop: false, resolvedDate: last.date,
  };
}

/**
 * R-múltiplo: retorno medido en unidades de riesgo asumido (distancia entry→stop).
 * +2R = ganaste el doble de lo que arriesgabas. Es la métrica de expectancy real:
 * un sistema con 37% de aciertos y salidas a +2R es rentable; % de aciertos solo, no dice nada.
 */
export function computeRMultiple(
  action: 'BUY' | 'SELL' | 'HOLD' | 'WATCH',
  entryPrice: number,
  stopLoss: number | null | undefined,
  resolutionPrice: number,
): number | null {
  if (stopLoss == null || entryPrice <= 0) return null;
  const isShort = action === 'SELL';
  const risk = isShort ? stopLoss - entryPrice : entryPrice - stopLoss;
  if (risk <= 0) return null; // stop incoherente con la dirección
  const move = isShort ? entryPrice - resolutionPrice : resolutionPrice - entryPrice;
  return Math.round((move / risk) * 100) / 100;
}

// ---------------------------------------------------------------------------
// 4) Benchmark — el costo de oportunidad de NO haber comprado el índice.
//
// Una señal con retorno positivo puede seguir siendo una mala decisión si el
// índice rindió más en la misma ventana. Sin esta medición el sistema es ciego
// a su propio costo de oportunidad: mide contra cero en vez de contra la
// alternativa real (comprar SPY y no hacer nada).
// ---------------------------------------------------------------------------

/**
 * Máximo de días calendario que puede alejarse la vela elegida de la fecha pedida.
 * Cubre fines de semana largos y feriados; más que eso significa que la serie NO
 * cubre la ventana y el dato no existe (fail-closed) en vez de medir otra ventana.
 */
const BENCHMARK_MAX_GAP_DAYS = 7;

/** Primera vela EN O DESPUÉS de la fecha (cubre feriados y fines de semana). */
function closeOnOrAfter(candles: PriceCandle[], date: string): number | null {
  let best: PriceCandle | null = null;
  for (const c of candles) {
    if (c.date >= date && (best === null || c.date < best.date)) best = c;
  }
  if (best == null || best.close <= 0) return null;
  // Vela demasiado lejos = la serie no cubre esa punta de la ventana.
  if (daysBetween(date, best.date) > BENCHMARK_MAX_GAP_DAYS) return null;
  return best.close;
}

/**
 * Retorno % del benchmark en la MISMA ventana que la señal [signalDate, resolutionDate].
 * Fail-closed: si falta cualquiera de las dos puntas devuelve null — jamás 0, que
 * se leería como "el índice no se movió" y regalaría alpha inexistente.
 */
export function computeBenchmarkReturn(
  signalDate: string,
  resolutionDate: string,
  benchmarkCandles: PriceCandle[],
): number | null {
  if (resolutionDate < signalDate) return null;
  const start = closeOnOrAfter(benchmarkCandles, signalDate);
  const end = closeOnOrAfter(benchmarkCandles, resolutionDate);
  if (start == null || end == null) return null;
  return pctChange(start, end);
}

/**
 * Exceso de retorno de la señal sobre el benchmark en la misma ventana.
 * `signalReturn` va DIRECCIONAL (a favor de la señal, como `resolutionReturn`):
 * el capital estuvo desplegado en la señal en vez de en el índice, así que un
 * short que gana 3% mientras el índice sube 5% igual destruyó valor relativo.
 * Fail-closed en null.
 */
export function computeAlpha(
  signalReturn: number | null | undefined,
  benchmarkReturn: number | null | undefined,
): number | null {
  if (signalReturn == null || benchmarkReturn == null) return null;
  return Math.round((signalReturn - benchmarkReturn) * 10_000) / 10_000;
}

/**
 * Campos de benchmark listos para `resolveSignal`, en una sola llamada.
 *
 * Existe para que NINGÚN resolver pueda cerrar una señal sin alpha. `signal_tracking` tiene
 * DOS productores que comparten la misma cola (`getPendingSignals`): el path-aware de
 * `opportunities/signal-tracking.service.ts` y el de `evidence-signals/signal-resolver.service.ts`.
 * Si solo uno calculara el benchmark, la columna quedaría con agujeros justo en las filas que
 * gana el otro — y el agujero sería invisible (null se lee igual que "sin cobertura").
 *
 * `signalReturn` va DIRECCIONAL (a favor de la señal). Fail-closed: sin fecha de resolución,
 * sin serie o sin cobertura, los tres campos salen null juntos y coherentes.
 */
export function benchmarkFields(
  signalDate: string,
  resolutionDate: string | null,
  benchmarkCandles: PriceCandle[] | null,
  signalReturn: number | null,
  symbol: string,
): {
  resolutionDate: string | null;
  benchmarkSymbol: string | null;
  benchmarkReturn: number | null;
  alphaVsBenchmark: number | null;
} {
  if (resolutionDate == null || benchmarkCandles == null || benchmarkCandles.length === 0) {
    return { resolutionDate, benchmarkSymbol: null, benchmarkReturn: null, alphaVsBenchmark: null };
  }
  const benchmarkReturn = computeBenchmarkReturn(signalDate, resolutionDate, benchmarkCandles);
  return {
    resolutionDate,
    benchmarkSymbol: benchmarkReturn != null ? symbol : null,
    benchmarkReturn,
    alphaVsBenchmark: computeAlpha(signalReturn, benchmarkReturn),
  };
}
