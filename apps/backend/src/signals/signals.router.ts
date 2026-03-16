import { router, publicProcedure } from '../trpc.js';
import { getBySymbolInput } from './signals.schema.js';
import { getAllIntegratedSignals, refreshIntegratedSignals } from './integrated-signals.service.js';

export const signalsRouter = router({
  getAll: publicProcedure.query(async () => {
    return getAllIntegratedSignals();
  }),

  getBySymbol: publicProcedure
    .input(getBySymbolInput)
    .query(async ({ input }) => {
      const all = await getAllIntegratedSignals();
      return all.find((s) => s.symbol === input.symbol) ?? null;
    }),

  refresh: publicProcedure.mutation(async () => {
    return refreshIntegratedSignals();
  }),
});
