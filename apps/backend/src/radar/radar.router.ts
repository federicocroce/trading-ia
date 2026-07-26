import { router, publicProcedure } from '../trpc.js';
import { getLatestCycleRadarDate, getCycleRadarSnapshots, countCycleRadarDates } from '../db/repository.js';
import { RADAR_UNIVERSE, runCycleRadar } from './cycle-radar.service.js';

export const radarRouter = router({
  // Corrida manual del radar de ciclos. runCycleRadar tiene guard `radarRunning`
  // interno: doble click no apila corridas — la segunda vuelve con skipped.
  run: publicProcedure.mutation(() => runCycleRadar()),

  getLatest: publicProcedure.query(() => {
    const date = getLatestCycleRadarDate();
    if (!date) return { date: null, snapshots: [], historyDays: 0, missing: [] };
    const snapshots = getCycleRadarSnapshots(date);
    const symbolsDelSnapshot = new Set(snapshots.map(s => s.symbol));
    // Canastas del universo sin snapshot hoy (fetch fallido en la corrida) — visibles, no silenciadas.
    const missing = RADAR_UNIVERSE
      .filter(b => !symbolsDelSnapshot.has(b.symbol))
      .map(b => ({ symbol: b.symbol, label: b.label }));
    return { date, snapshots, historyDays: countCycleRadarDates(), missing };
  }),
});
