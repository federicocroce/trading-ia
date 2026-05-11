import { z } from 'zod';
import { TRPCError } from '@trpc/server';
import type { Opportunity, Price } from '@trading/shared';
import { router, publicProcedure } from '../trpc.js';
import { getEtfWatchlist, addEtfToWatchlist, removeEtfFromWatchlist, getLatestOpportunityScan } from '../db/repository.js';
import { getAssetProfile } from '../shared/yahoo.js';
import { getAllPrices } from '../prices/prices.service.js';
import { getTechnicalSummary } from '../technical/technical-analysis.service.js';

const ETF_CATEGORIES = ['indices', 'sectores', 'bonos', 'commodities', 'latam', 'internacional', 'crypto', 'factor'] as const;

export const etfRouter = router({
  getWatchlist: publicProcedure.query(() => getEtfWatchlist()),

  getEnrichedWatchlist: publicProcedure.query(async () => {
    const etfs = getEtfWatchlist();
    const prices = await getAllPrices();
    const scan = getLatestOpportunityScan();

    const priceMap = new Map<string, Price>(prices.map(p => [p.symbol, p]));
    const oppMap = new Map<string, Opportunity>();
    if (scan) {
      try {
        const opps = JSON.parse(scan.opportunities) as Opportunity[];
        for (const o of opps) oppMap.set(o.symbol, o);
      } catch { /* ignore parse errors */ }
    }

    // Fetch RSI for ETFs without opportunity data (parallel, cached)
    const techPromises = etfs.map(async (etf) => {
      if (oppMap.has(etf.symbol)) return null;
      try {
        const tech = await getTechnicalSummary(etf.symbol);
        return { symbol: etf.symbol, rsi: tech.indicators.rsi14 ?? null };
      } catch {
        return { symbol: etf.symbol, rsi: null };
      }
    });
    const techResults = await Promise.all(techPromises);
    const techMap = new Map<string, number | null>();
    for (const t of techResults) {
      if (t) techMap.set(t.symbol, t.rsi);
    }

    return etfs.map((etf) => {
      const price = priceMap.get(etf.symbol);
      const opp = oppMap.get(etf.symbol);
      const rsiFromOpp = opp ? (opp as unknown as { indicators?: { rsi14?: number } }).indicators?.rsi14 : undefined;
      return {
        ...etf,
        price: price?.current ?? null,
        changePercent: price?.changePercent ?? null,
        action: opp?.action ?? null,
        opportunityScore: opp?.opportunityScore ?? null,
        confidence: opp?.confidence ?? null,
        rsi: rsiFromOpp ?? techMap.get(etf.symbol) ?? null,
        thesis: opp?.unifiedAnalysis?.thesis ?? opp?.reasoning ?? null,
        narrative: opp?.unifiedAnalysis?.narrative ?? opp?.narrativeDigest ?? null,
        analyzedAt: scan?.scannedAt ? new Date(scan.scannedAt).getTime() : null,
      };
    });
  }),

  getCategories: publicProcedure.query(() => ETF_CATEGORIES),

  addToWatchlist: publicProcedure
    .input(z.object({
      symbol: z.string().min(1).max(10),
      category: z.enum(ETF_CATEGORIES),
      description: z.string().optional(),
    }))
    .mutation(async ({ input }) => {
      const symbol = input.symbol.toUpperCase();
      const profile = await getAssetProfile(symbol);
      if (!profile) {
        throw new TRPCError({ code: 'BAD_REQUEST', message: `Símbolo ${symbol} no encontrado en Yahoo Finance` });
      }
      const name = profile.longName ?? symbol;
      try {
        addEtfToWatchlist(symbol, name, input.category, input.description);
      } catch (err: unknown) {
        const msg = err instanceof Error ? err.message : String(err);
        if (msg.includes('UNIQUE') || msg.includes('unique')) {
          throw new TRPCError({ code: 'CONFLICT', message: `${symbol} ya está en el watchlist` });
        }
        throw new TRPCError({ code: 'INTERNAL_SERVER_ERROR', message: 'Error al agregar ETF' });
      }
      return { success: true, symbol, name };
    }),

  removeFromWatchlist: publicProcedure
    .input(z.object({ symbol: z.string().min(1).max(10) }))
    .mutation(({ input }) => {
      removeEtfFromWatchlist(input.symbol.toUpperCase());
      return { success: true };
    }),
});
