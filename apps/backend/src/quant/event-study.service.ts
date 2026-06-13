/**
 * Orquestador I/O del event-study: baja la historia de precios, detecta los eventos por proxy,
 * mide la reacción forward de cada sector y persiste el playbook empírico.
 *
 * Aislado: no toca el motor. Es research/aprendizaje. La noticia en vivo (otro paso) solo
 * clasificará a qué eventType se parece y consultará este playbook.
 */
import { getHistoricalQuotes } from '../shared/yahoo.js';
import { replaceEventReactions, getEventReactions, type EventReactionRow } from '../db/repository.js';
import { EVENT_DEFS, detectEventDates, meanStats, edgeTStat, type Candle } from './event-study.js';

/** ETFs sectoriales + canastas relevantes que medimos como "target" de cada evento. */
const SECTOR_TARGETS = ['XLE', 'XLK', 'XLF', 'XLV', 'XLY', 'XLP', 'XLI', 'XLB', 'XLU', 'XLRE', 'XLC', 'JETS', 'ITA', 'GLD'];
const HORIZONS = [5, 10, 20];
const YEARS = 8;
const MIN_EVENTS = 6; // por debajo de esto la muestra no dice nada
const T_SIGNIFICANT = 2;
const round2 = (n: number) => Math.round(n * 100) / 100;

function dateIndex(candles: Candle[]): Map<string, number> {
  return new Map(candles.map((c, i) => [c.date, i]));
}

function forwardReturnAt(candles: Candle[], idx: number | undefined, horizon: number): number | null {
  if (idx == null || idx + horizon >= candles.length) return null;
  const a = candles[idx].close;
  return a > 0 ? ((candles[idx + horizon].close - a) / a) * 100 : null;
}

/** Retornos forward incondicionales (línea base) del target para un horizonte. */
function baselineReturns(candles: Candle[], horizon: number): number[] {
  const out: number[] = [];
  for (let i = 0; i + horizon < candles.length; i++) {
    const a = candles[i].close;
    if (a > 0) out.push(((candles[i + horizon].close - a) / a) * 100);
  }
  return out;
}

async function loadAll(symbols: string[]): Promise<Map<string, Candle[]>> {
  const out = new Map<string, Candle[]>();
  const limit = 4;
  let next = 0;
  const worker = async () => {
    while (next < symbols.length) {
      const s = symbols[next++];
      try { out.set(s, await getHistoricalQuotes(s, `${YEARS}y`, '1d')); } catch { /* skip */ }
    }
  };
  await Promise.all(Array.from({ length: Math.min(limit, symbols.length) }, worker));
  return out;
}

export interface EventStudyResult {
  computedAt: string;
  rowsStored: number;
  significant: EventReactionRow[];
}

export async function runEventStudy(): Promise<EventStudyResult> {
  const proxies = [...new Set(EVENT_DEFS.map((d) => d.proxy))];
  const symbols = [...new Set([...proxies, ...SECTOR_TARGETS])];
  const candlesBySymbol = await loadAll(symbols);

  // Pre-cómputo por target: índice por fecha + baseline por horizonte.
  const targetMeta = new Map<string, { candles: Candle[]; idx: Map<string, number>; baseMean: Record<number, number> }>();
  for (const t of SECTOR_TARGETS) {
    const candles = candlesBySymbol.get(t);
    if (!candles || candles.length < 250) continue;
    const baseMean: Record<number, number> = {};
    for (const h of HORIZONS) baseMean[h] = meanStats(baselineReturns(candles, h)).mean;
    targetMeta.set(t, { candles, idx: dateIndex(candles), baseMean });
  }

  const rows: EventReactionRow[] = [];
  for (const def of EVENT_DEFS) {
    const proxyCandles = candlesBySymbol.get(def.proxy);
    if (!proxyCandles || proxyCandles.length < 250) continue;
    const eventDates = detectEventDates(proxyCandles, def);
    if (eventDates.length < MIN_EVENTS) continue;

    for (const [target, meta] of targetMeta) {
      for (const horizon of HORIZONS) {
        const reactions = eventDates
          .map((d) => forwardReturnAt(meta.candles, meta.idx.get(d), horizon))
          .filter((v): v is number => v != null);
        if (reactions.length < MIN_EVENTS) continue;

        const rStats = meanStats(reactions);
        const baselineAvg = round2(meta.baseMean[horizon]);
        const t = edgeTStat(reactions, baselineAvg);
        rows.push({
          eventType: def.type,
          target,
          horizonDays: horizon,
          reactionAvg: rStats.mean,
          baselineAvg,
          edge: round2(rStats.mean - baselineAvg),
          winRate: rStats.winRate,
          tStat: t,
          significant: Math.abs(t) >= T_SIGNIFICANT,
          nEvents: rStats.n,
        });
      }
    }
  }

  replaceEventReactions(rows);
  return {
    computedAt: new Date().toISOString(),
    rowsStored: rows.length,
    significant: rows.filter((r) => r.significant).sort((a, b) => Math.abs(b.edge) - Math.abs(a.edge)),
  };
}

export function getEventPlaybook(eventType?: string): EventReactionRow[] {
  return getEventReactions(eventType).sort((a, b) => Math.abs(b.edge) - Math.abs(a.edge));
}
