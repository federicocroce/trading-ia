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
  getPortfolioDiagnostic,
} from './opportunities.service.js';
import {
  getTrackingHistory,
  getAccuracyStats,
  resolveExpiredSignals,
} from './signal-tracking.service.js';
import { promoteToWatchlist, getDiscoveredTickers } from '../discovery/discovery-registry.js';
import { getTodayDecisions } from './today-decisions.service.js';
import {
  getAccuracyBySector,
  getAccuracyByConfidenceTier,
  getAccuracyByScoreRange,
  getDimensionCorrelation,
  getEstimateAccuracy,
  getMissedOpportunities,
  getOpportunityScanDates,
  getOpportunityScanByDate,
  getAntiHypeRejectionsForScan,
  getRecentAntiHypeRejections,
  getLatestNewsIntelligenceSnapshot,
  getNewsIntelligenceSnapshotsByDateRange,
} from '../db/repository.js';

export const opportunitiesRouter = router({
  scanDates: publicProcedure.query(() => getOpportunityScanDates()),

  scanByDate: publicProcedure
    .input(z.object({ date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/) }))
    .query(({ input }) => {
      const row = getOpportunityScanByDate(input.date);
      if (!row) return null;
      return {
        ...row,
        opportunities: JSON.parse(row.opportunities),
        sectorSummary: JSON.parse(row.sectorSummary),
      };
    }),

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
      return refreshOpportunities(input?.sectors, input?.aiMode ?? 'cloud');
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

  // --- Anti-hype rejections audit ---

  antiHypeRejectionsRecent: publicProcedure
    .input(z.object({ limit: z.number().min(1).max(500).default(100) }).optional())
    .query(({ input }) => {
      return getRecentAntiHypeRejections(input?.limit ?? 100);
    }),

  antiHypeRejectionsForScan: publicProcedure
    .input(z.object({ scanId: z.number() }))
    .query(({ input }) => {
      return getAntiHypeRejectionsForScan(input.scanId);
    }),

  // --- Portfolio correlation diagnostic ---

  portfolioDiagnostic: publicProcedure
    .query(async () => {
      return getPortfolioDiagnostic();
    }),

  // --- Vista "Hoy": un veredicto por cosa (cartera + mercado) ---

  today: publicProcedure.query(() => getTodayDecisions()),
});
