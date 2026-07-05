// Radar de ciclos cuantitativo: contexto medible de dónde se gesta un ciclo. NO emite señales.
import { getHistoricalQuotes, getKeyStats } from '../shared/yahoo.js';
import { getToday } from '../shared/date-utils.js';
import {
  replaceCycleRadarSnapshotsForDate, getRadarSharesHistory,
  type CycleRadarSnapshotInsert,
} from '../db/repository.js';
import {
  computeReturnPct, computeSma, computeSmaSide, computeFlowDeltaPct, classifyCycleState,
  RADAR_RET_SHORT_SESSIONS, RADAR_RET_LONG_SESSIONS, RADAR_SMA_SESSIONS, RADAR_FLOW_LOOKBACK,
} from './cycle-signals.js';

const BENCHMARK = 'SPY';
const CANDLE_RANGE = '2y'; // la SMA200 necesita ventana amplia para conocer el "lado" (ver spec)

export const RADAR_UNIVERSE: Array<{ symbol: string; label: string; categoria: 'pais' | 'sector' }> = [
  { symbol: 'ARGT', label: 'Argentina', categoria: 'pais' },
  { symbol: 'EWZ', label: 'Brasil', categoria: 'pais' },
  { symbol: 'EWW', label: 'México', categoria: 'pais' },
  { symbol: 'ECH', label: 'Chile', categoria: 'pais' },
  { symbol: 'EPU', label: 'Perú', categoria: 'pais' },
  { symbol: 'INDA', label: 'India', categoria: 'pais' },
  { symbol: 'EWJ', label: 'Japón', categoria: 'pais' },
  { symbol: 'MCHI', label: 'China', categoria: 'pais' },
  { symbol: 'EWG', label: 'Alemania', categoria: 'pais' },
  { symbol: 'EWU', label: 'Reino Unido', categoria: 'pais' },
  { symbol: 'EEM', label: 'Emergentes', categoria: 'pais' },
  { symbol: 'XLU', label: 'Utilities US', categoria: 'sector' },
  { symbol: 'XLE', label: 'Energía US', categoria: 'sector' },
  { symbol: 'XLF', label: 'Finanzas US', categoria: 'sector' },
  { symbol: 'XBI', label: 'Biotech', categoria: 'sector' },
  { symbol: 'SMH', label: 'Semiconductores', categoria: 'sector' },
  { symbol: 'ITA', label: 'Defensa', categoria: 'sector' },
  { symbol: 'COPX', label: 'Mineras de cobre', categoria: 'sector' },
  { symbol: 'URA', label: 'Uranio', categoria: 'sector' },
  { symbol: 'LIT', label: 'Litio', categoria: 'sector' },
  { symbol: 'GDX', label: 'Mineras de oro', categoria: 'sector' },
  { symbol: 'TAN', label: 'Solar', categoria: 'sector' },
  { symbol: 'XME', label: 'Metales y minería', categoria: 'sector' },
];

// Guard módulo-level: dos corridas superpuestas (cron + disparo manual) pisarían resultados
// entre sí sin ganar nada, porque cada una arma su propio replace por símbolo.
let radarRunning = false;

export async function runCycleRadar(): Promise<{ date: string; persisted: number; skipped: string[] }> {
  const date = getToday();

  if (radarRunning) {
    console.warn('[radar] corrida ya en curso, se omite esta invocación');
    return { date, persisted: 0, skipped: ['radar ya en curso'] };
  }
  radarRunning = true;
  try {
    // Benchmark primero: sin SPY no hay fuerza relativa => abort honesto (fail-closed).
    let spyRet3m: number | null = null;
    let spyRet6m: number | null = null;
    try {
      const spyCloses = (await getHistoricalQuotes(BENCHMARK, CANDLE_RANGE, '1d')).map(c => c.close);
      spyRet3m = computeReturnPct(spyCloses, RADAR_RET_SHORT_SESSIONS);
      spyRet6m = computeReturnPct(spyCloses, RADAR_RET_LONG_SESSIONS);
    } catch (err) {
      console.warn('[radar] SPY sin datos, radar abortado:', (err as Error).message);
      return { date, persisted: 0, skipped: [`${BENCHMARK}: ${(err as Error).message}`] };
    }
    if (spyRet3m === null || spyRet6m === null) {
      console.warn('[radar] SPY con historia insuficiente, radar abortado');
      return { date, persisted: 0, skipped: [`${BENCHMARK}: historia insuficiente`] };
    }

    const rows: CycleRadarSnapshotInsert[] = [];
    const skipped: string[] = [];

    for (const basket of RADAR_UNIVERSE) {
      try {
        const candles = await getHistoricalQuotes(basket.symbol, CANDLE_RANGE, '1d');
        const closes = candles.map(c => c.close);
        if (closes.length === 0) throw new Error('sin velas');
        const close = closes[closes.length - 1];

        const ret3m = computeReturnPct(closes, RADAR_RET_SHORT_SESSIONS);
        const ret6m = computeReturnPct(closes, RADAR_RET_LONG_SESSIONS);
        const rs3m = ret3m === null ? null : ret3m - spyRet3m;
        const rs6m = ret6m === null ? null : ret6m - spyRet6m;
        const sma200 = computeSma(closes, RADAR_SMA_SESSIONS);
        const distSma200Pct = sma200 === null || sma200 <= 0 ? null : ((close - sma200) / sma200) * 100;
        const { lado, sesionesEnLado, saturado } = computeSmaSide(closes, RADAR_SMA_SESSIONS);
        const { state, reason } = classifyCycleState({ distSma200Pct, rs3m, rs6m, lado, sesionesEnLado, saturado });

        const { totalAssets } = await getKeyStats(basket.symbol);
        // Siempre shares IMPLÍCITAS (AUM/precio), nunca sharesOutstanding real de Yahoo: una serie
        // consistente de una sola fuente > precisión ocasional. El sharesOutstanding real de Yahoo
        // es flaky para ETFs (aparece y desaparece entre corridas); si flipeáramos de fuente según
        // disponibilidad, cada flip metería un salto espurio del mismo orden de magnitud que la
        // señal que el delta de 20 días intenta medir. Proxy con ruido de prima/descuento vs NAV
        // (<±0,5% en ETFs líquidos) — irrelevante frente a eso.
        const sharesOutstanding = totalAssets !== null && close > 0 ? totalAssets / close : null;
        const historia = getRadarSharesHistory(basket.symbol, RADAR_FLOW_LOOKBACK + 1, date);
        const flowDelta20d = computeFlowDeltaPct([...historia, sharesOutstanding], RADAR_FLOW_LOOKBACK);

        rows.push({
          snapshotDate: date, symbol: basket.symbol, label: basket.label, categoria: basket.categoria,
          close, sma200, distSma200Pct, ret3m, ret6m, rs3m, rs6m,
          sesionesEnLado, ladoSma: lado, sharesOutstanding, flowDelta20d,
          cycleState: state, stateReason: reason,
        });
      } catch (err) {
        skipped.push(`${basket.symbol}: ${(err as Error).message}`);
      }
    }

    if (rows.length > 0) replaceCycleRadarSnapshotsForDate(date, rows);
    if (skipped.length > 0) console.warn(`[radar] canastas sin datos: ${skipped.join('; ')}`);
    return { date, persisted: rows.length, skipped };
  } finally {
    radarRunning = false;
  }
}
