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
      const history = getSignalTrackingHistory(500).filter((s) => s.sector === 'evidence-v2');
      const resolved = history.filter((s) => s.outcome && s.outcome !== 'pending');
      const wins = resolved.filter((s) => s.outcome === 'win').length;
      const losses = resolved.filter((s) => s.outcome === 'loss').length;
      const pending = history.filter((s) => s.outcome === 'pending').length;
      const avgReturn30d = resolved.length > 0
        ? Math.round(resolved.reduce((sum, s) => sum + (s.returnAfter30d ?? 0), 0) / resolved.length * 100) / 100
        : null;

      // Per-component win rates (for signals that have component score data)
      const componentStats = (['pead', 'insider', 'options'] as const).map((comp) => {
        const key = `${comp}Score` as 'peadScore' | 'insiderScore' | 'optionsScore';
        const withComp = resolved.filter((s) => (s as any)[key] != null && (s as any)[key] > 0);
        const compWins = withComp.filter((s) => s.outcome === 'win').length;
        return {
          signal: comp,
          count: withComp.length,
          winRate: withComp.length > 0 ? Math.round((compWins / withComp.length) * 100) : null,
        };
      });

      // Win rate by market regime
      const regimeStats = (['bull', 'bear', 'neutral'] as const).map((regime) => {
        const withRegime = resolved.filter((s) => (s as any).marketRegimeAtSignal === regime);
        const regimeWins = withRegime.filter((s) => s.outcome === 'win').length;
        return {
          regime,
          count: withRegime.length,
          winRate: withRegime.length > 0 ? Math.round((regimeWins / withRegime.length) * 100) : null,
        };
      });

      // Win rate when AI verdict was BUY_SETUP vs other
      const aiStats = {
        buySetup: (() => {
          const s = resolved.filter((r) => (r as any).aiVerdict === 'BUY_SETUP');
          const w = s.filter((r) => r.outcome === 'win').length;
          return { count: s.length, winRate: s.length > 0 ? Math.round((w / s.length) * 100) : null };
        })(),
        noVerdict: (() => {
          const s = resolved.filter((r) => !(r as any).aiVerdict);
          const w = s.filter((r) => r.outcome === 'win').length;
          return { count: s.length, winRate: s.length > 0 ? Math.round((w / s.length) * 100) : null };
        })(),
      };

      return {
        totalTracked: history.length,
        resolved: resolved.length,
        pending,
        wins,
        losses,
        winRate: resolved.length > 0 ? Math.round((wins / resolved.length) * 100) : null,
        avgReturn30d,
        componentStats,
        regimeStats,
        aiStats,
      };
    }),
});
