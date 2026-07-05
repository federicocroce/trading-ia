import { router, publicProcedure } from '../trpc.js';
import { getLatestCycleRadarDate, getCycleRadarSnapshots, countCycleRadarDates } from '../db/repository.js';

export const radarRouter = router({
  getLatest: publicProcedure.query(() => {
    const date = getLatestCycleRadarDate();
    if (!date) return { date: null, snapshots: [], historyDays: 0 };
    return { date, snapshots: getCycleRadarSnapshots(date), historyDays: countCycleRadarDates() };
  }),
});
