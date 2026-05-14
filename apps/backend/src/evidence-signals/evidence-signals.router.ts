import { z } from 'zod';
import { router, publicProcedure } from '../trpc.js';
import {
  getCachedScanResult,
  triggerScan,
  getScanStatus,
  getEvidenceSignalForSymbol,
  getLastScanRuns,
} from './evidence-signals.service.js';
import { getSignalTrackingHistory, getSignalAccuracyStats, getEvidenceSnapshotDates, getEvidenceSnapshotByDate } from '../db/repository.js';
import { getCachedAnalysis, getAllCachedAnalyses } from './deep-analysis.service.js';
import { runSignalResolver } from './signal-resolver.service.js';
import { triggerNewsPipeline, getNewsPipelineStatus, getNewsPipelineResults } from './news-pipeline.service.js';
import { getStoredSectorReports } from '../intelligence/sector-report.service.js';

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

  scanDates: publicProcedure.query(() => getEvidenceSnapshotDates()),

  snapshotByDate: publicProcedure
    .input(z.object({ date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/) }))
    .query(({ input }) => {
      const row = getEvidenceSnapshotByDate(input.date);
      if (!row) return null;
      return {
        ...row,
        signals: JSON.parse(row.signals),
        analyses: JSON.parse(row.analyses),
        marketRegime: row.marketRegime ? JSON.parse(row.marketRegime) : null,
      };
    }),

  getScanHistory: publicProcedure
    .query(() => getLastScanRuns(10)),

  // ─── Convergence: symbols in both pipelines ───────────────────────────────
  getConvergence: publicProcedure.query(() => {
    const scanResult = getCachedScanResult();
    const newsResult = getNewsPipelineResults();
    const analyses = getAllCachedAnalyses();
    const sectorReports = getStoredSectorReports();

    const analysisMap = new Map(analyses.map((a) => [a.symbol, a]));
    const scanMap = new Map(scanResult.signals.map((s) => [s.symbol, s]));
    const newsMap = new Map(newsResult.signals.map((s) => [s.symbol, s]));
    const sectorByTicker = new Map<string, (typeof sectorReports)[number]>();
    for (const r of sectorReports) {
      for (const t of r.suggestedTickers) sectorByTicker.set(t, r);
    }

    function convictionScore(c: string) {
      return c === 'high' ? 3 : c === 'medium' ? 2 : c === 'low' ? 1 : 0;
    }

    // Intersection: in both pipelines
    const intersection = [...scanMap.keys()]
      .filter((sym) => newsMap.has(sym))
      .map((sym) => {
        const scan = scanMap.get(sym)!;
        const news = newsMap.get(sym)!;
        const analysis = analysisMap.get(sym) ?? null;
        const sector = sectorByTicker.get(sym) ?? null;
        // Combined conviction: scan (0-3) weighted x2 + news (0-2) + verdict bonus (0-2) + sector bonus (-1/0/1)
        const verdictBonus = analysis?.verdict === 'BUY_SETUP' ? 2 : analysis?.verdict === 'WAIT' ? 1 : 0;
        const sectorBonus = sector?.impact === 'positive' ? 1 : sector?.impact === 'negative' ? -1 : 0;
        const combined = convictionScore(scan.conviction) * 2 + convictionScore(news.conviction) + verdictBonus + sectorBonus;
        return {
          symbol: sym,
          currentPrice: scan.currentPrice,
          scanConviction: scan.conviction,
          newsConviction: news.conviction,
          compositeScore: scan.compositeScore,
          sector: sector?.sector ?? null,
          sectorImpact: sector?.impact ?? null,
          sectorCatalysts: sector?.catalysts ?? [],
          analysis: analysis ? {
            verdict: analysis.verdict,
            confidence: analysis.confidence,
            reasoning: analysis.reasoning,
            entryZone: analysis.entryZone,
            target: analysis.target,
            stopLoss: analysis.stopLoss,
            riskReward: analysis.riskReward,
          } : null,
          combinedScore: Math.max(0, combined),
          signals: {
            pead: scan.pead.active,
            insider: scan.insider.active,
            options: scan.optionsFlow.active,
          },
        };
      })
      .sort((a, b) => b.combinedScore - a.combinedScore);

    // Only in scan (signals without news confirmation)
    const onlyInScan = [...scanMap.keys()]
      .filter((sym) => !newsMap.has(sym) && scanMap.get(sym)!.activeSignals > 0)
      .map((sym) => ({ symbol: sym, conviction: scanMap.get(sym)!.conviction, compositeScore: scanMap.get(sym)!.compositeScore }))
      .sort((a, b) => b.compositeScore - a.compositeScore)
      .slice(0, 10);

    // Only in news (thematic plays without technical signals)
    const onlyInNews = [...newsMap.keys()]
      .filter((sym) => !scanMap.has(sym))
      .map((sym) => {
        const sector = sectorByTicker.get(sym) ?? null;
        return { symbol: sym, sector: sector?.sector ?? null, sectorImpact: sector?.impact ?? null };
      });

    return { intersection, onlyInScan, onlyInNews };
  }),

  // ─── News-First Pipeline ──────────────────────────────────────────────────
  newsPipelineTrigger: publicProcedure
    .mutation(() => {
      triggerNewsPipeline();
      return { ok: true, message: 'Pipeline news-first iniciado en background' };
    }),

  newsPipelineStatus: publicProcedure
    .query(() => getNewsPipelineStatus()),

  newsPipelineResults: publicProcedure
    .query(() => getNewsPipelineResults()),

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
