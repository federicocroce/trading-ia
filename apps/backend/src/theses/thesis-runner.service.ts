// apps/backend/src/theses/thesis-runner.service.ts
/**
 * Evaluador diario de tesis activas/gatilladas: por cada una, pide el precio vivo del
 * `primarySymbol` y le pasa el estado a `evaluateThesis` (lógica pura) para decidir si hay
 * transición. Cuando la transición es terminal (cumplida/invalidada/expirada), calcula el
 * outcome numérico y persiste todo.
 *
 * FRONTERA: igual que thesis-generator — solo LEE precios vivos/históricos de
 * `shared/yahoo.ts` y tesis de `db/repository.ts`. No importa nada de opportunities/radar/macro,
 * y nada de esos dominios importa theses/.
 *
 * Fail-closed: sin precio vivo de un símbolo, esa tesis no transiciona esta corrida (se
 * reintenta la próxima). Un fallo total de `getQuotes` aborta la corrida entera sin persistir
 * nada — no hay transición parcial con datos a medias.
 *
 * Outcome v1 (simplificación documentada): no persistimos el precio exacto en el momento del
 * gatillo (requeriría una columna extra que esta task no agrega). En cambio medimos el retorno
 * del primarySymbol desde el CIERRE de `createdDate` hasta el precio vivo al momento de la
 * resolución, menos el retorno de SPY en el mismo período. Esto sobreestima/subestima el
 * retorno real de tesis que tardaron en gatillar (el "reloj" arranca en la creación de la
 * tesis, no en el gatillo de entrada) — aceptado para v1; revisar si el tracking exige
 * precisión del entry real.
 *
 * outcomeReturnPct vs outcomeVsSpyPct son independientes: el primero solo depende del histórico
 * de `primarySymbol` y se persiste siempre que ese histórico exista. Si falta el precio vivo o
 * el histórico de SPY, outcomeVsSpyPct queda null pero outcomeReturnPct NO se pierde — la tesis
 * ya es terminal en ese punto, así que tirar el dato completo por falta de SPY sería perderlo
 * para siempre.
 */
import type { OHLC, Price } from '@trading/shared';
import { getQuotes, getHistoricalQuotes } from '../shared/yahoo.js';
import { getActiveTheses, updateThesis } from '../db/repository.js';
import { evaluateThesis, type ThesisState } from './thesis-evaluator.js';

const SPY = 'SPY';
const OUTCOME_HISTORY_RANGE = '1y';

// Guard in-flight contra invocaciones concurrentes de evaluateActiveTheses en el mismo proceso.
let evaluacionEnCurso = false;

function todayStr(): string {
  return new Date().toISOString().slice(0, 10);
}

/** Cierre en `date` o el más reciente inmediatamente anterior. Mismo patrón que entryCloseOn en outcome-resolver.service.ts. */
function closeOnOrBefore(candles: OHLC[], date: string): number | null {
  const exact = candles.find((c) => c.date === date);
  if (exact) return exact.close;
  const before = candles.filter((c) => c.date <= date).sort((a, b) => a.date.localeCompare(b.date)).at(-1);
  return before ? before.close : null;
}

/**
 * outcomeReturnPct depende solo del histórico de `symbol` — se calcula siempre que ese
 * histórico exista, aunque falte SPY. outcomeVsSpyPct queda null si falta el precio vivo de
 * SPY o su histórico: no tiramos el retorno crudo del símbolo por un problema ajeno a él.
 */
async function computeOutcome(
  symbol: string,
  createdDate: string,
  currentPrice: number,
  spyCurrentPrice: number | null,
): Promise<{ outcomeReturnPct: number | null; outcomeVsSpyPct: number | null }> {
  let symbolCandles: OHLC[];
  try {
    symbolCandles = await getHistoricalQuotes(symbol, OUTCOME_HISTORY_RANGE, '1d');
  } catch (err) {
    console.warn(`[thesis-runner] getHistoricalQuotes falló calculando outcome de ${symbol}: ${(err as Error).message}`);
    return { outcomeReturnPct: null, outcomeVsSpyPct: null };
  }
  const symbolEntry = closeOnOrBefore(symbolCandles, createdDate);
  if (symbolEntry == null || symbolEntry <= 0) {
    console.warn(`[thesis-runner] Sin cierre histórico de ${symbol} en ${createdDate} — outcome null`);
    return { outcomeReturnPct: null, outcomeVsSpyPct: null };
  }
  const outcomeReturnPct = ((currentPrice - symbolEntry) / symbolEntry) * 100;

  if (spyCurrentPrice === null) {
    console.warn(`[thesis-runner] Sin precio vivo de ${SPY} — outcome de ${symbol} conserva outcomeReturnPct pero queda sin vs-benchmark (outcomeVsSpyPct null)`);
    return { outcomeReturnPct, outcomeVsSpyPct: null };
  }

  try {
    const spyCandles = await getHistoricalQuotes(SPY, OUTCOME_HISTORY_RANGE, '1d');
    const spyEntry = closeOnOrBefore(spyCandles, createdDate);
    if (spyEntry == null || spyEntry <= 0) {
      console.warn(`[thesis-runner] Sin cierre histórico de ${SPY} en ${createdDate} — outcomeVsSpyPct null (outcomeReturnPct de ${symbol} sí calculado)`);
      return { outcomeReturnPct, outcomeVsSpyPct: null };
    }
    const spyReturnPct = ((spyCurrentPrice - spyEntry) / spyEntry) * 100;
    return { outcomeReturnPct, outcomeVsSpyPct: outcomeReturnPct - spyReturnPct };
  } catch (err) {
    console.warn(`[thesis-runner] getHistoricalQuotes de ${SPY} falló calculando vs-benchmark de ${symbol}: ${(err as Error).message}`);
    return { outcomeReturnPct, outcomeVsSpyPct: null };
  }
}

export interface EvaluateActiveThesesResult {
  evaluated: number;
  transitions: number;
}

export async function evaluateActiveTheses(): Promise<EvaluateActiveThesesResult> {
  // Guard in-flight contra invocaciones concurrentes. El backend es un solo proceso Node —
  // esto cierra completamente la race condition sin necesidad de locks distribuidos.
  if (evaluacionEnCurso) {
    const msg = 'Evaluación ya en curso — invocación concurrente ignorada';
    console.warn(`[thesis-runner] ${msg}`);
    return { evaluated: 0, transitions: 0 };
  }

  evaluacionEnCurso = true;
  try {
    const active = getActiveTheses();
    if (active.length === 0) {
      console.log('[thesis-runner] Sin tesis activas/gatilladas — nada que evaluar');
      return { evaluated: 0, transitions: 0 };
    }

    const symbols = [...new Set([...active.map((t) => t.primarySymbol), SPY])];
    let quotes: Price[];
    try {
      quotes = await getQuotes(symbols);
    } catch (err) {
      console.error('[thesis-runner] getQuotes falló — sin transiciones esta corrida:', (err as Error).message);
      return { evaluated: 0, transitions: 0 };
    }
    const priceMap = new Map(quotes.map((q) => [q.symbol, q.current]));
    const spyPrice = priceMap.get(SPY) ?? null;

    const today = todayStr();
    let transitions = 0;

    for (const t of active) {
      const price = priceMap.get(t.primarySymbol) ?? null;
      if (price === null) {
        console.warn(`[thesis-runner] Sin precio vivo de ${t.primarySymbol} (tesis #${t.id}) — sin transición esta corrida`);
        continue;
      }

      const state: ThesisState = {
        status: t.status,
        direction: t.direction,
        entryTriggerPrice: t.entryTriggerPrice,
        entryComparator: t.entryComparator,
        invalidationPrice: t.invalidationPrice,
        horizonDays: t.horizonDays,
        createdDate: t.createdDate,
        triggeredAt: t.triggeredAt,
      };

      const { newStatus, reason } = evaluateThesis(state, price, today);
      if (!newStatus) continue;

      transitions++;

      if (newStatus === 'gatillada') {
        updateThesis(t.id, { status: newStatus, triggeredAt: today });
        console.log(`[thesis-runner] Tesis #${t.id} "${t.title}" → gatillada (${reason})`);
        continue;
      }

      // Terminal: cumplida | invalidada | expirada — calcula outcome (best-effort, ver nota v1 arriba).
      const outcome = await computeOutcome(t.primarySymbol, t.createdDate, price, spyPrice);
      updateThesis(t.id, {
        status: newStatus,
        resolvedAt: today,
        outcomeReturnPct: outcome.outcomeReturnPct,
        outcomeVsSpyPct: outcome.outcomeVsSpyPct,
      });
      const outcomeMsg = outcome.outcomeReturnPct === null
        ? 'outcome no calculable (sin históricos)'
        : outcome.outcomeVsSpyPct === null
          ? `outcome=${outcome.outcomeReturnPct.toFixed(1)}% (sin vs-benchmark: falta SPY)`
          : `outcome=${outcome.outcomeReturnPct.toFixed(1)}% vs SPY=${outcome.outcomeVsSpyPct.toFixed(1)}%`;
      console.log(`[thesis-runner] Tesis #${t.id} "${t.title}" → ${newStatus} (${reason}) — ${outcomeMsg}`);
    }

    return { evaluated: active.length, transitions };
  } finally {
    evaluacionEnCurso = false;
  }
}
