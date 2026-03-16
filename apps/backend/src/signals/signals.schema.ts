import { z } from 'zod';

export const getBySymbolInput = z.object({
  symbol: z.string().min(1).max(10),
});
