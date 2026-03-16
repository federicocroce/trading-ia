import { z } from 'zod';
import { router, publicProcedure } from '../trpc.js';
import { getNews, getSourceStats } from './news.service.js';
import { getAnalyzedNews, getIntelligence, refreshIntelligence } from './news-intelligence.service.js';

export const newsRouter = router({
  getAll: publicProcedure.query(async () => {
    return getNews();
  }),

  sourceStats: publicProcedure.query(() => {
    return getSourceStats();
  }),

  getBySymbol: publicProcedure
    .input(z.object({ symbol: z.string().min(1) }))
    .query(async ({ input }) => {
      const news = await getNews();
      return news.filter((n) =>
        n.relatedTickers.includes(input.symbol)
      );
    }),

  getAnalyzed: publicProcedure.query(async () => {
    return getAnalyzedNews();
  }),

  intelligence: publicProcedure.query(async () => {
    return getIntelligence();
  }),

  refreshIntelligence: publicProcedure.mutation(async () => {
    return refreshIntelligence();
  }),
});
