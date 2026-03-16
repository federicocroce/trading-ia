import { z } from 'zod';

export const scanInput = z.object({
  sectors: z.array(z.enum([
    'argentina-energy',
    'argentina-finance',
    'us-energy',
    'us-tech',
    'crypto',
  ])).optional(),
}).optional();
