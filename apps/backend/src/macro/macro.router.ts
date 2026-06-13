import { router, publicProcedure } from '../trpc.js';
import { getMarketRegime } from '../evidence-signals/market-regime.service.js';
import { getSectorRotation } from './sector-rotation.service.js';
import { getArgentinaMacro } from './argentina-macro.service.js';
import type { MacroDashboard } from '@trading/shared';

export const macroRouter = router({
  dashboard: publicProcedure.query(async (): Promise<MacroDashboard> => {
    const [regime, sectors, argentinaSignal] = await Promise.all([
      getMarketRegime(),
      getSectorRotation(),
      getArgentinaMacro(),
    ]);
    return { regime, sectors, argentinaSignal };
  }),

  regime: publicProcedure.query(() => getMarketRegime()),

  sectorRotation: publicProcedure.query(() => getSectorRotation()),

  argentinaSignal: publicProcedure.query(() => getArgentinaMacro()),
});
