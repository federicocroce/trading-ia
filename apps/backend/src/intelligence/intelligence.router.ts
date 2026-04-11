import { router, publicProcedure } from '../trpc.js';
import { getStoredDailyReport } from './daily-report.service.js';
import { getMarketDigest } from '../opportunities/opportunities.service.js';
import { generateMarketReport, getCachedMarketReport } from './market-report.service.js';
import { getStoredSectorReports } from './sector-report.service.js';

export const intelligenceRouter = router({
  dailyReport: publicProcedure.query(() => {
    return getStoredDailyReport();
  }),

  marketDigest: publicProcedure.query(() => {
    return getMarketDigest();
  }),

  marketReport: publicProcedure.query(() => {
    return getCachedMarketReport();
  }),

  generateMarketReport: publicProcedure.mutation(async () => {
    return generateMarketReport();
  }),

  sectorReports: publicProcedure.query(() => {
    return getStoredSectorReports();
  }),
});
