import { getPendingSignals, resolveSignal } from '../db/repository.js';
import { getHistoricalQuotes, getQuote } from '../shared/yahoo.js';

const DAYS_7 = 7 * 24 * 60 * 60 * 1000;
const DAYS_30 = 30 * 24 * 60 * 60 * 1000;

let resolving = false;

/**
 * Returns price closest to targetDate from an OHLC array.
 */
function priceAtDate(ohlc: Array<{ date: string; close: number; high: number; low: number }>, targetDate: Date): number | null {
  if (!ohlc.length) return null;
  const targetTs = targetDate.getTime();
  const sorted = [...ohlc].sort((a, b) => {
    const da = Math.abs(new Date(a.date).getTime() - targetTs);
    const db = Math.abs(new Date(b.date).getTime() - targetTs);
    return da - db;
  });
  return sorted[0].close;
}

/**
 * Checks if targetPrice was hit by any high/low in the 30d window.
 * Returns the date of first hit, or null.
 */
function firstHitDate(
  ohlc: Array<{ date: string; high: number; low: number }>,
  signalTs: number,
  targetPrice: number | null,
  stopLoss: number | null,
): { targetHitAt: string | null; stopHitAt: string | null } {
  const window = ohlc.filter((c) => {
    const ts = new Date(c.date).getTime();
    return ts >= signalTs && ts <= signalTs + DAYS_30;
  });

  let targetHitAt: string | null = null;
  let stopHitAt: string | null = null;

  for (const candle of window.sort((a, b) => new Date(a.date).getTime() - new Date(b.date).getTime())) {
    if (!targetHitAt && targetPrice != null && candle.high >= targetPrice) {
      targetHitAt = candle.date;
    }
    if (!stopHitAt && stopLoss != null && candle.low <= stopLoss) {
      stopHitAt = candle.date;
    }
  }

  return { targetHitAt, stopHitAt };
}

/** Compute max drawdown from entry price across an OHLC window. */
function maxDrawdownPct(
  ohlc: Array<{ date: string; low: number }>,
  signalTs: number,
  entryPrice: number,
): number | null {
  const window = ohlc.filter((c) => new Date(c.date).getTime() >= signalTs);
  if (!window.length || entryPrice <= 0) return null;
  const worstLow = Math.min(...window.map((c) => c.low));
  return Math.round(((worstLow - entryPrice) / entryPrice) * 10000) / 100;
}

async function resolveOne(signal: ReturnType<typeof getPendingSignals>[0]): Promise<void> {
  // Only resolve evidence-v2 signals
  if (signal.sector !== 'evidence-v2') return;

  const signalTs = new Date(signal.signalDate).getTime();
  const now = Date.now();
  const ageMs = now - signalTs;

  // Not old enough to resolve 7d yet
  if (ageMs < DAYS_7) return;

  const is30dOld = ageMs >= DAYS_30;

  try {
    // Fetch OHLC regardless of age — needed for early hit detection
    const ohlc = await getHistoricalQuotes(signal.symbol, '3mo', '1d');

    // EARLY RESOLUTION: check if target/stop already hit before 30 days
    if (!is30dOld && (signal.targetPrice || signal.stopLoss)) {
      const { targetHitAt, stopHitAt } = firstHitDate(ohlc, signalTs, signal.targetPrice ?? null, signal.stopLoss ?? null);
      if (targetHitAt || stopHitAt) {
        const firstTarget = targetHitAt ? new Date(targetHitAt) : null;
        const firstStop = stopHitAt ? new Date(stopHitAt) : null;
        const bothHit = firstTarget && firstStop;
        const targetWins = bothHit ? firstTarget! < firstStop! : !!firstTarget;
        const hitTs = (targetWins ? firstTarget : firstStop)!.getTime();
        const priceAtHit = priceAtDate(ohlc, new Date(hitTs));
        const returnAtHit = priceAtHit != null
          ? Math.round(((priceAtHit - signal.entryPrice) / signal.entryPrice) * 10000) / 100
          : null;

        resolveSignal(signal.id, {
          priceAfter30d: priceAtHit,
          returnAfter30d: returnAtHit,
          hitTarget: targetWins,
          hitStop: !targetWins,
          outcome: targetWins ? 'win' : 'loss',
        });
        console.log(`[SignalResolver] ⚡ Early exit ${signal.symbol} → ${targetWins ? 'WIN (target)' : 'LOSS (stop)'} hit on ${targetHitAt ?? stopHitAt}`);
        return;
      }
      // No hit yet — just update 7d price if not set
      if (signal.priceAfter7d == null) {
        const quote = await getQuote(signal.symbol);
        if (quote.current > 0) {
          const returnAfter7d = Math.round(((quote.current - signal.entryPrice) / signal.entryPrice) * 10000) / 100;
          resolveSignal(signal.id, { priceAfter7d: quote.current, returnAfter7d, outcome: 'pending' });
        }
      }
      return;
    }

    if (is30dOld) {
      const price7d = priceAtDate(ohlc, new Date(signalTs + DAYS_7));
      const price30d = priceAtDate(ohlc, new Date(signalTs + DAYS_30));
      const returnAfter7d = price7d != null
        ? Math.round(((price7d - signal.entryPrice) / signal.entryPrice) * 10000) / 100
        : null;
      const returnAfter30d = price30d != null
        ? Math.round(((price30d - signal.entryPrice) / signal.entryPrice) * 10000) / 100
        : null;

      const { targetHitAt, stopHitAt } = firstHitDate(ohlc, signalTs, signal.targetPrice ?? null, signal.stopLoss ?? null);

      // Outcome: first event wins
      let outcome = 'neutral';
      let hitTarget = false;
      let hitStop = false;

      if (targetHitAt && stopHitAt) {
        // Both hit — first one wins
        if (new Date(targetHitAt) < new Date(stopHitAt)) {
          outcome = 'win';
          hitTarget = true;
        } else {
          outcome = 'loss';
          hitStop = true;
        }
      } else if (targetHitAt) {
        outcome = 'win';
        hitTarget = true;
      } else if (stopHitAt) {
        outcome = 'loss';
        hitStop = true;
      } else if (returnAfter30d != null) {
        // No explicit target/stop hit — use return magnitude
        const targetPct = signal.targetPrice ? ((signal.targetPrice - signal.entryPrice) / signal.entryPrice) * 100 : 15;
        const stopPct = signal.stopLoss ? ((signal.stopLoss - signal.entryPrice) / signal.entryPrice) * 100 : -7;
        if (returnAfter30d >= targetPct * 0.5) outcome = 'win';
        else if (returnAfter30d <= stopPct * 0.5) outcome = 'loss';
        else outcome = 'neutral';
      }

      resolveSignal(signal.id, {
        priceAfter7d: price7d,
        priceAfter30d: price30d,
        returnAfter7d,
        returnAfter30d,
        hitTarget,
        hitStop,
        outcome,
      });

      console.log(`[SignalResolver] ✓ ${signal.symbol} (${signal.signalDate}) → ${outcome.toUpperCase()} | 30d return: ${returnAfter30d != null ? (returnAfter30d > 0 ? '+' : '') + returnAfter30d + '%' : 'N/A'}`);
    }
  } catch (err) {
    console.warn(`[SignalResolver] Error resolving ${signal.symbol}:`, (err as Error).message?.slice(0, 80));
  }
}

export async function runSignalResolver(): Promise<{ processed: number; resolved: number }> {
  if (resolving) return { processed: 0, resolved: 0 };
  resolving = true;

  let processed = 0;
  let resolved = 0;

  try {
    const pending = getPendingSignals().filter((s) => s.sector === 'evidence-v2');
    if (!pending.length) return { processed: 0, resolved: 0 };

    console.log(`[SignalResolver] Procesando ${pending.length} señales pendientes...`);

    for (const signal of pending) {
      const ageMs = Date.now() - new Date(signal.signalDate).getTime();
      if (ageMs >= 7 * 24 * 60 * 60 * 1000) {
        processed++;
        const wasOld = ageMs >= 30 * 24 * 60 * 60 * 1000;
        await resolveOne(signal);
        if (wasOld) resolved++;
        // Small delay to avoid hammering Yahoo
        await new Promise((r) => setTimeout(r, 300));
      }
    }

    console.log(`[SignalResolver] Completo — ${processed} procesadas, ${resolved} resueltas`);
    return { processed, resolved };
  } finally {
    resolving = false;
  }
}

export function triggerSignalResolver(): void {
  runSignalResolver().catch((err) =>
    console.error('[SignalResolver] Error fatal:', err),
  );
}
