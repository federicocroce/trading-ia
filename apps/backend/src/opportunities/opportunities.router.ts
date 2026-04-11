import { z } from 'zod';
import { router, publicProcedure } from '../trpc.js';
import { scanInput } from './opportunities.schema.js';
import {
  scanOpportunities,
  refreshOpportunities,
  refreshNewsProcess,
  refreshFundamentalsProcess,
  runAnalysis,
  runFullPipeline,
  getOpportunityScanHistory,
  getOpportunityScanDetail,
  getSymbolScoreHistory,
  getScanStatus,
  getProcessTimestamps,
} from './opportunities.service.js';
import {
  getTrackingHistory,
  getAccuracyStats,
  resolveExpiredSignals,
} from './signal-tracking.service.js';
import { promoteToWatchlist, getDiscoveredTickers } from '../discovery/discovery-registry.js';
import {
  getAccuracyBySector,
  getAccuracyByConfidenceTier,
  getAccuracyByScoreRange,
  getDimensionCorrelation,
  getEstimateAccuracy,
  getMissedOpportunities,
} from '../db/repository.js';

export const opportunitiesRouter = router({
  scan: publicProcedure
    .input(scanInput)
    .query(async ({ input }) => {
      return scanOpportunities(input?.sectors);
    }),

  scanStatus: publicProcedure
    .query(() => {
      return getScanStatus();
    }),

  refresh: publicProcedure
    .input(scanInput)
    .mutation(async ({ input }) => {
      return refreshOpportunities(input?.sectors);
    }),

  // --- 3 procesos independientes ---

  refreshNews: publicProcedure
    .mutation(async () => {
      return refreshNewsProcess();
    }),

  refreshFundamentals: publicProcedure
    .mutation(async () => {
      return refreshFundamentalsProcess();
    }),

  analyze: publicProcedure
    .mutation(async () => {
      return runAnalysis();
    }),

  fullPipeline: publicProcedure
    .mutation(async () => {
      return runFullPipeline();
    }),

  processTimestamps: publicProcedure
    .query(() => {
      return getProcessTimestamps();
    }),

  // --- Historical data ---

  history: publicProcedure
    .input(z.object({ limit: z.number().min(1).max(100).default(20) }).optional())
    .query(({ input }) => {
      return getOpportunityScanHistory(input?.limit ?? 20);
    }),

  scanDetail: publicProcedure
    .input(z.object({ scanId: z.number() }))
    .query(({ input }) => {
      return getOpportunityScanDetail(input.scanId);
    }),

  symbolHistory: publicProcedure
    .input(z.object({ symbol: z.string(), limit: z.number().min(1).max(100).default(30) }))
    .query(({ input }) => {
      return getSymbolScoreHistory(input.symbol, input.limit);
    }),

  // --- Signal tracking ---

  trackingHistory: publicProcedure
    .input(z.object({ limit: z.number().min(1).max(200).default(100) }).optional())
    .query(({ input }) => {
      return getTrackingHistory(input?.limit ?? 100);
    }),

  accuracyStats: publicProcedure
    .query(() => {
      return getAccuracyStats();
    }),

  accuracyBySector: publicProcedure.query(() => {
    return getAccuracyBySector();
  }),

  accuracyByConfidenceTier: publicProcedure.query(() => {
    return getAccuracyByConfidenceTier();
  }),

  accuracyByScoreRange: publicProcedure.query(() => {
    return getAccuracyByScoreRange();
  }),

  dimensionCorrelation: publicProcedure.query(() => {
    return getDimensionCorrelation();
  }),

  estimateAccuracy: publicProcedure.query(() => {
    return getEstimateAccuracy();
  }),

  missedOpportunities: publicProcedure
    .input(z.object({ limit: z.number().min(1).max(100).default(50) }).optional())
    .query(({ input }) => {
      return getMissedOpportunities(input?.limit ?? 50);
    }),

  compare: publicProcedure
    .input(z.object({
      symbols: z.array(z.string()).min(2).max(5),
      budget: z.number().optional(),
    }))
    .mutation(async ({ input }) => {
      const { compareAssets } = await import('./compare.service.js');
      return compareAssets(input.symbols, input.budget);
    }),

  // --- Discovery ---

  discoveredTickers: publicProcedure
    .query(() => {
      return getDiscoveredTickers();
    }),

  addToWatchlist: publicProcedure
    .input(z.object({ symbol: z.string() }))
    .mutation(({ input }) => {
      return { success: promoteToWatchlist(input.symbol) };
    }),

  resolveSignals: publicProcedure
    .mutation(async () => {
      const resolved = await resolveExpiredSignals();
      return { resolved };
    }),
});
