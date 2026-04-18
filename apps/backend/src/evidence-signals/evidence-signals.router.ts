import { z } from 'zod';
import { router, publicProcedure } from '../trpc.js';
import { getAllEvidenceSignals, getEvidenceSignalForSymbol, invalidateEvidenceCache } from './evidence-signals.service.js';

export const evidenceSignalsRouter = router({
  getAll: publicProcedure.query(() => getAllEvidenceSignals()),

  getBySymbol: publicProcedure
    .input(z.object({ symbol: z.string() }))
    .query(({ input }) => getEvidenceSignalForSymbol(input.symbol)),

  refresh: publicProcedure.mutation(() => getAllEvidenceSignals(true)),
});
