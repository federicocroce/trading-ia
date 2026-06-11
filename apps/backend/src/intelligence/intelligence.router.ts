import { z } from 'zod';
import { router, publicProcedure } from '../trpc.js';
import type { OpportunitySector } from '@trading/shared';
import { getStoredDailyReport, getStoredDailyReportByDate } from './daily-report.service.js';
import { getMarketDigest } from '../opportunities/opportunities.service.js';
import { getCachedMarketReport, getCachedMarketReportByDate } from './market-report.service.js';
import { getStoredSectorReports } from './sector-report.service.js';
import { getSectorImpactMap } from './sector-impact-map.service.js';
import {
  checkOrRunPipeline,
  rerunPipelineStage,
  getPipelineRunByDate,
  getActivePipelineRun,
  getPipelineHistory,
  resolveWebSearch,
} from './pipeline.service.js';
import { isLMStudioAvailable } from '../shared/lmstudio.js';
import { getReportDates } from './pipeline.repository.js';
import { getCausalMapByDate } from '../db/repository.js';
import {
  getAllDiscoveryQueries,
  updateDiscoveryQuery,
  addDiscoveryQuery,
  deleteDiscoveryQuery,
  getAllThematicQueries,
  updateThematicQuery,
  addThematicQuery,
  deleteThematicQuery,
} from './config.repository.js';
import { getStageArtifactsByRun, getUnifiedBatchesByRun } from './pipeline-artifacts.repository.js';
import { getAccuracyReport } from './accuracy.service.js';
import { getEarningsContext } from './earnings-calendar.service.js';
import {
  getPendingProposal,
  getWeightHistory,
  approveWeightProposal,
  rejectWeightProposal,
  getActiveWeights,
} from './weight-adjustment.service.js';

export const intelligenceRouter = router({
  dailyReport: publicProcedure.query(() => {
    return getStoredDailyReport();
  }),

  marketDigest: publicProcedure.query(() => {
    return getMarketDigest();
  }),

  marketReport: publicProcedure.query(() => {
    return getCachedMarketReport();
  }),

  reportDates: publicProcedure.query(() => {
    return getReportDates();
  }),

  earningsCalendar: publicProcedure
    .input(z.object({ daysAhead: z.number().int().min(1).max(30).default(7) }).optional())
    .query(async ({ input }) => {
      const ctx = await getEarningsContext(input?.daysAhead ?? 7);
      return ctx.upcomingEarnings;
    }),

  reportsByDate: publicProcedure
    .input(z.object({ date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/) }))
    .query(({ input }) => {
      return {
        marketReport: getCachedMarketReportByDate(input.date),
        dailyReport: getStoredDailyReportByDate(input.date),
        date: input.date,
      };
    }),

  // Replaces old generateMarketReport — now triggers the full pipeline
  generateMarketReport: publicProcedure
    .input(z.object({
      force: z.boolean().optional(),
      sectors: z.array(z.string()).optional(),
      aiMode: z.enum(['cloud', 'local']).default('cloud'),
    }).optional())
    .mutation(async ({ input }) => {
      // Fire-and-forget: bloquear aca colgaba el HTTP todo el run (~40min) y la UI
      // nunca veia el estado. El prefijo SINCRONO de checkOrRunPipeline ya crea/marca
      // el run (status=running) antes de su primer await, asi que devolvemos esa fila
      // de inmediato y el frontend pollea pipelineStatus. Mismo patron que
      // runFullPipeline en opportunities.service.ts.
      checkOrRunPipeline(
        input?.force ?? false,
        input?.sectors as OpportunitySector[] | undefined,
        input?.aiMode ?? 'cloud',
      ).catch(err => console.error('[pipeline] async run error:', (err as Error).message));
      const today = new Date().toISOString().split('T')[0];
      return getActivePipelineRun() ?? getPipelineRunByDate(today)!;
    }),

  // Pipeline status for polling (every 2s while running)
  pipelineStatus: publicProcedure.query(() => {
    const today = new Date().toISOString().split('T')[0];
    const active = getActivePipelineRun();
    if (active) return active;
    return getPipelineRunByDate(today);
  }),

  // Pipeline history (last 7 runs)
  pipelineHistory: publicProcedure
    .input(z.object({ limit: z.number().min(1).max(30).default(7) }).optional())
    .query(({ input }) => {
      return getPipelineHistory(input?.limit ?? 7);
    }),

  // Re-run a specific stage
  rerunStage: publicProcedure
    .input(z.object({
      stage: z.enum(['webSearch', 'news', 'fundamentals', 'analysis', 'report']),
      aiMode: z.enum(['cloud', 'local']).default('cloud'),
    }))
    .mutation(async ({ input }) => {
      // Fire-and-forget (mismo razonamiento que generateMarketReport): el prefijo
      // sincrono de rerunPipelineStage ya hizo markRunAsRunning antes del primer await.
      rerunPipelineStage(input.stage, input.aiMode)
        .catch(err => console.error('[pipeline] async rerun error:', (err as Error).message));
      const today = new Date().toISOString().split('T')[0];
      return getActivePipelineRun() ?? getPipelineRunByDate(today)!;
    }),

  resolveWebSearch: publicProcedure
    .input(z.object({ action: z.enum(['retry', 'skip', 'cancel']) }))
    .mutation(async ({ input }) => {
      return resolveWebSearch(input.action);
    }),

  sectorReports: publicProcedure.query(() => {
    return getStoredSectorReports();
  }),

  // Mapa macro → sectores: síntesis causal + scan + cartera (al vuelo, sin persistencia)
  sectorImpactMap: publicProcedure.query(() => {
    return getSectorImpactMap();
  }),

  lmStudioStatus: publicProcedure.query(async () => {
    return { available: await isLMStudioAvailable() };
  }),

  // Config: Discovery queries
  configGetDiscoveryQueries: publicProcedure.query(() => {
    return getAllDiscoveryQueries();
  }),

  configUpdateDiscoveryQuery: publicProcedure
    .input(z.object({
      id: z.number(),
      query: z.string().optional(),
      active: z.boolean().optional(),
      priority: z.number().optional(),
      category: z.string().optional(),
    }).refine(d => Object.keys(d).length > 1, { message: 'At least one field required' }))
    .mutation(({ input }) => {
      updateDiscoveryQuery(input.id, { query: input.query, active: input.active, priority: input.priority, category: input.category });
      return { ok: true };
    }),

  configAddDiscoveryQuery: publicProcedure
    .input(z.object({
      query: z.string().min(5),
      lang: z.enum(['en', 'es']),
      category: z.string().optional(),
      priority: z.number().optional(),
    }))
    .mutation(({ input }) => {
      return addDiscoveryQuery(input);
    }),

  configDeleteDiscoveryQuery: publicProcedure
    .input(z.object({ id: z.number() }))
    .mutation(({ input }) => {
      deleteDiscoveryQuery(input.id);
      return { ok: true };
    }),

  // Config: Thematic queries
  configGetThematicQueries: publicProcedure.query(() => {
    return getAllThematicQueries();
  }),

  configUpdateThematicQuery: publicProcedure
    .input(z.object({
      id: z.number(),
      name: z.string().optional(),
      keywords: z.array(z.string()).optional(),
      active: z.boolean().optional(),
      priority: z.number().optional(),
    }).refine(d => Object.keys(d).length > 1, { message: 'At least one field required' }))
    .mutation(({ input }) => {
      updateThematicQuery(input.id, { name: input.name, keywords: input.keywords, active: input.active, priority: input.priority });
      return { ok: true };
    }),

  configAddThematicQuery: publicProcedure
    .input(z.object({
      name: z.string().min(2),
      keywords: z.array(z.string()).min(1),
      priority: z.number().optional(),
    }))
    .mutation(({ input }) => {
      return addThematicQuery(input);
    }),

  configDeleteThematicQuery: publicProcedure
    .input(z.object({ id: z.number() }))
    .mutation(({ input }) => {
      deleteThematicQuery(input.id);
      return { ok: true };
    }),

  // Audit trail
  pipelineArtifacts: publicProcedure
    .input(z.object({ pipelineRunId: z.number().min(1) }))
    .query(({ input }) => {
      return getStageArtifactsByRun(input.pipelineRunId);
    }),

  pipelineUnifiedBatches: publicProcedure
    .input(z.object({ pipelineRunId: z.number().min(1) }))
    .query(({ input }) => {
      return getUnifiedBatchesByRun(input.pipelineRunId);
    }),

  accuracyReport: publicProcedure
    .input(z.object({ days: z.union([z.literal(30), z.literal(60), z.literal(90), z.literal(180)]).default(90) }).optional())
    .query(({ input }) => {
      return getAccuracyReport(input?.days ?? 90);
    }),

  // Weight adjustment
  weightPendingProposal: publicProcedure.query(() => {
    return getPendingProposal();
  }),

  weightHistory: publicProcedure.query(() => {
    return getWeightHistory();
  }),

  weightCurrentWeights: publicProcedure.query(() => {
    return getActiveWeights();
  }),

  weightApproveProposal: publicProcedure
    .input(z.object({ id: z.number() }))
    .mutation(({ input }) => {
      approveWeightProposal(input.id);
      return { ok: true };
    }),

  weightRejectProposal: publicProcedure
    .input(z.object({ id: z.number(), reason: z.string().optional() }))
    .mutation(({ input }) => {
      rejectWeightProposal(input.id, input.reason);
      return { ok: true };
    }),

  causalMap: publicProcedure
    .input(z.object({ date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional() }).optional())
    .query(({ input }) => {
      const date = input?.date ?? new Date().toISOString().slice(0, 10);
      return getCausalMapByDate(date);
    }),
});
