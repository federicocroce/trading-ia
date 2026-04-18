import { router, publicProcedure } from '../trpc.js';
import { z } from 'zod';
import { runBacktest, runBulkBacktest, getBulkBacktestStatus } from './backtest.service.js';
import { getBacktestRun, listBacktestRuns, getLatestBacktestForSymbol, getBacktestSummaryByClass } from './backtest.repository.js';
import { getStageQuantContext } from '../intelligence/pipeline.service.js';
import { calibrateThresholdsFromBacktests, getAllAssetClassThresholds } from './threshold-calibrator.service.js';

const strategyConfigSchema = z.object({
  name: z.string(),
  shortTermWeights: z.object({
    sentiment: z.number().min(0).max(1),
    technical: z.number().min(0).max(1),
    fundamental: z.number().min(0).max(1),
  }).optional(),
  mediumTermWeights: z.object({
    sentiment: z.number().min(0).max(1),
    technical: z.number().min(0).max(1),
    fundamental: z.number().min(0).max(1),
  }).optional(),
  buyThreshold: z.number().min(0).max(100),
  sellThreshold: z.number().min(0).max(100),
  stopLossPercent: z.number().min(0).max(100),
  takeProfitPercent: z.number().min(0).max(100),
});

export const quantRouter = router({
  triggerBacktest: publicProcedure
    .input(z.object({
      symbol: z.string().min(1),
      startDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
      endDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
      strategy: strategyConfigSchema,
    }))
    .mutation(async ({ input }) => {
      const runId = await runBacktest(input);
      return { runId };
    }),

  getBacktestRun: publicProcedure
    .input(z.object({ runId: z.number() }))
    .query(({ input }) => getBacktestRun(input.runId)),

  listBacktestRuns: publicProcedure
    .input(z.object({ limit: z.number().optional().default(20) }))
    .query(({ input }) => listBacktestRuns(input.limit)),

  getQuantContext: publicProcedure
    .query(() => getStageQuantContext()),

  triggerBulkBacktest: publicProcedure
    .mutation(() => {
      void runBulkBacktest();
      return { started: true };
    }),

  bulkBacktestStatus: publicProcedure
    .query(() => getBulkBacktestStatus()),

  getBacktestForSymbol: publicProcedure
    .input(z.object({ symbol: z.string().min(1) }))
    .query(({ input }) => getLatestBacktestForSymbol(input.symbol)),

  backtestSummaryByClass: publicProcedure
    .query(() => getBacktestSummaryByClass()),

  calibrateThresholds: publicProcedure
    .mutation(() => calibrateThresholdsFromBacktests()),

  getThresholdsByClass: publicProcedure
    .query(() => getAllAssetClassThresholds()),
});
