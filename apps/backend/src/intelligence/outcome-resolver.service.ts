/**
 * Orquestadores I/O del outcome-resolver: leen precios (Yahoo), aplican la lógica pura
 * de outcome-resolver.ts y persisten el veredicto. Se disparan una vez al día desde el cron.
 *
 * Separado de outcome-resolver.ts a propósito: ese archivo es puro y testeable sin tocar
 * la DB; este trae las dependencias de infraestructura.
 */
import { getHistoricalQuotes } from '../shared/yahoo.js';
import type { OHLC } from '@trading/shared';
import {
  getUnresolvedAnticipatoryAlerts,
  resolveAnticipatoryAlert,
  getUnresolvedCausalChains,
  resolveCausalChain,
} from '../db/repository.js';
import { resolveExpiredSignals } from '../opportunities/signal-tracking.service.js';
import { resolveAlertOutcome, resolveCausalOutcome } from './outcome-resolver.js';

const ALERT_HORIZON_DAYS = 14;
const CAUSAL_HORIZON_DAYS = 5;
/** Más allá de esto un evento ya no entra en el rango histórico que pedimos — se deja pending. */
const CAUSAL_MAX_AGE_DAYS = 80;

function today(): string {
  return new Date().toISOString().slice(0, 10);
}

function addDays(ymd: string, days: number): string {
  return new Date(Date.parse(ymd) + days * 86_400_000).toISOString().slice(0, 10);
}

/** Cache de velas por símbolo dentro de una corrida — varias alertas/cadenas comparten ticker. */
function makeCandleLoader() {
  const cache = new Map<string, Promise<OHLC[]>>();
  return (symbol: string): Promise<OHLC[]> => {
    let p = cache.get(symbol);
    if (!p) {
      p = getHistoricalQuotes(symbol, '3mo', '1d').catch(() => [] as OHLC[]);
      cache.set(symbol, p);
    }
    return p;
  };
}

/** Resuelve alertas anticipatorias: ¿la movida alcista anticipada ocurrió? */
export async function resolveAlerts(): Promise<{ resolved: number; triggered: number; missed: number; expired: number }> {
  const alerts = getUnresolvedAnticipatoryAlerts();
  const loadCandles = makeCandleLoader();
  const asOf = today();
  let triggered = 0, missed = 0, expired = 0;

  for (const alert of alerts) {
    try {
      const candles = await loadCandles(alert.symbol);
      if (candles.length === 0) continue;
      const res = resolveAlertOutcome(
        {
          entryPrice: alert.entryPrice ?? alert.currentPrice,
          takeProfit: alert.takeProfit ?? null,
          stopLoss: alert.stopLoss ?? null,
          firstSeenDate: alert.firstSeenDate,
        },
        candles,
        asOf,
        { horizonDays: ALERT_HORIZON_DAYS },
      );
      if (res.outcome === 'pending') continue;
      resolveAnticipatoryAlert(alert.id, {
        outcome: res.outcome,
        resolutionPrice: res.resolutionPrice,
        resolutionReturn: res.resolutionReturn,
      });
      if (res.outcome === 'triggered') triggered++;
      else if (res.outcome === 'missed') missed++;
      else expired++;
    } catch {
      // Skip on error, retry next run
    }
  }

  return { resolved: triggered + missed + expired, triggered, missed, expired };
}

/** Precio en (o inmediatamente antes de) la fecha del evento — base de la tesis causal. */
function entryCloseOn(candles: OHLC[], eventDate: string): number | null {
  const exact = candles.find((c) => c.date === eventDate);
  if (exact) return exact.close;
  const before = candles.filter((c) => c.date <= eventDate).sort((a, b) => a.date.localeCompare(b.date)).at(-1);
  return before ? before.close : null;
}

/** Resuelve cadenas causales: ¿la dirección que predijo la noticia acertó? */
export async function resolveCausalChains(): Promise<{ resolved: number; correct: number; incorrect: number; neutral: number }> {
  const asOf = today();
  const chains = getUnresolvedCausalChains(asOf, CAUSAL_HORIZON_DAYS);
  const loadCandles = makeCandleLoader();
  let correct = 0, incorrect = 0, neutral = 0;

  for (const chain of chains) {
    try {
      // Demasiado viejo para el rango histórico que pedimos — se deja pending.
      if (Date.parse(asOf) - Date.parse(chain.date) > CAUSAL_MAX_AGE_DAYS * 86_400_000) continue;

      const candles = await loadCandles(chain.ticker);
      if (candles.length === 0) continue;

      const entryPrice = entryCloseOn(candles, chain.date);
      if (entryPrice == null || entryPrice <= 0) continue;

      const windowEnd = addDays(chain.date, CAUSAL_HORIZON_DAYS);
      const window = candles.filter((c) => c.date > chain.date && c.date <= windowEnd);

      const res = resolveCausalOutcome(chain.direction, entryPrice, window, asOf, chain.date, {
        horizonDays: CAUSAL_HORIZON_DAYS,
      });
      if (res.outcome === 'pending') continue;

      resolveCausalChain(chain.id, {
        entryPrice,
        resolutionPrice: res.resolutionPrice,
        resolutionReturn: res.resolutionReturn,
        outcome: res.outcome,
      });
      if (res.outcome === 'correct') correct++;
      else if (res.outcome === 'incorrect') incorrect++;
      else neutral++;
    } catch {
      // Skip on error, retry next run
    }
  }

  return { resolved: correct + incorrect + neutral, correct, incorrect, neutral };
}

/**
 * Cierra el loop completo de "predicción vs realidad" en una pasada: señales, alertas
 * anticipatorias y cadenas causales de noticias. Llamado por el cron diario.
 */
export async function resolveDailyOutcomes(): Promise<{
  signals: number;
  alerts: { resolved: number; triggered: number; missed: number; expired: number };
  causal: { resolved: number; correct: number; incorrect: number; neutral: number };
}> {
  const signals = await resolveExpiredSignals();
  const alerts = await resolveAlerts();
  const causal = await resolveCausalChains();
  return { signals, alerts, causal };
}
