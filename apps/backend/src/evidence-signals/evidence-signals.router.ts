import { z } from 'zod';
import { router, publicProcedure } from '../trpc.js';
import {
  getCachedScanResult,
  triggerScan,
  getScanStatus,
  getEvidenceSignalForSymbol,
  getLastScanRuns,
} from './evidence-signals.service.js';
import { getSignalTrackingHistory, getSignalAccuracyStats } from '../db/repository.js';
import { getCachedAnalysis, getAllCachedAnalyses } from './deep-analysis.service.js';
import { runSignalResolver } from './signal-resolver.service.js';

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

  getDeepAnalysis: publicProcedure
    .input(z.object({ symbol: z.string() }))
    .query(({ input }) => getCachedAnalysis(input.symbol)),

  getAllDeepAnalyses: publicProcedure
    .query(() => getAllCachedAnalyses()),

  resolveSignals: publicProcedure
    .mutation(() => runSignalResolver()),

  getScanHistory: publicProcedure
    .query(() => getLastScanRuns(10)),

  getAccuracyStats: publicProcedure
    .query(() => {
      const stats = getSignalAccuracyStats();
      // Filter to evidence-v2 sector only
      const history = getSignalTrackingHistory(200).filter((s) => s.sector === 'evidence-v2');
      const resolved = history.filter((s) => s.outcome && s.outcome !== 'pending');
      const wins = resolved.filter((s) => s.outcome === 'win').length;
      const losses = resolved.filter((s) => s.outcome === 'loss').length;
      const pending = history.filter((s) => s.outcome === 'pending').length;
      const avgReturn30d = resolved.length > 0
        ? Math.round(resolved.reduce((sum, s) => sum + (s.returnAfter30d ?? 0), 0) / resolved.length * 100) / 100
        : null;
      return {
        totalTracked: history.length,
        resolved: resolved.length,
        pending,
        wins,
        losses,
        winRate: resolved.length > 0 ? Math.round((wins / resolved.length) * 100) : null,
        avgReturn30d,
      };
    }),
});
