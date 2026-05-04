import { z } from 'zod';
import { TRPCError } from '@trpc/server';
import { router, publicProcedure } from '../trpc.js';
import { getEtfWatchlist, addEtfToWatchlist, removeEtfFromWatchlist } from '../db/repository.js';
import { getAssetProfile } from '../shared/yahoo.js';

const ETF_CATEGORIES = ['indices', 'sectores', 'bonos', 'commodities', 'latam', 'internacional', 'crypto', 'factor'] as const;

export const etfRouter = router({
  getWatchlist: publicProcedure.query(() => getEtfWatchlist()),

  getCategories: publicProcedure.query(() => ETF_CATEGORIES),

  addToWatchlist: publicProcedure
    .input(z.object({
      symbol: z.string().min(1).max(10),
      category: z.enum(ETF_CATEGORIES),
      description: z.string().optional(),
    }))
    .mutation(async ({ input }) => {
      const symbol = input.symbol.toUpperCase();
      const profile = await getAssetProfile(symbol);
      if (!profile) {
        throw new TRPCError({ code: 'BAD_REQUEST', message: `Símbolo ${symbol} no encontrado en Yahoo Finance` });
      }
      const name = profile.longName ?? symbol;
      addEtfToWatchlist(symbol, name, input.category, input.description);
      return { success: true, symbol, name };
    }),

  removeFromWatchlist: publicProcedure
    .input(z.object({ symbol: z.string().min(1).max(10) }))
    .mutation(({ input }) => {
      removeEtfFromWatchlist(input.symbol.toUpperCase());
      return { success: true };
    }),
});
