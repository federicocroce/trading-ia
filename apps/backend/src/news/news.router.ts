import { z } from 'zod';
import { router, publicProcedure } from '../trpc.js';
import { getNewsFromDB, getSourceStats } from './news.service.js';
import { getAnalyzedNews, getIntelligenceFromDB, refreshIntelligence } from './news-intelligence.service.js';

export const newsRouter = router({
  getAll: publicProcedure.query(async () => {
    // Read from BD only — fetch happens via "Noticias" button
    return getNewsFromDB();
  }),

  sourceStats: publicProcedure.query(() => {
    return getSourceStats();
  }),

  getBySymbol: publicProcedure
    .input(z.object({ symbol: z.string().min(1) }))
    .query(async ({ input }) => {
      const news = getNewsFromDB();
      return news.filter((n) =>
        n.relatedTickers.includes(input.symbol)
      );
    }),

  getAnalyzed: publicProcedure.query(async () => {
    return getAnalyzedNews();
  }),

  intelligence: publicProcedure.query(async () => {
    // Read from BD/cache — never triggers API fetch
    return getIntelligenceFromDB();
  }),

  refreshIntelligence: publicProcedure.mutation(async () => {
    return refreshIntelligence();
  }),
});
