import { z } from 'zod';
import type { NewsRadarSnapshot } from '@trading/shared';
import { router, publicProcedure } from '../trpc.js';
import { getNewsFromDB, getSourceStats } from './news.service.js';
import { getAnalyzedNews, getIntelligenceFromDB, refreshIntelligence, prepareDeepAnalysisNews } from './news-intelligence.service.js';
import { generateNewsRadar } from './news-radar.service.js';
import {
  getLatestNewsRadarSnapshot,
  getNewsRadarSnapshotsByDateRange,
  getLatestNewsIntelligenceSnapshot,
  getNewsIntelligenceSnapshotsByDateRange,
} from '../db/repository.js';

function deserializeSnapshot(row: ReturnType<typeof getLatestNewsRadarSnapshot>): NewsRadarSnapshot | null {
  if (!row) return null;
  try {
    return {
      generatedAt: new Date(row.generatedAt).getTime(),
      totalNewsAnalyzed: row.totalNewsAnalyzed,
      perArticle: JSON.parse(row.perArticle),
      aggregatedSignals: JSON.parse(row.aggregatedSignals),
      emergingNarratives: row.emergingNarratives ? JSON.parse(row.emergingNarratives) : undefined,
      llmModel: row.llmModel ?? undefined,
      durationMs: row.durationMs ?? undefined,
    };
  } catch {
    return null;
  }
}

export const newsRouter = router({
  getAll: publicProcedure.query(async () => {
    // Read from BD only — fetch happens via "Noticias" button
    return getNewsFromDB();
  }),

  sourceStats: publicProcedure.query(() => {
    return getSourceStats();
  }),

  getBySymbol: publicProcedure
    .input(z.object({ symbol: z.string().min(1) }))
    .query(async ({ input }) => {
      const news = getNewsFromDB();
      return news.filter((n) =>
        n.relatedTickers.includes(input.symbol)
      );
    }),

  getAnalyzed: publicProcedure.query(async () => {
    return getAnalyzedNews();
  }),

  intelligence: publicProcedure.query(async () => {
    // Read from BD/cache — never triggers API fetch
    return getIntelligenceFromDB();
  }),

  refreshIntelligence: publicProcedure.mutation(async () => {
    return refreshIntelligence();
  }),

  // --- News Radar v2 (cause + impacts) ---

  radarLatest: publicProcedure.query(() => {
    return deserializeSnapshot(getLatestNewsRadarSnapshot());
  }),

  radarRecent: publicProcedure
    .input(z.object({ limit: z.number().min(1).max(50).default(10) }).optional())
    .query(({ input }) => {
      const sinceISO = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString();
      const rows = getNewsRadarSnapshotsByDateRange(sinceISO, input?.limit ?? 10);
      return rows.map(deserializeSnapshot).filter((s): s is NewsRadarSnapshot => s != null);
    }),

  refreshRadar: publicProcedure.mutation(async () => {
    const news = await prepareDeepAnalysisNews();
    if (news.length === 0) {
      return { ok: false, reason: 'no-articles', snapshot: null };
    }
    const snapshot = await generateNewsRadar(news, { persist: true });
    return { ok: true, snapshot };
  }),

  // --- Intelligence snapshots history ---

  intelligenceLatest: publicProcedure.query(() => {
    const row = getLatestNewsIntelligenceSnapshot();
    if (!row) return null;
    return {
      generatedAt: new Date(row.generatedAt).getTime(),
      totalNewsCount: row.totalNewsCount,
      plazas: JSON.parse(row.plazas),
      alerts: JSON.parse(row.alerts),
      topHeadlines: row.topHeadlines ? JSON.parse(row.topHeadlines) : [],
      triangulationStats: row.triangulationStats ? JSON.parse(row.triangulationStats) : null,
    };
  }),

  intelligenceHistory: publicProcedure
    .input(z.object({ limit: z.number().min(1).max(50).default(15) }).optional())
    .query(({ input }) => {
      const sinceISO = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString();
      const rows = getNewsIntelligenceSnapshotsByDateRange(sinceISO, input?.limit ?? 15);
      return rows.map(r => ({
        generatedAt: new Date(r.generatedAt).getTime(),
        totalNewsCount: r.totalNewsCount,
        plazas: JSON.parse(r.plazas),
        alerts: JSON.parse(r.alerts),
        topHeadlines: r.topHeadlines ? JSON.parse(r.topHeadlines) : [],
        triangulationStats: r.triangulationStats ? JSON.parse(r.triangulationStats) : null,
      }));
    }),
});
