import { z } from 'zod';
import { router, publicProcedure } from '../trpc.js';
import {
  getCachedScanResult,
  triggerScan,
  getScanStatus,
  getEvidenceSignalForSymbol,
} from './evidence-signals.service.js';
import { getSignalTrackingHistory } from '../db/repository.js';

export const evidenceSignalsRouter = router({
  // Returns cached results immediately (fast). Empty if scan hasn't run yet.
  getAll: publicProcedure.query(() => getCachedScanResult()),

  // Scan status: idle | scanning + progress counters
  scanStatus: publicProcedure.query(() => getScanStatus()),

  // Fire-and-forget scan trigger. Returns immediately.
  refresh: publicProcedure.mutation(({ input }) => {
    triggerScan(true);
    return { ok: true, message: 'Scan iniciado en background' };
  }),

  // Start scan without clearing cache (picks up new symbols only)
  scan: publicProcedure.mutation(() => {
    triggerScan(false);
    return { ok: true, message: 'Scan iniciado en background' };
  }),

  getBySymbol: publicProcedure
    .input(z.object({ symbol: z.string() }))
    .query(({ input }) => getEvidenceSignalForSymbol(input.symbol)),

  getTracked: publicProcedure
    .input(z.object({ limit: z.number().default(50) }))
    .query(({ input }) =>
      getSignalTrackingHistory(input.limit).filter((s) => s.sector === 'evidence-v2')
    ),
});
