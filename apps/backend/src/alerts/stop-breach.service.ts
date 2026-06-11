import type { AnticipatoryAlert } from '@trading/shared';
import {
  getPortfolioPositions,
  getActiveAnticipatoryAlerts,
  upsertAnticipatoryAlerts,
  getLatestOpportunityScan,
} from '../db/repository.js';
import { getQuotes } from '../shared/yahoo.js';

export interface StopBreachPosition { symbol: string; quantity: number; avgCost: number; }
export interface StopBreachOpp { symbol: string; inPortfolio: boolean; tradeLevels?: { entryPrice: number; stopLoss: number; takeProfit: number }; }

/** Puro: posiciones × stops del último scan × precios actuales → breaches. */
export function detectStopBreaches(
  positions: StopBreachPosition[],
  opportunities: StopBreachOpp[],
  prices: Map<string, number>,
  today: string,
): AnticipatoryAlert[] {
  const held = new Set(positions.map(p => p.symbol.toUpperCase()));
  const breaches: AnticipatoryAlert[] = [];

  for (const opp of opportunities) {
    if (!opp.inPortfolio || !held.has(opp.symbol.toUpperCase())) continue;
    const stop = opp.tradeLevels?.stopLoss;
    if (stop == null || stop <= 0) continue;
    const price = prices.get(opp.symbol);
    if (price == null || price <= 0) continue;
    if (price >= stop) continue;

    breaches.push({
      id: `stop:${opp.symbol}`,
      kind: 'stop_breach',
      symbol: opp.symbol,
      signals: [{
        category: 'divergence', // sin categoria propia en v1; el kind manda en UI
        description: `${opp.symbol} perforó el stop sugerido $${stop.toFixed(2)} (precio $${price.toFixed(2)}). Revisar salida — proteger capital.`,
        estimatedDays: 0,
      }],
      currentPrice: price,
      stopLoss: stop,
      score: 0,
      status: 'active',
      firstSeenDate: today,
      lastSeenDate: today,
      seen: false,
    });
  }
  return breaches;
}

/** Runner con I/O: dedup contra alertas activas (no re-insertar el mismo breach). */
export async function checkStopBreaches(): Promise<number> {
  const positions = getPortfolioPositions();
  if (positions.length === 0) return 0;

  const scan = getLatestOpportunityScan();
  if (!scan) return 0;
  const opportunities: StopBreachOpp[] = JSON.parse(scan.opportunities);

  const quotes = await getQuotes(positions.map(p => p.symbol));
  const prices = new Map(quotes.map(q => [q.symbol, q.current]));
  const today = new Date().toISOString().slice(0, 10);

  const breaches = detectStopBreaches(positions, opportunities, prices, today);
  const activeIds = new Set(getActiveAnticipatoryAlerts().map(a => a.id));
  const fresh = breaches.filter(b => !activeIds.has(b.id));
  if (fresh.length > 0) {
    upsertAnticipatoryAlerts(fresh, []);
    console.log(`[stop-breach] ${fresh.length} stops perforados: ${fresh.map(b => b.symbol).join(', ')}`);
  }
  return fresh.length;
}
