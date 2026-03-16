import { z } from 'zod';
import { TRPCError } from '@trpc/server';
import { router, publicProcedure } from '../trpc.js';
import { getPortfolio } from './portfolio.service.js';
import * as repo from '../db/repository.js';
import { searchSymbols } from '../shared/yahoo.js';
import { resetPriceCache } from '../prices/prices.service.js';

export const portfolioRouter = router({
  // --- Existing endpoints (unchanged API) ---

  get: publicProcedure.query(async () => {
    return getPortfolio();
  }),

  summary: publicProcedure.query(async () => {
    const portfolio = await getPortfolio();
    return {
      totalValue: portfolio.totalValue,
      totalCost: portfolio.totalCost,
      totalPnl: portfolio.totalPnl,
      totalPnlPercent: portfolio.totalPnlPercent,
      positionCount: portfolio.positions.length,
    };
  }),

  // --- Symbols CRUD ---

  symbols: router({
    list: publicProcedure.query(() => {
      return repo.getAllSymbols();
    }),

    search: publicProcedure
      .input(z.object({ query: z.string().min(1).max(50) }))
      .query(async ({ input }) => {
        return searchSymbols(input.query);
      }),

    add: publicProcedure
      .input(z.object({
        symbol: z.string().min(1).toUpperCase(),
        name: z.string().min(1),
        type: z.enum(['adr', 'us', 'crypto']),
        flag: z.string().optional(),
        plaza: z.enum(['argentina-energy', 'argentina-finance', 'us-energy', 'crypto', 'global']).optional(),
      }))
      .mutation(({ input }) => {
        repo.insertSymbol(input);
        resetPriceCache();
        return { success: true, symbol: input.symbol };
      }),

    update: publicProcedure
      .input(z.object({
        symbol: z.string(),
        name: z.string().optional(),
        type: z.enum(['adr', 'us', 'crypto']).optional(),
        flag: z.string().optional(),
        plaza: z.enum(['argentina-energy', 'argentina-finance', 'us-energy', 'crypto', 'global']).optional(),
        active: z.boolean().optional(),
      }))
      .mutation(({ input }) => {
        const { symbol, ...data } = input;
        repo.updateSymbol(symbol, data);
        return { success: true };
      }),

    delete: publicProcedure
      .input(z.object({ symbol: z.string() }))
      .mutation(({ input }) => {
        const position = repo.getPositionBySymbol(input.symbol);
        if (position && position.quantity > 0) {
          throw new TRPCError({
            code: 'PRECONDITION_FAILED',
            message: `No se puede eliminar ${input.symbol} porque tiene una posicion activa`,
          });
        }
        repo.deleteSymbol(input.symbol);
        resetPriceCache();
        return { success: true };
      }),
  }),

  // --- Positions CRUD ---

  positions: router({
    list: publicProcedure.query(() => {
      return repo.getAllPositions();
    }),

    upsert: publicProcedure
      .input(z.object({
        symbol: z.string().min(1),
        quantity: z.number().min(0),
        avgCost: z.number().min(0),
        notes: z.string().optional(),
      }))
      .mutation(({ input }) => {
        repo.upsertPosition(input);
        return { success: true, symbol: input.symbol };
      }),

    delete: publicProcedure
      .input(z.object({ symbol: z.string() }))
      .mutation(({ input }) => {
        repo.deletePosition(input.symbol);
        return { success: true };
      }),
  }),

  // --- Transactions CRUD ---

  transactions: router({
    list: publicProcedure
      .input(z.object({ symbol: z.string().optional() }).optional())
      .query(({ input }) => {
        return repo.getTransactions(input?.symbol);
      }),

    add: publicProcedure
      .input(z.object({
        symbol: z.string().min(1),
        type: z.enum(['BUY', 'SELL', 'DIVIDEND']),
        quantity: z.number().positive(),
        price: z.number().positive(),
        fees: z.number().min(0).optional(),
        date: z.string().min(1),
        currency: z.string().optional(),
        totalAmount: z.number().positive().optional(),
        platform: z.string().optional(),
        externalId: z.string().optional(),
        notes: z.string().optional(),
      }))
      .mutation(({ input }) => {
        repo.insertTransaction(input);
        repo.rebuildPositionsFromTransactions();
        return { success: true };
      }),

    delete: publicProcedure
      .input(z.object({ id: z.number() }))
      .mutation(({ input }) => {
        repo.deleteTransaction(input.id);
        repo.rebuildPositionsFromTransactions();
        return { success: true };
      }),
  }),
});
