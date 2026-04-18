import { z } from 'zod';
import { router, publicProcedure } from '../trpc.js';
import { getAllEvidenceSignals, getEvidenceSignalForSymbol } from './evidence-signals.service.js';
import { getSignalTrackingHistory } from '../db/repository.js';

export const evidenceSignalsRouter = router({
  getAll: publicProcedure.query(() => getAllEvidenceSignals()),

  getBySymbol: publicProcedure
    .input(z.object({ symbol: z.string() }))
    .query(({ input }) => getEvidenceSignalForSymbol(input.symbol)),

  refresh: publicProcedure.mutation(() => getAllEvidenceSignals(true)),

  getTracked: publicProcedure
    .input(z.object({ limit: z.number().default(50) }))
    .query(({ input }) =>
      getSignalTrackingHistory(input.limit).filter((s) => s.sector === 'evidence-v2')
    ),
});
