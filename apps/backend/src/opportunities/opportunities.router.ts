import { z } from 'zod';
import { router, publicProcedure } from '../trpc.js';
import { scanInput } from './opportunities.schema.js';
import {
  scanOpportunities,
  refreshOpportunities,
  getOpportunityScanHistory,
  getOpportunityScanDetail,
  getSymbolScoreHistory,
} from './opportunities.service.js';

export const opportunitiesRouter = router({
  scan: publicProcedure
    .input(scanInput)
    .query(async ({ input }) => {
      return scanOpportunities(input?.sectors);
    }),

  refresh: publicProcedure
    .input(scanInput)
    .mutation(async ({ input }) => {
      return refreshOpportunities(input?.sectors);
    }),

  // --- Historical data ---

  history: publicProcedure
    .input(z.object({ limit: z.number().min(1).max(100).default(20) }).optional())
    .query(({ input }) => {
      return getOpportunityScanHistory(input?.limit ?? 20);
    }),

  scanDetail: publicProcedure
    .input(z.object({ scanId: z.number() }))
    .query(({ input }) => {
      return getOpportunityScanDetail(input.scanId);
    }),

  symbolHistory: publicProcedure
    .input(z.object({ symbol: z.string(), limit: z.number().min(1).max(100).default(30) }))
    .query(({ input }) => {
      return getSymbolScoreHistory(input.symbol, input.limit);
    }),
});
