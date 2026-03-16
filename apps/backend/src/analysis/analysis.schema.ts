import { z } from 'zod';

export const analyzeNewsInput = z.object({
  title: z.string().min(1),
  content: z.string().optional(),
});

export const analyzeSignalInput = z.object({
  symbol: z.string().min(1).max(10),
});
