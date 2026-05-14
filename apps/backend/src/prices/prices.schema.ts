import { z } from 'zod';

export const getBySymbolInput = z.object({
  symbol: z.string().min(1).max(10),
});

export const getHistoryInput = z.object({
  symbol: z.string().min(1).max(10),
  range: z.enum(['1d', '5d', '1mo', '3mo', '6mo', '1y', '5y']).default('6mo'),
  interval: z.enum(['5m', '15m', '1h', '1d', '1wk', '1mo']).default('1d'),
});
