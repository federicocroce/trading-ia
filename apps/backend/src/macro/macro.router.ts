import { router, publicProcedure } from '../trpc.js';
import { getMarketRegime } from '../evidence-signals/market-regime.service.js';
import { getSectorRotation } from './sector-rotation.service.js';
import { getArgentinaMacro } from './argentina-macro.service.js';
import { getLatestWeeklyPicks, generateWeeklyPicks, saveWeeklyPicks } from '../opportunities/weekly-picks.service.js';
import type { MacroDashboard } from '@trading/shared';

export const macroRouter = router({
  dashboard: publicProcedure.query(async (): Promise<MacroDashboard> => {
    const [regime, sectors, argentinaSignal, picks] = await Promise.all([
      getMarketRegime(),
      getSectorRotation(),
      getArgentinaMacro(),
      Promise.resolve(getLatestWeeklyPicks()),
    ]);
    return { regime, sectors, argentinaSignal, picks };
  }),

  regime: publicProcedure.query(() => getMarketRegime()),

  sectorRotation: publicProcedure.query(() => getSectorRotation()),

  argentinaSignal: publicProcedure.query(() => getArgentinaMacro()),

  weeklyPicks: publicProcedure.query(() => getLatestWeeklyPicks()),

  generatePicks: publicProcedure.mutation(async () => {
    const picks = await generateWeeklyPicks();
    await saveWeeklyPicks(picks);
    return picks;
  }),
});
