import { router, publicProcedure } from '../trpc.js';
import { analyzeNewsInput, analyzeSignalInput } from './analysis.schema.js';
import { analyzeNews, generateSignal } from './analysis.service.js';

export const analysisRouter = router({
  news: publicProcedure
    .input(analyzeNewsInput)
    .mutation(async ({ input }) => {
      return analyzeNews(input.title, input.content);
    }),

  signal: publicProcedure
    .input(analyzeSignalInput)
    .mutation(async ({ input }) => {
      return generateSignal(input.symbol);
    }),
});
