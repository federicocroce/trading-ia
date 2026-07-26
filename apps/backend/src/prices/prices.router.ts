import { router, publicProcedure } from '../trpc.js';
import { getBySymbolInput, getHistoryInput } from './prices.schema.js';
import { getAllPrices, getPriceBySymbol, getPriceHistory } from './prices.service.js';
import { getFundamentals } from '../shared/yahoo.js';
import { getTechnicalSummary } from '../technical/technical-analysis.service.js';
import { getMarketMovers } from '../shared/fmp.js';

export const pricesRouter = router({
  getAll: publicProcedure.query(async () => {
    return getAllPrices();
  }),

  getBySymbol: publicProcedure
    .input(getBySymbolInput)
    .query(async ({ input }) => {
      return getPriceBySymbol(input.symbol);
    }),

  getHistory: publicProcedure
    .input(getHistoryInput)
    .query(async ({ input }) => {
      return getPriceHistory(input.symbol, input.range, input.interval);
    }),

  getFundamentals: publicProcedure
    .input(getBySymbolInput)
    .query(async ({ input }) => {
      return getFundamentals(input.symbol, { priority: true });
    }),

  getTechnical: publicProcedure
    .input(getBySymbolInput)
    .query(async ({ input }) => {
      return getTechnicalSummary(input.symbol);
    }),

  getMarketMovers: publicProcedure.query(async () => {
    return getMarketMovers();
  }),
});
